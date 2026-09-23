/**
 * Auto-tags — system-derived flags for invoices.
 *
 * Tags are computed from invoice data and the invoice list, not manually
 * selected by the user. Each tag has a clear predicate that can be evaluated
 * at creation time and re-evaluated when the invoice list changes (e.g. a
 * "First-time vendor" becomes "Recurring" when a second invoice arrives).
 */
import type { Invoice, InvoiceTag } from "./types";

/** Threshold for "High value" invoices (EUR). */
const HIGH_VALUE_THRESHOLD = 10_000;

/** Days before due date to flag as "Urgent". */
const URGENT_DAYS = 3;

/** Days window for duplicate detection. */
const DUPLICATE_WINDOW_DAYS = 7;

/** Amount similarity threshold for duplicate detection (1%). */
const DUPLICATE_AMOUNT_TOLERANCE = 0.01;

/**
 * Computes the system-derived tags for an invoice based on its data and
 * the full invoice list. Returns a sorted, deduplicated array of tags.
 *
 * Call this:
 *  - When an invoice is created (to set initial tags)
 *  - When the invoice list changes (e.g. new invoice added, so "First-time
 *    vendor" might become "Recurring" for an existing invoice)
 */
/**
 * Late: the due date has passed and the money is still owed — unpaid, and not
 * something already decided against. One definition, so the tag a row wears and
 * the band's overdue total agree; a rejected record is not late, it is rejected,
 * and counting it made the overdue figure claim money nobody owes.
 */
export function isLate(
  invoice: Pick<Invoice, "dueDate" | "status">,
  now: Date = new Date(),
): boolean {
  return (
    Boolean(invoice.dueDate) &&
    invoice.dueDate < now.toISOString().slice(0, 10) &&
    invoice.status !== "paid" &&
    invoice.status !== "rejected"
  );
}

/**
 * The invoice this one looks like a duplicate of, if any. Same vendor, same
 * currency, total within 1%, issued within a week of each other.
 *
 * One definition, three users: the "Duplicate risk" tag a row wears, the wording
 * of the removal action, and the note that goes in the audit trail when someone
 * acts on it. They cannot disagree about which pair is the pair.
 *
 * The currency check is part of identity, not a nicety: without it a €100
 * invoice flags against a $100 one and the flag is noise.
 */
export function duplicatePeer(invoice: Invoice, allInvoices: Invoice[]): Invoice | undefined {
  if (invoice.total <= 0) return undefined;
  return allInvoices.find((candidate) => {
    if (candidate.id === invoice.id) return false;
    if (candidate.total <= 0) return false;
    if (candidate.currency !== invoice.currency) return false;
    if (candidate.vendor.toLowerCase() !== invoice.vendor.toLowerCase()) return false;
    const amountMatch =
      Math.abs(candidate.total - invoice.total) / Math.max(candidate.total, invoice.total) <=
      DUPLICATE_AMOUNT_TOLERANCE;
    if (!amountMatch) return false;
    const daysDiff = Math.abs(
      (new Date(candidate.issueDate).getTime() - new Date(invoice.issueDate).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    return daysDiff <= DUPLICATE_WINDOW_DAYS;
  });
}

/**
 * Tags as they stand right now, for a whole list at once.
 *
 * Tags are derived data, so a record can carry a claim that is no longer true:
 * tagged under an older rule, or tagged before its vendor stopped being new. The
 * store re-derives on load, which is what keeps "the tag a row wears and the
 * overdue total agree" honest for records that were already on disk — a rejected
 * record sitting there wearing Late is exactly the disagreement.
 */
export function retagAll(invoices: Invoice[]): Invoice[] {
  return invoices.map((invoice) => ({ ...invoice, tags: computeAutoTags(invoice, invoices) }));
}

export function computeAutoTags(invoice: Invoice, allInvoices: Invoice[]): InvoiceTag[] {
  const tags = new Set<InvoiceTag>();
  const now = new Date();

  // ── First-time vendor / Recurring ──────────────────────────────────
  const vendorInvoices = allInvoices.filter(
    (i) => i.vendor.toLowerCase() === invoice.vendor.toLowerCase() && i.id !== invoice.id,
  );
  if (vendorInvoices.length === 0) {
    tags.add("First-time vendor");
  } else if (vendorInvoices.length >= 1) {
    tags.add("Recurring");
  }

  // ── Duplicate risk ─────────────────────────────────────────────────
  if (duplicatePeer(invoice, allInvoices)) {
    tags.add("Duplicate risk");
  }

  // ── High value ─────────────────────────────────────────────────────
  if (invoice.total >= HIGH_VALUE_THRESHOLD) {
    tags.add("High value");
  }

  // ── Late ───────────────────────────────────────────────────────────
  if (isLate(invoice, now)) {
    tags.add("Late");
  }

  // ── Urgent ─────────────────────────────────────────────────────────
  if (invoice.dueDate && invoice.status !== "paid") {
    const dueDate = new Date(invoice.dueDate);
    const daysUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysUntilDue >= 0 && daysUntilDue <= URGENT_DAYS) {
      tags.add("Urgent");
    }
  }

  // ── International ──────────────────────────────────────────────────
  // Non-NL IBAN or non-Dutch address indicators
  if (invoice.iban && !invoice.iban.startsWith("NL")) {
    tags.add("International");
  }
  // Also check vendor name for non-Dutch legal forms
  if (
    !tags.has("International") &&
    /\b(GmbH|AG|S\.?A\.?|S\.?R\.?L\.?|Ltd|LLC|Inc|PLC|Pty)\b/i.test(invoice.vendor)
  ) {
    tags.add("International");
  }

  // ── Needs receipt ──────────────────────────────────────────────────
  // Flag high-value first-time vendors — these are the riskiest
  if (tags.has("First-time vendor") && tags.has("High value")) {
    tags.add("Needs receipt");
  }

  return [...tags].sort();
}
