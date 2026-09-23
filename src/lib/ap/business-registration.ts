/**
 * Business registration numbers — one generic field, country-scoped labels.
 *
 * Under the hood the invoice stores a single "businessRegistration" string per
 * vendor (replaced the old Dutch-only "kvkNumber"). The UI label is chosen from
 * the country table so editors see the local name: "KVK number" for NL,
 * "SIREN / SIRET" for FR, "Handelsregisternummer" for DE, etc.
 */

import { ibanCountry, normalizeIban } from "./iban";

/** ISO 3166-1 alpha-2 → how the field is labelled in the UI. */
export const BUSINESS_REGISTRATION_LABELS: Readonly<Record<string, string>> = {
  NL: "KVK number",
  FR: "SIREN / SIRET",
  DE: "Handelsregisternummer",
  GB: "Company Registration Number",
  BE: "KBO number",
  FI: "Y-tunnus",
};

/** Fallback label when the country is unknown or not in the table above. */
export const BUSINESS_REGISTRATION_LABEL_FALLBACK = "Business registration number";

/**
 * UI label for the business-registration field given a country code (ISO 3166-1
 * alpha-2, e.g. "NL"). Unknown / missing countries fall back to the generic
 * label so the field is never unlabelled.
 */
export function businessRegistrationLabel(country: string | undefined): string {
  if (!country) return BUSINESS_REGISTRATION_LABEL_FALLBACK;
  return (
    BUSINESS_REGISTRATION_LABELS[country.toUpperCase()] ?? BUSINESS_REGISTRATION_LABEL_FALLBACK
  );
}

/**
 * Which country a supplier's registration number belongs to, read from the
 * identifiers an invoice already carries: VAT numbers and IBANs both start with
 * the two-letter country prefix. VAT wins — it is the registration country, and
 * it is the number a registration number sits next to in the footer — while the
 * bank's country stands in when the VAT number is missing or un-prefixed (a US
 * EIN, say).
 *
 * Returns undefined when neither identifier says anything, so callers fall back
 * to the generic label rather than guessing a country.
 */
export function registrationCountry(
  vatNumber: string | undefined,
  iban: string | undefined,
): string | undefined {
  const vat = vatNumber?.trim().toUpperCase().slice(0, 2) ?? "";
  if (/^[A-Z]{2}$/.test(vat)) return vat;
  const bank = iban ? ibanCountry(normalizeIban(iban)) : "";
  return bank || undefined;
}
