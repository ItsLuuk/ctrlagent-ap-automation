/**
 * Business-key duplicate detection.
 *
 * Consumes the identity layer from the vendor profile store to resolve
 * canonical vendor keys (so "KPN" and "KPN B.V." match), then applies two
 * layers:
 *
 * 1. Hard key: resolved vendor + exact invoiceNumber. No time window —
 *    quarter-end archival uploads arrive months later. A matching
 *    invoiceNumber from the same vendor is a duplicate regardless of when
 *    it was issued.
 *
 * 2. Soft key: for number-less invoices only. Same resolved vendor, same
 *    currency, total within 1%, issued within 7 days.
 *
 * Soft flag, deep-link to the original, "import anyway" escape that stamps
 * the duplicate relationship — never silently creates a second draft.
 */

import type { Invoice, VendorProfile } from "./types";

/**
 * Resolves the canonical vendor key for an invoice by matching against
 * the vendor profile store's aliases. Falls back to the invoice's vendor
 * name (lowercased, trimmed) when no profile matches.
 *
 * Identity resolution is the foundation: without it, "KPN" vs "KPN B.V."
 * splits the key and duplicates slip through.
 */
export function resolveVendorIdentity(
  invoice: Invoice,
  profiles: Record<string, VendorProfile>,
): string {
  const vendorLower = invoice.vendor.toLowerCase().trim();
  // Direct hit on a profile's canonical key or alias.
  for (const profile of Object.values(profiles)) {
    if (profile.vendor_key === vendorLower) return profile.vendor_key;
    if (profile.aliases.some((a) => a.toLowerCase().trim() === vendorLower)) {
      return profile.vendor_key;
    }
  }
  // No profile match — use the invoice's vendor name as the key.
  return vendorLower;
}

/**
 * Finds the invoice this one looks like a duplicate of, using the
 * business-key layers. Returns undefined when no duplicate is found.
 *
 * Hard key (invoiceNumber present): same resolved vendor + same invoiceNumber.
 * No time window — a matching invoiceNumber is a duplicate regardless of date.
 *
 * Soft key (no invoiceNumber): same resolved vendor, same currency, total
 * within 1%, issued within 7 days.
 */
export function duplicatePeer(
  invoice: Invoice,
  allInvoices: Invoice[],
  profiles: Record<string, VendorProfile>,
): Invoice | undefined {
  const vendorKey = resolveVendorIdentity(invoice, profiles);

  // Hard key: exact invoiceNumber match (no time window).
  if (invoice.invoiceNumber) {
    const hardMatch = allInvoices.find((candidate) => {
      if (candidate.id === invoice.id) return false;
      if (!candidate.invoiceNumber) return false;
      const candidateKey = resolveVendorIdentity(candidate, profiles);
      if (candidateKey !== vendorKey) return false;
      return candidate.invoiceNumber === invoice.invoiceNumber;
    });
    if (hardMatch) return hardMatch;
    // Hard key found nothing — don't fall through to soft key when
    // invoiceNumber is present. A missing match means it's NOT a duplicate.
    return undefined;
  }

  // Soft key: number-less invoices only.
  if (invoice.total <= 0) return undefined;
  return allInvoices.find((candidate) => {
    if (candidate.id === invoice.id) return false;
    if (candidate.total <= 0) return false;
    if (candidate.currency !== invoice.currency) return false;
    const candidateKey = resolveVendorIdentity(candidate, profiles);
    if (candidateKey !== vendorKey) return false;
    const amountMatch =
      Math.abs(candidate.total - invoice.total) / Math.max(candidate.total, invoice.total) <=
      0.01;
    if (!amountMatch) return false;
    const daysDiff = Math.abs(
      (new Date(candidate.issueDate).getTime() - new Date(invoice.issueDate).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    return daysDiff <= 7;
  });
}
