/**
 * Payment risk flags (Phase Flow Plan §4.2).
 *
 * Pure scorer over the invoice list + vendor payment history. Each flag is
 * expandable in the UI with a required-acknowledge action before release —
 * this is the fraud-prevention workflow made operable.
 */
import type { Invoice } from "./types";

export type RiskFlagKind =
  "bank_details_changed" | "first_payment" | "amount_above_average" | "duplicate_warning";

export type RiskFlag = {
  kind: RiskFlagKind;
  /** Plain-language explanation shown when the row flag is expanded. */
  explanation: string;
  /** Acknowledgment the operator must confirm before release. */
  acknowledgePrompt: string;
};

export type PaidHistoryEntry = {
  vendor: string;
  total: number;
  paidAt: string;
};

export type PaymentRiskInput = {
  invoice: Invoice;
  /** All invoices currently scheduled for payment (incl. this one). */
  scheduled: Invoice[];
  /** Previously paid invoices — the vendor baseline. */
  history: PaidHistoryEntry[];
  /** Vendor bank details changed this many days ago (undefined = never changed). */
  bankDetailsChangedDaysAgo?: number | undefined;
  /** Amount ratio above the vendor's average that triggers a flag (default 1.5). */
  aboveAverageFactor?: number | undefined;
};

/**
 * Scores one scheduled invoice. Pure — the UI acknowledges, the state
 * machine blocks release until every flag is acknowledged.
 */
export function scorePaymentRisk(input: PaymentRiskInput): RiskFlag[] {
  const { invoice, scheduled, history } = input;
  const flags: RiskFlag[] = [];

  if (input.bankDetailsChangedDaysAgo !== undefined && input.bankDetailsChangedDaysAgo <= 14) {
    flags.push({
      kind: "bank_details_changed",
      explanation: `Bank details changed ${input.bankDetailsChangedDaysAgo} day${input.bankDetailsChangedDaysAgo === 1 ? "" : "s"} ago.`,
      acknowledgePrompt: "I've verified the new bank details by phone.",
    });
  }

  const paidForVendor = history.filter(
    (h) => h.vendor.toLowerCase() === invoice.vendor.toLowerCase(),
  );
  if (paidForVendor.length === 0) {
    flags.push({
      kind: "first_payment",
      explanation: "This would be the first payment to this vendor.",
      acknowledgePrompt: "I've confirmed this vendor is legitimate and expected.",
    });
  }

  if (paidForVendor.length > 0) {
    const avg = paidForVendor.reduce((s, h) => s + h.total, 0) / paidForVendor.length;
    const factor = input.aboveAverageFactor ?? 1.5;
    if (avg > 0 && invoice.total > avg * factor) {
      flags.push({
        kind: "amount_above_average",
        explanation: `Amount is ${(invoice.total / avg).toFixed(1)}× the vendor's average (${paidForVendor.length} past payments).`,
        acknowledgePrompt: "I've confirmed the amount is expected for this vendor.",
      });
    }
  }

  // Duplicate warning: same vendor + number (or same vendor + amount) among
  // other scheduled invoices.
  const duplicate = scheduled.find(
    (other) =>
      other.id !== invoice.id &&
      other.vendor.toLowerCase() === invoice.vendor.toLowerCase() &&
      (other.invoiceNumber === invoice.invoiceNumber ||
        Math.abs(other.total - invoice.total) < 0.01),
  );
  if (duplicate) {
    flags.push({
      kind: "duplicate_warning",
      explanation: `${duplicate.invoiceNumber || "Another invoice"} for the same vendor/amount is also scheduled.`,
      acknowledgePrompt: "I've confirmed these are not duplicate invoices.",
    });
  }

  return flags;
}

/** Release gate: every flagged row must have all its flags acknowledged. */
export function releaseIsBlocked(flags: RiskFlag[], acknowledged: Set<RiskFlagKind>): boolean {
  return flags.some((f) => !acknowledged.has(f.kind));
}
