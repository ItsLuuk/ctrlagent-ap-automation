import {
  GL_ACCOUNTS,
  DEPARTMENTS,
  ZONE_FIELDS,
  uid,
  type AnchorSpec,
  type BusinessProfile,
  type CrossCheck,
  type ExtractedField,
  type Invoice,
  type LineItem,
  type OcrMethod,
  type OcrPage,
  type OcrWord,
  type ProcessingState,
  type VendorTemplate,
  type OcrWord as PageWord,
  type DriftInfo,
  type Provenance,
  AUTO_APPROVE_PROVENANCE,
  EMPTY_BUSINESS_PROFILE,
} from "./types";
import { computeFileHash } from "./file-hash";
import { detectPrepaid, moneyToNumber, dueDateFromPaymentTerms, parseDateParts } from "./zones";
import { labelsFor, detectDocumentLocale, type DocumentLocale } from "./labels";
import { ibanChecksumValid } from "./iban";
// The model backend is reached through the port the domain owns, never by
// importing an adapter: `vision.ts` declares what a vision engine must do,
// and a composition root registers the implementation. Importing the adapter
// here is what used to make `ocr.ts` and the adapter a cycle.
import {
  mergeVisionPages,
  visionEngine,
  visionPageToFields,
  type ExtractedFields,
} from "./vision";
export type { ExtractedFields } from "./vision";
import "./pdfjs-polyfill";
import { EU_VAT_PATTERNS, isValidVatFormat } from "./vat-collector";

// The supplier-VAT machinery (EU pattern table, structural validator, candidate
// collection and supplier-anchor arbitration) lives in ./vat-collector; it is
// re-exported here so callers keep a single import site.
export {
  collectVatCandidates,
  isValidVatFormat,
  resolveSupplierVatNumber,
  type VatCandidate,
} from "./vat-collector";

const performance_default = globalThis.performance;

export type PageRead = { pageNumber: number; text: string; words?: OcrWord[] };
type ProcessingPage = PageRead & {
  method: "text-layer" | "none";
  image?: Blob | undefined;
  words: OcrWord[];
  sourceFile?: File | undefined;
};
type ProcessingDrift = DriftInfo & {
  templateKey: string;
  templateFingerprint: string;
  templateHold: boolean;
  fields: Partial<Record<ExtractedField, unknown>>;
  provenance: Partial<Record<ExtractedField, Provenance>>;
  fieldSources: Partial<Record<ExtractedField, number>>;
  lineItems: LineItem[];
  currency?: string | undefined;
};
/**
 * The quick phase's "processing" result: the placeholder invoice plus the
 * pages and flags the background job needs to finish it. Not the return type
 * of `buildProcessingSkeleton` — that builds the *invoice* inside this shape.
 */
export type ProcessingSkeleton = {
  invoice: Invoice;
  loadedPages: ProcessingPage[];
  firstSlow: boolean;
  drift?: ProcessingDrift | undefined;
};

import { compareExtractions, disagreements } from "./cross-check";
import { parseLineItemRows } from "./mapping";
import { applyTemplateField } from "./template-apply";
import { cosine, embedVendorText, extractVendorBlock, fingerprintOf } from "./fingerprint";

export type OcrProgress = {
  stage: string;
  progress: number;
  page?: number | undefined;
  totalPages?: number | undefined;
};

/** Upper bound on PDF pages processed, to keep scanned-document OCR time sane. */
export const MAX_PDF_PAGES = 20;

export function normalize(text, type) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (type === "number" || type === "decimal") {
    const numMatch = trimmed.match(/([-]?\d[\d.,]*\d|[-]?\d)(?:[^\d]|$)/);
    const n = moneyToNumber(
      (numMatch ? numMatch[0].replace(/[^\d.,\-]/g, "").replace(/[,.$]+$/, "") : trimmed) ||
        trimmed,
    );
    return n !== undefined ? Number(n.toFixed(2)) : undefined;
  }
  if (type === "date") {
    const parts = parseDateParts(trimmed);
    if (!parts) return undefined;
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }
  return trimmed;
}
/** A page with at least this much embedded text skips the slower render path. */
const TEXT_LAYER_MIN_CHARS = 120;
/** Render scale for page images fed to the VLM (2 ≈ 144 dpi). */
const RENDER_SCALE = 2;
/** Highest provenance tier — embedded PDF text layer is the source of truth. */
const PROV_TEXT_LAYER: Provenance = "exact";
/** VLMs read what they see; mild skew/noise is handled by the model, not preprocessing. */
const PROV_VLM: Provenance = "read";
/** Regex/heuristic reads over already-extracted text. */
const PROV_OCR: Provenance = "read";
/** Computed from other fields (derived due date, etc.). */
const PROV_DERIVED: Provenance = "derived";
/** Human-entered or confirmed at prompt time. */
const PROV_MANUAL: Provenance = "manual";
/** Only matches figures that look like currency. Dutch/European forms come
 * first so "1.234,56" is read as 1234.56 and not as US "1.23": alternation
 * is ordered, and the Dutch comma-decimal carries a lookahead so US
 * "14,200.00" is not clipped to "14,20".
 */
export const MONEY_RE = new RegExp(
  "(?:€\\s?(?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,\\d{2,3})?|\\$\\s?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{2})?|(?<![\\d,.])\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+,\\d{2,3}|(?<![\\d,.])\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+\\.\\d{2}|(?<![\\d,.])\\d+[ \\u00a0\\u202f]\\d{2}(?![\\d.])|(?<![\\d,.])\\d{1,3}(?:\\.\\d{3})+,\\d{2}|(?<![\\d,.])\\d{1,3}(?:\\.\\d{3})+(?![\\d.,])|(?<![\\d,.])\\d{1,3},\\d{3}(?![\\d.,])|(?<![\\d,.])\\d+,\\d{2}(?![\\d.])|(?<![\\d.])\\d{1,3}(?:,\\d{3})+\\.\\d{2}|(?<![\\d,])\\d+\\.\\d{2})",
  "g",
);
const MONEY_TEST_RE = new RegExp(`^(?:${MONEY_RE.source})$`);
export function toNumber(raw) {
  if (!raw) return undefined;
  const hadEuro = /€|\bEUR\b/i.test(raw);
  const s = raw.replace(/\b[A-Z]{2,3}\b/gi, "").replace(/[€$\s]/g, "");
  let n;
  if (/,\d{1,2}$/.test(s)) n = Number(s.replace(/\./g, "").replace(",", "."));
  else if (/,\d{3}$/.test(s))
    if (s.slice(0, s.length - 4).length <= 2 && !/\./g.test(s)) n = Number(s.replace(",", "."));
    else if (hadEuro) n = Number(s.replace(/\./g, "").replace(",", "."));
    else n = Number(s.replace(/,/g, ""));
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) n = Number(s.replace(/\./g, ""));
  else n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
const IBAN_RE = /\b[A-Z]{2}[ .]?\d{2}(?:[ .]?[A-Z0-9]){11,30}\b/gi;
const DUTCH_IBAN_RE = /^NL\d{2}[A-Z]{4}\d{10}$/;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
/** Dutch legal entity suffixes to strip when comparing vendor names to email domains. */
const VENDOR_ENTITY_RE =
  /\s+(?:B\.?V\.?|N\.?V\.?|V\.?O\.?F\.?|Eenmanszaak|Stichting|C\.?V\.?|GmbH|AG|SARL|SAS|S\.?L\.?|Ltd|LLC|Inc\.?|PLC)\.?$/i;
/** Generic email prefixes that are unlikely to be the vendor's primary contact. */
const GENERIC_EMAIL_PREFIXES =
  /^(?:noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|webmaster|hostmaster|abuse|spam|unsubscribe)$/i;
/**
 * Strips legal entity suffixes and normalizes a vendor name into a slug
 * suitable for matching against email domains and prefixes.
 * "Acme Nederland B.V." → "acmenederland", "De Vries & Co V.O.F." → "devriesco"
 */
export function slugifyVendorName(name) {
  return name
    .replace(VENDOR_ENTITY_RE, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}
/**
 * Scores how well an email address matches a known vendor name.
 * Returns 0..1 where higher is better. Used to disambiguate between
 * multiple candidate emails on the same invoice.
 *
 * Scoring logic:
 *  - Domain contains vendor slug → 0.9 (e.g. info@acme.com for "Acme B.V.")
 *  - Email prefix contains vendor slug → 0.75 (e.g. acme@partner.nl)
 *  - Generic prefix (noreply@) → 0.1 penalty
 *  - No vendor name context → 0.5 (neutral)
 */
export function scoreEmailByVendor(email, vendorName) {
  if (!vendorName) return 0.5;
  const slug = slugifyVendorName(vendorName);
  if (slug.length < 2) return 0.5;
  const parts = email.toLowerCase().split("@");
  if (parts.length !== 2) return 0.3;
  const [local, domain] = parts;
  if (GENERIC_EMAIL_PREFIXES.test(local)) return 0.1;
  const domainSlug = domain.replace(/[^a-z0-9]/g, "");
  if (domainSlug.includes(slug) || slug.includes(domainSlug)) return 0.9;
  const slugParts = slug.match(/[a-z]{3,}/g) ?? [slug];
  for (const part of slugParts) if (domainSlug.includes(part)) return 0.85;
  const localSlug = local.replace(/[^a-z0-9]/g, "");
  if (localSlug.includes(slug) || slug.includes(localSlug)) return 0.75;
  for (const part of slugParts) if (localSlug.includes(part)) return 0.65;
  return 0.5;
}
/**
 * Checks whether a text value appears near the vendor name in the document
 * text. "Near" means on the same page and within a reasonable text distance.
 * This is a text-based heuristic — no word coordinates needed.
 */
export function appearsNearVendor(text, value, vendorName) {
  if (!vendorName || !value) return false;
  const vendorLower = vendorName.toLowerCase();
  const valueLower = value.toLowerCase();
  const vendorIdx = text.toLowerCase().indexOf(vendorLower);
  if (vendorIdx === -1) return false;
  const valueIdx = text.toLowerCase().indexOf(valueLower);
  if (valueIdx === -1) return false;
  return Math.abs(vendorIdx - valueIdx) < 500;
}
/**
 * Finds the bounding box that encloses all words matching the vendor name.
 * Returns the center (cx, cy) and the average word height for distance
 * calculations. Normalized 0..1 coordinates.
 */
export function vendorNameCenter(words, vendorName) {
  const parts = vendorName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 2);
  if (parts.length === 0) return undefined;
  const matched = [];
  for (const part of parts)
    for (const w of words)
      if (w.text.toLowerCase().replace(/[^a-z0-9]/g, "") === part) {
        matched.push(w);
        break;
      }
  if (matched.length === 0) return undefined;
  const minX = Math.min(...matched.map((w) => w.x));
  const maxX = Math.max(...matched.map((w) => w.x + w.w));
  const minY = Math.min(...matched.map((w) => w.y));
  const maxY = Math.max(...matched.map((w) => w.y + w.h));
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    h: matched.reduce((s, w) => s + w.h, 0) / matched.length,
  };
}
/**
 * Finds the center of the words that match a candidate value text.
 * Tries exact match first, then falls back to substring matching.
 */
export function candidateCenter(words, candidateText) {
  const needle = candidateText.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (needle.length < 3) return undefined;
  const lower = words.map((w) => w.text.toLowerCase().replace(/[^a-z0-9]/g, ""));
  for (let i = 0; i < words.length; i++)
    if (lower[i] === needle) {
      const w = words[i];
      return {
        cx: w.x + w.w / 2,
        cy: w.y + w.h / 2,
      };
    }
  for (let i = 0; i < words.length; i++)
    if (needle.startsWith(lower[i]) && lower[i].length >= 2) {
      let remaining = needle.slice(lower[i].length);
      let endIdx = i;
      for (let j = i + 1; j < words.length && remaining.length > 0; j++)
        if (remaining.startsWith(lower[j])) {
          remaining = remaining.slice(lower[j].length);
          endIdx = j;
        }
      if (remaining.length === 0) {
        const start = words[i];
        const end = words[endIdx];
        return {
          cx: (start.x + end.x + end.w) / 2,
          cy: (start.y + end.y + end.h) / 2,
        };
      }
    }
}
/**
 * Euclidean distance between two points in normalized 0..1 space.
 * Returns a value where 0 = same position, 1 = opposite corners.
 */
export function normalizedDistance(a, b) {
  const dx = a.cx - b.cx;
  const dy = a.cy - b.cy;
  return Math.sqrt(dx * dx + dy * dy);
}
/**
 * Scores a candidate value by spatial proximity to the vendor name.
 * Returns 0..1 where higher means closer (more likely the vendor's value).
 *
 * Distance thresholds (in normalized 0..1 page space):
 *  - < 0.05 (very close, same line area) → 0.95
 *  - < 0.10 (nearby, same section) → 0.85
 *  - < 0.20 (same half of page) → 0.70
 *  - >= 0.20 (far away) → 0.40
 */
export function scoreByProximity(candidateText, vendorName, words) {
  const vendorCenter = vendorNameCenter(words, vendorName);
  if (!vendorCenter) return 0.5;
  const candidatePos = candidateCenter(words, candidateText);
  if (!candidatePos) return 0.5;
  const dist = normalizedDistance(vendorCenter, candidatePos);
  if (dist < 0.05) return 0.95;
  if (dist < 0.1) return 0.85;
  if (dist < 0.2) return 0.7;
  return 0.4;
}
/**
 * Checks whether a candidate value matches the user's own business profile.
 * Used to exclude customer/bill-to data from vendor extraction.
 */
export function isOwnBusiness(value, profile) {
  if (!value || !profile.name) return false;
  const v = value.toLowerCase().trim();
  if (profile.name && v.includes(profile.name.toLowerCase())) return true;
  if (profile.name && profile.name.toLowerCase().includes(v) && v.length >= 4) return true;
  return false;
}
export function isOwnField(value, profile, field) {
  if (!value) return false;
  const v = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const p = profile[field]?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!p || p.length < 4) return false;
  return v.includes(p) || p.includes(v);
}
export function normalizeIban(raw) {
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}
export function isValidIban(raw) {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)) return false;
  return ibanChecksumValid(iban);
}
export function findEmailIn(text, profile, vendorName, words) {
  const allEmails = [
    ...new Set(
      [...text.matchAll(new RegExp(EMAIL_RE.source, "gi"))].map((m) => m[0].toLowerCase()),
    ),
  ];
  if (allEmails.length === 0) return undefined;
  const ownProfile = profile ?? EMPTY_BUSINESS_PROFILE;
  const labelledEmail = text
    .match(
      /(?:vendor|supplier|leverancier|facturatie|billing|email|e-mail|contact(?:\s*email)?|klantenservice|info)\s*[:\-]?[^\n]{0,48}(${EMAIL_RE.source})/i,
    )?.[1]
    ?.toLowerCase();
  const scored = [];
  for (const email of allEmails) {
    if (isOwnField(email, ownProfile, "email")) continue;
    const isLabelled = email === labelledEmail;
    let score = scoreEmailByVendor(email, vendorName ?? "") + (isLabelled ? 0.3 : 0);
    if (words && vendorName && words.length > 0) {
      const proximity = scoreByProximity(email, vendorName, words);
      score += (proximity - 0.5) * 0.4;
    }
    scored.push({
      value: email,
      score,
      labelled: isLabelled,
    });
  }
  if (scored.length === 0) return undefined;
  scored.sort((a, b) => b.score - a.score);
  return {
    value: scored[0].value,
    labelled: scored[0].labelled,
  };
}
export function findIbanIn(text, profile, vendorName, words) {
  const matches = [...text.matchAll(IBAN_RE)]
    .map((m) => normalizeIban(m[0]))
    .filter((value) => isValidIban(value) || DUTCH_IBAN_RE.test(value));
  const fallback = text.match(/NL[\s]*(?:\d[\s]*){2}(?:[A-Z][\s]*){4}(?:\d[\s]*){10}/i)?.[0];
  if (matches.length === 0 && fallback && DUTCH_IBAN_RE.test(normalizeIban(fallback)))
    matches.push(normalizeIban(fallback));
  if (matches.length === 0) return undefined;
  const ownIban = (profile ?? EMPTY_BUSINESS_PROFILE).iban
    ?.replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  if (ownIban && ownIban.length >= 10) {
    const filtered = matches.filter((m) => m !== ownIban);
    if (filtered.length > 0) matches.splice(0, matches.length, ...filtered);
  }
  if (matches.length === 0) return undefined;
  const labelled =
    /(?:iban|bankrekening|bank(?:rekening)?|rekening(?:nummer)?|betalingsgegevens)\s*[:\-]?[^\n]{0,48}/i.test(
      text,
    );
  if (matches.length === 1)
    return {
      value: matches[0],
      labelled,
    };
  if (vendorName && matches.length > 1)
    matches.sort((a, b) => {
      if (words && words.length > 0) {
        const aScore = scoreByProximity(a, vendorName, words);
        const bScore = scoreByProximity(b, vendorName, words);
        if (Math.abs(aScore - bScore) > 0.1) return bScore - aScore;
      }
      const aNear = appearsNearVendor(text, a, vendorName) ? 0 : 1;
      const bNear = appearsNearVendor(text, b, vendorName) ? 0 : 1;
      if (aNear !== bNear) return aNear - bNear;
      return (a.startsWith("NL") ? 0 : 1) - (b.startsWith("NL") ? 0 : 1);
    });
  else matches.sort((a, b) => (a.startsWith("NL") ? 0 : 1) - (b.startsWith("NL") ? 0 : 1));
  return {
    value: matches[0],
    labelled,
  };
}
function normalizeVatNumber(raw) {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (
    /^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|GB|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)/.test(
      compact,
    )
  )
    return compact;
  if (/^\d{9}B\d{2}$/.test(compact)) return `NL${compact}`;
  return compact;
}
/**
 * Finds the character position of the vendor email in the text. The vendor's
 * name, address, BTW and KVK usually cluster around it (footer block), so it
 * anchors the other profile-field extractions.
 */
export function vendorEmailPos(text, vendorEmail) {
  if (!vendorEmail) return -1;
  return text.toLowerCase().indexOf(vendorEmail.toLowerCase());
}
/** Distance from a position to the vendor email anchor (-1 anchor = far). */
export function anchorDistance(text, pos, vendorEmail) {
  const anchor = vendorEmailPos(text, vendorEmail);
  if (anchor === -1 || pos === -1) return Number.MAX_SAFE_INTEGER;
  return Math.abs(pos - anchor);
}
/**
 * Business registration number: country-scoped identifier for the supplier's
 * legal entity (NL KVK, FR SIREN/SIRET, DE HRB/HRA, GB CRN, BE KBO, FI
 * Y-tunnus, ...). Unlike the Dutch-only KVK reader below, this reader
 * recognises labels in multiple languages so the generic field can be populated
 * for non-Dutch suppliers too.
 *
 * The label is local and shown in the UI by `businessRegistrationLabel()` in
 * business-registration.ts; under the hood it is one string field.
 */
export function findBusinessRegistrationNumberIn(text, vendorEmail) {
  const nl = /\bkvk(?:[\s-]*(?:nr\.?|nummer|number|num))?[\s:\-]?\s*((?:\d[\s.\-]*){7,8})\b/gi;
  const nlCoc =
    /\b(?:chamber\s+of\s+commerce|kamer\s+van\s+koophandel|c\.?o\.?c\.?)\s*(?:nr\.?|number)?\s*[:\-]?\s*((?:\d[\s.\-]*){7,8})\b/gi;
  const fr = /\b(?:siren|siret)\s*(?:num(?:éro)?\.?|nr\.?|number)?\s*[:\-]?\s*(\d{9,14})\b/gi;
  const de =
    /\b(?:hrb|hra|handelsregisternummer|handelsregister\s*nummer)\s*(?:nr\.?|number)?\s*[:\-]?\s*(\d{3,8})\b/gi;
  const gb =
    /\b(?:company\s*(?:registration\s*)?number|crn|companies\shouse\s*number)\s*(?:nr\.?|number)?\s*[:\-]?\s*(\d{6,10})\b/gi;
  const be = /\b(?:kbo|bce)\s*(?:nr\.?|nummer|number)?\s*[:\-]?\s*(?:\d[\s\-.\/]*\d){8,10}\b/gi;
  const fi = /\b(?:y[\s-]?tun(?:nus)?|business\s*id)\s*(?:nr\.?|number)?\s*[:\-]?\s*(\d{6,7})\b/gi;
  const all = [
    ...text.matchAll(nl),
    ...text.matchAll(nlCoc),
    ...text.matchAll(fr),
    ...text.matchAll(de),
    ...text.matchAll(gb),
    ...text.matchAll(be),
    ...text.matchAll(fi),
  ];
  if (all.length === 0) return undefined;
  let best = all[0];
  if (vendorEmail) {
    let bestDist = Number.MAX_SAFE_INTEGER;
    for (const m of all) {
      const dist = anchorDistance(text, m.index ?? -1, vendorEmail);
      if (dist < bestDist) {
        bestDist = dist;
        best = m;
      }
    }
  }
  const compact = String(best[1] ?? "").replace(/[\s\-.\/]/g, "");
  if (
    !/^\d{7,8}$/.test(compact) &&
    !/^\d{9,14}$/.test(compact) &&
    !/^\d{3,8}$/.test(compact) &&
    !/^\d{6,10}$/.test(compact) &&
    !/^\d{8,10}$/.test(compact) &&
    !/^\d{6,7}$/.test(compact)
  )
    return undefined;
  return {
    value: compact,
    labelled: true,
  };
}
/**
 * Vendor-block arbitration for supplier profile identifiers (VAT, business
 * registration).
 * The vision model reads top-down and returns the first labelled number,
 * which on Dutch invoices is often the *customer's* (bill-to block at the
 * top). The regex finders below are anchored to the vendor email in the
 * footer block, so when an anchor exists the anchored read wins — whether
 * the current value came from the VLM, a template, or is still empty.
 * Without an anchor there is nothing to arbitrate with: keep current, so a
 * missing value stays a visible profile gap instead of becoming a wrong one.
 */
export function preferAnchoredProfileValue(current, anchored, vendorEmail) {
  if (!vendorEmail || !anchored) return current;
  return anchored;
}
/**
 * Address extraction anchored to the vendor email / vendor block. Within a
 * window around the anchor, pairs a street line (house number) with a Dutch
 * postal-code line — in either order, since footer blocks are often read
 * bottom-up — so the *vendor's* address wins over the customer's.
 */
function findAddressAnchoredIn(text, profile, vendorEmail) {
  if (!vendorEmail) return findAddressIn(text, profile);
  const anchor = vendorEmailPos(text, vendorEmail);
  if (anchor === -1) return findAddressIn(text, profile);
  const lines = text.split("\n");
  let offset = 0;
  const indexed = lines.map((line) => {
    const start = offset;
    offset += line.length + 1;
    return {
      line: line.trim(),
      start,
    };
  });
  const POSTAL_LINE = /^\d{4}\s{0,3}[A-Z]{2}(?:\s{1,}.+)?$/i;
  const HOUSE_NUM = /\b\d{1,5}[A-Za-z]?\b/;
  const MONEY = /[€$]\s*\d|\d+,\d{2}/;
  const LABELISH =
    /:|\bbtw\b|\biban\b|\bkvk\b|\bsiren\b|\bsiret\b|\bhrb\b|\bhra\b|\bkbo\b|\bbce\b|\by[-\s]?tun(?:nus)?\b|\bbusiness\s?id\b|\btel\b|\bbic\b|pagina/i;
  const dist = (start) => Math.abs(start - anchor);
  const postalHits = indexed.filter(
    (l) => l.line && POSTAL_LINE.test(l.line) && !LABELISH.test(l.line),
  );
  if (postalHits.length === 0) return findAddressIn(text, profile);
  postalHits.sort((a, b) => dist(a.start) - dist(b.start));
  const postal = postalHits[0];
  if (dist(postal.start) > 600) return findAddressIn(text, profile);
  const streetHits = indexed.filter((l) => {
    if (!l.line || l.line === postal.line) return false;
    if (!HOUSE_NUM.test(l.line)) return false;
    if (MONEY.test(l.line) || LABELISH.test(l.line)) return false;
    if (POSTAL_LINE.test(l.line)) return false;
    if (/factuur|invoice|order|referentie|ordernummer/i.test(l.line)) return false;
    if (!/[A-Za-z]{3,}/.test(l.line.replace(/\d/g, ""))) return false;
    return dist(l.start) <= dist(postal.start) + 300;
  });
  streetHits.sort((a, b) => Math.abs(a.start - postal.start) - Math.abs(b.start - postal.start));
  const street = streetHits[0];
  const clean = (s) =>
    s
      .replace(/\s{2,}/g, " ")
      .trim()
      .replace(/[,;]+$/, "");
  if (street)
    return {
      value: `${clean(street.line)}, ${clean(postal.line)}`.slice(0, 120),
      labelled: false,
    };
  return {
    value: clean(postal.line).slice(0, 120),
    labelled: false,
  };
}
export function findVatNumberIn(text: string, profile?: BusinessProfile, vendorEmail?: string) {
  const labelledLine =
    text.match(
      /(?:btw[- ]?(?:identificatienummer|identificatienr|nummer|nr\.?|id)|vat(?:\s+(?:number|id|nr|number))?|USt[- ]?(?:I(?:d|-Nummer)|Nr\.?))\s*[:\-]?\s*([^\n]{0,40})/i,
    )?.[1] ?? "";
  const values = (
    `${labelledLine}\n${text}`.match(/(?:NL\s*)?(?:\d[\s.\-]?){9}\s*B\s*\d{2}/gi) ?? []
  )
    .map(normalizeVatNumber)
    .filter((value) => /^NL\d{9}B\d{2}$/.test(value));
  const ownVat = (profile ?? EMPTY_BUSINESS_PROFILE).vatNumber
    ?.replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  const filteredValues =
    ownVat && ownVat.length >= 10 ? values.filter((v) => v !== ownVat) : values;
  if (filteredValues.length > 0) {
    const hasSupplierContext = Boolean(vendorEmail) || /(?:supplier|leverancier)/i.test(text);
    if (!hasSupplierContext && /bill to/i.test(text) && !/(?:btw|vat)/i.test(text.split(/bill to/i)[0] ?? "")) {
      // Customer-only VAT without supplier anchor — treat as not the supplier's VAT.
    } else {
      if (filteredValues.length > 1 && vendorEmail) {
      const positions = [
        ...`${labelledLine}\n${text}`.matchAll(/(?:NL\s*)?(?:\d[\s.\-]?){9}\s*B\s*\d{2}/gi),
      ].map((m) => ({
        value: normalizeVatNumber(m[0]),
        index: (m.index ?? 0) - labelledLine.length - 1,
      }));
      let bestValue = filteredValues[0];
      let bestDist = Number.MAX_SAFE_INTEGER;
      for (const p of positions) {
        const dist = anchorDistance(text, p.index, vendorEmail);
        if (dist < bestDist) {
          bestDist = dist;
          bestValue = p.value;
        }
      }
      return {
        value: bestValue,
        labelled: Boolean(labelledLine),
      };
    }
      return {
        value: filteredValues[0],
        labelled: Boolean(labelledLine),
      };
    }
  }
  const ccList = EU_VAT_PATTERNS.map((p) => p.cc).join("|");
  const bodyRe = new RegExp(`\\b(${ccList})((?:[\\s.\\-]*[0-9A-Z+*]){1,14})`, "gi");
  const hay = `${labelledLine}\n${text}`;
  const euCandidates = [];
  for (const m of hay.matchAll(bodyRe)) {
    const cc = m[1].toUpperCase();
    const body = m[2];
    const alnums = [];
    for (const ch of body) if (/[0-9A-Z+*]/i.test(ch)) alnums.push(ch.toUpperCase());
    for (let n = Math.min(alnums.length, 14); n >= 1; n--) {
      const cand = cc + alnums.slice(0, n).join("");
      if (!isValidVatFormat(cand)) continue;
      let seen = 0;
      let endIdx = body.length;
      for (let i = 0; i < body.length; i++)
        if (/[0-9A-Z+*]/i.test(body[i])) {
          seen++;
          if (seen === n) {
            endIdx = i + 1;
            break;
          }
        }
      const afterRaw =
        endIdx < body.length ? (body[endIdx] ?? "") : (hay[m.index + m[0].length] ?? "");
      if (/[0-9A-Z+*]/i.test(afterRaw)) continue;
      euCandidates.push({
        value: cand,
        index: (m.index ?? 0) - labelledLine.length - 1,
      });
      break;
    }
  }
  if (euCandidates.length > 0) {
    const hasSupplierContext = Boolean(vendorEmail) || /(?:supplier|leverancier)/i.test(text);
    if (!hasSupplierContext && /bill to/i.test(text) && !/(?:btw|vat)/i.test(text.split(/bill to/i)[0] ?? "")) {
      // Customer-only block without supplier anchor — do not surface a VAT.
    } else {
      let best = euCandidates[0];
    if (euCandidates.length > 1 && vendorEmail) {
      let bestDist = Number.MAX_SAFE_INTEGER;
      for (const c of euCandidates) {
        const dist = anchorDistance(text, c.index, vendorEmail);
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
    }
    return {
      value: best.value,
      labelled: Boolean(labelledLine),
    };
    }
  }
}
/** Street/road types common in the Netherlands and Belgium.
 *  Matches as a suffix of compound Dutch words (e.g. Industrieweg, Keizersgracht). */
const DUTCH_STREET_TYPES =
  /(?:straat|straatje|laan|weg|dreef|wegel|pad|dijk|dam|kade|gracht|singel|hof|plein|park|boulevard|drive|lane|court|place|avenue|road|street)(?=[^a-zA-Z]|$)/i;
/** Dutch postal code — 4 digits + 2 letters, optionally space-separated. */
const DUTCH_POSTAL_RE = /\b(\d{4}\s?[A-Z]{2})\b/i;
/** Detects Postbus / bus (PO box) addresses. */
const POSTBUS_RE = /\b(?:postbus|bus\.?\s*\d+)\b/i;
/** Lines that signal the end of an address block. */
const ADDRESS_END_RE =
  /@|(?:e-?mail|iban|btw[-\s]?(?:nr|nummer|identificatie)|factuur|invoice|telefoon|phone|kvk|website|www\.|http)/i;
export function findAddressIn(text, profile) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const ownProfile = profile ?? EMPTY_BUSINESS_PROFILE;
  const labelled = text
    .match(/(?:adres|address|vestigingsadres|factuuradres|locatie)\s*[:\-]?\s*([^\n]+)/i)?.[1]
    ?.trim();
  if (labelled && /\d/.test(labelled) && /[A-Za-z]{2,}/.test(labelled)) {
    if (!isOwnField(labelled, ownProfile, "address"))
      return {
        value: labelled,
        labelled: true,
      };
  }
  for (let i = 0; i < lines.length; i++)
    if (POSTBUS_RE.test(lines[i])) {
      const next = lines[i + 1];
      return {
        value: [
          lines[i],
          ...(next && DUTCH_POSTAL_RE.test(next) && !ADDRESS_END_RE.test(next) ? [next] : []),
        ]
          .join(", ")
          .slice(0, 120),
        labelled: false,
      };
    }
  const addressLine = lines.findIndex((line) => {
    const hasHouseNumber = /\b\d{1,5}[A-Za-z]?\b/.test(line);
    const hasPostalCode = DUTCH_POSTAL_RE.test(line);
    const hasStreetType = DUTCH_STREET_TYPES.test(line);
    const hasComma = /,/.test(line);
    return hasHouseNumber && (hasPostalCode || hasStreetType || hasComma);
  });
  if (addressLine >= 0) {
    const next = lines[addressLine + 1];
    const candidate = [
      lines[addressLine],
      ...(next && !ADDRESS_END_RE.test(next) && DUTCH_POSTAL_RE.test(next) ? [next] : []),
    ]
      .join(", ")
      .slice(0, 120);
    if (!isOwnField(candidate, ownProfile, "address"))
      return {
        value: candidate,
        labelled: false,
      };
  }
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(\d{4}\s?[A-Z]{2})\s+(.+)/i);
    if (!m) continue;
    const city = m[2].trim();
    if (city.length < 2 || city.length > 40) continue;
    if (ADDRESS_END_RE.test(city)) continue;
    const prev = lines[i - 1];
    if (prev && /\d/.test(prev) && prev.length >= 4 && prev.length <= 60)
      return {
        value: [prev, lines[i]].join(", ").slice(0, 120),
        labelled: false,
      };
    return {
      value: lines[i].slice(0, 120),
      labelled: false,
    };
  }
}
export function inferCurrency(text) {
  const upper = text.toUpperCase();
  if (/\bEUR\b|€/.test(upper)) return "EUR";
  if (/\bUSD\b|\$/.test(upper)) return "USD";
  if (/\bGBP\b|£/.test(upper)) return "GBP";
  if (/\bCAD\b/.test(upper)) return "CAD";
  if (/\bAUD\b/.test(upper)) return "AUD";
  if (/\bCHF\b/.test(upper)) return "CHF";
  if (/\bJPY\b|¥/.test(upper)) return "JPY";
}
export function findAmountIn(text, labels) {
  for (const label of labels) {
    const re = new RegExp(
      `${label}[^\\na-zA-Z]{0,60}?((?:[A-Z]{2,3}\\$?\\s*)?${MONEY_RE.source})`,
      "i",
    );
    const labelledMatch = text.match(re)?.[1];
    const fallbackLine = text.match(new RegExp(`${label}[^\\n]{0,60}`, "i"))?.[0];
    const fallbackAmount = fallbackLine?.match(/(?:[A-Z]{2,3}[$]?\s*)?-?\d[\d.,\s]*\d/i)?.[0];
    const n = toNumber(labelledMatch ?? fallbackAmount);
    if (n !== undefined)
      return {
        value: n,
        labelled: true,
      };
  }
}
const MONTHS_NL = {
  januari: "January",
  februari: "February",
  maart: "March",
  april: "April",
  mei: "May",
  juni: "June",
  juli: "July",
  augustus: "August",
  september: "September",
  oktober: "October",
  november: "November",
  december: "December",
  jan: "January",
  feb: "February",
  mrt: "March",
  apr: "April",
  jun: "June",
  jul: "July",
  aug: "August",
  sep: "September",
  sept: "September",
  okt: "October",
  nov: "November",
  dec: "December",
};
/**
 * Formats a Date from its local components. Dates are constructed in local
 * time, so `toISOString()` would shift them back a day for every timezone east
 * of UTC — an 04-03-2026 invoice must read 2026-03-04 everywhere.
 */
export function toIsoLocal(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
/** Parses Dutch-first dates: dd-mm-yyyy numerics are day-first, plus Dutch month names. */
export function parseDateValue(raw) {
  const s = raw.trim();
  const parsed = parseDateParts(s, detectDocumentLocale(s));
  if (parsed)
    return `${parsed.year}-${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = m[3].length === 2 ? 2e3 + Number(m[3]) : Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d)
      return toIsoLocal(dt);
    return;
  }
  m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (m) {
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!Number.isNaN(dt.getTime())) return toIsoLocal(dt);
    return;
  }
  const en = s.replace(/[A-Za-z]{3,9}/g, (w) => MONTHS_NL[w.toLowerCase()] ?? w);
  const dt = new Date(en);
  if (!Number.isNaN(dt.getTime())) {
    const dayMatch = en.match(/^(\d{1,2})\s/);
    if (dayMatch && dt.getDate() !== Number(dayMatch[1])) return undefined;
    return toIsoLocal(dt);
  }
}
export function findDateIn(text, labels, locale: DocumentLocale = "NL") {
  for (const label of labels) {
    const re = new RegExp(
      `${label}[^0-9\\p{L}]{0,18}([\\p{L}]{3,12}\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+[\\p{L}]{3,12}\\s+\\d{4}|\\d{1,4}[\\/\\-.]\\d{1,4}[\\/\\-.]\\d{1,4})`,
      "iu",
    );
    const m = text.match(re);
    const v = m?.[1] ? parseDateValue(m[1]) : undefined;
    if (v !== undefined)
      return {
        value: v,
        labelled: true,
      };
  }
}
/** Fields that, when all present, indicate the heuristic path has enough
 * evidence to skip the slow VLM call entirely. */
const CRITICAL_HEURISTIC_FIELDS = ["vendor", "invoiceNumber", "issueDate", "total"];
const NOISE_RE =
  /^(?:factuur|offerte|pakbon|kvk|btw[-\s]?(?:nr|nummer)|iban|bic|betaling|overschrijving|\bbank\b|rekening|invoice|bill\s*to|receipt|statement|tax\s*id|@|www\.|http)/i;
const BTW_ID_RE = /^btw\s+[A-Z]{2}\d/i;
/** Dutch legal entity types — matched at the end of a company name. */
const NL_LEGAL_ENTITIES =
  /(?:\bB\.?V\.?\b|\bN\.?V\.?\b|\bV\.?O\.?F\.?\b|\bEenmanszaak\b|\bStichting\b|\bVereniging\b|\bCo[öo]peratie\b|\bC\.?V\.?\b|\bU\.?A\.?\b|\bGmbH\b|\bAG\b|\bS\.?A\.?S\.?\b|\bS\.?A\.?R\.?L\.?\b|\bS\.?R\.?L\.?\b|\bS\.?L\.?\b|\bLtd\b|\bLLC\b|\bInc\.?\b|\bPty\b|\bPLC\b)/i;
/** Detects a line that is purely a label like "Factuur van:", "Van:", "From:", etc. */
const VENDOR_LABEL_RE =
  /^\s*(?:factuur\s+)?(?:van|from|leverancier|supplier|afzender|verkoper)\s*[:\-]?\s*/i;
export function guessVendorIn(text, profile, vendorEmail) {
  const norm = text
    .split("\n")
    .map((l) => l.replace(/\s{2,}/g, " "))
    .join("\n");
  const lines = norm
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2);
  // Skip page-number headers ("Pagina 1 van 1") that would otherwise become
  // the fallback vendor when nothing else matches.
  const PAGINA_RE = /^pagina\s+\d+\s+(?:van|de|du)?\s*\d*\s*$/i;
  let fallbackCandidate;
  let emailAnchored;
  for (const line of lines) {
    const cleaned = line
      .replace(/^\s*t\.n\.v\.\s*/i, "")
      .replace(
        /\b(invoice|tax invoice|statement|factuur|belastingfactuur|creditfactuur|creditnota|offerte)\b/gi,
        "",
      )
      .trim();
    if (PAGINA_RE.test(cleaned)) continue;
    const labelMatch = line.match(VENDOR_LABEL_RE);
    if (
      labelMatch &&
      !/door middel|betaald|betaling/i.test(line) &&
      !/\([^)]*\)/.test(line.slice(labelMatch[0].length))
    ) {
      const value = line.slice(labelMatch[0].length).trim();
      if (
        value.length >= 2 &&
        value.length <= 60 &&
        /[A-Za-z]{2,}/.test(value) &&
        !value.includes("@")
      )
        return {
          value,
          labelled: true,
        };
    }
    if (NL_LEGAL_ENTITIES.test(cleaned) && !NOISE_RE.test(cleaned)) {
      if (!isOwnBusiness(cleaned, profile ?? EMPTY_BUSINESS_PROFILE)) {
        if (vendorEmail) {
          const dist = anchorDistance(norm, norm.indexOf(cleaned), vendorEmail);
          if (!emailAnchored || dist < emailAnchored.dist)
            emailAnchored = {
              value: cleaned,
              labelled: false,
              dist,
            };
          continue;
        }
        return { value: cleaned };
      }
    }
    if (cleaned.length < 3 || cleaned.length > 60) continue;
    if (NOISE_RE.test(cleaned)) continue;
    if (
      /^\d|\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?)\b/i.test(cleaned) ||
      /\b\d{5}(?:-\d{4})?\b/.test(cleaned) ||
      /\b(?:datum|date|issued|uitgiftedatum|vervaldatum|pagina|currency|omschrijving|description|beschrijving|eenheidsprijs|quantity|amount|bedrag)\b/i.test(
        cleaned,
      )
    )
      continue;
    // Prefer real-name look-alikes; a bare "Pagina 1 van 1" has no
    // capitalised tokens and is therefore rejected as fallback.
    const upperTokens = cleaned.match(/[A-Z][a-z]{2,}/g);
    if (!upperTokens || upperTokens.length < 1) continue;
    if (BTW_ID_RE.test(cleaned)) continue;
    if (!/[A-Za-z]{3,}/.test(cleaned)) continue;
    if (MONEY_TEST_RE.test(cleaned) || MONEY_RE.test(cleaned)) {
      MONEY_RE.lastIndex = 0;
      continue;
    }
    if (
      /\b(btw|iban|kvk|rekening|account|siren|siret|hrb|hra|kbo|bce|y-tunnus|business.id)\b/i.test(
        cleaned,
      )
    )
      continue;
    if (/@|e-?mail\s*[:\-]/i.test(cleaned)) continue;
    if (
      /^(?:subtotaal|totaal|btw|omzetbelasting|belasting|tax|vat|bedrag|amount|saldo|gesamtbetrag)/i.test(
        cleaned,
      )
    )
      continue;
    if (isOwnBusiness(cleaned, profile ?? EMPTY_BUSINESS_PROFILE)) continue;
    fallbackCandidate ??= { value: cleaned };
  }
  return emailAnchored ?? fallbackCandidate;
}
export function findInvoiceNumberIn(text) {
  const labelled =
    text.match(
      /(?:invoice|factuur|rechnung|facture|factura)\s*(?:no\.?|nummer|nr\.?|number|num|n[°º]?|#)[^A-Za-z0-9\n]{0,6}([A-Z0-9][A-Z0-9\-/.]{2,})/i,
    ) ??
    text.match(
      /(?:rechnungsnummer|numéro de facture|número de factura)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-/.]{2,})/i,
    ) ??
    // Order confirmations ("Orderbevestiging") often label the id Ordernummer
    // instead of Factuurnummer — match only when no invoice-number label hit.
    text.match(
      /(?:web-)?(?:order\s*nummer|ordernummer|ordernr|order\s*(?:no|nr))\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-/.]{2,})/i,
    );
  if (labelled?.[1])
    return {
      value: labelled[1].replace(/[./-]+$/, ""),
      labelled: true,
    };
  const dutchF = text.match(/\bF(\d{4,8})\b/);
  if (dutchF?.[1])
    return {
      value: `F${dutchF[1]}`,
      labelled: false,
    };
  const pattern = text.match(/\b([A-Z]{2,5}[-/]\d{3,8})\b/);
  if (pattern?.[1])
    return {
      value: pattern[1],
      labelled: false,
    };
  const yearPattern = text.match(/\b((?:19|20)\d{2}[-/]\d{2,8})\b/);
  if (yearPattern?.[1])
    return {
      value: yearPattern[1],
      labelled: false,
    };
  const dateBased = text.match(
    /\b((?:20|19)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[-.]\d{2,6})\b/,
  );
  if (dateBased?.[1])
    return {
      value: dateBased[1],
      labelled: false,
    };
}
export function guessLineItemsIn(text, page) {
  const items = [];
  for (const line of text.split("\n")) {
    const amounts = line.match(MONEY_RE);
    const description = line
      .replace(MONEY_RE, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!amounts || amounts.length === 0) continue;
    if (description.length < 4) continue;
    if (
      /totaal|subtotaal|btw|omzetbelasting|total|subtotal|tax|vat|balance|saldo|bedrag|amount\s*due|te betalen|te voldoen|payment|remit|account|rekening/i.test(
        description,
      )
    )
      continue;
    if (NOISE_RE.test(description) || /\b(datum|date)\b/i.test(description)) continue;
    const amount = toNumber(amounts[amounts.length - 1]) ?? 0;
    if (amount < 1) continue;
    const qtyMatch = description.match(
      /\b(\d{1,4})\s?(x|units?|hrs?|pcs?|stuks?|st\.?|uur|uren|aantal|keer|dagdelen?|dag|dagen|maanden?|week|weken|fles|flessen|doos|dozen|pak|pakken|pallet|pallets?|set|sets?|m[²2³3]|kg|g|liter|ltr|ml)\b/i,
    );
    const quantity = qtyMatch ? Number(qtyMatch[1]) : 1;
    items.push({
      id: uid(),
      description: description.slice(0, 80),
      quantity,
      unitPrice: quantity > 0 ? Number((amount / quantity).toFixed(2)) : amount,
      amount,
      glAccount: GL_ACCOUNTS[0]!,
      department: DEPARTMENTS[0]!,
      page,
    });
    if (items.length >= 8) break;
  }
  return items;
}
/**
 * Searches pages in order and returns the first hit, preferring a labelled
 * match on a later page over an unlabelled pattern on an earlier one.
 */
export function locate(pages, find) {
  let fallback;
  for (const p of pages) {
    const hit = find(p.text, p.words);
    if (hit === undefined) continue;
    const located = {
      value: hit.value,
      page: p.pageNumber,
      labelled: hit.labelled ?? true,
    };
    if (located.labelled) return located;
    fallback ??= located;
  }
  return fallback;
}
/** Renders a PDF page to a PNG blob for the local vision model. */
async function renderPageToPngBlob(page, scale = RENDER_SCALE) {
  const viewport = page.getViewport({ scale });
  // Defensive cap: hostile PDFs can declare absurd page sizes. A 30 000 pt page
  // at 1:1 is ~900 megapixels and will OOM the tab. We scale down instead.
  const MAX_PX = 2000;
  const fscale = Math.min(
    scale,
    MAX_PX / viewport.width,
    MAX_PX / viewport.height,
  );
  const capped = page.getViewport({ scale: fscale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(capped.width);
  canvas.height = Math.ceil(capped.height);
  await page.render({
    canvas,
    viewport: capped,
  }).promise;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  canvas.width = canvas.height = 0;
  return blob;
}
async function pdfLib() {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    const WorkerWrapper = await import("./pdf-worker?worker");
    pdfjs.GlobalWorkerOptions.workerPort = new WorkerWrapper.default();
  }
  return pdfjs;
}
async function extractTextLayer(page) {
  const content = await page.getTextContent();
  let text = "";
  for (const item of content.items)
    if ("str" in item) {
      text += item.str;
      text += item.hasEOL ? "\n" : " ";
    }
  return text
    .replace(/[\t ]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function overallMethod(pages) {
  const hasTextLayer = pages.some((p) => p.method === "text-layer");
  return hasTextLayer ? "text-layer" : "none";
}
const METHOD_LABEL = {
  "text-layer": "digital text",
  none: "no readable text",
};
/**
 * Pure field extraction over per-page text. Values carry provenance instead of
 * a synthetic confidence score; missing fields remain absent.
 */
export function extractFieldsFromPages(
  pages: PageRead[],
  fileName: string,
  businessProfile: BusinessProfile = EMPTY_BUSINESS_PROFILE,
): ExtractedFields {
  const pageTexts = pages.map(toPageText);
  const locale = detectDocumentLocale(pages.map((p) => p.text).join("\n"));
  const fieldLabels = (field: ExtractedField, fallback: string[]) => [
    ...new Set([...labelsFor(field, locale), ...fallback]),
  ];
  const vendorHit = locate(pageTexts, (t) => guessVendorIn(t, businessProfile));
  const currency = pages.map((p) => inferCurrency(p.text)).find(Boolean);
  const numberHit = locate(pageTexts, findInvoiceNumberIn);
  const issueHit = locate(pageTexts, (t) =>
    findDateIn(
      t,
      fieldLabels("issueDate", [
        "factuurdatum",
        "datum factuur",
        "datum van factuur",
        "leveringsdatum",
        "afleverdatum",
        "boekdatum",
        "invoice date",
        "date of issue",
        "issued",
        "(?<!verval)datum",
        "date",
      ]),
      locale,
    ),
  );
  const dueHit = locate(pageTexts, (t) =>
    findDateIn(
      t,
      fieldLabels("dueDate", [
        "vervaldatum",
        "uiterste betaaldatum",
        "betalingsdatum",
        "betalingsvoorwaarde",
        "te betalen voor",
        "betalingsdatum",
        "due date",
        "payment due",
        "due",
      ]),
      locale,
    ),
  );
  const computedDue =
    !dueHit && issueHit?.value
      ? (() => {
          const iso = typeof issueHit.value === "string" ? issueHit.value : undefined;
          const computed = dueDateFromPaymentTerms(pages.map((p) => p.text).join("\n"), iso);
          return computed
            ? {
                value: computed,
                page: issueHit.page,
                labelled: false,
              }
            : undefined;
        })()
      : undefined;
  const dueFinal = dueHit ?? computedDue;
  const totalHit = locate(pageTexts, (t) =>
    findAmountIn(
      t,
      fieldLabels("total", [
        "te betalen",
        "te voldoen",
        "totaalbedrag",
        "eindtotaal",
        "totaal te betalen",
        "totaal incl",
        "totaal incl.? btw",
        "bedrag te voldoen",
        "saldo",
        "amount due",
        "total due",
        "grand total",
        "total incl",
        "gesamtbetrag",
        "\\btotaal\\b",
        "\\btotal\\b",
      ]),
    ),
  );
  const subtotalHit = locate(pageTexts, (t) =>
    findAmountIn(
      t,
      fieldLabels("subtotal", [
        "subtotaal",
        "subtotal",
        "sub total",
        "netto",
        "netto bedrag",
        "totaal excl",
        "totaal excl.? btw",
        "net",
      ]),
    ),
  );
  const taxHit = locate(pageTexts, (t) =>
    findAmountIn(
      t,
      fieldLabels("tax", [
        "btw-bedrag",
        "btw bedrag",
        "omzetbelasting",
        "btw 21",
        "btw 9",
        "btw 0",
        "btw 6",
        "belasting",
        "tax",
        "vat",
        "gst",
      ]),
    ),
  );
  const knownVendorName = vendorHit?.value;
  const emailHit = locate(pageTexts, (t, w) => findEmailIn(t, businessProfile, knownVendorName, w));
  const vendorEmailValue = emailHit?.value;
  const vendorHitAnchored = vendorHit
    ? locate(pageTexts, (t) => guessVendorIn(t, businessProfile, vendorEmailValue))
    : undefined;
  const vendorFinal =
    vendorHit && vendorHitAnchored && vendorHitAnchored.value !== vendorHit.value
      ? vendorHitAnchored
      : vendorHit;
  const addressHit = locate(
    pageTexts,
    (t) =>
      findAddressAnchoredIn(t, businessProfile, vendorEmailValue) ??
      findAddressIn(t, businessProfile),
  );
  const ibanHit = locate(pageTexts, (t, w) => findIbanIn(t, businessProfile, knownVendorName, w));
  const vatHit = locate(pageTexts, (t) => findVatNumberIn(t, businessProfile, vendorEmailValue));
  const businessRegHit = locate(pageTexts, (t) =>
    findBusinessRegistrationNumberIn(t, vendorEmailValue),
  );
  const multiPage = pages.length > 1;
  const lineItems = pages
    .flatMap((p) => guessLineItemsIn(p.text, p.pageNumber))
    .slice(0, multiPage ? 20 : 8);
  const fieldSources: Partial<Record<ExtractedField, number>> = {};
  if (vendorFinal) fieldSources.vendor = vendorFinal.page;
  if (numberHit) fieldSources.invoiceNumber = numberHit.page;
  if (issueHit) fieldSources.issueDate = issueHit.page;
  if (dueFinal) fieldSources.dueDate = dueFinal.page;
  if (subtotalHit) fieldSources.subtotal = subtotalHit.page;
  if (taxHit) fieldSources.tax = taxHit.page;
  if (totalHit) fieldSources.total = totalHit.page;
  if (addressHit) fieldSources.address = addressHit.page;
  if (emailHit) fieldSources.vendorEmail = emailHit.page;
  if (ibanHit) fieldSources.iban = ibanHit.page;
  if (vatHit) fieldSources.vatNumber = vatHit.page;
  if (businessRegHit) fieldSources.businessRegistrationNumber = businessRegHit.page;

  // Provenance for regex/heuristic reads: "read" (seen by a reader, not exact text layer).
  const provenance: Record<string, Provenance> = {};
  for (const f of Object.keys(fieldSources)) {
    provenance[f] = PROV_OCR;
  }
  // Derived due date from payment terms → "derived".
  if (dueFinal && dueFinal.labelled === false && !dueHit) {
    provenance.dueDate = PROV_DERIVED;
  }

  return {
    vendor: vendorFinal?.value ?? vendorNameFromFile(fileName),
    currency,
    invoiceNumber: numberHit?.value,
    issueDate: issueHit?.value,
    dueDate: dueFinal?.value,
    subtotal: subtotalHit?.value,
    tax: taxHit?.value,
    total: totalHit?.value,
    address: addressHit?.value,
    vendorEmail: emailHit?.value,
    iban: ibanHit?.value,
    vatNumber: vatHit?.value,
    businessRegistrationNumber: businessRegHit?.value,
    lineItems,
    provenance,
    fieldSources,
    ...(() => {
      const prepaid = detectPrepaid(pages.map((p) => p.text).join("\n"));
      return { prepaid: prepaid.prepaid, prepaidPhrase: prepaid.phrase };
    })(),
  };
}
/**
 * The fields the regex reader genuinely found. `extractFieldsFromPages` falls
 * back to the file name for `vendor`, so its output alone can't tell a real
 * read from a placeholder — `fieldSources` can.
 */
export function confirmedReads(fields: ExtractedFields) {
  const out: Partial<Record<ExtractedField, string | number>> = {};
  for (const field of [
    ...ZONE_FIELDS,
    "address",
    "vendorEmail",
    "iban",
    "vatNumber",
    "businessRegistrationNumber",
  ]) {
    if (fields.fieldSources[field] === undefined) continue;
    const value = fields[field];
    if (value === undefined || value === "") continue;
    out[field] = value;
  }
  return out;
}
export function toPageText(page) {
  return {
    pageNumber: page.pageNumber,
    text: page.text,
    ...(page.words ? { words: page.words } : {}),
  };
}
/**
 * Derives a vendor name from the filename when no vendor was extracted.
 * Strips the extension and replaces underscores/hyphens with spaces.
 * "acme_invoice_2026.pdf" → "acme invoice 2026".
 */
export function vendorNameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

/** Loads the file into per-page payloads. Each payload carries
  * the extracted text, word boxes (from the text layer where available),
  * and a rendered page image for the VLM path.
  *
 * Scanned images (photo/PDF-that-is-actually-an-image) are rendered to PNG
 * and fed straight to the vision model. The model handles mild skew and noise
 * natively, so no image preprocessing is needed before the read.
  */
 async function loadPages(file, onProgress) {
   const isImage = file.type.startsWith("image/");
   const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
   if (isImage) {
     onProgress?.({
       stage: "rendering page",
       progress: 0.08,
     });
     // Images can't use pdfjs — render directly from the blob.
     const bitmap = await createImageBitmap(file).catch(() => null);
     if (!bitmap) {
       return {
         pages: [],
         totalPages: 0,
         truncated: false,
       };
     }
     const canvas = document.createElement("canvas");
     canvas.width = Math.ceil(bitmap.width * RENDER_SCALE);
     canvas.height = Math.ceil(bitmap.height * RENDER_SCALE);
     const ctx = canvas.getContext("2d");
     if (ctx) {
       ctx.imageSmoothingEnabled = true;
       ctx.imageSmoothingQuality = "high";
       ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
     }
     bitmap.close();
     const pngBlob = await new Promise<Blob | null>((resolve) =>
       canvas.toBlob(resolve, "image/png"),
     );
     canvas.width = canvas.height = 0;
     return {
       pages: [
         {
           pageNumber: 1,
           text: "",
           method: "none",
           image: pngBlob ?? file,
           words: [],
           sourceFile: file,
         },
       ],
       totalPages: 1,
       truncated: false,
     };
   }
   if (!isPdf)
     return {
       pages: [],
       totalPages: 0,
       truncated: false,
     };
   const pdfjs = await pdfLib();
   const data = await file.arrayBuffer();
   const loadingTask = pdfjs.getDocument({ data, disableXfa: true });
   const pdf = await loadingTask.promise;
   const totalPages = pdf.numPages;
   const count = Math.min(totalPages, MAX_PDF_PAGES);
   const pages = [];
   const processPage = async (n) => {
     const base = 0.05 + (0.7 * (n - 1)) / count;
     onProgress?.({
       stage: `reading page ${n}`,
       progress: base,
       page: n,
       totalPages,
     });
     const page = await pdf.getPage(n);
     try {
       const layered = await extractTextLayer(page);
       let image;
       let words = [];
       let text = layered;
       let method = layered.trim().length >= TEXT_LAYER_MIN_CHARS ? "text-layer" : "none";
       if (method === "text-layer") {
         words = await textLayerWordsFromPage(page);
       } else {
         // No embedded text or too little — render for the VLM.
         onProgress?.({
           stage: `rendering page ${n}`,
           progress: base + 0.5 / count,
           page: n,
           totalPages,
         });
         image = await renderPageToPngBlob(page, RENDER_SCALE);
       }
       return {
         pageNumber: n,
         text,
         method,
         image: image ?? undefined,
         words,
         sourceFile: file,
       };
     } finally {
       page.cleanup();
     }
   };
   try {
     // Sequential page processing — the VLM path is the bottleneck, not page I/O.
     for (let n = 1; n <= count; n++) {
       pages.push(await processPage(n));
     }
     pages.sort((a, b) => a.pageNumber - b.pageNumber);
   } finally {
     await loadingTask.destroy();
   }
   return {
     pages,
     totalPages,
     truncated: totalPages > count,
   };
 }
/** Projects the PDF text layer's real transforms into normalized word boxes. */
async function textLayerWordsFromPage(page) {
  const content = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  const vx = viewport.transform[4] ?? 0;
  const vy = viewport.transform[5] ?? 0;
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;
  const words = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim() || !Array.isArray(item.transform)) continue;
    const [, , , , tx, ty] = item.transform;
    const x = (viewport.transform[0] * tx + viewport.transform[2] * ty + vx) / pageWidth;
    const baselineY = viewport.transform[1] * tx + viewport.transform[3] * ty + vy;
    const height = Math.abs(item.transform[3] ?? 0) || 10;
    const y = Math.max(0, Math.min(1, (baselineY - height) / pageHeight));
    const width = Math.max(1, item.width ?? item.str.length * height * 0.5);
    const safeX = Math.max(0, Math.min(1, x));
    words.push({
      text: item.str.trim(),
      x: safeX,
      y,
      w: Math.min(1 - safeX, width / pageWidth),
      h: Math.min(1 - y, height / pageHeight),
      confidence: 0.98,
    });
  }
  return words;
}
/**
 * Tries the cached template path. Returns undefined when no template matched
 * or nothing read — caller falls through to VLM. Every field the template
 * produces gets provenance "read" (template zone match).
 */
export async function tryTemplatePath(
  pages: { pageNumber: number; text: string; words: OcrWord[] }[],
  templates?: Record<string, VendorTemplate>,
  lookup?: (input: { vendorBlock: string; embedding: number[] }) => VendorTemplate | undefined,
) {
  if (!templates || Object.keys(templates).length === 0) return undefined;
  if (pages.length === 0) return undefined;
  const firstPage = pages[0] as { words: OcrWord[] };
  if (firstPage.words.length === 0) return undefined;
  const vendorBlock = extractVendorBlock(firstPage.words);
  if (!vendorBlock) return undefined;
  if (lookup) {
    const embedding = embedVendorText(vendorBlock);
    const tpl = lookup({ vendorBlock, embedding });
    if (!tpl) return undefined;
    const fields: Partial<Record<ExtractedField, string | number>> = {};
    const provenance: Partial<Record<ExtractedField, Provenance>> = {};
    const fieldSources: Partial<Record<ExtractedField, number>> = {};
    for (const page of pages)
      for (const rawField of Object.keys(tpl.fields)) {
        const field = rawField as ExtractedField;
        if (fields[field] !== undefined) continue;
        const spec = tpl.fields[field];
        const hit = applyTemplateField((page as { words: OcrWord[] }).words, spec, field);
        if (hit === undefined) continue;
        fields[field] = hit.value;
        provenance[field] = PROV_VLM;
        fieldSources[field] = (page as { pageNumber: number }).pageNumber;
      }
    if (Object.keys(fields).length === 0) return undefined;
    return { fields, provenance, fieldSources, fingerprint: tpl.vendor_fingerprint, templateKey: tpl.vendor_key };
  }
  const fingerprint = fingerprintOf(vendorBlock);
  const embedding = embedVendorText(vendorBlock);
  const candidates = Object.values(templates);
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: cosine(embedding, candidate.embedding),
    }))
    .sort((a, b) => b.score - a.score);
  const exact = candidates.find((candidate) => candidate.vendor_fingerprint === fingerprint);
  const best = ranked[0];
  const runnerUp = ranked[1];
  const tpl =
    exact ??
    (best && best.score >= 0.82 && (!runnerUp || best.score - runnerUp.score >= 0.06)
      ? best.candidate
      : undefined);
  if (!tpl) return undefined;
  const fields: Partial<Record<ExtractedField, string | number>> = {};
  const provenance: Partial<Record<ExtractedField, Provenance>> = {};
  const fieldSources: Partial<Record<ExtractedField, number>> = {};
  for (const page of pages)
    for (const rawField of Object.keys(tpl.fields)) {
      const field = rawField as ExtractedField;
      if (fields[field] !== undefined) continue;
      const spec = tpl.fields[field];
      const hit = applyTemplateField(page.words, spec, field);
      if (hit === undefined) continue;
      fields[field] = hit.value;
      provenance[field] = PROV_VLM;
      fieldSources[field] = page.pageNumber;
    }
  if (Object.keys(fields).length === 0) return undefined;
  return {
    fields,
    provenance,
    fieldSources,
    fingerprint: tpl.vendor_fingerprint,
    templateKey: tpl.vendor_key,
  };
}
/**
 * Phase 4 drift handling: template matched, but some template fields produced
 * no value on this invoice (layout changed). The missing fields are recovered
 * by the fallback path and the invoice is flagged so the draft screen offers
 * the template update flow.
 */
export function detectDrift(tpl, fields) {
  return Object.keys(tpl.fields).filter((f) => fields[f] === undefined);
}
/**
 * Folds recovered drift reads back into the template extraction. Only fields
 * present in `reads` are written; a field with no read stays missing, so the
 * caller can hand it to another reader.
 */
export function applyDriftReads(args) {
  const fields = { ...args.fields };
  const provenance = { ...args.provenance };
  const fieldSources = { ...args.fieldSources };
  const recoveredBy = {};
  for (const field of args.missing) {
    const read = args.reads[field];
    if (!read) continue;
    fields[field] = read.value;
    provenance[field] = PROV_VLM;
    fieldSources[field] = read.page;
    recoveredBy[field] = args.source;
  }
  return {
    fields,
    provenance,
    fieldSources,
    recoveredBy,
    stillMissing: args.missing.filter((field) => recoveredBy[field] === undefined),
  };
}
/**
 * Cheap drift recovery from the text scan already cached on the page payloads.
 * Only fields the regex reader genuinely found are returned, so a file-name
 * vendor fallback never masquerades as a recovered value.
 */
/** What the drift-recovery scan got back for one field. */
export type RecoveredRead = { value: string | number; provenance: Provenance; page: number };
export type RecoveredReads = Partial<Record<ExtractedField, RecoveredRead>>;
export function recoverFieldsFromText(
  pages,
  fileName,
  missing: ExtractedField[],
  businessProfile?,
): RecoveredReads {
  const out: RecoveredReads = {};
  if (missing.length === 0) return out;
  const reads = extractFieldsFromPages(pages, fileName, businessProfile);
  for (const field of missing) {
    const page = reads.fieldSources[field];
    if (page === undefined) continue;
    const value = reads[field];
    if (value === undefined || value === "") continue;
    out[field] = {
      value,
      provenance: reads.provenance[field] ?? PROV_OCR,
      page,
    };
  }
  return out;
}
/** Parses line-item rows using the template's learned line_items block. */
export function applyLineItemsSpec(pages, spec) {
  const words = pages[0]?.words ?? [];
  if (words.length === 0) return [];
  return parseLineItemRows(words, spec).map((li) => ({
    ...li,
    id: uid(),
    glAccount: GL_ACCOUNTS[0]!,
    department: DEPARTMENTS[0]!,
  }));
}
/** Runs the VLM fallback and parses the constrained JSON. */
export function selectVisionPageNumbers(pages) {
  if (pages.length <= 2) return pages.map((page) => page.pageNumber);
  const selected = new Set();
  if (pages[0]) selected.add(pages[0].pageNumber);
  if (pages[pages.length - 1]) selected.add(pages[pages.length - 1].pageNumber);
  const signal =
    /leverancier|supplier|vendor|adres|address|email|e-mail|contact|iban|bankrekening|rekening|account\s*(?:number|details)?|btw|vat|tax\s*id|totaal|total|te betalen|payment|remittance|beneficiary/i;
  for (const page of pages) if (signal.test(page.text)) selected.add(page.pageNumber);
  return pages.filter((page) => selected.has(page.pageNumber)).map((page) => page.pageNumber);
}
function relevantVisionPages(pages) {
  const selected = new Set(selectVisionPageNumbers(pages));
  return pages.filter((page) => selected.has(page.pageNumber));
}
/** Render all deferred text-layer pages in one PDF session. */
async function ensureVisionImages(pages) {
  const missing = pages.filter((page) => !page.image && page.sourceFile);
  if (missing.length === 0) return;
  const source = missing[0].sourceFile;
  if (!/\.pdf$/i.test(source.name) && source.type !== "application/pdf") return;
  const loadingTask = (await pdfLib()).getDocument({ data: await source.arrayBuffer(), disableXfa: true });
  const pdf = await loadingTask.promise;
  try {
    await Promise.all(
      missing.map(async (page) => {
        const pdfPage = await pdf.getPage(page.pageNumber);
        try {
          page.image = (await renderPageToPngBlob(pdfPage)) ?? undefined;
        } finally {
          pdfPage.cleanup();
        }
      }),
    );
  } finally {
    await loadingTask.destroy();
  }
}
/** Check whether all critical fields have been filled by the VLM so far. */
function allCriticalFieldsFound(results) {
  const merged = mergeVisionPages(results);
  return CRITICAL_HEURISTIC_FIELDS.every((f) => {
    const v = merged[f];
    return typeof v === "object" && v !== null && "value" in v ? !!v.value : false;
  });
}
/**
 * The VLM read, reached only through the registered `VisionEngine`. Exported
 * so the port can be exercised with a fake engine and no model server — if
 * this ever stops consulting `visionEngine()`, vision quietly dies app-wide
 * and only a test like that will say so.
 */
export async function tryVlmPath(pages, onProgress, onToken) {
  const engine = visionEngine();
  if (!engine || !(await engine.healthy()) || pages.length === 0) return undefined;
  onProgress?.({
    stage: "AI reading document",
    progress: 0.85,
  });
  const visionPages = relevantVisionPages(pages);
  await ensureVisionImages(visionPages);
  const results = [];
  let winningModel;
  for (const page of visionPages) {
    if (allCriticalFieldsFound(results)) break;
    const image = page.image;
    if (!image) {
      results.push(null);
      continue;
    }
    const b64 = page.visionB64 ?? (await engine.encodePageImage(image));
    page.visionB64 ??= b64;
    try {
      const { page: parsed, model } = await engine.extractPage({
        imageB64: b64,
        page: page.pageNumber,
        totalPages: pages.length,
        onProgress,
        onToken,
      });
      results.push(parsed);
      winningModel ??= model;
    } catch {
      results.push(null);
    }
  }
  const merged = mergeVisionPages(results, pages.map((p) => p.text).join("\n"));
  const fields = visionPageToFields(merged);
  const prepaid = detectPrepaid(merged.pagesText);
  // Drop the VLM result when the model found nothing beyond empty strings
  // and the heuristic path already has data — don't let a silent VLM
  // override real text-layer reads.
  if (
    fields.vendor === undefined &&
    fields.address === undefined &&
    fields.vendorEmail === undefined &&
    fields.iban === undefined &&
    fields.vatNumber === undefined &&
    fields.businessRegistrationNumber === undefined &&
    fields.invoiceNumber === undefined &&
    fields.issueDate === undefined &&
    fields.dueDate === undefined &&
    fields.subtotal === undefined &&
    fields.tax === undefined &&
    fields.total === undefined
  )
    return undefined;
  const picked: Partial<Record<ExtractedField, string | number>> = {};
  for (const f of [
    "vendor",
    "address",
    "vendorEmail",
    "iban",
    "vatNumber",
    "businessRegistrationNumber",
    "invoiceNumber",
    "issueDate",
    "dueDate",
    "subtotal",
    "tax",
    "total",
  ]) {
    const v = fields[f];
    if (v !== undefined && v !== "") picked[f] = v;
  }
  return {
    fields: picked,
    provenance: fields.provenance,
    fieldSources: fields.fieldSources,
    currency: fields.currency,
    lineItems: fields.lineItems,
    model: winningModel,
    prepaid: prepaid.prepaid,
    prepaidPhrase: prepaid.phrase,
  };
}
/** Last-resort path: pure regex/heuristic over text. Used when both the
 * template store is empty AND no VLM is available. Every field gets
 * provenance "read" — seen by a reader, not exact text layer. */
async function tryHeuristicPath(pages, fileName, businessProfile) {
  const fields = extractFieldsFromPages(
    pages.map((p) => ({
      pageNumber: p.pageNumber,
      text: p.text,
      words: p.words,
    })),
    fileName,
    businessProfile,
  );
  const out: Partial<Record<ExtractedField, string | number>> = {};
  if (fields.vendor !== undefined) out.vendor = fields.vendor;
  if (fields.invoiceNumber !== undefined) out.invoiceNumber = fields.invoiceNumber;
  if (fields.issueDate !== undefined) out.issueDate = fields.issueDate;
  if (fields.dueDate !== undefined) out.dueDate = fields.dueDate;
  if (fields.subtotal !== undefined) out.subtotal = fields.subtotal;
  if (fields.tax !== undefined) out.tax = fields.tax;
  if (fields.total !== undefined) out.total = fields.total;
  if (fields.address !== undefined) out.address = fields.address;
  if (fields.vendorEmail !== undefined) out.vendorEmail = fields.vendorEmail;
  if (fields.iban !== undefined) out.iban = fields.iban;
  if (fields.vatNumber !== undefined) out.vatNumber = fields.vatNumber;
  if (fields.businessRegistrationNumber !== undefined) {
    out.businessRegistrationNumber = fields.businessRegistrationNumber;
  }
  const prepaid = detectPrepaid(pages.map((p) => p.text).join("\n"));
  return {
    fields: out,
    provenance: fields.provenance,
    fieldSources: fields.fieldSources,
    lineItems: fields.lineItems,
    currency: fields.currency,
    prepaid: prepaid.prepaid,
    prepaidPhrase: prepaid.phrase,
  };
}
/** Fast phase: read document text → fingerprint → template match.
 *  Returns either a finished Invoice (template hit) or a ProcessingSkeleton
 *  (novel vendor). The caller decides whether to await the VLM/heuristic
 *  fallback here or hand off to a background job. */
export async function extractQuickPhase(file, onProgress, templates) {
  // Hash the original bytes uniformly at the top, before any type branching.
  const fileHash = await computeFileHash(file);
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isImage && !isPdf) {
    onProgress?.({
      stage: "reading document",
      progress: 0.6,
    });
    const now = new Date().toISOString();
    return {
      kind: "invoice",
      invoice: {
        id: uid(),
        vendor: file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " "),
        invoiceNumber: "",
        issueDate: now.slice(0, 10),
        dueDate: "",
        currency: "",
        subtotal: 0,
        tax: 0,
        total: 0,
        status: "draft",
        lineItems: [],
        glAccount: GL_ACCOUNTS[0]!,
        department: DEPARTMENTS[0]!,
        memo: "",
        tags: [],
        confidence: {},
        audit: [
          {
            id: uid(),
            at: now,
            actor: "text layer",
            action: "Document uploaded (preview only)",
            note: file.name,
          },
        ],
        source: "upload",
        engine: undefined,
        fileName: file.name,
        fileType: file.type,
        fileUrl: URL.createObjectURL(file),
        fileHash,
        createdAt: now,
      },
    };
  }
  onProgress?.({
    stage: "reading document",
    progress: 0.05,
  });
  const loaded = await loadPages(file, onProgress);
  onProgress?.({
    stage: "matching vendor",
    progress: 0.8,
  });
  const templateHit = await tryTemplatePath(loaded.pages, templates);
  if (templateHit) {
    onProgress?.({
      stage: "template hit",
      progress: 0.9,
    });
    const tpl = templates?.[templateHit.templateKey];
    const driftFields = tpl ? detectDrift(tpl, templateHit.fields) : [];
    const hold = (tpl?.confirmNextCount ?? 0) > 0;
    const lineItems = tpl?.line_items ? applyLineItemsSpec(loaded.pages, tpl.line_items) : [];
    const currency = inferCurrency(loaded.pages.map((p) => p.text).join("\n"));
    if (driftFields.length > 0) {
      const merged = applyDriftReads({
        fields: templateHit.fields,
        provenance: templateHit.provenance,
        fieldSources: templateHit.fieldSources,
        missing: driftFields,
        reads: recoverFieldsFromText(loaded.pages, file.name, driftFields),
        source: "text",
      });
      if (merged.stillMissing.length > 0)
        return {
          kind: "processing",
          invoice: await buildProcessingSkeleton(file, loaded, {
            fields: merged.fields,
            provenance: merged.provenance,
            fieldSources: merged.fieldSources,
            currency,
            action: "Template matched — recovering missing fields",
            fileHash,
          }),
          loadedPages: loaded.pages,
          firstSlow: false,
          drift: {
            templateKey: templateHit.templateKey,
            templateFingerprint: templateHit.fingerprint,
            templateVersion: tpl?.version,
            templateHold: hold,
            fields: merged.fields,
            provenance: merged.provenance,
            fieldSources: merged.fieldSources,
            lineItems,
            currency,
            missing: driftFields,
            recoveredBy: merged.recoveredBy,
          },
        };
      return {
        kind: "invoice",
        invoice: {
          ...(await finalizeInvoice({
            file,
            loaded,
            chosen: {
              path: "template",
              fields: merged.fields,
              provenance: merged.provenance,
              fieldSources: merged.fieldSources,
              lineItems,
              currency,
              templateFingerprint: templateHit.fingerprint,
              model: undefined,
              ...(hold ? { templateHold: true } : {}),
            },
            templates,
          })),
          templateDrift: {
            missing: driftFields,
            recoveredBy: merged.recoveredBy,
            templateVersion: tpl?.version,
            detectedAt: new Date().toISOString(),
          },
          fileHash,
        },
      };
    }
    return {
      kind: "invoice",
      invoice: {
        ...(await finalizeInvoice({
          file,
          loaded,
          chosen: {
            path: "template",
            fields: templateHit.fields,
            provenance: templateHit.provenance,
            fieldSources: templateHit.fieldSources,
            lineItems,
            currency,
            templateFingerprint: templateHit.fingerprint,
            model: undefined,
            ...(hold ? { templateHold: true } : {}),
          },
          templates,
        })),
        fileHash,
      },
    };
  }
  const firstSlow = !templates || Object.keys(templates).length === 0;
  return {
    kind: "processing",
    invoice: await buildProcessingSkeleton(file, loaded, {
      action: "Queued for AI extraction",
      fileHash,
    }),
    loadedPages: loaded.pages,
    firstSlow,
  };
}
/**
 * Builds the "processing" placeholder invoice. Optional `partial` values let a
 * drift recovery job surface the fields a template already read while it waits
 * on the model.
 */
export async function buildProcessingSkeleton(file, loaded, partial) {
  const now = new Date().toISOString();
  const method = overallMethod(loaded.pages);
  const pageCount = loaded.totalPages;
  const ocrText =
    (pageCount ?? 1) > 1
      ? loaded.pages
          .map((p) => `--- page ${p.pageNumber} of ${pageCount} ---\n${p.text.trim()}`)
          .join("\n\n")
      : (loaded.pages[0]?.text ?? "");
  const fields = partial?.fields ?? {};
  return {
    id: uid(),
    vendor: String(fields.vendor ?? file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ")),
    invoiceNumber: String(fields.invoiceNumber ?? ""),
    issueDate: String(fields.issueDate ?? now.slice(0, 10)),
    dueDate: String(fields.dueDate ?? ""),
    currency: partial?.currency ?? inferCurrency(ocrText) ?? "",
    subtotal: Number(fields.subtotal ?? 0),
    tax: Number(fields.tax ?? 0),
    total: Number(fields.total ?? 0),
    address: fields.address ? String(fields.address) : undefined,
    vendorEmail: fields.vendorEmail ? String(fields.vendorEmail) : undefined,
    iban: fields.iban ? String(fields.iban) : undefined,
    vatNumber: fields.vatNumber ? String(fields.vatNumber) : undefined,
    businessRegistrationNumber: fields.businessRegistrationNumber
      ? String(fields.businessRegistrationNumber)
      : undefined,
    status: "processing",
    lineItems: [],
    glAccount: GL_ACCOUNTS[0]!,
    department: DEPARTMENTS[0]!,
    memo: "",
    tags: [],
    confidence: partial?.confidence ?? {},
    audit: [
      {
        id: uid(),
        at: now,
        actor: "text layer",
        action: partial?.action ?? "Queued for extraction",
        note: file.name,
      },
    ],
    source: "upload",
    engine: undefined,
    processing: {
      stage: "queued",
      progress: 0.05,
      background: false,
      startedAt: now,
    },
    fileName: file.name,
    fileType:
      file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "application/octet-stream"),
    fileUrl: URL.createObjectURL(file),
    ocrText,
    pageCount,
    ocrMethod: method,
    ocrPages: loaded.pages.map((p) => ({
      pageNumber: p.pageNumber,
      charCount: p.text.trim().length,
      confidence: p.image ? 0.9 : 0.98,
      method: p.method,
    })),
    fieldSources: partial?.fieldSources ?? {},
    fileHash: partial?.fileHash ?? "",
    createdAt: now,
  };
}
/** Background phase: runs VLM/heuristic on the cached pages. Returns the
 *  finalised Invoice, suitable to swap in for the skeleton. */
export async function runBackgroundJob(skeleton, onProgress, onToken, templates, businessProfile) {
  const { invoice, loadedPages } = skeleton;
  const pages = loadedPages;
  if (skeleton.drift) return runDriftRecovery(skeleton, pages, onProgress, onToken, templates);
  let chosen;
  const t0 = typeof performance_default !== "undefined" ? performance_default.now() : Date.now();
  onProgress?.({
    stage: "text extraction",
    progress: 0.5,
  });
  const heur = await tryHeuristicPath(pages, invoice.fileName ?? "invoice", businessProfile);
  Math.round(
    (typeof performance_default !== "undefined" ? performance_default.now() : Date.now()) - t0,
  );
  if (
    CRITICAL_HEURISTIC_FIELDS.every(
      (f) => heur.fields[f] !== undefined && heur.fields[f] !== "" && heur.fields[f] !== 0,
    )
  )
    chosen = {
      path: "text",
      fields: heur.fields,
      provenance: heur.provenance,
      fieldSources: heur.fieldSources,
      lineItems: heur.lineItems,
      currency: heur.currency,
      templateFingerprint: undefined,
      model: undefined,
    };
  else chosen = mergeVlmResult(heur, await tryVlmPath(pages, onProgress, onToken));
  return await finalizeInvoice({
    file: await urlToFile(invoice.fileUrl, invoice.fileName ?? "invoice", invoice.fileType ?? ""),
    loaded: {
      pages,
      totalPages: pages.length,
      truncated: false,
    },
    chosen,
    templates,
  });
}
/** Text-layer values win; the VLM only fills fields the text reader missed. */
export function mergeVlmResult(heur, vlmHit) {
  const fields = { ...heur.fields };
  const provenance = { ...heur.provenance };
  const fieldSources = { ...heur.fieldSources };

  // The text-layer reader is authoritative; the model only fills gaps.
  if (vlmHit) {
    for (const [field, value] of Object.entries(vlmHit.fields)) {
      if (fields[field] === undefined || fields[field] === "" || fields[field] === 0) {
        fields[field] = value;
        provenance[field] = PROV_VLM;
        const source = vlmHit.fieldSources[field];
        if (source !== undefined) fieldSources[field] = source;
      }
    }
  }

  return {
    path: vlmHit ? "vlm" : "ocr-fallback",
    fields,
    provenance,
    fieldSources,
    lineItems: vlmHit?.lineItems.length ? vlmHit.lineItems : heur.lineItems,
    currency: vlmHit?.currency ?? heur.currency,
    templateFingerprint: undefined,
    model: vlmHit?.model,
    prepaid: vlmHit?.prepaid ?? heur.prepaid,
    prepaidPhrase: vlmHit?.prepaidPhrase ?? heur.prepaidPhrase,
  };
}
/**
 * Background recovery for a drifting template. Asks the VLM only for the fields
 * the template (and the text scan) could not read, then finalises on the
 * template path so the values that did read are preserved and `recoveredBy`
 * records which reader supplied each field.
 */
export async function runDriftRecovery(skeleton, pages, onProgress, onToken, templates) {
  const drift = skeleton.drift;
  const unresolved = drift.missing.filter((field) => drift.recoveredBy[field] === undefined);
  onProgress?.({
    stage: "recovering missing fields",
    progress: 0.5,
  });
  const reads = {};
  if (unresolved.length > 0) {
    const vlm = await tryVlmPath(pages, onProgress, onToken);
    if (vlm)
      for (const field of unresolved) {
        const value = vlm.fields[field];
        if (value === undefined || value === "") continue;
        reads[field] = {
          value,
          provenance: PROV_VLM,
          page: vlm.fieldSources[field] ?? 1,
        };
      }
  }
  const merged = applyDriftReads({
    fields: drift.fields,
    provenance: drift.provenance,
    fieldSources: drift.fieldSources,
    missing: unresolved,
    reads,
    source: "vlm",
  });
  return {
    ...(await finalizeInvoice({
      file: await urlToFile(
        skeleton.invoice.fileUrl,
        skeleton.invoice.fileName ?? "invoice",
        skeleton.invoice.fileType ?? "",
      ),
      loaded: {
        pages,
        totalPages: pages.length,
        truncated: false,
      },
      chosen: {
        path: "template",
        fields: merged.fields,
        provenance: merged.provenance,
        fieldSources: merged.fieldSources,
        lineItems: drift.lineItems,
        currency: drift.currency,
        templateFingerprint: drift.templateFingerprint,
        model: undefined,
        ...(drift.templateHold ? { templateHold: true } : {}),
      },
      templates,
    })),
    templateDrift: {
      missing: drift.missing,
      recoveredBy: {
        ...drift.recoveredBy,
        ...merged.recoveredBy,
      },
      templateVersion: drift.templateVersion,
      detectedAt: new Date().toISOString(),
    },
  };
}
/** Loads the original file from the persisted Blob URL so finalizeInvoice
 *  can rebuild the invoice with the cached page data. */
async function urlToFile(url, name, type) {
  if (!url) return new File([new Blob()], name, { type });
  const blob = await (await fetch(url)).blob();
  return new File([blob], name, { type });
}
export function reconcileExtraction({ subtotal, tax, total, lineItems }) {
  const expected = subtotal > 0 || tax > 0 ? subtotal + tax : undefined;
  if (expected !== undefined && total > 0 && Math.abs(expected - total) > 0.02)
    return {
      mismatch: true,
      reason: `Subtotal plus tax (${expected.toFixed(2)}) does not match total (${total.toFixed(2)}).`,
    };
  if (lineItems.length > 0 && total > 0) {
    const sum = lineItems.reduce((value, item) => value + item.amount, 0);
    if (Math.abs(sum - total) > 0.02 && Math.abs(sum - subtotal) > 0.02)
      return {
        mismatch: true,
        reason: `Line items (${sum.toFixed(2)}) do not reconcile with subtotal or total.`,
      };
  }
  return { mismatch: false };
}
/** Builds the final Invoice payload from the chosen path + cached pages. */
export async function finalizeInvoice(args): Promise<Invoice> {
  const { file, loaded, chosen, templates } = args;
  const isImage = file.type.startsWith("image/");
  const now = new Date().toISOString();
  const method = overallMethod(loaded.pages);
  const pageCount = loaded.totalPages;
  const ocrText =
    (pageCount ?? 1) > 1
      ? loaded.pages
          .map((p) => `--- page ${p.pageNumber} of ${pageCount} ---\n${p.text.trim()}`)
          .join("\n\n")
      : (loaded.pages[0]?.text ?? "");
  const vendor = String(
    chosen.fields.vendor ?? file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " "),
  );
  const invoiceNumber = String(chosen.fields.invoiceNumber ?? "");
  const issueDate = String(chosen.fields.issueDate ?? "");
  const dueDate = String(chosen.fields.dueDate ?? "");
  const subtotal = Number(chosen.fields.subtotal ?? 0);
  const tax = Number(chosen.fields.tax ?? 0);
  const total = Number(
    chosen.fields.total ?? (subtotal + tax || chosen.lineItems.reduce((s, li) => s + li.amount, 0)),
  );
  const address = chosen.fields.address ? String(chosen.fields.address) : undefined;
  const vendorEmail = chosen.fields.vendorEmail ? String(chosen.fields.vendorEmail) : undefined;
  const iban = chosen.fields.iban ? String(chosen.fields.iban) : undefined;
  const documentText = loaded.pages.map((page) => page.text).join("\n");
  const finalDueDate =
    dueDate || dueDateFromPaymentTerms(documentText, issueDate || undefined) || "";
  const chosenVat = chosen.fields.vatNumber ? String(chosen.fields.vatNumber) : undefined;
  const textVat = findVatNumberIn(documentText, undefined, vendorEmail)?.value;
  const anchoredVat = preferAnchoredProfileValue(chosenVat, textVat, vendorEmail);
  const vatNumber = anchoredVat ?? chosenVat ?? textVat;
  const businessRegistrationNumber = preferAnchoredProfileValue(
    chosen.fields.businessRegistrationNumber
      ? String(chosen.fields.businessRegistrationNumber)
      : undefined,
    findBusinessRegistrationNumberIn(documentText, vendorEmail)?.value,
    vendorEmail,
  );
  const detectedCurrency = chosen.currency ?? inferCurrency(documentText);
  const invoicePrepaid = detectPrepaid(documentText);
  const reconciliation = reconcileExtraction({
    subtotal,
    tax,
    total,
    lineItems: chosen.lineItems,
  });

  // Build final provenance per field. Reconciliation mismatches downgrade
  // subtotal/tax/total to "derived" (computed) so the UI shows amber.
  const finalProvenance = { ...(chosen.provenance ?? {}) };
  if (reconciliation.mismatch) {
    for (const field of ["subtotal", "tax", "total"]) {
      if (finalProvenance[field] !== undefined) {
        finalProvenance[field] = PROV_DERIVED;
      }
    }
  }

  // Cross-check: text-layer regex vs primary reader. Still useful as a
  // verification signal — disagreements surface in the audit trail.
  let crossCheck;
  if (chosen.path !== "text") {
    const secondary = confirmedReads(
      extractFieldsFromPages(
        loaded.pages.map((p) => ({
          pageNumber: p.pageNumber,
          text: p.text,
        })),
        file.name,
      ),
    );
    if (Object.keys(secondary).length > 0)
      crossCheck = compareExtractions(chosen.fields, secondary);
  }
  const crossCheckDisagreements = disagreements(crossCheck);

  const visionLabel = chosen.model ?? visionEngine()?.modelName() ?? "vision model";
  const auditAction =
    chosen.path === "template"
      ? `Template extraction (${chosen.templateFingerprint})`
      : chosen.path === "vlm"
        ? `AI vision extraction (${visionLabel}) — new vendor`
        : `Document text read — ${pageCount} page${pageCount === 1 ? "" : "s"} (${METHOD_LABEL[method]})${loaded.truncated ? `, first 20 processed` : ""}`;
  const auditNote =
    file.name +
    (chosen.path === "template"
      ? " · template match"
      : chosen.path === "vlm"
        ? " · VLM read"
        : " · read from document text");

  // Auto-approve check: every field is exact or read, nothing derived/manual,
  // and reconciliation passes.
  const autoApprove =
    Object.values(finalProvenance).every((p) => AUTO_APPROVE_PROVENANCE.has(p)) &&
    !reconciliation.mismatch;

  const fieldPath: Partial<Record<ExtractedField, "template" | "vlm" | "text">> = {};
  for (const f of Object.keys(chosen.fields))
    fieldPath[f as ExtractedField] = chosen.path as "template" | "vlm" | "text";

  return {
    id: uid(),
    vendor,
    invoiceNumber,
    issueDate: issueDate || now.slice(0, 10),
    dueDate: finalDueDate,
    currency: detectedCurrency ?? "",
    subtotal,
    tax,
    total,
    ...(address ? { address } : {}),
    ...(vendorEmail ? { vendorEmail } : {}),
    ...(iban ? { iban } : {}),
    ...(vatNumber ? { vatNumber } : {}),
    ...(businessRegistrationNumber ? { businessRegistrationNumber } : {}),
    status: "draft",
    ...(chosen.templateHold ? { templateHold: true } : {}),
    ...(autoApprove ? { autoApproved: true } : {}),
    lineItems: chosen.lineItems,
    glAccount: GL_ACCOUNTS[0]!,
    department: DEPARTMENTS[0]!,
    memo: "",
    tags: [],
    provenance: finalProvenance,
    originalExtraction: {
      vendor,
      invoiceNumber,
      issueDate,
      dueDate: finalDueDate,
      subtotal,
      tax,
      total,
      ...(address ? { address } : {}),
      ...(vendorEmail ? { vendorEmail } : {}),
      ...(iban ? { iban } : {}),
      ...(vatNumber ? { vatNumber } : {}),
      ...(businessRegistrationNumber ? { businessRegistrationNumber } : {}),
    },
    audit: [
      {
        id: uid(),
        at: now,
        actor: chosen.path === "template" ? "template" : chosen.path === "vlm" ? "vision model" : "document text",
        action: auditAction,
        note: auditNote,
      },
      ...(reconciliation.mismatch
        ? [
            {
              id: uid(),
              at: now,
              actor: "system",
              action: "Extraction needs review",
              note: reconciliation.reason,
            },
          ]
        : []),
      ...(crossCheckDisagreements.length > 0
        ? [
            {
              id: uid(),
              at: now,
              actor: "system",
              action: "Cross-check flagged disagreements",
              note: `${crossCheckDisagreements.length} field${crossCheckDisagreements.length === 1 ? "" : "s"} read differently by the vision and text readers — confirm before approving.`,
            },
          ]
        : []),
      ...(invoicePrepaid.prepaid
        ? [
            {
              id: uid(),
              at: now,
              actor: "document text",
              action: "Prepaid phrasing detected",
              note: `The document text describes this amount as already paid: "${invoicePrepaid.phrase}". This is an attention flag, not a blocker — the paying screen decides auto-mark vs manual review, but the flag stays on the invoice so it cannot be missed on a high-value payment run.`,
            },
          ]
        : []),
    ],
    source: "upload",
    engine: chosen.path === "template" ? "template" : chosen.path === "vlm" ? "gemma" : "text",
    templateFingerprint: chosen.templateFingerprint,
    fieldPath,
    prepaid: !!invoicePrepaid,
    prepaidPhrase: invoicePrepaid.phrase,
    learnPayload:
      chosen.path === "template"
        ? undefined
        : {
            pages: loaded.pages.map((p) => ({
              pageNumber: p.pageNumber,
              words: p.words.map((w) => ({
                text: w.text,
                x: w.x,
                y: w.y,
                w: w.w,
                h: w.h,
                confidence: w.confidence,
              })),
            })),
          },
    fileName: file.name,
    fileType:
      file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "application/octet-stream"),
    fileUrl: URL.createObjectURL(file),
    ocrText,
    pageCount,
    ocrMethod: method,
    ocrPages: loaded.pages.map((p) => ({
      pageNumber: p.pageNumber,
      charCount: p.text.trim().length,
      confidence: Number((p.image ? 0.92 : 0.98).toFixed(2)),
      method: p.method,
    })),
    fieldSources: chosen.fieldSources,
    ...(crossCheck ? { crossCheck } : {}),
    createdAt: now,
  };
}
/** Builds a VendorTemplate from a confirmed invoice — used by the auto-learn
 * hook (see store.tsx). Operates on the cached `learnPayload` so we don't
 * re-run OCR. Only fields with provenance "exact" or "read" are learned —
 * derived/manual fields are not reliable enough to teach the template. */
export function buildTemplateFromInvoice(invoice: Invoice): VendorTemplate | undefined {
  const payload = invoice.learnPayload;
  const words = payload?.pages[0]?.words.map((w) => ({ ...w })) ?? [];
  const vendorBlock = (words.length > 0 ? extractVendorBlock(words) : undefined) ?? invoice.vendor;
  const provenance = invoice.provenance ?? {};
  const fields: Partial<Record<ExtractedField, AnchorSpec>> = {};
  for (const rawField of Object.keys(provenance)) {
    const field = rawField as ExtractedField;
    // Only learn from exact (text layer) or read (template/VLM) — not derived or manual.
    if (provenance[field] !== "exact" && provenance[field] !== "read") continue;
    const value = invoice[field];
    if (value === undefined || value === "" || value === 0) continue;
    const spec = deriveAnchor(words, field, value);
    if (spec) fields[field] = spec;
  }
  return {
    vendor_fingerprint: fingerprintOf(vendorBlock),
    vendor_key: invoice.vendor,
    embedding: embedVendorText(vendorBlock),
    version: 1,
    fields,
    updatedAt: new Date().toISOString(),
  };
}
/** Reverse-engineers an AnchorSpec by finding the value's words and the
 * nearest anchor label preceding them. */
function deriveAnchor(
  words: OcrWord[],
  field: ExtractedField,
  value: string | number,
): AnchorSpec | undefined {
  const anchorCandidates = ANCHOR_LABELS[field] ?? [];
  let anchor;
  for (const cand of anchorCandidates) {
    anchor = nearestAnchorWord(words, cand);
    if (anchor) break;
  }
  if (!anchor) anchor = words[0];
  if (!anchor) return undefined;
  const valueWord = nearestValueWord(words, anchor, String(value));
  if (!valueWord) return undefined;
  const x0 = Math.min(anchor.x, valueWord.x);
  const y0 = Math.min(anchor.y, valueWord.y);
  const x1 = Math.max(anchor.x + anchor.w, valueWord.x + valueWord.w);
  const y1 = Math.max(anchor.y + anchor.h, valueWord.y + valueWord.h);
  const ax = anchor.x;
  const ay = anchor.y;
  const aw = anchor.w || 0.05;
  const ah = anchor.h || 0.05;
  return {
    anchor: anchor.text,
    region: {
      x0: (x0 - ax) / aw,
      y0: (y0 - ay) / ah,
      x1: (x1 - ax) / aw,
      y1: (y1 - ay) / ah,
    },
    type:
      field === "issueDate" || field === "dueDate"
        ? "date"
        : field === "subtotal" || field === "tax" || field === "total"
          ? "decimal"
          : "string",
  };
}
const ANCHOR_LABELS = {
  vendor: ["van", "from", "leverancier", "supplier", "afzender", "verkoper"],
  invoiceNumber: [
    "factuur",
    "factuurnummer",
    "factuurnr",
    "factuur nr",
    "invoice",
    "invoice number",
    "nummer",
    "no.",
    "nr.",
  ],
  issueDate: ["factuurdatum", "datum factuur", "datum", "date", "invoice date", "leveringsdatum"],
  dueDate: ["vervaldatum", "betalingsdatum", "te betalen", "due", "due date", "payment due"],
  subtotal: ["subtotaal", "subtotal", "netto", "net", "totaal excl", "totaal excl. btw"],
  tax: ["btw", "btw-bedrag", "btw bedrag", "omzetbelasting", "vat", "tax"],
  total: [
    "totaal",
    "total",
    "te betalen",
    "amount due",
    "total due",
    "grand total",
    "totaalbedrag",
    "totaal incl",
    "bedrag te voldoen",
  ],
};
function nearestAnchorWord(words, query) {
  const needle = query.toLowerCase();
  let best;
  for (const w of words)
    if (w.text.toLowerCase().includes(needle)) {
      if (!best || w.y < best.y) best = w;
    }
  return best;
}
function nearestValueWord(words, anchor, value) {
  const needle = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (!needle) return undefined;
  let best;
  for (const w of words) {
    if (w.y < anchor.y - 0.05 || w.y > anchor.y + 0.15) continue;
    if (w.x + w.w < anchor.x + anchor.w) continue;
    const hay = w.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (!hay) continue;
    let score = 0;
    if (hay === needle) score = 1;
    else if (hay.includes(needle)) score = 0.85;
    else {
      let shared = 0;
      for (const c of needle) if (hay.includes(c)) shared++;
      score = (shared / needle.length) * 0.6;
    }
    if (best === undefined || score > best.score)
      best = {
        word: w,
        score,
      };
  }
  return best && best.score >= 0.45 ? best.word : undefined;
}
