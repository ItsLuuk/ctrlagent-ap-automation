/**
 * Template-save policy — what has to be settled before a draft can become a
 * saved vendor template, and what the reviewer is told when it cannot.
 *
 * The screen asks this before it starts writing anything, so a blocked save
 * never half-applies. `confirmDraft` re-checks the same two rules on the write
 * path: this is the reviewer's-facing gate, that one is the safety net, and
 * neither is trusted to be the only one.
 */
import { validateInvoiceForConfirmation, type InvoiceValidationIssue } from "../mapping";
import {
  TEMPLATE_TRAINING_WHEELS,
  unconfirmedCriticalFields,
  type ConfirmedMappings,
  type DraftAssignments,
} from "../mapping-proposals";
import { ZONE_LABEL, type Invoice, type ZoneField } from "../types";

/**
 * Training wheels hold this many future extractions for manual confirmation
 * before a vendor template is trusted outright.
 */
export const TRAINING_WHEELS_CONFIRMATIONS = TEMPLATE_TRAINING_WHEELS;

export type TemplateSaveRequest = {
  /** The invoice as the caller sees it — the draft screen keeps it current on every edit. */
  invoice: Invoice;
  assignments: DraftAssignments;
  confirmedMappings?: ConfirmedMappings | undefined;
  /** Fields this vendor's invoices do not print — never blocked on. */
  absentFields?: readonly ZoneField[] | undefined;
};

export type TemplateSaveGate =
  | { ok: true }
  | {
      ok: false;
      kind: "unconfirmed-critical-mappings";
      fields: ZoneField[];
      title: string;
      message: string;
    }
  | {
      ok: false;
      kind: "blocking-issues";
      issues: InvoiceValidationIssue[];
      title: string;
      message: string;
    };

export function templateSaveGate(request: TemplateSaveRequest): TemplateSaveGate {
  const { invoice, assignments, confirmedMappings = {}, absentFields = [] } = request;

  const critical = unconfirmedCriticalFields(assignments, confirmedMappings);
  if (critical.length > 0) {
    return {
      ok: false,
      kind: "unconfirmed-critical-mappings",
      fields: critical,
      title: "Confirm the critical mappings first",
      message: `Review the highlighted source box for ${critical
        .map((field) => ZONE_LABEL[field])
        .join(", ")} before saving a template.`,
    };
  }

  const issues = validateInvoiceForConfirmation(invoice, "confirm", absentFields).filter(
    (issue) => issue.severity === "error",
  );
  if (issues.length > 0) {
    return {
      ok: false,
      kind: "blocking-issues",
      issues,
      title: "Fix the highlighted issues before confirming",
      message: issues[0]?.message ?? "Fix the highlighted issues before confirming.",
    };
  }

  return { ok: true };
}
