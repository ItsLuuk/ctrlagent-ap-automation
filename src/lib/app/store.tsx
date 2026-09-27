import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { hasSampleData, mergeById, sampleDataPayload, withoutSampleData } from "@/lib/ap/demo-data";
import {
  uid,
  EMPTY_BUSINESS_PROFILE,
  type AnchorSpec,
  type BusinessProfile,
  type Invoice,
  type InvoiceStatus,
  type LineItemsSpec,
  type VendorTemplate,
  type ZoneField,
  type ZoneMap,
} from "@/lib/ap/types";
import { clearKnownHashes, recordFileHash } from "@/lib/ap/file-hash-gate";
import {
  autoLearnProfile,
  clearProfiles,
  clearTemplates,
  confirmProfile,
  readAllProfiles,
  readAllTemplates,
  upsertTemplate as persistTemplate,
} from "@/lib/ap/vendor-profile-store";
import { validateInvoiceForConfirmation } from "@/lib/ap/mapping";
import { appendAudit, changesForPatch, fieldEvidence } from "@/lib/ap/audit-evidence";
import { matchInvoiceToPo } from "@/lib/ap/matching";
import { matchNoPoInvoice, type FlexContract, type FlexReceipt, type FlexRule } from "@/lib/ap/flex-matching";
import {
  clearFlexPolicies,
  readFlexContracts,
  readFlexReceipts,
  readFlexRules,
  removeFlexPolicy as persistFlexPolicyRemoval,
  removeFlexReceipt as persistFlexReceiptRemoval,
  saveFlexContract as persistFlexContract,
  saveFlexReceipt as persistFlexReceipt,
  saveFlexRule as persistFlexRule,
} from "@/lib/ap/flex-store";
import { TEMPLATE_TRAINING_WHEELS } from "@/lib/ap/mapping-proposals";
import { fingerprintOf, embedVendorText } from "@/lib/ap/fingerprint";
import {
  archiveRecord,
  describeTransitionError,
  patchRefusal,
  restoreRecord,
  stripPrematureConfirmEntries,
  transition,
  type Actor,
  type TransitionOutcome,
} from "@/lib/ap/state-machine";
import { computeAutoTags, retagAll } from "@/lib/ap/auto-tags";
import { readAllPos, putPos, deletePos, clearPos } from "@/lib/ap/po-store";
import { samplePos } from "@/lib/ap/samples";
import type { PurchaseOrder } from "@/lib/ap/purchase-order";
import { loadFileUrl, clearAllFiles } from "@/lib/ap/file-store";
import type { VendorMaster } from "@/lib/ap/vendor-master";
import { operatorName as resolveOperatorName } from "@/lib/ap/operator";
import { DEFAULT_SOD_POLICY, normalizeSodPolicy, type SodPolicy, type SodRuleId } from "@/lib/ap/sod";
import {
  decideVendorBankChange,
  requestVendorBankChange,
  requiresVendorBankApproval,
  type VendorBankChange,
} from "@/lib/ap/vendor-bank-changes";
import {
  activeEntityOf,
  applyProfile,
  currencyForJurisdiction,
  DEFAULT_CHART_OF_ACCOUNTS,
  entityFromProfile,
  profileOf,
  taxProfileFor,
  type BusinessEntity,
} from "@/lib/ap/entities";
import { putRate, type FxRate } from "@/lib/ap/fx";
import { normalizeResidency, type ComplianceFramework, type DataResidency } from "@/lib/ap/compliance";

const STORAGE_KEY = "ap-automation-invoices-v1";
const HISTORY_STORAGE_KEY = "ap-automation-history-v1";
const REMOVED_STORAGE_KEY = "ap-automation-removed-v1";
const TEMPLATES_STORAGE_KEY = "ap-automation-templates-v1";
const VENDORS_STORAGE_KEY = "ap-automation-vendors-v1";
const BUSINESS_PROFILE_KEY = "ap-automation-business-profile-v1";
const OPERATOR_NAME_STORAGE_KEY = "ap-automation-operator-name-v1";
const SOD_POLICY_STORAGE_KEY = "ap-automation-sod-policy-v1";
const VENDOR_BANK_CHANGES_STORAGE_KEY = "ap-automation-vendor-bank-changes-v1";
const ENTITIES_STORAGE_KEY = "ap-automation-entities-v1";
const ACTIVE_ENTITY_STORAGE_KEY = "ap-automation-active-entity-v1";
const FX_RATES_STORAGE_KEY = "ap-automation-fx-rates-v1";
const COMPLIANCE_PACK_STORAGE_KEY = "ap-automation-compliance-pack-v1";

/**
 * Reads an invoice array straight out of a storage key.
 *
 * Synchronous and used from `useState` initialisers on purpose: an
 * effect-based rehydrate renders one commit with an empty queue, and the
 * persist effect fires on that commit — writing the emptiness over the user's
 * real invoices before hydration could land. Reading at first paint makes an
 * empty queue mean "empty" rather than "not read yet".
 */
function readStoredInvoices(key: string): Invoice[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Invoice[];
    return Array.isArray(parsed)
      ? parsed.map((invoice) => ({
          ...invoice,
          fieldEvidence: invoice.fieldEvidence ?? fieldEvidence(invoice),
        }))
      : [];
  } catch {
    return [];
  }
}

/** Maps a zone field to the nearest anchor label a user would have drawn on
 *  the page. Used by the legacy zone editor when migrating into the new
 *  VendorTemplate shape (anchor + region + regex). */
const ZONE_TO_ANCHOR: Record<string, string> = {
  vendor: "Factuur",
  invoiceNumber: "Factuurnummer",
  issueDate: "Factuurdatum",
  dueDate: "Vervaldatum",
  subtotal: "Subtotaal",
  tax: "BTW",
  total: "Totaal",
};

type Ctx = {
  invoices: Invoice[];
  history: Invoice[];
  purchaseOrders: PurchaseOrder[];
  /** No-PO approval policies and evidence stored on this device. */
  flexRules: FlexRule[];
  flexContracts: FlexContract[];
  flexReceipts: FlexReceipt[];
  saveFlexRule: (rule: Omit<FlexRule, "id"> & { id?: string }) => void;
  saveFlexContract: (contract: Omit<FlexContract, "id"> & { id?: string }) => void;
  saveFlexReceipt: (receipt: Omit<FlexReceipt, "id"> & { id?: string }) => void;
  removeFlexPolicy: (kind: "rule" | "contract", id: string) => void;
  removeFlexReceipt: (id: string) => void;
  /** Links/unlinks the purchase order. Always audited, attributed to `actor`
   *  so a decision made on the review screen names the person who made it. */
  linkPo: (invoiceId: string, poId: string | undefined, actor?: string) => void;
  /** Records a manual goods receipt against a PO line for three-way matching. */
  recordReceipt: (
    poId: string,
    poLineId: string,
    quantityReceived: number,
    actor?: string,
  ) => { accepted: boolean; reason?: string | undefined };
  addInvoice: (invoice: Invoice) => void;
  /** Patches an invoice. Pass `auditAction` to record the change in the audit
   *  trail, and `actor` for the name of the person making it — an edit is
   *  attributed to whoever made it, not to a default.
   *
   *  Frozen records take no patches: see `patchRefusal`. The outcome says whether
   *  the patch landed, so a screen can tell the user instead of toasting a
   *  success over a record that did not change. */
  updateInvoice: (
    id: string,
    patch: Partial<Invoice>,
    auditAction?: string,
    note?: string,
    actor?: string,
  ) => TransitionOutcome;
  setStatus: (
    id: string,
    status: InvoiceStatus,
    actor: string,
    action: string,
    note?: string,
  ) => void;
  /** Canonical Phase-Flow write path: validates the transition (state + role
   *  + SoD) before touching status. Returns whether it was accepted and, when
   *  not, the human-readable reason. */
  applyTransition: (
    id: string,
    input: {
      transition: Parameters<typeof import("@/lib/ap/state-machine").transition>[1]["transition"];
      actor: Actor;
      note?: string;
    },
  ) => import("@/lib/ap/state-machine").TransitionOutcome;
  markPaid: (id: string, actor: string, action: string, note?: string) => void;
  /** Takes a record out of the queue without destroying it. Validated by the
   *  state machine's `archive` rule, so which stages can be removed is the
   *  machine's decision and not the caller's. */
  removeInvoice: (id: string, actor: Actor, note?: string) => TransitionOutcome;
  /** Puts a removed record back where it was, with its document re-attached. */
  restoreInvoice: (id: string, actor: Actor) => TransitionOutcome;
  /** Records taken out of the queue — still readable, still restorable. */
  removed: Invoice[];
  templates: Record<string, VendorTemplate>;
  upsertTemplate: (vendor: string, zones: ZoneMap) => void;
  /** Canonical Phase-1 write path: persists human-confirmed mappings. */
  saveVendorTemplate: (input: SaveTemplateInput) => void;
  /** Decrements the vendor template's confirmNextCount (training wheels). */
  confirmTemplateExtraction: (vendor: string) => void;
  /** Canonical per-vendor profiles (zones + identity aliases). */
  vendorProfiles: Record<string, import("@/lib/ap/types").VendorProfile>;
  /** Vendor master records keyed by vendor name. */
  vendors: Record<string, VendorMaster>;
  /** Creates or updates a vendor master record. An enabled bank-change control returns a pending request instead of applying IBAN changes. */
  upsertVendor: (vendor: VendorMaster) => TransitionOutcome;
  /** Configured segregation-of-duties controls. */
  sodPolicy: SodPolicy;
  setSodRule: (rule: SodRuleId, enabled: boolean) => void;
  vendorBankChanges: VendorBankChange[];
  decideVendorBankChange: (id: string, decision: "approved" | "rejected") => TransitionOutcome;
  /** Workspace operator identity, independent from the active legal entity. */
  operatorDisplayName: string;
  setOperatorDisplayName: (name: string) => void;
  /** The user's own business profile — used to filter self-matches during extraction. */
  businessProfile: BusinessProfile;
  /** Update the business profile (lands on the active entity). */
  setBusinessProfile: (profile: BusinessProfile) => void;
  /** Every legal entity this install books for — the source of truth behind `businessProfile`. */
  entities: BusinessEntity[];
  /** The entity new work is booked under. */
  activeEntity: BusinessEntity;
  /** Switch the active entity. */
  setActiveEntity: (id: string) => void;
  /** Register a new entity and return it (the caller usually activates it). */
  createEntity: (input: {
    name: string;
    jurisdiction: string;
    baseCurrency: string;
  }) => BusinessEntity;
  /** Patch an entity: jurisdiction moves tax defaults and reporting currency. */
  updateEntity: (id: string, patch: Partial<BusinessEntity>) => void;
  /** The operator's exchange-rate table for consolidation. */
  fxRates: FxRate[];
  /** Record or replace the rate for one pair. */
  saveFxRate: (base: string, quote: string, rate: number) => void;
  /** Nothing captured and nothing completed — the state the app opens in. */
  isFirstRun: boolean;
  /** The queue or the history currently holds demo data. */
  hasSampleData: boolean;
  /** Loads the demo set. Anything already captured is left in place. */
  loadSampleData: () => void;
  /** Removes demo records only — real captures stay. */
  clearSampleData: () => void;
  /** Wipes every local record. Irreversible, so the caller confirms first. */
  clearAllData: () => void;
  /** Procurement readiness selection; it never claims certification. */
  complianceFrameworks: ComplianceFramework[];
  setComplianceFrameworks: (frameworks: ComplianceFramework[]) => void;
  dataResidency: DataResidency;
  setDataResidency: (residency: DataResidency) => void;
};

export type SaveTemplateInput = {
  vendor: string;
  /** Anchor specs for the scalar header fields. */
  fields: Partial<Record<ZoneField, AnchorSpec>>;
  /** Optional learned line-item block. */
  lineItems?: LineItemsSpec | undefined;
  /** Training wheels: hold the next N template extractions at Draft. */
  confirmNextCount?: number | undefined;
  /** Marks the save as a drift-update (bumps version with origin marker). */
  origin?: "confirmed" | "drift-update" | undefined;
  /** Raw page zones, stored on this invoice for the overlay/preview. */
  zones?: ZoneMap | undefined;
  /** Invoice whose `zones` field receives the drawn zones. */
  invoiceId?: string | undefined;
};

const AppContext = createContext<Ctx | null>(null);

export function ApProvider({ children }: { children: ReactNode }) {
  // No demo data on boot: the first run is empty by design (see demo-data.ts).
  const [invoices, setInvoices] = useState<Invoice[]>(() =>
    retagAll(
      readStoredInvoices(STORAGE_KEY).filter(
        (invoice) => invoice.status !== "paid" && invoice.status !== "archived",
      ),
      // Profiles are read here, not inside the tag rule: persistence stays the
      // store's concern and auto-tags stays a pure function of its inputs.
      readAllProfiles(),
    ),
  );
  const [history, setHistory] = useState<Invoice[]>(() =>
    // Paid invoices left the queue before History existed; archive them.
    mergeById(
      readStoredInvoices(HISTORY_STORAGE_KEY),
      readStoredInvoices(STORAGE_KEY).filter((invoice) => invoice.status === "paid"),
    ),
  );
  /**
   * Removed records. A removal leaves the queue but destroys nothing: the
   * record keeps its audit trail and can be put back, so it waits here rather
   * than being dropped. Read at first paint like the queue, for the same reason
   * — an empty Removed list must mean "empty", not "not read yet".
   */
  const [removed, setRemoved] = useState<Invoice[]>(() =>
    mergeById(
      readStoredInvoices(REMOVED_STORAGE_KEY),
      readStoredInvoices(STORAGE_KEY).filter((invoice) => invoice.status === "archived"),
    ),
  );
  const [templates, setTemplates] = useState<Record<string, VendorTemplate>>(() => {
    try {
      const persisted = readAllTemplates();
      if (Object.keys(persisted).length > 0) return persisted;
    } catch {
      /* stored profile unavailable — fall back to legacy key */
    }
    try {
      const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, VendorTemplate>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      }
    } catch {
      /* ignore corrupted storage */
    }
    return {};
  });
  // Vendor profiles: the canonical per-vendor document (zones + identity).
  // Read at first paint like every other persisted list — the persist effect
  // below must never run against state that has not been hydrated yet.
  const [vendorProfiles, setVendorProfiles] = useState<
    Record<string, import("@/lib/ap/types").VendorProfile>
  >(() => {
    try {
      return readAllProfiles();
    } catch {
      /* ignore corrupted storage */
      return {};
    }
  });
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(() => readAllPos());
  const [flexRules, setFlexRules] = useState<FlexRule[]>(() => readFlexRules());
  const [flexContracts, setFlexContracts] = useState<FlexContract[]>(() => readFlexContracts());
  const [flexReceipts, setFlexReceipts] = useState<FlexReceipt[]>(() => readFlexReceipts());
  const [operatorDisplayName, setOperatorDisplayNameState] = useState<string>(() => {
    try {
      return localStorage.getItem(OPERATOR_NAME_STORAGE_KEY)?.trim() || "";
    } catch {
      return "";
    }
  });
  const [sodPolicy, setSodPolicyState] = useState<SodPolicy>(() => {
    try {
      const raw = localStorage.getItem(SOD_POLICY_STORAGE_KEY);
      if (raw) return normalizeSodPolicy(JSON.parse(raw));
    } catch {
      /* corrupted or unavailable: safe defaults */
    }
    return { ...DEFAULT_SOD_POLICY };
  });
  const [complianceFrameworks, setComplianceFrameworksState] = useState<ComplianceFramework[]>(() => {
    try {
      const raw = localStorage.getItem(COMPLIANCE_PACK_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { frameworks?: unknown };
        if (Array.isArray(parsed.frameworks)) {
          return parsed.frameworks.filter((item): item is ComplianceFramework => item === "SOC 2" || item === "ISO 27001");
        }
      }
    } catch { /* corrupted or unavailable */ }
    return [];
  });
  const [dataResidency, setDataResidencyState] = useState<DataResidency>(() => {
    try { return normalizeResidency(JSON.parse(localStorage.getItem(COMPLIANCE_PACK_STORAGE_KEY) ?? "{}").residency); }
    catch { return "device-only"; }
  });

  const [vendorBankChanges, setVendorBankChanges] = useState<VendorBankChange[]>(() => {
    try {
      const raw = localStorage.getItem(VENDOR_BANK_CHANGES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as VendorBankChange[];
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      /* corrupted or unavailable */
    }
    return [];
  });
  const [vendorMaster, setVendorMaster] = useState<Record<string, VendorMaster>>(() => {
    try {
      const raw = localStorage.getItem(VENDORS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, VendorMaster>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      }
    } catch {
      /* ignore corrupted storage */
    }
    return {};
  });
  // Re-check active records when a period changes. History and removed records
  // are part of the duplicate universe, so a late/re-submitted PDF is compared
  // against prior periods rather than only the current queue.
  useEffect(() => {
    const profiles = readAllProfiles();
    setInvoices((previous) =>
      retagAll(previous, profiles, [...previous, ...history, ...removed]),
    );
  }, [history, removed]);

  /** Entities are the source of truth for identity; the legacy profile key
   *  seeds the first entity exactly once, read here before anything writes. */
  const [entities, setEntitiesState] = useState<BusinessEntity[]>(() => {
    try {
      const raw = localStorage.getItem(ENTITIES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as BusinessEntity[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      /* ignore */
    }
    // One-time migration: the singleton profile becomes the first entity.
    // The profile key is read here and never written again — the registry
    // owns identity from this point on.
    try {
      const raw = localStorage.getItem(BUSINESS_PROFILE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as BusinessProfile;
        if (parsed && typeof parsed === "object") {
          return [entityFromProfile({ ...EMPTY_BUSINESS_PROFILE, ...parsed })];
        }
      }
    } catch {
      /* ignore */
    }
    return [entityFromProfile(EMPTY_BUSINESS_PROFILE)];
  });

  const [activeEntityId, setActiveEntityIdState] = useState<string>(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_ENTITY_STORAGE_KEY);
      if (raw) return raw;
    } catch {
      /* ignore */
    }
    return "";
  });

  const [fxRates, setFxRatesState] = useState<FxRate[]>(() => {
    try {
      const raw = localStorage.getItem(FX_RATES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as FxRate[];
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      /* ignore */
    }
    return [];
  });

  /** The entity every "our side" decision reads from. The registry is never
   *  empty (the initializer guarantees one), so this always resolves. */
  const activeEntity = useMemo(
    () => activeEntityOf(entities, activeEntityId) ?? entities[0]!,
    [entities, activeEntityId],
  );
  /** The legacy projection: extraction, settings and approval keep the
   *  BusinessProfile shape while the store keeps one truth — the registry. */
  const businessProfile = useMemo(
    () => ({ ...profileOf(activeEntity), operatorName: operatorDisplayName }),
    [activeEntity, operatorDisplayName],
  );

  /** The store's lists as they stand right now, for callbacks that outlive the
   *  render that created them (the removal toast, for one). */
  const lists = useRef({ invoices, removed });
  useEffect(() => {
    lists.current = { invoices, removed };
  }, [invoices, removed]);

  // The theme cut left its key behind in every profile written before it —
  // nothing reads it now, so the entry is dead weight in the user's storage.
  useEffect(() => {
    try {
      localStorage.removeItem("foundry-theme");
    } catch {
      /* storage unavailable */
    }
  }, []);

  const persistEntities = useCallback((next: BusinessEntity[]) => {
    try {
      localStorage.setItem(ENTITIES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage full */
    }
    return next;
  }, []);

  /** Profile edits land on the active entity — one truth, one projection. */
  const setBusinessProfile = useCallback(
    (profile: BusinessProfile) => {
      setEntitiesState((current) => {
        const target = activeEntityOf(current, activeEntityId);
        if (!target) return current;
        return persistEntities(
          current.map((entity) => (entity.id === target.id ? applyProfile(entity, profile) : entity)),
        );
      });
    },
    [activeEntityId, persistEntities],
  );

  const setActiveEntity = useCallback((id: string) => {
    setActiveEntityIdState(id);
    try {
      localStorage.setItem(ACTIVE_ENTITY_STORAGE_KEY, id);
    } catch {
      /* storage full */
    }
  }, []);

  const createEntity = useCallback(
    (input: { name: string; jurisdiction: string; baseCurrency: string }): BusinessEntity => {
      const jurisdiction = input.jurisdiction.trim().toUpperCase();
      const entity: BusinessEntity = {
        id: `ent-${uid()}`,
        name: input.name.trim(),
        jurisdiction,
        baseCurrency: input.baseCurrency || currencyForJurisdiction(jurisdiction),
        address: "",
        email: "",
        iban: "",
        vatNumber: "",
        businessRegistrationNumber: "",
        chartOfAccounts: [...DEFAULT_CHART_OF_ACCOUNTS],
        tax: taxProfileFor(jurisdiction, false),
        createdAt: new Date().toISOString(),
      };
      setEntitiesState((current) => persistEntities([...current, entity]));
      return entity;
    },
    [persistEntities],
  );

  /** Patch an entity. Moving its jurisdiction moves the tax defaults and the
   *  reporting currency with it, unless the patch overrides them explicitly. */
  const updateEntity = useCallback(
    (id: string, patch: Partial<BusinessEntity>) => {
      setEntitiesState((current) =>
        persistEntities(
          current.map((entity) => {
            if (entity.id !== id) return entity;
            const jurisdiction = (patch.jurisdiction ?? entity.jurisdiction).trim().toUpperCase();
            const moved = jurisdiction !== entity.jurisdiction;
            return {
              ...entity,
              ...patch,
              id: entity.id,
              jurisdiction,
              baseCurrency:
                patch.baseCurrency ??
                (moved ? currencyForJurisdiction(jurisdiction) : entity.baseCurrency),
              tax:
                patch.tax ??
                (moved ? taxProfileFor(jurisdiction, entity.tax.registered) : entity.tax),
            };
          }),
        ),
      );
    },
    [persistEntities],
  );

  /** Record or replace the rate for one pair in the operator's table. */
  const saveFxRate = useCallback((base: string, quote: string, rate: number) => {
    setFxRatesState((current) => {
      const next = putRate(current, { base, quote, rate, at: new Date().toISOString() });
      try {
        localStorage.setItem(FX_RATES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage full */
      }
      return next;
    });
  }, []);

  const setOperatorDisplayName = useCallback((name: string) => {
    const normalized = name.trim();
    setOperatorDisplayNameState(normalized);
    try {
      if (normalized) localStorage.setItem(OPERATOR_NAME_STORAGE_KEY, normalized);
      else localStorage.removeItem(OPERATOR_NAME_STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const setSodRule = useCallback((rule: SodRuleId, enabled: boolean) => {
    setSodPolicyState((current) => {
      const next = { ...current, [rule]: enabled };
      try {
        localStorage.setItem(SOD_POLICY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    try { localStorage.setItem(COMPLIANCE_PACK_STORAGE_KEY, JSON.stringify({ frameworks: complianceFrameworks, residency: dataResidency })); }
    catch { /* storage unavailable */ }
  }, [complianceFrameworks, dataResidency]);

  useEffect(() => {
    try {
      localStorage.setItem(VENDOR_BANK_CHANGES_STORAGE_KEY, JSON.stringify(vendorBankChanges));
    } catch {
      /* storage unavailable */
    }
  }, [vendorBankChanges]);

  // The queue is read at first paint, but a stored invoice's blob URL died with
  // the last session. Source files live in IndexedDB (file-store), so hand each
  // upload a fresh URL once the store is up. Nothing is written from storage
  // here — only the URLs are added back — so the one-time capture is enough.
  const invoicesAtMount = useRef(invoices);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const missing = invoicesAtMount.current
        .filter((invoice) => invoice.source === "upload" && !invoice.fileUrl)
        .map((invoice) => invoice.id);
      if (missing.length === 0) return;
      const urls = new Map(
        await Promise.all(missing.map(async (id) => [id, await loadFileUrl(id)] as const)),
      );
      if (cancelled) return;
      setInvoices((prev) =>
        prev.map((invoice) => {
          const url = urls.get(invoice.id);
          return url ? { ...invoice, fileUrl: url } : invoice;
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(invoices.map(({ fileUrl: _fileUrl, ...rest }) => rest)),
      );
    } catch {
      /* storage full or unavailable */
    }
  }, [invoices]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "ap-automation-vendor-profiles-v1",
        JSON.stringify(vendorProfiles),
      );
    } catch {
      /* storage full or unavailable */
    }
  }, [vendorProfiles]);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
      /* storage full or unavailable */
    }
  }, [history]);

  useEffect(() => {
    try {
      localStorage.setItem(REMOVED_STORAGE_KEY, JSON.stringify(removed));
    } catch {
      /* storage full or unavailable */
    }
  }, [removed]);

  useEffect(() => {
    // The vendor profile store owns persistence. Keep the legacy template key
    // in sync while users still have legacy templates.
    try {
      const legacy = Object.fromEntries(
        Object.entries(templates).filter(
          ([, t]) => !t.vendor_fingerprint || t.vendor_fingerprint.startsWith("legacy-"),
        ),
      );
      if (Object.keys(legacy).length === 0) {
        localStorage.removeItem(TEMPLATES_STORAGE_KEY);
      } else {
        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(legacy));
      }
    } catch {
      /* storage full or unavailable */
    }
  }, [templates]);

  const addInvoice = useCallback((invoice: Invoice) => {
    // Record the file hash for duplicate detection (already computed at ingest).
    if (invoice.fileHash) {
      recordFileHash(invoice.fileHash);
    }
    const profiles = readAllProfiles();
    setInvoices((prev) => {
      const knownInvoices = [...prev, ...history, ...removed];
      // Compute auto-tags for the new invoice against every known period.
      const tagged = {
        ...invoice,
        // Booked under whoever was active at capture; records without an
        // entity fall back to the first entity in the report.
        entity: invoice.entity ?? activeEntity?.id ?? "",
        fieldEvidence: fieldEvidence(invoice),
        tags: computeAutoTags(invoice, knownInvoices, profiles),
      };
      // Re-compute tags for existing invoices from the same vendor
      // (e.g. "First-time vendor" becomes "Recurring")
      const vendorLower = invoice.vendor.toLowerCase();
      const updated = prev.map((inv) =>
        inv.vendor.toLowerCase() === vendorLower
          ? { ...inv, tags: computeAutoTags(inv, [...knownInvoices, tagged], profiles) }
          : inv,
      );
      return [tagged, ...updated];
    });
    // Auto-learn: when an invoice came from the VLM or document-text path, it
    // is novel for this vendor — persist a provisional vendor profile so the
    // next one skips the slow path. Template-path hits don't need to be
    // re-learned. The profile is a provisional cache (origin "auto"); at
    // confirm time it gets refined or promoted to "reviewed".
    if (invoice.engine !== "template") {
      const profile = autoLearnProfile(invoice);
      if (profile) {
        setVendorProfiles((prev) => ({
          ...prev,
          [profile.vendor_key]: profile,
        }));
        // Keep the legacy template store in sync for backward compatibility.
        const legacy: VendorTemplate = {
          vendor_fingerprint: profile.vendor_key,
          vendor_key: profile.vendor_key,
          embedding: [],
          version: profile.version,
          fields: profile.fields,
          line_items: profile.line_items,
          origin: "learned",
          updatedAt: profile.updatedAt,
        };
        setTemplates((prev) => ({
          ...prev,
          [profile.vendor_key]: legacy,
        }));
        persistTemplate(legacy);
      }
    }
  }, [history, removed, activeEntity]);

  const updateInvoice = useCallback<Ctx["updateInvoice"]>((id, patch, auditAction, note, actor) => {
    // The machine guards transitions; this is its field-level counterpart. A
    // record someone has decided may not be patched — not by a screen, not by
    // a job racing an approval — or the signature on it would outlive the
    // number it signed. The caller is told, so the refusal can be shown rather
    // than toasted as a success over nothing.
    const target = lists.current.invoices.find((inv) => inv.id === id);
    const refusal = target ? patchRefusal(target) : null;
    if (refusal) return refusal;
    const profiles = readAllProfiles();
    setInvoices((prev) => {
      // Find the invoice being updated to re-compute its auto-tags
      const target = prev.find((inv) => inv.id === id);
      const updated = prev.map((inv) => {
        if (inv.id !== id) return inv;
        const patched = {
          ...inv,
          ...patch,
          audit: inv.audit,
        };
        // Re-compute auto-tags if data-relevant fields changed
        const dataChanged =
          patch.total !== undefined ||
          patch.invoiceNumber !== undefined ||
          patch.currency !== undefined ||
          patch.vendor !== undefined ||
          patch.iban !== undefined ||
          patch.dueDate !== undefined ||
          patch.issueDate !== undefined ||
          patch.status !== undefined;
        if (dataChanged) {
          patched.tags = computeAutoTags(patched, [...prev, ...history, ...removed], profiles);
        }
        if (
          patch.confidence !== undefined ||
          patch.provenance !== undefined ||
          patch.fieldSources !== undefined ||
          patch.zones !== undefined
        ) {
          patched.fieldEvidence = fieldEvidence(patched);
        }
        const changes = changesForPatch(inv, patch);
        if (auditAction || Object.keys(changes).length > 0) {
          return appendAudit(patched, {
            actor: actor ?? "system",
            action: auditAction ?? "Invoice updated",
            note,
            changes,
          });
        }
        return patched;
      });
      return updated;
    });
    return { accepted: true };
  }, [history, removed]);

  const setStatus = useCallback<Ctx["setStatus"]>((id, status, actor, action, note) => {
    // Same freeze as updateInvoice: a decided record's status moves only
    // through the machine's transitions, never by a direct write that could
    // silently unfreeze it or rewrite where a signature sits.
    const target = lists.current.invoices.find((inv) => inv.id === id);
    if (target && patchRefusal(target)) return;
    setInvoices((prev) =>
      prev.map((inv) =>
        inv.id === id
          ? appendAudit(
              { ...inv, status },
              {
                actor,
                action,
                note,
                changes: { status: { before: inv.status, after: status } },
              },
            )
          : inv,
      ),
    );
  }, []);

  /** Links (or unlinks) a purchase order to an invoice — a draft-phase
   *  decision that drives approval matching. Audited. Frozen records take
   *  no link either: the PO the approval matched against is part of what
   *  was signed. Trying to link a frozen record returns a refusal immediately. */
  const linkPo = useCallback(
    (invoiceId: string, poId: string | undefined, actor?: string) => {
      const target = lists.current.invoices.find((inv) => inv.id === invoiceId);
      const refusal = target ? patchRefusal(target) : null;
      if (refusal) return refusal;
      setInvoices((prev) =>
        prev.map((inv) => {
          if (inv.id !== invoiceId || inv.poId === poId) return inv;
          const po = poId ? purchaseOrders.find((p) => p.id === poId) : undefined;
          return appendAudit(
            { ...inv, poId },
            {
              actor: actor ?? resolveOperatorName({ operatorName: operatorDisplayName }),
              action: po ? `Linked PO ${po.number}` : "Unlinked PO",
              changes: { poId: { before: inv.poId, after: poId } },
            },
          );
        }),
      );
      // Every path answers explicitly — a refusal, or nothing to link.
      return undefined;
    },
    [operatorDisplayName, purchaseOrders],
  );

  /** Records a manual goods receipt without mutating the invoice record. */
  const recordReceipt = useCallback<Ctx["recordReceipt"]>(
    (poId, poLineId, quantityReceived, actor) => {
      const po = purchaseOrders.find((candidate) => candidate.id === poId);
      if (!po) return { accepted: false, reason: "Purchase order not found." };
      if (!po.lines.some((line) => line.id === poLineId)) {
        return { accepted: false, reason: "Purchase-order line not found." };
      }
      if (!Number.isFinite(quantityReceived) || quantityReceived <= 0) {
        return { accepted: false, reason: "Received quantity must be greater than zero." };
      }

      setPurchaseOrders((previous) => {
        const next = previous.map((candidate) =>
          candidate.id === poId
            ? {
                ...candidate,
                receipts: [
                  ...candidate.receipts,
                  {
                    poLineId,
                    quantityReceived,
                    receivedAt: new Date().toISOString(),
                    recordedBy: actor ?? resolveOperatorName({ operatorName: operatorDisplayName }),
                    source: "manual" as const,
                  },
                ],
              }
            : candidate,
        );
        return putPos(next);
      });
      return { accepted: true };
    },
    [operatorDisplayName, purchaseOrders],
  );

  /**
   * Canonical Phase-Flow write path (plan §1). Runs the transition through
   * the state machine — legality, actor role, mandatory reason, SoD — and
   * applies the status change + audit entry only when it passes.
   */
  const saveFlexRule = useCallback<Ctx["saveFlexRule"]>((rule) => {
    setFlexRules(persistFlexRule(rule));
  }, []);
  const saveFlexContract = useCallback<Ctx["saveFlexContract"]>((contract) => {
    setFlexContracts(persistFlexContract(contract));
  }, []);
  const saveFlexReceipt = useCallback<Ctx["saveFlexReceipt"]>((receipt) => {
    setFlexReceipts(persistFlexReceipt(receipt));
  }, []);
  const removeFlexPolicy = useCallback<Ctx["removeFlexPolicy"]>((kind, id) => {
    persistFlexPolicyRemoval(kind, id);
    if (kind === "rule") setFlexRules(readFlexRules());
    else setFlexContracts(readFlexContracts());
  }, []);
  const removeFlexReceipt = useCallback<Ctx["removeFlexReceipt"]>((id) => {
    persistFlexReceiptRemoval(id);
    setFlexReceipts(readFlexReceipts());
  }, []);

  const applyTransition = useCallback<Ctx["applyTransition"]>((id, input) => {
    let outcome: import("@/lib/ap/state-machine").TransitionOutcome = {
      accepted: false,
      reason: "Invoice not found — reload and try again.",
    };
    // flushSync: the caller reads `outcome` immediately, but React defers this
    // updater whenever an earlier dispatch in the same tick (upsertVendor,
    // updateInvoice) already queued a lane on the provider — so the updater ran
    // only after `return`, and a successful transition reported "Invoice not
    // found". The flush keeps evaluation on fresh state (inside the updater)
    // while making the synchronous result truthful.
    flushSync(() =>
      setInvoices((prev) =>
        prev.map((inv) => {
          if (inv.id !== id) return inv;
          // Repair premature "Confirmed draft" audit entries before validation
          // and SoD read the trail — otherwise one bad entry bricks confirm
          // forever with no visible cause. Persisted even on rejection.
          // A confirm is a confirm wherever the operator is standing: from
          // Draft, or from Profiling when the mapper pinned the profile and
          // the fields in one pass.
          const isConfirm =
            input.transition === "confirm" || input.transition === "confirm-from-profiling";
          const repaired = isConfirm ? stripPrematureConfirmEntries(inv) : inv;
          const validationIssues = isConfirm
            ? validateInvoiceForConfirmation(repaired, "confirm")
            : input.transition === "approve"
                ? validateInvoiceForConfirmation(repaired, "approve")
                : [];
          const blocking = validationIssues.find((issue) => issue.severity === "error");
          if (blocking) {
            console.warn(
              `[state-machine] rejected ${input.transition} on ${id}: invoice validation failed`,
              validationIssues,
            );
            outcome = { accepted: false, reason: blocking.message };
            return repaired;
          }
          if (input.transition === "approve") {
            const linkedPo = repaired.poId
              ? purchaseOrders.find((candidate) => candidate.id === repaired.poId)
              : undefined;
            if (linkedPo && repaired.lineItems.length > 0) {
              const match = matchInvoiceToPo(repaired.lineItems, linkedPo.lines, {
                receipts: linkedPo.receipts ?? [],
              });
              if (match.mode === "three_way" && match.exceptions.length > 0) {
                const reason = `Resolve ${match.exceptions.length} three-way matching exception${
                  match.exceptions.length === 1 ? "" : "s"
                } before approval.`;
                console.warn(`[state-machine] rejected approve on ${id}: ${reason}`);
                outcome = { accepted: false, reason };
                return repaired;
              }
            }
            if (!linkedPo) {
              const flexMatch = matchNoPoInvoice(repaired, {
                contracts: flexContracts,
                receipts: flexReceipts,
                rules: flexRules,
              });
              if (flexMatch.blocksApproval) {
                const reason = flexMatch.explanation;
                console.warn(`[state-machine] rejected approve on ${id}: ${reason}`);
                outcome = { accepted: false, reason };
                return repaired;
              }
            }
          }
          const result = transition(repaired, { ...input, sodPolicy });
          if (!result.ok) {
            console.warn(`[state-machine] rejected ${input.transition} on ${id}:`, result.error);
            outcome = { accepted: false, reason: describeTransitionError(result.error) };
            return repaired;
          }
          outcome = { accepted: true };
          // Confirm-time profile refinement: diff the confirmed fields against
          // the original extraction to compute corrections, then refine the
          // vendor profile. Corrections → origin "reviewed" with re-derived
          // specs; no corrections → promote auto → reviewed (cheap, honest).
          if (input.transition === "confirm") {
            const original = inv.originalExtraction ?? {};
            const corrections: Record<string, string | number> = {};
            for (const field of [
              "vendor",
              "invoiceNumber",
              "issueDate",
              "dueDate",
              "subtotal",
              "tax",
              "total",
              "address",
              "vendorEmail",
              "iban",
              "vatNumber",
              "businessRegistrationNumber",
            ] as const) {
              const current = repaired[field];
              const orig = original[field];
              if (current !== undefined && orig !== undefined && String(current) !== String(orig)) {
                corrections[field] = current as string | number;
              }
            }
            const profile = confirmProfile(repaired, corrections);
            if (profile) {
              setVendorProfiles((prev) => ({
                ...prev,
                [profile.vendor_key]: profile,
              }));
            }
          }
          return {
            ...repaired,
            status: result.result.status,
            audit: appendAudit(repaired, {
              actor: input.actor.name,
              action: result.result.auditAction,
              note: input.note,
            }).audit,
          };
        }),
      ),
    );
    // A local handoff marker does not archive the invoice or imply payment.
    // Only a real external integration may create a paid/completed record.
    return outcome;
  }, [purchaseOrders, flexContracts, flexReceipts, flexRules, sodPolicy]);

  const markPaid = useCallback<Ctx["markPaid"]>((id, actor, action, note) => {
    const profiles = readAllProfiles();
    setInvoices((prev) => {
      const moving = prev.find((inv) => inv.id === id);
      if (!moving) return prev;
      const paid: Invoice = {
        ...moving,
        status: "paid",
        audit: appendAudit(moving, {
          actor,
          action,
          note,
          changes: { status: { before: moving.status, after: "paid" } },
        }).audit,
      };
      setHistory((h) => {
        const nextHistory = [paid, ...h];
        return retagAll(nextHistory, profiles, [...prev, ...nextHistory, ...removed]);
      });
      // Payment closes the active record, then the remaining queue is checked
      // again against the new paid period.
      return retagAll(
        prev.filter((inv) => inv.id !== id),
        profiles,
        [...prev, paid, ...history, ...removed],
      );
    });
  }, [history, removed]);

  /**
   * Removal. The record leaves the working queue and waits under Removed with
   * its audit trail intact; nothing is destroyed and nothing is silently
   * mutated. The state machine owns which stages this is legal for — asking it
   * is what keeps the affordance and the rule from drifting apart.
   *
   * Both this and Restore read the store's lists through refs rather than
   * through the render they were created in. The removal toast's Undo is created
   * by the very click that removes the record, so a callback closed over this
   * render's `removed` array would look for the record in the list from before
   * the move and never find it.
   */
  const removeInvoice = useCallback<Ctx["removeInvoice"]>((id, actor, note) => {
    const target = lists.current.invoices.find((invoice) => invoice.id === id);
    if (!target) return { accepted: false, reason: "Invoice not found — reload and try again." };
    const result = transition(target, {
      transition: "archive",
      actor,
      ...(note ? { note } : {}),
    });
    if (!result.ok) {
      console.warn(`[state-machine] rejected archive on ${id}:`, result.error);
      return { accepted: false, reason: describeTransitionError(result.error) };
    }
    // The blob URL died with the queue entry; the file itself is still in the
    // file store, so Restore hands a fresh one back.
    const { fileUrl: _fileUrl, ...persisted } = target;
    const record = archiveRecord(persisted, actor, result.result, note);
    setInvoices((prev) => prev.filter((invoice) => invoice.id !== id));
    setRemoved((prev) => [record, ...prev]);
    return { accepted: true };
  }, []);

  const restoreInvoice = useCallback<Ctx["restoreInvoice"]>((id, actor) => {
    const target = lists.current.removed.find((invoice) => invoice.id === id);
    if (!target) return { accepted: false, reason: "That record is no longer in Removed." };
    // Back where it was: a removed draft returns to Draft, a removed profile
    // stage returns to the profile stage.
    const restored = restoreRecord(target, actor);
    setRemoved((prev) => prev.filter((invoice) => invoice.id !== id));
    setInvoices((prev) => [restored, ...prev]);
    if (restored.source === "upload" && !restored.fileUrl) {
      void loadFileUrl(id).then((url) => {
        if (!url) return;
        setInvoices((prev) =>
          prev.map((invoice) => (invoice.id === id ? { ...invoice, fileUrl: url } : invoice)),
        );
      });
    }
    return { accepted: true };
  }, []);

  /**
   * Canonical template write path (Phase 1). Persists human-confirmed anchor
   * mappings as a VendorTemplate. When the vendor already has a template the
   * existing fingerprint/embedding are kept so matching stays stable.
   */
  const saveVendorTemplate = useCallback<Ctx["saveVendorTemplate"]>(
    (input) => {
      const {
        vendor,
        fields,
        lineItems,
        confirmNextCount,
        origin,
        zones: invoiceZones,
        invoiceId,
      } = input;
      if (!vendor || Object.keys(fields).length === 0) return;
      const existing = templates[vendor];
      const tpl: VendorTemplate = {
        vendor_fingerprint: existing?.vendor_fingerprint ?? fingerprintOf(vendor),
        vendor_key: vendor,
        embedding: existing?.embedding ?? embedVendorText(vendor),
        version: (existing?.version ?? 0) + 1,
        fields,
        ...(lineItems ? { line_items: lineItems } : {}),
        confirmNextCount:
          confirmNextCount ?? existing?.confirmNextCount ?? (existing ? 0 : TEMPLATE_TRAINING_WHEELS),
        ...(origin !== undefined ? { origin } : { origin: "confirmed" as const }),
        updatedAt: new Date().toISOString(),
      };
      setTemplates((prev) => ({ ...prev, [vendor]: tpl }));
      persistTemplate(tpl);
      // Mirror the drawn zones onto the confirmed invoice so the overlay and
      // template preview agree with what was saved. A frozen record keeps its
      // zones too — they describe the fields the decision was made against.
      if (invoiceZones && invoiceId) {
        setInvoices((prev) =>
          prev.map((inv) => {
            if (inv.id !== invoiceId || patchRefusal(inv)) return inv;
            return { ...inv, zones: invoiceZones };
          }),
        );
      }
    },
    [templates],
  );

  /** Training wheels: decrement confirmNextCount when a held draft is confirmed. */
  const confirmTemplateExtraction = useCallback((vendor: string) => {
    setTemplates((prev) => {
      const tpl = prev[vendor];
      if (!tpl || !tpl.confirmNextCount || tpl.confirmNextCount <= 0) return prev;
      const next = { ...tpl, confirmNextCount: tpl.confirmNextCount - 1 };
      persistTemplate(next);
      return { ...prev, [vendor]: next };
    });
  }, []);

  const upsertTemplate = useCallback((vendor: string, zones: ZoneMap) => {
    setTemplates((prev) => {
      const prevTpl = prev[vendor];
      const fields: Partial<
        Record<import("@/lib/ap/types").ZoneField, import("@/lib/ap/types").AnchorSpec>
      > = {};
      for (const field of Object.keys(zones) as (keyof typeof zones)[]) {
        const zone = zones[field];
        if (!zone) continue;
        // Translate the legacy Zone (raw rect) into an AnchorSpec whose anchor
        // sits at the top-left of the rectangle. The apply path uses anchor-
        // relative coordinates, so we collapse the region to (0..1, 0..1)
        // around the anchor and let the matcher scan the whole zone area.
        fields[field] = {
          anchor: ZONE_TO_ANCHOR[field] ?? field,
          region: { x0: 0, y0: 0, x1: 1, y1: 1 },
          type:
            field === "issueDate" || field === "dueDate"
              ? "date"
              : field === "subtotal" || field === "tax" || field === "total"
                ? "decimal"
                : "string",
        };
        (fields[field] as unknown as { _zone?: typeof zone })._zone = zone;
      }
      const tpl: VendorTemplate = {
        vendor_fingerprint:
          prevTpl?.vendor_fingerprint ??
          `legacy-${vendor.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        vendor_key: vendor,
        embedding: prevTpl?.embedding ?? [],
        version: (prevTpl?.version ?? 0) + 1,
        fields,
        confirmNextCount:
          prevTpl?.confirmNextCount ?? (prevTpl ? 0 : TEMPLATE_TRAINING_WHEELS),
        updatedAt: new Date().toISOString(),
      };
      return { ...prev, [vendor]: tpl };
    });
  }, []);

  const upsertVendor = useCallback(
    (vendor: VendorMaster): TransitionOutcome => {
      const current = vendorMaster[vendor.name];
      if (requiresVendorBankApproval(current, vendor, sodPolicy)) {
        const change = requestVendorBankChange({
          id: uid(),
          current: current!,
          proposed: vendor,
          actor: { name: resolveOperatorName({ operatorName: operatorDisplayName }), roles: ["processor", "approver", "treasury"] },
          now: new Date().toISOString(),
        });
        setVendorBankChanges((previous) => [change, ...previous]);
        return {
          accepted: false,
          reason: "Bank details are pending approval by a different person.",
        };
      }
      setVendorMaster((prev) => ({ ...prev, [vendor.name]: vendor }));
      return { accepted: true };
    },
    [operatorDisplayName, sodPolicy, vendorMaster],
  );

  const decideBankChange = useCallback(
    (id: string, decision: "approved" | "rejected"): TransitionOutcome => {
      const change = vendorBankChanges.find((candidate) => candidate.id === id);
      if (!change) return { accepted: false, reason: "Bank-change request not found." };
      const result = decideVendorBankChange(
        change,
        { name: resolveOperatorName({ operatorName: operatorDisplayName }), roles: ["processor", "approver", "treasury"] },
        decision,
        new Date().toISOString(),
      );
      if (!result.ok) return { accepted: false, reason: result.message };
      setVendorBankChanges((previous) =>
        previous.map((candidate) => (candidate.id === id ? result.change : candidate)),
      );
      if (decision === "approved") {
        setVendorMaster((previous) => ({
          ...previous,
          [result.change.proposed.name]: result.change.proposed,
        }));
      }
      return { accepted: true };
    },
    [operatorDisplayName, vendorBankChanges],
  );

  useEffect(() => {
    try {
      localStorage.setItem(VENDORS_STORAGE_KEY, JSON.stringify(vendorMaster));
    } catch {
      /* storage full or unavailable */
    }
  }, [vendorMaster]);

  /** Explicit opt-in to the demo set. Captures already in the queue stay. */
  const loadSampleData = useCallback(() => {
    const payload = sampleDataPayload();
    setInvoices((prev) => mergeById(prev, payload.invoices));
    setHistory((prev) => mergeById(prev, payload.history));
    // Merge by hand rather than replacing: a real PO with the same id wins.
    setPurchaseOrders((prev) => putPos([...payload.purchaseOrders, ...prev]));
  }, []);

  /** Takes the demo set back out; documents the user captured are untouched. */
  const clearSampleData = useCallback(() => {
    setInvoices((prev) => withoutSampleData(prev));
    setHistory((prev) => withoutSampleData(prev));
    setPurchaseOrders(deletePos(samplePos().map((po) => po.id)));
  }, []);

  /**
   * Wipes every local record — queue, history, templates, source files,
   * purchase orders and vendor masters. There is no server to restore from, so
   * the UI confirms before calling this.
   */
  const setComplianceFrameworks = useCallback((frameworks: ComplianceFramework[]) => {
    setComplianceFrameworksState([...new Set(frameworks)]);
  }, []);
  const setDataResidency = useCallback((residency: DataResidency) => {
    setDataResidencyState(normalizeResidency(residency));
  }, []);

  const clearAllData = useCallback(() => {
    setInvoices([]);
    setHistory([]);
    setRemoved([]);
    setTemplates({});
    clearTemplates();
    setVendorProfiles({});
    clearProfiles();
    void clearAllFiles();
    clearPos();
    setPurchaseOrders([]);
    clearFlexPolicies();
    setFlexRules([]);
    setFlexContracts([]);
    setFlexReceipts([]);
    // The vendor-master persist effect writes the empty object back out.
    setVendorMaster({});
    setVendorBankChanges([]);
    clearKnownHashes();
  }, []);

  const value = useMemo(
    () => ({
      invoices,
      history,
      removed,
      purchaseOrders,
      flexRules,
      flexContracts,
      flexReceipts,
      saveFlexRule,
      saveFlexContract,
      saveFlexReceipt,
      removeFlexPolicy,
      removeFlexReceipt,
      linkPo,
      recordReceipt,
      addInvoice,
      updateInvoice,
      setStatus,
      applyTransition,
      markPaid,
      removeInvoice,
      restoreInvoice,
      templates,
      upsertTemplate,
      saveVendorTemplate,
      confirmTemplateExtraction,
      vendorProfiles,
      vendors: vendorMaster,
      upsertVendor,
      sodPolicy,
      setSodRule,
      vendorBankChanges,
      decideVendorBankChange: decideBankChange,
      operatorDisplayName,
      setOperatorDisplayName,
      businessProfile,
      setBusinessProfile,
      entities,
      activeEntity,
      setActiveEntity,
      createEntity,
      updateEntity,
      fxRates,
      saveFxRate,
      isFirstRun: invoices.length === 0 && history.length === 0 && removed.length === 0,
      hasSampleData: hasSampleData(invoices, history),
      loadSampleData,
      clearSampleData,
      clearAllData,
      complianceFrameworks,
      setComplianceFrameworks,
      dataResidency,
      setDataResidency,
    }),
    [
      invoices,
      history,
      removed,
      purchaseOrders,
      flexRules,
      flexContracts,
      flexReceipts,
      saveFlexRule,
      saveFlexContract,
      saveFlexReceipt,
      removeFlexPolicy,
      removeFlexReceipt,
      linkPo,
      recordReceipt,
      addInvoice,
      updateInvoice,
      setStatus,
      applyTransition,
      markPaid,
      removeInvoice,
      restoreInvoice,
      templates,
      upsertTemplate,
      saveVendorTemplate,
      confirmTemplateExtraction,
      vendorProfiles,
      vendorMaster,
      upsertVendor,
      sodPolicy,
      setSodRule,
      vendorBankChanges,
      decideBankChange,
      operatorDisplayName,
      setOperatorDisplayName,
      businessProfile,
      setBusinessProfile,
      entities,
      activeEntity,
      setActiveEntity,
      createEntity,
      updateEntity,
      fxRates,
      saveFxRate,
      loadSampleData,
      clearSampleData,
      clearAllData,
      complianceFrameworks,
      setComplianceFrameworks,
      dataResidency,
      setDataResidency,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAp must be used inside ApProvider");
  return ctx;
}
