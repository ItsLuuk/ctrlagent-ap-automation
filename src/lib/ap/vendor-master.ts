import type { Invoice, ZoneField } from "./types";
/**
 * Vendor master records — the editable vendor profile persisted in the AP
 * store. Keyed by vendor name; the record is optional per vendor, falling
 * back to derived defaults (billing@ email, initials logo).
 *
 * address/iban/vatNumber/businessRegistrationNumber/department are optional so
 * records written before the Vendor Profile Registration phase
 * (name/email/logo only) keep loading unchanged.
 */
export const DEPARTMENTS = [
  "Engineering",
  "Finance",
  "Marketing",
  "Operations",
  "Sales",
  "People",
] as const;

/** Per-vendor department classification. Reuses the invoice-level DEPARTMENTS set. */
export type Department = (typeof DEPARTMENTS)[number];

export type VendorMaster = {
  name: string;
  /** Billing/contact email; falls back to a derived billing@slug.com. */
  email: string;
  /** Optional logo as a data URL (small images only). */
  logoUrl?: string | undefined;
  /** Street + city as a single free-text line. */
  address?: string | undefined;
  /** IBAN for payment. */
  iban?: string | undefined;
  /** VAT identification number (BTW-nummer). */
  vatNumber?: string | undefined;
  /** KvK (Chamber of Commerce) number. */
  businessRegistrationNumber?: string | undefined;
  /** Per-vendor default department. Invoices from this vendor prefill this
   *  onto `Invoice.department` when the vendor profile is confirmed. */
  department?: Department | undefined;
  /** Legacy spelling kept for older stored records and callers. */
  kvkNumber?: string | undefined;
  /** Legacy agreed payment terms, e.g. "Net 30" — kept for stored records, no longer shown. */
  paymentTerms?: string | undefined;
  updatedAt: string;
};

/** Profile fields in card display order; name is always first. */
export const PROFILE_FIELDS = [
  "name",
  "email",
  "address",
  "iban",
  "vatNumber",
  "businessRegistrationNumber",
  "department",
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** Profile field → document zone field, for focus-follows-highlight on registration.
 *  department is absent — it has no position on the document. */
export const PROFILE_ZONE_FIELD: Partial<Record<ProfileField, ZoneField>> = {
  name: "vendor",
  email: "vendorEmail",
  address: "address",
  iban: "iban",
  vatNumber: "vatNumber",
  businessRegistrationNumber: "businessRegistrationNumber",
};

/** Blank strings count as missing so untouched inputs never inflate the meter. */
export function profileCompleteness(v: VendorMaster): { filled: number; total: number } {
  const filled = PROFILE_FIELDS.filter((f) => v[f] !== undefined && v[f].trim() !== "").length;
  return { filled, total: PROFILE_FIELDS.length };
}

/* ─── Registration gate ──────────────────────────────────────────── */

import { businessRegistrationLabel, registrationCountry } from "./business-registration";
import { ibanChecksumValid, normalizeIban } from "./iban";

/**
 * The fields a processor must confirm before a vendor profile can be saved.
 * Name and business registration establish *who* is being paid (confirmed as
 * a pair); the IBAN establishes *where* the money goes and must be
 * checksum-valid. Everything else is enriching data the completeness meter
 * nudges for — a hard gate on those would lock out foreign vendors with no
 * KvK/VAT and train users to type junk.
 */
export const REQUIRED_PROFILE_FIELDS = [
  "name",
  "businessRegistrationNumber",
  "iban",
] as const satisfies readonly ProfileField[];

/** The required fields still missing (or, for the IBAN, not checksum-valid). */
export function vendorProfileGaps(vendor: VendorMaster): ProfileField[] {
  return REQUIRED_PROFILE_FIELDS.filter((field) => {
    if (field === "iban") return !ibanChecksumValid(normalizeIban(vendor.iban ?? ""));
    const value = vendor[field];
    return value === undefined || value.trim() === "";
  });
}

/** Human label for a required field; the registration number is country-scoped. */
export function vendorProfileGapLabel(field: ProfileField, vendor: VendorMaster): string {
  return profileFieldLabel(field, vendor);
}

/** Human label for any profile field — audit entries and UI share one naming. */
export function profileFieldLabel(field: ProfileField, vendor: VendorMaster): string {
  if (field === "businessRegistrationNumber") {
    return businessRegistrationLabel(registrationCountry(vendor.vatNumber, vendor.iban));
  }
  const labels: Record<Exclude<ProfileField, "businessRegistrationNumber">, string> = {
    name: "Vendor name",
    email: "Billing email",
    address: "Address",
    iban: "IBAN",
    vatNumber: "VAT number",
    department: "Department",
  };
  return labels[field];
}

/**
 * Initial profile draft seeded by whatever the extractor already pulled off the
 * document. Empty strings, not `undefined`, so the inputs render as blanks
 * rather than placeholders that hide the extraction result.
 */
export function seedProfileFromInvoice(invoice: Invoice): VendorMaster {
  const record: VendorMaster = {
    name: invoice.vendor ?? "",
    email: invoice.vendorEmail ?? "",
    address: invoice.address,
    iban: invoice.iban,
    vatNumber: invoice.vatNumber,
    businessRegistrationNumber: invoice.businessRegistrationNumber,
    updatedAt: new Date().toISOString(),
  };
  return record;
}

/* ─── Audit: identity corrections ───────────────────────────────── */

const asText = (value: string | undefined): string =>
  value === undefined ? "" : String(value).trim();

/** IBAN/VAT are upper-cased on save; case alone is not an operator correction. */
function sameValue(field: ProfileField, a: string, b: string): boolean {
  if (field === "iban" || field === "vatNumber") return a.toUpperCase() === b.toUpperCase();
  return a === b;
}

/**
 * What the operator changed between the seeded profile and the saved record —
 * the difference the vendor-profile audit trail is written from. `from`/`to`
 * are display-ready (trimmed, "" for unset).
 */
export function profileCorrections(
  seed: VendorMaster,
  saved: VendorMaster,
): Array<{ field: ProfileField; from: string; to: string }> {
  return PROFILE_FIELDS.filter((field) => {
    const a = asText(seed[field]);
    const b = asText(saved[field]);
    return !sameValue(field, a, b);
  }).map((field) => ({ field, from: asText(seed[field]), to: asText(saved[field]) }));
}
