/**
 * Supplier VAT collection and arbitration.
 *
 * Why this module exists: on Dutch invoices the first *labelled* VAT number is
 * often the customer's (the bill-to block sits at the top), while the
 * supplier's VAT lives in the footer next to the vendor email / IBAN / KvK.
 * The collector finds every structurally valid EU VAT number in a text; the
 * resolver picks the supplier's one, anchored to the vendor's own identifiers.
 *
 * The EU pattern table and the structural validator live here too, so this
 * module stands alone — `ocr.ts` imports them from here and re-exports every
 * public name, so existing importers keep a single import site.
 */
import type { BusinessProfile } from "./types";

/**
 * EU VAT structures per member state (BTW-nummer-controle.nl format table).
 * Each pattern matches the COMPACT form (no spaces/punctuation, with country
 * code). Used to accept structurally valid candidates and reject garbage
 * that merely looks numeric — e.g. a phone number after "Tel:".
 */
export const EU_VAT_PATTERNS = [
  {
    cc: "AT",
    re: /^ATU\d{8}$/,
  },
  {
    cc: "BE",
    re: /^BE0\d{9}$/,
  },
  {
    cc: "BG",
    re: /^BG\d{9,10}$/,
  },
  {
    cc: "CY",
    re: /^CY\d{8}[A-Z]$/,
  },
  {
    cc: "CZ",
    re: /^CZ\d{8,10}$/,
  },
  {
    cc: "DE",
    re: /^DE\d{9}$/,
  },
  {
    cc: "DK",
    re: /^DK\d{8}$/,
  },
  {
    cc: "EE",
    re: /^EE\d{9}$/,
  },
  {
    cc: "EL",
    re: /^EL\d{9}$/,
  },
  {
    cc: "ES",
    re: /^ES[0-9A-Z]\d{7}[0-9A-Z]$/,
  },
  {
    cc: "FI",
    re: /^FI\d{8}$/,
  },
  {
    cc: "FR",
    re: /^FR[0-9A-Z]{2}\d{9}$/,
  },
  {
    cc: "GB",
    re: /^GB(?:\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
  },
  {
    cc: "HR",
    re: /^HR\d{11}$/,
  },
  {
    cc: "HU",
    re: /^HU\d{8}$/,
  },
  {
    cc: "IE",
    re: /^IE\d[0-9A-Z+*]\d{5}[A-Z]$/,
  },
  {
    cc: "IT",
    re: /^IT\d{11}$/,
  },
  {
    cc: "LT",
    re: /^LT(?:\d{9}|\d{12})$/,
  },
  {
    cc: "LU",
    re: /^LU\d{8}$/,
  },
  {
    cc: "LV",
    re: /^LV\d{11}$/,
  },
  {
    cc: "MT",
    re: /^MT\d{8}$/,
  },
  {
    cc: "NL",
    re: /^NL\d{9}B\d{2}$/,
  },
  {
    cc: "PL",
    re: /^PL\d{10}$/,
  },
  {
    cc: "PT",
    re: /^PT\d{9}$/,
  },
  {
    cc: "RO",
    re: /^RO\d{2,10}$/,
  },
  {
    cc: "SE",
    re: /^SE\d{12}$/,
  },
  {
    cc: "SI",
    re: /^SI\d{8}$/,
  },
  {
    cc: "SK",
    re: /^SK\d{10}$/,
  },
];

/** True when the value matches its country's VAT structure (compact form). */
export function isValidVatFormat(raw: string): boolean {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9+*]/g, "");
  const entry = EU_VAT_PATTERNS.find((p) => compact.startsWith(p.cc));
  if (!entry) return false;
  if (entry.cc === "ES") {
    if (/^\d/.test(compact.slice(2, 3)) && /\d$/.test(compact)) return false;
  }
  return entry.re.test(compact);
}

/** A VAT number found in the text, with where it was found. */
export type VatCandidate = {
  value: string;
  index: number;
  labelled: boolean;
  nearVendorEmail?: boolean;
};

/**
 * Every structurally valid EU VAT number in `text`, in document order, each
 * carrying its own position (so arbitration can measure distance) and whether
 * a VAT/BTW label sits next to it. The operator's own VAT is dropped: a
 * self-match is never the supplier's number.
 */
export function collectVatCandidates(
  text: string,
  opts?: {
    profile?: BusinessProfile;
    vendorEmail?: string;
    vendorIban?: string;
    businessRegistrationNumber?: string;
  },
): VatCandidate[] {
  const ownVat = opts?.profile?.vatNumber?.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const candidates: VatCandidate[] = [];
  const ccList = EU_VAT_PATTERNS.map((p) => p.cc).join("|");
  const re = new RegExp(`\\b(${ccList})((?:[\\s.\\-]*[0-9A-Z+*]){1,14})`, "gi");
  for (const m of text.matchAll(re)) {
    const cc = (m[1] ?? "").toUpperCase();
    const body = m[2] ?? "";
    const alnums: string[] = [];
    for (const ch of body) if (/[0-9A-Z+*]/i.test(ch)) alnums.push(ch.toUpperCase());
    for (let n = Math.min(alnums.length, 14); n >= 1; n--) {
      const cand = cc + alnums.slice(0, n).join("");
      if (!isValidVatFormat(cand)) continue;
      if (ownVat && cand === ownVat) break;
      let seen = 0;
      let endIdx = body.length;
      for (let i = 0; i < body.length; i++) {
        if (/[0-9A-Z+*]/i.test(body[i] ?? "")) {
          seen++;
          if (seen === n) {
            endIdx = i + 1;
            break;
          }
        }
      }
      const afterRaw =
        endIdx < body.length ? (body[endIdx] ?? "") : (text[(m.index ?? 0) + m[0].length] ?? "");
      if (/[0-9A-Z+*]/i.test(afterRaw)) continue;
      const idx = m.index ?? 0;
      const windowStart = Math.max(0, idx - 50);
      const context = text.slice(windowStart, idx + m[0].length + 10);
      const labelled = /(?:btw|vat|ust|tva)\b/i.test(context);
      candidates.push({ value: cand, index: idx, labelled });
      break;
    }
  }
  const seenValues = new Set<string>();
  const dedup: VatCandidate[] = [];
  for (const c of candidates) {
    if (seenValues.has(c.value)) continue;
    seenValues.add(c.value);
    dedup.push(c);
  }
  return dedup;
}

/**
 * A VAT/BTW label anywhere in the text (any language the OCR layer reads).
 * Used by the footer-less fallback below to measure how far a candidate sits
 * from the label that names it.
 */
const VAT_LABEL_RE = /\b(?:btw|vat|ust|tva)\b/gi;

/**
 * How far (characters) a value may sit from its VAT/BTW label and still count
 * as that label's value on a footer-less invoice. Generous enough for
 * "BTW-nummer: NL123456789B01", tight enough to reject a number that merely
 * happens somewhere near a tax mention.
 */
const LABEL_FALLBACK_MAX_DISTANCE = 60;

/**
 * Picks the supplier's VAT number out of the candidates.
 *
 * Anchored path: the vendor email / IBAN / registration number, or the word
 * "supplier|leverancier", marks the supplier's block — the candidate closest
 * to one of those anchors wins, since the bill-to block at the top of the page
 * (which reads first) usually carries the *customer's* number.
 *
 * Footer-less fallback: an invoice whose supplier block never made it into the
 * text has no anchor at all, and returning nothing there silently loses the
 * supplier's VAT. Fall back to label proximity instead — the candidate closest
 * to a VAT/BTW label within {@link LABEL_FALLBACK_MAX_DISTANCE} characters —
 * with one carve-out: a value below a "Bill to" block is the customer's, and
 * stays rejected. With no label in reach the value's owner is unknowable, so
 * the conservative answer (undefined) stands.
 */
export function resolveSupplierVatNumber(
  candidates: VatCandidate[],
  ctx: {
    text: string;
    vendorEmail?: string;
    vendorIban?: string;
    businessRegistrationNumber?: string;
  },
): VatCandidate | undefined {
  if (candidates.length === 0) return undefined;
  const text = ctx.text ?? "";
  const hasSupplierAnchor =
    /supplier|leverancier/i.test(text) ||
    Boolean(ctx.vendorEmail && text.toLowerCase().includes(ctx.vendorEmail.toLowerCase())) ||
    Boolean(ctx.vendorIban && text.includes(ctx.vendorIban)) ||
    Boolean(
      ctx.businessRegistrationNumber && text.includes(ctx.businessRegistrationNumber),
    );
  if (!hasSupplierAnchor) return closestToVatLabel(candidates, text);
  let best: VatCandidate | undefined;
  let bestDist = Number.MAX_SAFE_INTEGER;
  let bestNearEmail = false;
  for (const c of candidates) {
    let dist = Number.MAX_SAFE_INTEGER;
    let nearEmail = false;
    if (ctx.vendorEmail) {
      const pos = text.toLowerCase().indexOf(ctx.vendorEmail.toLowerCase());
      if (pos !== -1) {
        dist = Math.min(dist, Math.abs(c.index - pos));
        nearEmail = dist < 600;
      }
    }
    if (ctx.vendorIban) {
      const pos = text.indexOf(ctx.vendorIban);
      if (pos !== -1) dist = Math.min(dist, Math.abs(c.index - pos));
    }
    if (ctx.businessRegistrationNumber) {
      const pos = text.indexOf(ctx.businessRegistrationNumber);
      if (pos !== -1) dist = Math.min(dist, Math.abs(c.index - pos));
    }
    if (dist === Number.MAX_SAFE_INTEGER) {
      const supplierPos = text.search(/supplier|leverancier/i);
      if (supplierPos !== -1)
        dist = c.index >= supplierPos ? c.index - supplierPos : Number.MAX_SAFE_INTEGER;
    }
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
      bestNearEmail = nearEmail;
    }
  }
  if (!best) return undefined;
  return { ...best, nearVendorEmail: bestNearEmail };
}

/** Label-proximity fallback used when no supplier anchor exists in the text. */
function closestToVatLabel(candidates: VatCandidate[], text: string): VatCandidate | undefined {
  const labels = [...text.matchAll(VAT_LABEL_RE)].map((m) => m.index ?? 0);
  const customerBlock = text.search(/bill\s*to/i);
  let best: VatCandidate | undefined;
  let bestDist = Number.MAX_SAFE_INTEGER;
  for (const candidate of candidates) {
    // Below "Bill to" with nothing marking the supplier: that is the customer's
    // number, exactly the case the anchored path exists to avoid.
    if (customerBlock !== -1 && candidate.index > customerBlock) continue;
    let dist = Number.MAX_SAFE_INTEGER;
    for (const label of labels) {
      const distance = Math.abs(candidate.index - label);
      if (distance < dist) dist = distance;
    }
    if (dist > LABEL_FALLBACK_MAX_DISTANCE) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best ? { ...best, nearVendorEmail: false } : undefined;
}
