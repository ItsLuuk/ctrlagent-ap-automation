/**
 * Vendor routing — pure decision for what status an invoice should land in
 * after upload. Used by the upload pipeline and tests so the policy lives in
 * exactly one place.
 *
 * Policy (per spec docs/superpowers/specs/2026-09-22-vendor-profile-registration-phase-design.md):
 *   - vendor name present in vendor-master → "draft" (existing flow).
 *   - vendor name absent from vendor-master → "vendor_profile" (new phase).
 *   - vendor name empty / unrecognised → "vendor_profile" (the registration
 *     screen surfaces the empty-name case and the user types it in).
 */
import type { InvoiceStatus } from "./types";

export function decideInitialStatus(
  vendorName: string | undefined,
  knownVendors: Record<string, unknown>,
): InvoiceStatus {
  const trimmed = (vendorName ?? "").trim();
  if (trimmed === "") return "vendor_profile";
  if (knownVendors[trimmed]) return "draft";
  return "vendor_profile";
}