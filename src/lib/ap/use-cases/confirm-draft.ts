/**
 * Draft confirmation use case.
 *
 * This is application policy, not a React controller. It receives plain draft
 * state and injected ports, then coordinates the writes required to move an
 * invoice from Draft to For approval. The hook owns UI state and notifications;
 * this module owns the decision and the persistence order.
 */
import {
  MAPPING_FIELDS,
  type AnchorSpec,
  type DraftFields,
  type Invoice,
  type LineItemsSpec,
  type OcrWord,
  type VendorTemplate,
  type ZoneField,
  type ZoneMap,
} from "../types";
import { buildAnchorSpec, validateInvoiceForConfirmation } from "../mapping";
import {
  CRITICAL_MAPPING_FIELDS,
  TEMPLATE_TRAINING_WHEELS,
  unconfirmedCriticalFields,
  type ConfirmedMappings,
  type DraftAssignments,
} from "../mapping-proposals";
import type { Actor, TransitionId, TransitionOutcome } from "../state-machine";
import type { InvoiceStatus } from "../types";
import { vendorProfileFromMapping, type VendorMaster } from "../vendor-master";

// The draft vocabulary is domain-owned now: assignments and confirmations live
// beside the proposals they refer to, draft values live on `Invoice`. Both are
// re-exported so existing importers keep a single import site.
export type { ConfirmedMappings, DraftAssignment, DraftAssignments } from "../mapping-proposals";
export type { DraftFields } from "../types";

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
  /** Writes the vendor record. A refused write (a bank detail awaiting a
   *  second signature) is answered, not swallowed — the confirm stops. */
  upsertVendor: (vendor: VendorMaster) => TransitionOutcome;
};

export type ConfirmDraftRequest = {
  invoice: Invoice;
  fields: DraftFields;
  assignments: DraftAssignments;
  words: OcrWord[];
  existingTemplate?: VendorTemplate | undefined;
  /** Explicit acceptance for proposed regions; critical fields default to unconfirmed. */
  confirmedMappings?: Partial<Record<ZoneField, boolean>> | undefined;
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

/**
 * Which confirm transition a confirmation uses, by the stage the operator is
 * standing in. The mapper runs in Profiling (a first-time vendor: identity and
 * fields pinned in one pass) and in Draft (a known vendor), and the state
 * machine only allows a confirm from each of those places under its own id.
 * Domain policy, so it lives beside the confirm rather than in the screen.
 */
export function confirmTransitionFor(status: InvoiceStatus): TransitionId {
  return status === "vendor_profile" ? "confirm-from-profiling" : "confirm";
}

/** Builds stable anchor specs and raw zones from the current draft assignments. */
export function buildDraftAnchorSpecs(
  words: OcrWord[],
  assignments: DraftAssignments,
  confirmedMappings: Partial<Record<ZoneField, boolean>> = {},
): { specs: Partial<Record<ZoneField, AnchorSpec>>; zones: ZoneMap } {
  const specs: Partial<Record<ZoneField, AnchorSpec>> = {};
  const zones: ZoneMap = {};
  for (const field of MAPPING_FIELDS) {
    const assignment = assignments[field];
    if (!assignment) continue;
    if (
      CRITICAL_MAPPING_FIELDS.includes(field) &&
      assignment.proposal &&
      assignment.proposal.source !== "saved" &&
      !confirmedMappings[field]
    ) {
      continue;
    }
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
 * transition. Which transition that is depends on the stage the invoice is in
 * (see `confirmTransitionFor`). A rejected transition is returned to the
 * adapter for its toast.
 */
export function confirmDraft(
  request: ConfirmDraftRequest,
  ports: DraftPersistencePorts,
): ConfirmDraftResult {
  const { invoice, fields, assignments, words, existingTemplate, confirmedMappings = {} } = request;
  const critical = unconfirmedCriticalFields(assignments, confirmedMappings);
  if (critical.length > 0) {
    return {
      ok: false,
      kind: "blocked",
      message: `Confirm the critical mappings first: ${critical.join(", ")}.`,
    };
  }
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

  const hasMappings = MAPPING_FIELDS.some((field) => assignments[field]);
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
    const { specs, zones } = buildDraftAnchorSpecs(words, assignments, confirmedMappings);
    ports.saveVendorTemplate({
      vendor: vendorName,
      fields: specs,
      zones,
      confirmNextCount: existingTemplate
        ? existingTemplate.confirmNextCount ?? 0
        : TEMPLATE_TRAINING_WHEELS,
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

  // The vendor record is written from the mapped identity values — the same
  // values the reviewer just looked at — before the transition, because a
  // write that can be refused (a bank detail needing a second signature) must
  // be able to stop the confirm rather than land after it.
  const profile = request.profile
    ? { ...request.profile, updatedAt: request.profileUpdatedAt ?? request.profile.updatedAt }
    : vendorProfileFromMapping(currentInvoice, undefined, new Date().toISOString());
  let profileSaved = false;
  if (request.profile || invoice.status === "vendor_profile") {
    const savedProfile = ports.upsertVendor(profile);
    if (!savedProfile.accepted) {
      return {
        ok: false,
        kind: "persistence-rejected",
        message:
          savedProfile.reason ??
          "The vendor record could not be saved, so the invoice stays where it is.",
      };
    }
    profileSaved = true;
  }

  if (!request.actor) {
    // Unreachable through the types, reachable through plain JavaScript. Better
    // a sentence than a crash inside the state machine's role check.
    return {
      ok: false,
      kind: "transition-rejected",
      message: "Nobody is signed in to confirm this draft.",
    };
  }
  const transitionId = confirmTransitionFor(invoice.status);
  const transition = ports.applyTransition(invoice.id, {
    transition: transitionId,
    actor: request.actor,
  });
  if (!transition.accepted) {
    return {
      ok: false,
      kind: "transition-rejected",
      message: transition.reason ?? "We couldn't submit this for approval.",
    };
  }

  return {
    ok: true,
    vendor: vendorName,
    templateAction,
    profileSaved,
    learnedCount: request.learnedCount ?? 0,
  };
}

export type PersistLineItemsSpecRequest = {
  invoice: Invoice;
  vendor: string;
  assignments: DraftAssignments;
  words: OcrWord[];
  lineItems: LineItemsSpec;
  existingTemplate?: VendorTemplate | undefined;
  confirmedMappings?: Partial<Record<ZoneField, boolean>> | undefined;
};

export type PersistLineItemsSpecResult =
  { ok: true } | { ok: false; kind: "missing-header-mappings"; message: string };

/** Persists a learned line-item block alongside the current header mappings. */
export function persistDraftLineItemsSpec(
  request: PersistLineItemsSpecRequest,
  ports: Pick<DraftPersistencePorts, "saveVendorTemplate">,
): PersistLineItemsSpecResult {
  const { specs, zones } = buildDraftAnchorSpecs(
    request.words,
    request.assignments,
    request.confirmedMappings,
  );
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
    confirmNextCount: request.existingTemplate
      ? request.existingTemplate.confirmNextCount ?? 0
      : TEMPLATE_TRAINING_WHEELS,
    origin: "confirmed",
    invoiceId: request.invoice.id,
  });
  return { ok: true };
}
