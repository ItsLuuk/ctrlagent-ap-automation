/**
 * Draft triage use case — the reviewer's worklist, derived.
 *
 * Pure policy: given the invoice, the current source-region assignments and
 * which proposals the reviewer has accepted, it returns the per-field status,
 * the order those fields should be looked at in, the validation issues that
 * block a save, and the counts the screen shows. No React, no storage, no
 * rendering — the hook calls this once per change and draws the result.
 */
import {
  fieldStatus,
  fieldValue,
  IDENTITY_FIELDS,
  LOW_CONFIDENCE,
  orderedFields,
  resultFor,
  validateInvoiceForConfirmation,
  type FieldStatus,
  type InvoiceValidationIssue,
} from "../mapping";
import {
  hasPendingProposal,
  pendingRoutineProposalFields,
  unconfirmedCriticalFields,
  type ConfirmedMappings,
  type DraftAssignments,
} from "../mapping-proposals";
import { MAPPING_FIELDS, ZONE_FIELDS, type Invoice, type ZoneField } from "../types";
import { countOf } from "../vocabulary";

export type DraftTriageRequest = {
  invoice: Invoice;
  assignments: DraftAssignments;
  confirmedMappings?: ConfirmedMappings | undefined;
  /**
   * Profiling a first-time vendor: the identity values are part of the same
   * worklist as the invoice fields, so the operator maps the document once
   * instead of filling a form and then mapping it.
   */
  includeIdentity?: boolean | undefined;
  /**
   * Fields this vendor's invoices do not print. Remembered from an earlier
   * invoice, so they stop being raised as missing on every one that follows.
   */
  absentFields?: readonly ZoneField[] | undefined;
};

/**
 * Why a field is on the worklist, in the reviewer's own terms. The screen pairs
 * each with the one action that resolves it, so nobody has to guess what a
 * colored row wants them to do.
 */
export type AttentionReason = "empty" | "no-box" | "unconfirmed" | "unverified";

export type FieldAttention = {
  field: ZoneField;
  reason: AttentionReason;
};

export type DraftTriage = {
  /** Green or amber per field, with unreviewed critical proposals forced amber. */
  statuses: Record<ZoneField, FieldStatus>;
  /** Ambers first: the order the reviewer should work through the fields. */
  order: ZoneField[];
  validationIssues: InvoiceValidationIssue[];
  /** The subset that stops a draft from being confirmed. */
  blockingIssues: InvoiceValidationIssue[];
  /** Nothing left to look at: every field green and nothing blocking. */
  allFieldsVerified: boolean;
  /** Fields with a source region at all, drawn or proposed. */
  mappedCount: number;
  /** Fields carrying a proposed region that did not come from a saved template. */
  proposalCount: number;
  /** Routine proposals one deliberate action can accept. */
  pendingRoutineProposalCount: number;
  unconfirmedCriticalFields: ZoneField[];
  unconfirmedProposalCount: number;
  /**
   * The worklist, in the order it should be worked, each item carrying the one
   * reason it is there. A field remembered as never printed by this vendor is
   * not on it: an absence already answered is not outstanding work.
   */
  attention: FieldAttention[];
  /**
   * Proposals a person can agree in one action: the machine is certain, the
   * value is read exactly, and the field is not one where being wrong is
   * expensive. Everything left on the worklist is a decision; this is not.
   */
  settleable: ZoneField[];
};

export function draftTriage(request: DraftTriageRequest): DraftTriage {
  const { invoice, assignments, confirmedMappings = {}, includeIdentity = false, absentFields = [] } = request;

  const critical = unconfirmedCriticalFields(assignments, confirmedMappings);
  const routinePending = pendingRoutineProposalFields(assignments, confirmedMappings);

  const statuses = {} as Record<ZoneField, FieldStatus>;
  for (const field of ZONE_FIELDS) {
    const check = resultFor(invoice.zoneCheck, field);
    statuses[field] = fieldStatus(invoice, field, { zoneCheckMatch: check?.match });
    // A critical field whose source box nobody has looked at is work, not a
    // value we get to call green.
    if (critical.includes(field)) statuses[field] = "amber";
  }
  if (includeIdentity) {
    for (const field of IDENTITY_FIELDS) {
      const value = invoice[field];
      // Identity is not "derived or manual, therefore amber": the point of
      // profiling is that these start out unmapped. What makes one work is a
      // missing value or a source box nobody has looked at — a bank detail
      // carries forward to every future invoice, so it never bulk-accepts.
      statuses[field] =
        (typeof value === "string" ? value.trim() === "" : value === undefined) ||
        hasPendingProposal(assignments[field], confirmedMappings[field])
          ? "amber"
          : "green";
    }
  }
  const order = orderedFields(
    invoice,
    statuses,
    includeIdentity ? MAPPING_FIELDS : ZONE_FIELDS,
  );

  const validationIssues = validateInvoiceForConfirmation(invoice, "confirm", absentFields);
  const blockingIssues = validationIssues.filter((issue) => issue.severity === "error");

  /**
   * One field, one reason, first match wins. The order is the reviewer's: a
   * value nobody has is the thing to fix before the reading of a value that
   * exists is worth doubting.
   *
   * A proposed region only becomes a person's decision when the field is one
   * where being wrong is expensive. Agreeing a region the machine proposed for
   * a field it read exactly, with high confidence, is bookkeeping — twelve of
   * those is what makes a first vendor feel like a chore instead of two
   * decisions.
   */
  const attentionFor = (field: ZoneField): AttentionReason | undefined => {
    const value = fieldValue(invoice, field);
    if (value === undefined || value === "") return "empty";
    // The page said something different from what is stored here.
    if (resultFor(invoice.zoneCheck, field)?.match === false) return "unverified";
    if (!assignments[field]) return "no-box";
    const confidence = invoice.confidence?.[field];
    if (confidence !== undefined && confidence < LOW_CONFIDENCE) return "unverified";
    const provenance = invoice.provenance?.[field];
    if (provenance === "derived" || provenance === "manual") return "unverified";
    if (hasPendingProposal(assignments[field], confirmedMappings[field])) {
      return critical.includes(field) ? "unconfirmed" : undefined;
    }
    return undefined;
  };
  const rank = new Map(order.map((field, index) => [field, index]));
  const attention = order
    .filter((field) => !absentFields.includes(field))
    .map((field) => ({ field, reason: attentionFor(field) }))
    .filter((item): item is FieldAttention => item.reason !== undefined)
    .sort((first, second) => (rank.get(first.field) ?? 0) - (rank.get(second.field) ?? 0));
  const settleable = order.filter(
    (field) =>
      !absentFields.includes(field) &&
      hasPendingProposal(assignments[field], confirmedMappings[field]) &&
      attentionFor(field) === undefined,
  );
  const proposalCount = MAPPING_FIELDS.filter(
    (field) =>
      Boolean(assignments[field]?.proposal) && assignments[field]?.proposal?.source !== "saved",
  ).length;

  return {
    statuses,
    order,
    validationIssues,
    blockingIssues,
    allFieldsVerified:
      order.every((field) => statuses[field] === "green") && blockingIssues.length === 0,
    mappedCount: MAPPING_FIELDS.filter((field) => assignments[field]).length,
    proposalCount,
    // While profiling, the identity proposals are on the same screen as their
    // rows, and they are individually confirmed — so they are never part of
    // the one-click "accept routine" set.
    pendingRoutineProposalCount: includeIdentity
      ? routinePending.filter((field) => ZONE_FIELDS.includes(field)).length
      : routinePending.length,
    unconfirmedCriticalFields: critical,
    unconfirmedProposalCount: critical.length,
    attention,
    settleable,
  };
}

export type NotableContext = {
  /** The vendor is being profiled: this is the first invoice we have from them. */
  profiling: boolean;
  /** A saved template exists for this vendor. */
  hasTemplate: boolean;
  /** The worklist. Its reasons are counted, never restated field by field. */
  attention: readonly FieldAttention[];
  /** The line items add up to what the invoice says. */
  totalsOk: boolean;
};

/** How many chips the header shows before it stops being skimmable. */
const MAX_NOTABLE = 3;

/**
 * What made this invoice its own problem, most explanatory first.
 *
 * Two invoices from the same vendor used to look identical on this screen,
 * which is the surest way to teach someone that the work never changes. The
 * variance is in the work, not in a manufactured surprise: a layout that
 * moved, a field nothing could read, a total that will not reconcile.
 *
 * An empty result means this one is routine, and that is worth showing — a
 * screen with nothing to say is a screen where the template has learned the job.
 */
export function notableFor(invoice: Invoice, context: NotableContext): string[] {
  const { profiling, hasTemplate, attention, totalsOk } = context;
  const count = (reason: AttentionReason) =>
    attention.filter((item) => item.reason === reason).length;

  const notable: string[] = [];
  // A layout that moved is the most useful thing to say: it explains why the
  // worklist is long on a vendor whose last invoice was effortless.
  if (invoice.templateDrift) notable.push("Layout changed since the last one");
  if (profiling) notable.push("First invoice from this vendor");
  else if (!hasTemplate) notable.push("No saved template for this vendor");

  const unread = count("empty");
  if (unread > 0) notable.push(`${countOf(unread, "field")} nothing could read`);
  const doubtful = count("unverified");
  if (doubtful > 0) notable.push(`${countOf(doubtful, "field")} we are not sure about`);
  const unplaced = count("no-box");
  if (unplaced > 0) notable.push(`${countOf(unplaced, "field")} we cannot point to`);
  if (!totalsOk) notable.push("Line items do not add up to the total");

  return notable.slice(0, MAX_NOTABLE);
}
