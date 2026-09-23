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
import { hasSampleData, mergeById, sampleDataPayload, withoutSampleData } from "./demo-data";
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
} from "./types";
import {
  upsertTemplate as persistTemplate,
  clearTemplates,
  readAllTemplates,
} from "./template-store";
import { buildTemplateFromInvoice } from "./ocr";
import { validateInvoiceForConfirmation } from "./mapping";
import { fingerprintOf, embedVendorText } from "./fingerprint";
import {
  archiveRecord,
  describeTransitionError,
  patchRefusal,
  restoreRecord,
  stripPrematureConfirmEntries,
  transition,
  type Actor,
  type TransitionOutcome,
} from "./state-machine";
import { computeAutoTags, retagAll } from "./auto-tags";
import { readAllPos, putPos, deletePos, clearPos, samplePos, type PurchaseOrder } from "./po-store";
import { loadFileUrl, clearAllFiles } from "./file-store";
import type { VendorMaster } from "./vendor-master";

const STORAGE_KEY = "ap-automation-invoices-v1";
const HISTORY_STORAGE_KEY = "ap-automation-history-v1";
const REMOVED_STORAGE_KEY = "ap-automation-removed-v1";
const TEMPLATES_STORAGE_KEY = "ap-automation-templates-v1";
const VENDORS_STORAGE_KEY = "ap-automation-vendors-v1";
const BUSINESS_PROFILE_KEY = "ap-automation-business-profile-v1";

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
    return Array.isArray(parsed) ? parsed : [];
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
  /** Links/unlinks the purchase order. Always audited, attributed to `actor`
   *  so a decision made on the review screen names the person who made it. */
  linkPo: (invoiceId: string, poId: string | undefined, actor?: string) => void;
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
      transition: Parameters<typeof import("./state-machine").transition>[1]["transition"];
      actor: Actor;
      note?: string;
    },
  ) => import("./state-machine").TransitionOutcome;
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
  /** Vendor master records keyed by vendor name. */
  vendors: Record<string, VendorMaster>;
  /** Creates or updates a vendor master record. */
  upsertVendor: (vendor: VendorMaster) => void;
  /** The user's own business profile — used to filter self-matches during extraction. */
  businessProfile: BusinessProfile;
  /** Update the business profile. */
  setBusinessProfile: (profile: BusinessProfile) => void;
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
  const [templates, setTemplates] = useState<Record<string, VendorTemplate>>({});
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(() => readAllPos());
  const [vendorMaster, setVendorMaster] = useState<Record<string, VendorMaster>>({});
  const [businessProfile, setBusinessProfileState] = useState<BusinessProfile>(() => {
    try {
      const raw = localStorage.getItem(BUSINESS_PROFILE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as BusinessProfile;
        if (parsed && typeof parsed === "object") return { ...EMPTY_BUSINESS_PROFILE, ...parsed };
      }
    } catch {
      /* ignore */
    }
    return EMPTY_BUSINESS_PROFILE;
  });

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

  const setBusinessProfile = useCallback((profile: BusinessProfile) => {
    setBusinessProfileState(profile);
    try {
      localStorage.setItem(BUSINESS_PROFILE_KEY, JSON.stringify(profile));
    } catch {
      /* storage full */
    }
  }, []);

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
      const persisted = readAllTemplates();
      if (Object.keys(persisted).length > 0) {
        setTemplates((prev) => ({ ...prev, ...persisted }));
        return;
      }
    } catch {
      /* template-store not loaded — fall back to legacy key */
    }
    try {
      const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, VendorTemplate>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) setTemplates(parsed);
      }
    } catch {
      /* ignore corrupted storage */
    }
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
    // The new template-store handles its own persistence. We only keep the
    // legacy key in sync while users still have legacy templates, so they
    // don't get silently dropped on refresh.
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
    setInvoices((prev) => {
      // Compute auto-tags for the new invoice
      const tagged = { ...invoice, tags: computeAutoTags(invoice, prev) };
      // Re-compute tags for existing invoices from the same vendor
      // (e.g. "First-time vendor" becomes "Recurring")
      const vendorLower = invoice.vendor.toLowerCase();
      const updated = prev.map((inv) =>
        inv.vendor.toLowerCase() === vendorLower
          ? { ...inv, tags: computeAutoTags(inv, [...prev, tagged]) }
          : inv,
      );
      return [tagged, ...updated];
    });
    // Auto-learn: when an invoice came from the VLM or OCR-fallback path, it
    // is novel for this vendor — persist a VendorTemplate so the next one
    // skips the slow path. Template-path hits don't need to be re-learned.
    if (invoice.engine !== "template") {
      const learned = buildTemplateFromInvoice(invoice);
      if (learned) {
        setTemplates((prev) => {
          const prevVersion = prev[learned.vendor_key]?.version ?? 0;
          const next = {
            ...prev,
            [learned.vendor_key]: {
              ...learned,
              version: prevVersion + 1,
            } satisfies VendorTemplate,
          };
          // Persist out-of-band to keep the in-memory state snappy.
          persistTemplate(learned);
          return next;
        });
      }
    }
  }, []);

  const updateInvoice = useCallback<Ctx["updateInvoice"]>((id, patch, auditAction, note, actor) => {
    // The machine guards transitions; this is its field-level counterpart. A
    // record someone has decided may not be patched — not by a screen, not by
    // a job racing an approval — or the signature on it would outlive the
    // number it signed. The caller is told, so the refusal can be shown rather
    // than toasted as a success over nothing.
    const target = lists.current.invoices.find((inv) => inv.id === id);
    const refusal = target ? patchRefusal(target) : null;
    if (refusal) return refusal;
    setInvoices((prev) => {
      // Find the invoice being updated to re-compute its auto-tags
      const target = prev.find((inv) => inv.id === id);
      const updated = prev.map((inv) => {
        if (inv.id !== id) return inv;
        const patched = {
          ...inv,
          ...patch,
          audit: auditAction
            ? [
                ...inv.audit,
                {
                  id: uid(),
                  at: new Date().toISOString(),
                  actor: actor ?? "Luuk Koppen",
                  action: auditAction,
                  note,
                },
              ]
            : inv.audit,
        };
        // Re-compute auto-tags if data-relevant fields changed
        const dataChanged =
          patch.total !== undefined ||
          patch.vendor !== undefined ||
          patch.iban !== undefined ||
          patch.dueDate !== undefined ||
          patch.issueDate !== undefined ||
          patch.status !== undefined;
        if (dataChanged) {
          patched.tags = computeAutoTags(patched, prev);
        }
        return patched;
      });
      return updated;
    });
    return { accepted: true };
  }, []);

  const setStatus = useCallback<Ctx["setStatus"]>((id, status, actor, action, note) => {
    // Same freeze as updateInvoice: a decided record's status moves only
    // through the machine's transitions, never by a direct write that could
    // silently unfreeze it or rewrite where a signature sits.
    const target = lists.current.invoices.find((inv) => inv.id === id);
    if (target && patchRefusal(target)) return;
    setInvoices((prev) =>
      prev.map((inv) =>
        inv.id === id
          ? {
              ...inv,
              status,
              audit: [
                ...inv.audit,
                { id: uid(), at: new Date().toISOString(), actor, action, note },
              ],
            }
          : inv,
      ),
    );
  }, []);

  /** Links (or unlinks) a purchase order to an invoice — a draft-phase
   *  decision that drives approval matching. Audited. Frozen records take
   *  no link either: the PO the approval matched against is part of what
   *  was signed. */
  const linkPo = useCallback(
    (invoiceId: string, poId: string | undefined, actor?: string) => {
      const target = lists.current.invoices.find((inv) => inv.id === invoiceId);
      if (target && patchRefusal(target)) return;
      setInvoices((prev) =>
        prev.map((inv) => {
          if (inv.id !== invoiceId || inv.poId === poId) return inv;
          const po = poId ? purchaseOrders.find((p) => p.id === poId) : undefined;
          return {
            ...inv,
            poId,
            audit: [
              ...inv.audit,
              {
                id: uid(),
                at: new Date().toISOString(),
                actor: actor ?? "Luuk Koppen",
                action: po ? `Linked PO ${po.number}` : "Unlinked PO",
              },
            ],
          };
        }),
      );
    },
    [purchaseOrders],
  );

  /**
   * Canonical Phase-Flow write path (plan §1). Runs the transition through
   * the state machine — legality, actor role, mandatory reason, SoD — and
   * applies the status change + audit entry only when it passes.
   */
  const applyTransition = useCallback<Ctx["applyTransition"]>((id, input) => {
    let outcome: import("./state-machine").TransitionOutcome = {
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
          const repaired = input.transition === "confirm" ? stripPrematureConfirmEntries(inv) : inv;
          const validationIssues =
            input.transition === "confirm"
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
          const result = transition(repaired, input);
          if (!result.ok) {
            console.warn(`[state-machine] rejected ${input.transition} on ${id}:`, result.error);
            outcome = { accepted: false, reason: describeTransitionError(result.error) };
            return repaired;
          }
          outcome = { accepted: true };
          return {
            ...repaired,
            status: result.result.status,
            audit: [
              ...repaired.audit,
              {
                id: uid(),
                at: new Date().toISOString(),
                actor: input.actor.name,
                action: result.result.auditAction,
                note: input.note,
              },
            ],
          };
        }),
      ),
    );
    // A local handoff marker does not archive the invoice or imply payment.
    // Only a real external integration may create a paid/completed record.
    return outcome;
  }, []);

  const markPaid = useCallback<Ctx["markPaid"]>((id, actor, action, note) => {
    setInvoices((prev) => {
      const moving = prev.find((inv) => inv.id === id);
      if (moving) {
        setHistory((h) => [
          {
            ...moving,
            status: "paid" as Invoice["status"],
            audit: [
              ...moving.audit,
              { id: uid(), at: new Date().toISOString(), actor, action, note },
            ],
          },
          ...h,
        ]);
      }
      return prev.filter((inv) => inv.id !== id);
    });
  }, []);

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
        ...(confirmNextCount !== undefined ? { confirmNextCount } : {}),
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
      const fields: Partial<Record<import("./types").ZoneField, import("./types").AnchorSpec>> = {};
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
        // We attach the raw zone so the legacy zone-check path can still find it.
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
        updatedAt: new Date().toISOString(),
      };
      return { ...prev, [vendor]: tpl };
    });
  }, []);

  const upsertVendor = useCallback((vendor: VendorMaster) => {
    setVendorMaster((prev) => ({ ...prev, [vendor.name]: vendor }));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(VENDORS_STORAGE_KEY, JSON.stringify(vendorMaster));
    } catch {
      /* storage full or unavailable */
    }
  }, [vendorMaster]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(VENDORS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, VendorMaster>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setVendorMaster((prev) => ({ ...prev, ...parsed }));
        }
      }
    } catch {
      /* ignore corrupted storage */
    }
  }, []);

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
  const clearAllData = useCallback(() => {
    setInvoices([]);
    setHistory([]);
    setTemplates({});
    clearTemplates();
    void clearAllFiles();
    clearPos();
    setPurchaseOrders([]);
    // The vendor-master persist effect writes the empty object back out.
    setVendorMaster({});
  }, []);

  const value = useMemo(
    () => ({
      invoices,
      history,
      removed,
      purchaseOrders,
      linkPo,
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
      vendors: vendorMaster,
      upsertVendor,
      businessProfile,
      setBusinessProfile,
      isFirstRun: invoices.length === 0 && history.length === 0 && removed.length === 0,
      hasSampleData: hasSampleData(invoices, history),
      loadSampleData,
      clearSampleData,
      clearAllData,
    }),
    [
      invoices,
      history,
      removed,
      purchaseOrders,
      linkPo,
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
      vendorMaster,
      upsertVendor,
      businessProfile,
      setBusinessProfile,
      loadSampleData,
      clearSampleData,
      clearAllData,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAp must be used inside ApProvider");
  return ctx;
}
