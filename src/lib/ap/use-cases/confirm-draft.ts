/**
 * Draft confirmation use case.
 *
 * This is application policy, not a React controller. It receives plain draft
 * state and injected ports, then coordinates the writes required to move an
 * invoice from Draft to For approval. The hook owns UI state and notifications;
 * this module owns the decision and the persistence order.
 */
import {
  ZONE_FIELDS,
  type AnchorSpec,
  type Invoice,
  type LineItemsSpec,
  type OcrWord,
  type VendorTemplate,
  type ZoneField,
  type ZoneMap,
} from "../types";
import { buildAnchorSpec, validateInvoiceForConfirmation } from "../mapping";
import type { Actor, TransitionId, TransitionOutcome } from "../state-machine";
import type { VendorMaster } from "../vendor-master";

export type DraftAssignment = {
  field: ZoneField;
  zone: { x: number; y: number; w: number; h: number };
  anchor?: string | undefined;
};
export type DraftAssignments = Record<ZoneField, DraftAssignment | undefined>;

/** The editable scalar fields shared by the draft hook and confirmation use case. */
export type DraftFields = {
  vendor: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  subtotal: string;
  tax: string;
  total: string;
  address: string;
  vendorEmail: string;
  iban: string;
  vatNumber: string;
  businessRegistrationNumber: string;
};

export type SaveVendorTemplateInput = {
  vendor: string;
  fields: Partial<Record<ZoneField, AnchorSpec>>;
  zones?: ZoneMap | undefined;
  lineItems?: LineItemsSpec | undefined;
  confirmNextCount?: number | undefined;
  origin?: "confirmed" | "drift-update" | undefined;
  invoiceId?: string | undefined;
};

export type DraftPersistencePorts = {
  saveVendorTemplate: (input: SaveVendorTemplateInput) => void;
  updateInvoice: (
    id: string,
    patch: Partial<Invoice>,
    auditAction?: string,
    note?: string,
    actor?: string,
  ) => TransitionOutcome;
  applyTransition: (
    id: string,
    input: { transition: TransitionId; actor: Actor; note?: string },
  ) => TransitionOutcome;
  confirmTemplateExtraction: (vendor: string) => void;
  upsertVendor: (vendor: VendorMaster) => void;
};

export type ConfirmDraftRequest = {
  invoice: Invoice;
  fields: DraftFields;
  assignments: DraftAssignments;
  words: OcrWord[];
  existingTemplate?: VendorTemplate | undefined;
  profile?: VendorMaster | undefined;
  profileUpdatedAt?: string | undefined;
  learnedCount?: number | undefined;
  /**
   * Who is confirming. Required on purpose: this use case has no opinion about
   * who the operator is, and must not be able to invent one. The caller resolves
   * the single identity from the operator module and passes it in.
   */
  actor: Actor;
};

export type ConfirmDraftResult =
  | {
      ok: false;
      kind: "blocked" | "persistence-rejected" | "transition-rejected";
      message: string;
    }
  | {
      ok: true;
      vendor: string;
      templateAction: "none" | "saved" | "updated";
      profileSaved: boolean;
      learnedCount: number;
    };

/** Builds stable anchor specs and raw zones from the current draft assignments. */
export function buildDraftAnchorSpecs(
  words: OcrWord[],
  assignments: DraftAssignments,
): { specs: Partial<Record<ZoneField, AnchorSpec>>; zones: ZoneMap } {
  const specs: Partial<Record<ZoneField, AnchorSpec>> = {};
  const zones: ZoneMap = {};
  for (const field of ZONE_FIELDS) {
    const assignment = assignments[field];
    if (!assignment) continue;
    specs[field] = buildAnchorSpec(words, field, assignment.zone, assignment.anchor);
    zones[field] = assignment.zone;
  }
  return { specs, zones };
}

/** Maps editable draft strings to the invoice's domain representation. */
export function draftFieldsToInvoicePatch(fields: DraftFields): Partial<Invoice> {
  return {
    vendor: fields.vendor,
    invoiceNumber: fields.invoiceNumber,
    issueDate: fields.issueDate,
    dueDate: fields.dueDate,
    subtotal: Number(fields.subtotal) || 0,
    tax: Number(fields.tax) || 0,
    total: Number(fields.total) || 0,
  };
}

/**
 * Confirms a draft in the same order as the screen: persist field values and
 * learned mappings, release any template training hold, then apply the state
 * transition. A rejected transition is returned to the adapter for its toast.
 */
export function confirmDraft(
  request: ConfirmDraftRequest,
  ports: DraftPersistencePorts,
): ConfirmDraftResult {
  const { invoice, fields, assignments, words, existingTemplate } = request;
  const currentFields = draftFieldsToInvoicePatch(fields);
  const currentInvoice = { ...invoice, ...currentFields };
  const blockingIssues = validateInvoiceForConfirmation(currentInvoice).filter(
    (issue) => issue.severity === "error",
  );
  if (blockingIssues.length > 0) {
    return {
      ok: false,
      kind: "blocked",
      message: blockingIssues[0]?.message ?? "Fix the highlighted issues before confirming.",
    };
  }

  const hasMappings = ZONE_FIELDS.some((field) => assignments[field]);
  const isInvoiceOnly = !hasMappings && !invoice.templateDrift;
  const vendorName = fields.vendor || invoice.vendor;
  let templateAction: "none" | "saved" | "updated" = "none";

  if (isInvoiceOnly) {
    const saved = ports.updateInvoice(
      invoice.id,
      { ...currentFields, templateHold: undefined },
      // The transition writes the real confirmation audit entry. Writing that
      // action during this field update would trip the segregation-of-duties
      // check before the transition runs.
      "Saved draft field values",
      "Confirmed template extraction",
    );
    if (!saved.accepted) {
      return {
        ok: false,
        kind: "persistence-rejected",
        message: saved.reason ?? "The draft values could not be saved.",
      };
    }
  } else {
    const { specs, zones } = buildDraftAnchorSpecs(words, assignments);
    ports.saveVendorTemplate({
      vendor: vendorName,
      fields: specs,
      zones,
      confirmNextCount: 0,
      origin: invoice.templateDrift ? "drift-update" : "confirmed",
      invoiceId: invoice.id,
    });
    templateAction = existingTemplate ? "updated" : "saved";
    const saved = ports.updateInvoice(
      invoice.id,
      { ...currentFields, templateHold: undefined, zones },
      existingTemplate ? "Template updated" : "Template saved",
      "Confirmed draft",
    );
    if (!saved.accepted) {
      return {
        ok: false,
        kind: "persistence-rejected",
        message: saved.reason ?? "The draft template could not be saved.",
      };
    }
  }

  if (invoice.templateHold) ports.confirmTemplateExtraction(invoice.vendor);
  if (!request.actor) {
    // Unreachable through the types, reachable through plain JavaScript. Better
    // a sentence than a crash inside the state machine's role check.
    return {
      ok: false,
      kind: "transition-rejected",
      message: "Nobody is signed in to confirm this draft.",
    };
  }
  const transition = ports.applyTransition(invoice.id, {
    transition: "confirm",
    actor: request.actor,
  });
  if (!transition.accepted) {
    return {
      ok: false,
      kind: "transition-rejected",
      message: transition.reason ?? "We couldn't submit this for approval.",
    };
  }

  if (request.profile) {
    ports.upsertVendor({
      ...request.profile,
      updatedAt: request.profileUpdatedAt ?? request.profile.updatedAt,
    });
  }

  return {
    ok: true,
    vendor: vendorName,
    templateAction,
    profileSaved: Boolean(request.profile),
    learnedCount: request.learnedCount ?? 0,
  };
}

export type PersistLineItemsSpecRequest = {
  invoice: Invoice;
  vendor: string;
  assignments: DraftAssignments;
  words: OcrWord[];
  lineItems: LineItemsSpec;
};

export type PersistLineItemsSpecResult =
  { ok: true } | { ok: false; kind: "missing-header-mappings"; message: string };

/** Persists a learned line-item block alongside the current header mappings. */
export function persistDraftLineItemsSpec(
  request: PersistLineItemsSpecRequest,
  ports: Pick<DraftPersistencePorts, "saveVendorTemplate">,
): PersistLineItemsSpecResult {
  const { specs, zones } = buildDraftAnchorSpecs(request.words, request.assignments);
  if (Object.keys(specs).length === 0) {
    return {
      ok: false,
      kind: "missing-header-mappings",
      message:
        "Map the header fields first. The line-item block is stored with the vendor's template.",
    };
  }
  ports.saveVendorTemplate({
    vendor: request.vendor,
    fields: specs,
    zones,
    lineItems: request.lineItems,
    origin: "confirmed",
    invoiceId: request.invoice.id,
  });
  return { ok: true };
}
