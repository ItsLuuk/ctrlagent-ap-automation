/**
 * Tax validation — VAT/GST number formats, tax arithmetic, and cross-border
 * (reverse-charge) observations for the approval check list.
 *
 * Pure domain: no browser or persistence APIs, no value rewrites — every
 * finding is a fact a person judges. Structural EU/GB format knowledge lives
 * in `vat-collector` (the table the OCR already trusts); this module adds the
 * handful of non-EU GST formats and turns everything into approval findings.
 *
 * Severity is deliberately `attention`, never `blocking`: freight outside the
 * subtotal, mixed-rate lines and cess-style levies all make an odd-looking
 * arithmetic or rate legitimate, and the existing approve-scope validation
 * already owns the hard gates (line totals, missing fields).
 */
import { EU_VAT_PATTERNS, isValidVatFormat } from "./vat-collector";
import { registrationCountry } from "./business-registration";
import { SUM_MATCH_TOLERANCE } from "./mapping";
import { money, ZONE_LABEL, type BusinessProfile, type Invoice, type ZoneField } from "./types";

/**
 * Non-EU VAT/GST structures, kept out of `EU_VAT_PATTERNS` on purpose: that
 * table drives OCR candidate scanning, and widening it would change what the
 * extractor accepts. Compact form, country prefix first.
 */
const NON_EU_VAT_PATTERNS: ReadonlyArray<{ cc: string; re: RegExp }> = [
  // Swiss UID: CHE-123.456.789, optionally suffixed MWST/TVA/IVA.
  { cc: "CH", re: /^CHE\d{9}(?:MWST|TVA|IVA)?$/ },
  // Norwegian MVA: NO + nine organisation digits + MVA (suffix often dropped).
  { cc: "NO", re: /^NO\d{9}(?:MVA)?$/ },
  // Australian ABN, 11 digits.
  { cc: "AU", re: /^AU\d{11}$/ },
  // New Zealand IRD number, 8–9 digits.
  { cc: "NZ", re: /^NZ\d{8,9}$/ },
];

/**
 * EU member states for *tax treatment* rules (reverse charge). Derived from
 * the format table minus GB: post-Brexit UK supplies are not intra-EU, and a
 * narrow flag beats a wrong one.
 */
const INTRA_EU_CCS: ReadonlySet<string> = new Set(
  EU_VAT_PATTERNS.map((p) => p.cc).filter((cc) => cc !== "GB"),
);

/** Highest standard VAT rate in the EU (Hungary, 27%) with a point of headroom. */
const MAX_PLAUSIBLE_TAX_RATE = 0.3;

/**
 * What a jurisdiction charges, for judging an invoice against its own rules.
 * `vat: false` means there is no single statutory rate to judge against (the
 * US sales-tax patchwork is the standing example) — the generic plausibility
 * cap applies there instead. Rates are fractions: 0.21 = 21%.
 */
export type JurisdictionTax = {
  currency: string;
  standardRate: number;
  reducedRates: number[];
  vat: boolean;
};

export const JURISDICTION_TAX: Readonly<Record<string, JurisdictionTax>> = {
  NL: { currency: "EUR", standardRate: 0.21, reducedRates: [0.09], vat: true },
  BE: { currency: "EUR", standardRate: 0.21, reducedRates: [0.06, 0.12], vat: true },
  DE: { currency: "EUR", standardRate: 0.19, reducedRates: [0.07], vat: true },
  FR: { currency: "EUR", standardRate: 0.2, reducedRates: [0.1, 0.055, 0.021], vat: true },
  ES: { currency: "EUR", standardRate: 0.21, reducedRates: [0.1, 0.04], vat: true },
  IT: { currency: "EUR", standardRate: 0.22, reducedRates: [0.1, 0.05, 0.04], vat: true },
  PT: { currency: "EUR", standardRate: 0.23, reducedRates: [0.13, 0.06], vat: true },
  AT: { currency: "EUR", standardRate: 0.2, reducedRates: [0.1, 0.13], vat: true },
  IE: { currency: "EUR", standardRate: 0.23, reducedRates: [0.135, 0.09], vat: true },
  FI: { currency: "EUR", standardRate: 0.255, reducedRates: [0.14, 0.1], vat: true },
  GR: { currency: "EUR", standardRate: 0.24, reducedRates: [0.13, 0.06], vat: true },
  PL: { currency: "PLN", standardRate: 0.23, reducedRates: [0.08, 0.05], vat: true },
  SE: { currency: "SEK", standardRate: 0.25, reducedRates: [0.12, 0.06], vat: true },
  DK: { currency: "DKK", standardRate: 0.25, reducedRates: [], vat: true },
  GB: { currency: "GBP", standardRate: 0.2, reducedRates: [0.05], vat: true },
  CH: { currency: "CHF", standardRate: 0.081, reducedRates: [0.026, 0.038], vat: true },
  // No VAT: state-level sales tax has no single rate to judge against.
  US: { currency: "USD", standardRate: 0, reducedRates: [], vat: false },
};

/** The rate plausibility ceiling for one jurisdiction: its own top rate. */
export function taxRateCeiling(jurisdiction: string | undefined): number | undefined {
  const rule = jurisdiction ? JURISDICTION_TAX[jurisdiction.toUpperCase()] : undefined;
  return rule?.vat ? rule.standardRate : undefined;
}

/** A VAT number can only carry a rate worth judging when the base is real. */
const MIN_RATE_BASE = 1;

function compactVat(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9+*]/g, "");
}

export type VatFormatCheck = {
  ok: boolean;
  /** Two-letter VAT country as the number claims it (Greece reads EL). */
  country?: string | undefined;
  /** Why a number failed: the shape is wrong, the prefix is unknown, or absent. */
  reason?: "format" | "unknown_country" | "no_country_prefix" | undefined;
};

/**
 * Structural format check for one VAT/GST number — does it match its own
 * country's published structure? Not a checksum and not a registry lookup:
 * those need a network, and this module must stay testable offline.
 */
export function validateVatNumber(raw: string | undefined): VatFormatCheck {
  const compact = compactVat(raw ?? "");
  if (!compact) return { ok: false, reason: "no_country_prefix" };
  const cc = /^[A-Z]{2}/.test(compact) ? compact.slice(0, 2) : "";
  if (!cc) return { ok: false, reason: "no_country_prefix" };
  const eu = EU_VAT_PATTERNS.find((p) => p.cc === cc);
  if (eu) {
    return isValidVatFormat(compact)
      ? { ok: true, country: cc }
      : { ok: false, country: cc, reason: "format" };
  }
  const other = NON_EU_VAT_PATTERNS.find((p) => p.cc === cc);
  if (other) {
    return other.re.test(compact)
      ? { ok: true, country: cc }
      : { ok: false, country: cc, reason: "format" };
  }
  return { ok: false, country: cc, reason: "unknown_country" };
}

/** A row for the approval check list: everything `ApprovalCheck` needs but the group. */
export type TaxFinding = {
  id: string;
  /** Subset of the approval groups this row is allowed to land in. */
  group: "vendor" | "header" | "amounts" | "commitments";
  label: string;
  severity: "ok" | "attention";
  documentValue: string;
  heldValue?: string | undefined;
  detail?: string | undefined;
  /** Field whose value region the row highlights on the document. */
  field?: ZoneField | undefined;
};

function vatFormatDetail(check: VatFormatCheck, country: string | undefined): string {
  if (check.reason === "no_country_prefix") {
    return "A VAT number starts with its two-letter country code (NL…, DE…, BE…) — this one has none.";
  }
  if (check.reason === "unknown_country") {
    return `"${country}" isn't a VAT country we know — check the number against the page.`;
  }
  return `This doesn't match the ${country} VAT structure — re-read it against the page.`;
}

/**
 * Every tax finding for one invoice: the supplier's VAT number format, our
 * own profile's, the tax arithmetic, an implausible implied rate, and the
 * cross-border reverse-charge picture when both sides are EU.
 *
 * `profile` is the operator's own business profile — its VAT number and IBAN
 * are the buyer's side of every cross-border test.
 */
export function taxFindings(
  invoice: Invoice,
  profile?: BusinessProfile | undefined,
  /** The buying entity's jurisdiction — judges the rate against its own rules. */
  jurisdiction?: string | undefined,
): TaxFinding[] {
  const findings: TaxFinding[] = [];
  const currency = invoice.currency || "EUR";

  // ── VAT number formats ────────────────────────────────────────────────
  const supplierVat = invoice.vatNumber?.trim() ?? "";
  if (supplierVat) {
    const check = validateVatNumber(supplierVat);
    if (!check.ok) {
      findings.push({
        id: "tax:supplier-vat",
        group: "vendor",
        label: `${ZONE_LABEL.vatNumber} format`,
        severity: "attention",
        documentValue: supplierVat,
        field: "vatNumber",
        detail: vatFormatDetail(check, check.country),
      });
    }
  }

  const ownVat = profile?.vatNumber.trim() ?? "";
  if (ownVat) {
    const check = validateVatNumber(ownVat);
    if (!check.ok) {
      findings.push({
        id: "tax:our-vat",
        group: "header",
        label: "Our VAT number",
        severity: "attention",
        documentValue: "—",
        heldValue: ownVat,
        detail: `Held in the business profile: ${vatFormatDetail(check, check.country)}`,
      });
    }
  }

  // ── Tax arithmetic ────────────────────────────────────────────────────
  const { subtotal, tax, total } = invoice;
  const expected = subtotal + tax;
  const mismatch = Math.abs(expected - total) > SUM_MATCH_TOLERANCE;
  const negativeTax = tax < -SUM_MATCH_TOLERANCE;
  const taxExceedsTotal = total > 0 && tax > total + SUM_MATCH_TOLERANCE;
  if (mismatch || negativeTax || taxExceedsTotal) {
    const detail = negativeTax
      ? `Tax is negative (${money(tax, currency)}) on an invoice with a positive total — credit lines usually carry their own paperwork.`
      : taxExceedsTotal
        ? `Tax (${money(tax, currency)}) is larger than the total (${money(total, currency)}).`
        : `Subtotal ${money(subtotal, currency)} + tax ${money(tax, currency)} = ${money(expected, currency)}, but the total says ${money(total, currency)} — freight or discounts may sit outside the subtotal.`;
    findings.push({
      id: "tax:math",
      group: "amounts",
      label: "Tax arithmetic",
      severity: "attention",
      documentValue: money(total, currency),
      heldValue: money(expected, currency),
      field: "tax",
      detail,
    });
  }

  // ── Implied rate plausibility ─────────────────────────────────────────
  // Mixed-rate invoices imply a rate between the published ones, so only the
  // jurisdiction's own ceiling can judge: implied above the standard rate is
  // wrong whatever the basket. Unknown jurisdiction → the generic cap.
  if (subtotal >= MIN_RATE_BASE && tax > 0) {
    const rate = tax / subtotal;
    const jurisdictionCeiling = taxRateCeiling(jurisdiction);
    const ceiling = jurisdictionCeiling ?? MAX_PLAUSIBLE_TAX_RATE;
    if (rate > ceiling + 0.000_5) {
      const expected = jurisdictionCeiling
        ? `above the ${jurisdiction!.toUpperCase()} standard rate of ${(ceiling * 100).toFixed(1)}%`
        : `above every EU standard VAT rate (27% is the highest)`;
      findings.push({
        id: "tax:rate",
        group: "amounts",
        label: "Tax rate",
        severity: "attention",
        documentValue: `${(rate * 100).toFixed(1)}%`,
        heldValue: `≤ ${(ceiling * 100).toFixed(1)}% expected`,
        field: "tax",
        detail: `Tax is ${(rate * 100).toFixed(1)}% of the subtotal — ${expected}. Check the tax amount, or an added charge that isn't tax.`,
      });
    }
  }

  // ── Cross-border / reverse charge ─────────────────────────────────────
  const sellerCc = registrationCountry(supplierVat || undefined, invoice.iban || undefined);
  const buyerCc = registrationCountry(ownVat || undefined, profile?.iban || undefined);
  const intraEu = Boolean(
    sellerCc &&
      buyerCc &&
      sellerCc !== buyerCc &&
      INTRA_EU_CCS.has(sellerCc) &&
      INTRA_EU_CCS.has(buyerCc),
  );
  if (intraEu) {
    const missing: string[] = [];
    if (!supplierVat) missing.push("the supplier's VAT number");
    if (!ownVat) missing.push("your VAT number (business profile)");
    if (missing.length > 0) {
      findings.push({
        id: "tax:reverse-charge-ids",
        group: "commitments",
        label: "Reverse charge — VAT IDs",
        severity: "attention",
        documentValue: supplierVat || "Not read",
        heldValue: ownVat || "Not on file",
        field: "vatNumber",
        detail: `Cross-border invoice inside the EU (${sellerCc} → ${buyerCc}), but ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing — reverse-charge treatment can't be confirmed.`,
      });
    }
    if (tax > SUM_MATCH_TOLERANCE) {
      findings.push({
        id: "tax:reverse-charge",
        group: "commitments",
        label: "Reverse charge",
        severity: "attention",
        documentValue: money(tax, currency),
        heldValue: "Usually 0 under reverse charge",
        field: "tax",
        detail: `Cross-border intra-EU invoice (${sellerCc} supplier, ${buyerCc} buyer) with tax charged. B2B supplies are normally reverse-charged — the buyer self-assesses the VAT. Confirm the treatment before payment.`,
      });
    } else {
      findings.push({
        id: "tax:reverse-charge",
        group: "commitments",
        label: "Reverse charge",
        severity: "ok",
        documentValue: money(tax, currency),
        field: "tax",
        detail: `Tax is ${money(tax, currency)} on a ${sellerCc} → ${buyerCc} B2B invoice — consistent with the reverse-charge treatment.`,
      });
    }
  }

  return findings;
}
