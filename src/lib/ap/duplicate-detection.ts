/**
 * Business-key duplicate detection.
 *
 * A duplicate is not just the same file twice. Re-printed PDFs and portal
 * re-downloads have different bytes, so the business key must survive OCR and
 * punctuation changes while staying conservative around recurring invoice
 * numbers.
 *
 * The key is resolved vendor + invoice number + amount + currency. Numbered
 * invoices are checked across all periods; number-less invoices retain a
 * seven-day window so recurring same-amount spend is not called a duplicate.
 */

import type { Invoice, VendorProfile } from "./types";

/** Amounts within 1% are treated as the same payable amount. */
const AMOUNT_TOLERANCE = 0.01;

/** Resolves aliases such as "KPN" and "KPN B.V." to one vendor key. */
export function resolveVendorIdentity(
  invoice: Invoice,
  profiles: Record<string, VendorProfile>,
): string {
  const vendorLower = invoice.vendor.toLowerCase().trim();
  for (const profile of Object.values(profiles)) {
    if (profile.vendor_key === vendorLower) return profile.vendor_key;
    if (profile.aliases.some((alias) => alias.toLowerCase().trim() === vendorLower)) {
      return profile.vendor_key;
    }
  }
  return vendorLower;
}

function normalizeInvoiceNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
}

/**
 * OCR and portal exports often change separators or one character. We accept
 * that only for non-sequential numbers: 001 and 002 are normally adjacent
 * invoices, not a typo, even though edit distance calls them similar.
 */
function invoiceNumbersMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeInvoiceNumber(left);
  const normalizedRight = normalizeInvoiceNumber(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (normalizedLeft.length < 6 || normalizedRight.length < 6) return false;

  const leftSuffix = normalizedLeft.match(/\d+$/)?.[0];
  const rightSuffix = normalizedRight.match(/\d+$/)?.[0];
  if (leftSuffix && rightSuffix && leftSuffix !== rightSuffix) return false;

  return editDistance(normalizedLeft, normalizedRight) === 1;
}

function amountMatches(left: number, right: number): boolean {
  if (left <= 0 || right <= 0) return left === right;
  return Math.abs(left - right) / Math.max(left, right) <= AMOUNT_TOLERANCE;
}

function daysApart(left: string, right: string): number {
  return Math.abs((new Date(left).getTime() - new Date(right).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Finds the invoice this one looks like across active, history, and removed
 * records. Numbered matches deliberately have no date window; a duplicate can
 * arrive in a later period or be uploaded after period close.
 */
export function duplicatePeer(
  invoice: Invoice,
  allInvoices: Invoice[],
  profiles: Record<string, VendorProfile>,
): Invoice | undefined {
  const vendorKey = resolveVendorIdentity(invoice, profiles);

  return allInvoices.find((candidate) => {
    if (candidate.id === invoice.id) return false;
    if (resolveVendorIdentity(candidate, profiles) !== vendorKey) return false;
    if (candidate.currency !== invoice.currency) return false;
    if (!amountMatches(candidate.total, invoice.total)) return false;

    if (invoice.invoiceNumber && candidate.invoiceNumber) {
      return invoiceNumbersMatch(invoice.invoiceNumber, candidate.invoiceNumber);
    }

    // A missing number is weaker evidence, so only nearby same-amount invoices
    // are treated as duplicates.
    if (invoice.invoiceNumber || candidate.invoiceNumber) return false;
    return (
      invoice.total > 0 &&
      candidate.total > 0 &&
      daysApart(invoice.issueDate, candidate.issueDate) <= 7
    );
  });
}
