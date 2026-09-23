import {
  GL_ACCOUNTS,
  DEPARTMENTS,
  ZONE_FIELDS,
  uid,
  type AnchorSpec,
  type BusinessProfile,
  type CrossCheck,
  type CrossCheckOutcome,
  type ExtractedField,
  type Invoice,
  type LineItem,
  type OcrMethod,
  type OcrPage,
  type OcrWord,
  type ProcessingState,
  type ZoneCheckResult,
  type OcrWord as PageWord,
  EMPTY_BUSINESS_PROFILE,
} from "./types";
import { detectPrepaid, moneyToNumber, dueDateFromPaymentTerms, parseDateParts } from "./zones";
import { labelsFor, detectDocumentLocale, type DocumentLocale } from "./labels";
import { ibanChecksumValid } from "./iban";
import {
  gemmaModel,
  downscaleToJpeg,
  mergeGemmaPages,
  gemmaHealthy,
  blobToBase64,
  extractPageWithVision,
  imageExtractModelOrder,
  gemmaToFields,
} from "../ai/gemma";
import "./pdfjs-polyfill";

const performance_default = globalThis.performance;

export type ExtractedFields = {
  vendor?: string | undefined;
  currency?: string | undefined;
  invoiceNumber?: string | undefined;
  issueDate?: string | undefined;
  dueDate?: string | undefined;
  subtotal?: number | undefined;
  tax?: number | undefined;
  total?: number | undefined;
  address?: string | undefined;
  vendorEmail?: string | undefined;
  iban?: string | undefined;
  vatNumber?: string | undefined;
  businessRegistrationNumber?: string | undefined;
  lineItems: LineItem[];
  confidence: Partial<Record<ExtractedField, number>>;
  fieldSources: Partial<Record<ExtractedField, number>>;
  baseConfidence: number;
  prepaid?: boolean;
  prepaidPhrase?: string;
};

export type PageRead = { pageNumber: number; text: string; confidence: number; words?: OcrWord[] };
export type ProcessingSkeleton = ReturnType<typeof buildProcessingSkeleton>;
import { preprocess } from "./preprocess";
import { layoutRecognize, type LayoutOcrResult } from "./layout-ocr";
import { runZoneCheck } from "./zone-check";
import { applyCrossCheck, compareExtractions, disagreements } from "./cross-check";
import { specToZone, parseLineItemRows } from "./mapping";
import { embedVendorText, extractVendorBlock, fingerprintOf } from "./fingerprint";
import { findTemplateMatch } from "./template-store";
import { applyTemplateField } from "./template-apply";

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
/** A page with at least this much embedded text skips the slower render + OCR path. */
const TEXT_LAYER_MIN_CHARS = 120;
/** Render scale for OCR fallback (2 ≈ 144 dpi, a good speed/accuracy trade-off). */
const RENDER_SCALE = 2;
/** Embedded PDF text is exact, but layout reconstruction is not — stay below 1. */
const TEXT_LAYER_CONFIDENCE = 0.98;
/**
 * Only matches figures that look like currency. Dutch/European forms come
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
 * EU VAT structures per member state (BTW-nummer-controle.nl format table).
 * Each pattern matches the COMPACT form (no spaces/punctuation, with country
 * code). Used to accept structurally valid candidates and reject garbage
 * that merely looks numeric — e.g. a phone number after "Tel:".
 */
const EU_VAT_PATTERNS = [
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
export function isValidVatFormat(raw) {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9+*]/g, "");
  const entry = EU_VAT_PATTERNS.find((p) => compact.startsWith(p.cc));
  if (!entry) return false;
  if (entry.cc === "ES") {
    if (/^\d/.test(compact.slice(2, 3)) && /\d$/.test(compact)) return false;
  }
  return entry.re.test(compact);
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
export function findVatNumberIn(text, profile, vendorEmail) {
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
/** Only filters lines that are *purely* metadata — not lines that merely
 * contain a metadata keyword alongside a company name. */
/** Fields that, when all present, indicate the heuristic path has enough
 * evidence to skip the slow VLM call entirely. */
const CRITICAL_HEURISTIC_FIELDS = ["vendor", "invoiceNumber", "issueDate", "total"];
/** Vendor heuristic result cache — keyed by lowercased vendor name.
 * When a heuristic extraction succeeds for a vendor, future invoices from
 * the same vendor can skip the VLM entirely even if the heuristic only
 * partially matched on the new invoice (the vendor name alone is enough
 * to predict a successful heuristic path).
 * TTL: 10 minutes, LRU cap: 200 entries. */
const VENDOR_HEURISTIC_CACHE = new Map();
const VENDOR_CACHE_TTL = 6e5;
const VENDOR_CACHE_MAX = 200;
export function cacheVendorHeuristic(vendorName, fields) {
  if (!vendorName) return;
  const key = vendorName.toLowerCase();
  if (VENDOR_HEURISTIC_CACHE.size >= VENDOR_CACHE_MAX) {
    const oldest = VENDOR_HEURISTIC_CACHE.keys().next().value;
    if (oldest !== undefined) VENDOR_HEURISTIC_CACHE.delete(oldest);
  }
  VENDOR_HEURISTIC_CACHE.set(key, {
    ts: Date.now(),
    fields,
  });
}
export function lookupVendorHeuristic(vendorName) {
  if (!vendorName) return undefined;
  const key = vendorName.toLowerCase();
  const entry = VENDOR_HEURISTIC_CACHE.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > VENDOR_CACHE_TTL) {
    VENDOR_HEURISTIC_CACHE.delete(key);
    return;
  }
  return entry.fields;
}
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
      glAccount: GL_ACCOUNTS[0],
      department: DEPARTMENTS[0],
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
/** Renders a PDF page to a PNG blob (shared by vision-model input and OCR fallback). */
async function renderPageToPngBlob(page, scale = RENDER_SCALE) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({
    canvas,
    viewport,
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
function overallMethod(pages) {
  const methods = new Set(pages.filter((p) => p.text.trim()).map((p) => p.method));
  methods.delete("none");
  if (methods.size === 0) return "none";
  if (methods.size > 1) return "mixed";
  return methods.has("text-layer") ? "text-layer" : "ocr";
}
const METHOD_LABEL = {
  "text-layer": "digital text",
  ocr: "OCR",
  mixed: "mixed text + OCR",
  none: "no readable text",
};
/**
 * Pure field extraction over per-page text. Confidence for each field blends
 * the source page's read quality with match strength
 * (labelled > pattern > heuristic); missing fields score low.
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
  const pageConfidence = new Map(pages.map((page) => [page.pageNumber, page.confidence]));
  const totalChars = pages.reduce((sum, page) => sum + page.text.trim().length, 0);
  const baseConfidence =
    pages.length === 0
      ? 0.55
      : pages.reduce((s, p) => s + p.confidence * Math.max(p.text.trim().length, 1), 0) /
        Math.max(totalChars, pages.length);
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
  const confidenceFor = (hit, quality) => {
    if (!hit) return cappedMissingConfidence(baseConfidence);
    return cappedConfidence((pageConfidence.get(hit.page) ?? baseConfidence) * quality, 0.99);
  };
  const fieldSources = {};
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
    confidence: {
      vendor: confidenceFor(vendorFinal, 0.97),
      invoiceNumber: confidenceFor(numberHit, numberHit?.labelled === false ? 0.85 : 1),
      issueDate: confidenceFor(issueHit, 0.97),
      dueDate: confidenceFor(dueFinal, dueFinal?.labelled === false ? 0.8 : 0.95),
      subtotal: confidenceFor(subtotalHit, 0.98),
      tax: confidenceFor(taxHit, 0.95),
      total: confidenceFor(totalHit, 0.98),
      address: confidenceFor(addressHit, addressHit?.labelled === false ? 0.8 : 0.96),
      vendorEmail: confidenceFor(emailHit, emailHit?.labelled === false ? 0.82 : 0.96),
      iban: confidenceFor(ibanHit, ibanHit?.labelled === false ? 0.9 : 0.99),
      vatNumber: confidenceFor(vatHit, vatHit?.labelled === false ? 0.9 : 0.99),
      businessRegistrationNumber: confidenceFor(businessRegHit, 0.99),
    },
    fieldSources,
    baseConfidence,
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
export function confirmedReads(fields) {
  const out = {};
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
export function cappedMissingConfidence(confidence, maximum = 0.5) {
  return cappedConfidence(confidence * 0.55, maximum);
}
export function cappedConfidence(confidence, maximum = 1) {
  return Number(Math.min(maximum, Math.max(0, confidence)).toFixed(2));
}
export function vendorNameFromFile(fileName) {
  return fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ");
}
/**
 * Confidence floor — when ALL fields from a template pass clear this, we ship
 * the result without falling back to the VLM. The rework doc uses 0.9; we
 * soften to 0.78 to keep the template path useful on slightly noisy scans.
 */
const TEMPLATE_CONFIDENCE_FLOOR = 0.78;
/**
 * Loads + preprocesses the file into per-page payloads. Each payload carries
 * the OCR text, a per-word bounding-box array, and the rendered page image.
 */
async function loadPages(file, onProgress) {
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isImage) {
    onProgress?.({
      stage: "preprocessing",
      progress: 0.08,
    });
    const clean = await preprocess(file);
    onProgress?.({
      stage: "layout OCR",
      progress: 0.18,
    });
    const ocr = await layoutRecognize(clean, (m) =>
      onProgress?.({
        stage: `scanning · ${m.stage}`,
        progress: 0.18 + m.progress * 0.55,
      }),
    );
    return {
      pages: [
        {
          pageNumber: 1,
          text: ocr.text,
          confidence: ocr.confidence,
          method: ocr.text.trim() ? "ocr" : "none",
          image: file,
          words: ocr.words,
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
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const count = Math.min(totalPages, 20);
  const pages = [];
  const processPage = async (n) => {
    const base = 0.05 + (0.7 * (n - 1)) / count;
    onProgress?.({
      stage: `preprocessing page ${n}`,
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
      let confidence = layered.trim() ? TEXT_LAYER_CONFIDENCE : 0.4;
      let method = layered.trim().length >= TEXT_LAYER_MIN_CHARS ? "text-layer" : "none";
      if (method === "text-layer") words = await textLayerWordsFromPage(page);
      else {
        onProgress?.({
          stage: `scanning page ${n}`,
          progress: base + 0.5 / count,
          page: n,
          totalPages,
        });
        image = await renderPageToPngBlob(page);
        if (image) {
          const ocr = await layoutRecognize(await preprocess(image), (m) =>
            onProgress?.({
              stage: `scanning page ${n} · ${m.stage}`,
              progress: base + 0.05 + (m.progress * 0.6) / count,
              page: n,
              totalPages,
            }),
          );
          const useLayer =
            ocr.text.trim().length < layered.trim().length && layered.trim().length > 0;
          text = useLayer ? layered : ocr.text;
          confidence = text.trim() ? (useLayer ? 0.6 : ocr.confidence) : 0.4;
          method = text.trim() ? "ocr" : "none";
          words = useLayer ? words : ocr.words;
        }
      }
      return {
        pageNumber: n,
        text,
        confidence,
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
    const concurrency = count > 1 ? 2 : 1;
    for (let start = 1; start <= count; start += concurrency) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(concurrency, count - start + 1) }, (_, offset) =>
          processPage(start + offset),
        ),
      );
      pages.push(...batch);
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
 * or nothing read strongly — caller falls through to VLM. When some fields
 * read below the floor, a partial result comes back so the caller can flag
 * drift on the invoice instead of paying for a full re-read.
 */
async function tryTemplatePath(pages, templates) {
  if (!templates || Object.keys(templates).length === 0) return undefined;
  if (pages.length === 0) return undefined;
  const firstPage = pages[0];
  if (firstPage.words.length === 0) return undefined;
  const vendorBlock = extractVendorBlock(firstPage.words);
  if (!vendorBlock) return undefined;
  const tpl = findTemplateMatch({
    vendorBlock,
    embedding: embedVendorText(vendorBlock),
  });
  if (!tpl) return undefined;
  const fields = {};
  const confidence = {};
  const fieldSources = {};
  for (const page of pages)
    for (const field of Object.keys(tpl.fields)) {
      if (fields[field] !== undefined) continue;
      const spec = tpl.fields[field];
      const hit = applyTemplateField(page.words, spec, field);
      if (hit === undefined) continue;
      fields[field] = hit.value;
      confidence[field] = hit.confidence;
      fieldSources[field] = page.pageNumber;
    }
  if (Object.keys(confidence).length === 0) return undefined;
  const tplFields = Object.keys(tpl.fields);
  const strong = tplFields.filter((field) => (confidence[field] ?? 0) >= TEMPLATE_CONFIDENCE_FLOOR);
  if (strong.length === 0) return undefined;
  if (strong.length < tplFields.length) {
    for (const field of tplFields)
      if ((confidence[field] ?? 0) < TEMPLATE_CONFIDENCE_FLOOR) {
        delete fields[field];
        delete confidence[field];
        delete fieldSources[field];
      }
  }
  const passAll = strong.length === tplFields.length;
  return {
    fields,
    confidence,
    fieldSources,
    fingerprint: tpl.vendor_fingerprint,
    templateKey: tpl.vendor_key,
    ...(passAll ? {} : { partial: true }),
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
  const confidence = { ...args.confidence };
  const fieldSources = { ...args.fieldSources };
  const recoveredBy = {};
  for (const field of args.missing) {
    const read = args.reads[field];
    if (!read) continue;
    fields[field] = read.value;
    confidence[field] = read.confidence;
    fieldSources[field] = read.page;
    recoveredBy[field] = args.source;
  }
  return {
    fields,
    confidence,
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
export function recoverFieldsFromText(pages, fileName, missing, businessProfile) {
  const out = {};
  if (missing.length === 0) return out;
  const reads = extractFieldsFromPages(pages, fileName, businessProfile);
  for (const field of missing) {
    const page = reads.fieldSources[field];
    if (page === undefined) continue;
    const value = reads[field];
    if (value === undefined || value === "") continue;
    out[field] = {
      value,
      confidence: reads.confidence[field],
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
    glAccount: GL_ACCOUNTS[0],
    department: DEPARTMENTS[0],
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
  const loadingTask = (await pdfLib()).getDocument({ data: await source.arrayBuffer() });
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
  const merged = mergeGemmaPages(results);
  return CRITICAL_HEURISTIC_FIELDS.every((f) => {
    const v = merged[f];
    return typeof v === "object" && v !== null && "value" in v ? !!v.value : false;
  });
}
async function tryVlmPath(pages, onProgress, onToken) {
  if (!(await gemmaHealthy()) || pages.length === 0) return undefined;
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
    const b64 = page.visionB64 ?? (await blobToBase64(await downscaleToJpeg(image)));
    page.visionB64 ??= b64;
    try {
      const { page: parsed, model } = await extractPageWithVision(
        b64,
        page.pageNumber,
        pages.length,
        imageExtractModelOrder(),
        onProgress,
        onToken,
      );
      results.push(parsed);
      winningModel ??= model;
    } catch {
      results.push(null);
    }
  }
  const merged = mergeGemmaPages(results, pages.map((p) => p.text).join("\n"));
  const fields = gemmaToFields(merged);
  const prepaid = detectPrepaid(merged.pagesText);
  if (!Object.values(fields.confidence).some((c) => c > 0.5)) return undefined;
  const picked = {};
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
    confidence: fields.confidence,
    fieldSources: fields.fieldSources,
    currency: fields.currency,
    lineItems: fields.lineItems,
    model: winningModel,
    prepaid: prepaid.prepaid,
    prepaidPhrase: prepaid.phrase,
  };
}
/** Last-resort path: pure regex/heuristic over OCR text. Used when both the
 * template store is empty AND no VLM is available. */
async function tryHeuristicPath(pages, fileName, businessProfile) {
  const fields = extractFieldsFromPages(
    pages.map((p) => ({
      pageNumber: p.pageNumber,
      text: p.text,
      confidence: p.confidence,
      words: p.words,
    })),
    fileName,
    businessProfile,
  );
  const out = {};
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
  fields.businessRegistrationNumber !== undefined && fields.businessRegistrationNumber;
  const prepaid = detectPrepaid(pages.map((p) => p.text).join("\n"));
  return {
    fields: out,
    confidence: fields.confidence,
    fieldSources: fields.fieldSources,
    lineItems: fields.lineItems,
    currency: fields.currency,
    prepaid: prepaid.prepaid,
    prepaidPhrase: prepaid.phrase,
  };
}
/** Fast phase: preprocess → layout OCR → fingerprint → template match.
 *  Returns either a finished Invoice (template hit) or a ProcessingSkeleton
 *  (novel vendor). The caller decides whether to await the VLM/heuristic
 *  fallback here or hand off to a background job. */
export async function extractQuickPhase(file, onProgress, templates) {
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
        glAccount: GL_ACCOUNTS[0],
        department: DEPARTMENTS[0],
        memo: "",
        tags: [],
        confidence: {},
        audit: [
          {
            id: uid(),
            at: now,
            actor: "OCR engine",
            action: "Document uploaded (preview only)",
            note: file.name,
          },
        ],
        source: "upload",
        engine: "ocr",
        fileName: file.name,
        fileType: file.type,
        fileUrl: URL.createObjectURL(file),
        createdAt: now,
      },
    };
  }
  onProgress?.({
    stage: "preprocessing",
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
    const driftFields = tpl && templateHit.partial ? detectDrift(tpl, templateHit.fields) : [];
    const hold = (tpl?.confirmNextCount ?? 0) > 0;
    const lineItems = tpl?.line_items ? applyLineItemsSpec(loaded.pages, tpl.line_items) : [];
    const currency = inferCurrency(loaded.pages.map((p) => p.text).join("\n"));
    if (driftFields.length > 0) {
      const merged = applyDriftReads({
        fields: templateHit.fields,
        confidence: templateHit.confidence,
        fieldSources: templateHit.fieldSources,
        missing: driftFields,
        reads: recoverFieldsFromText(loaded.pages, file.name, driftFields),
        source: "ocr",
      });
      if (merged.stillMissing.length > 0)
        return {
          kind: "processing",
          invoice: buildProcessingSkeleton(file, loaded, {
            fields: merged.fields,
            confidence: merged.confidence,
            fieldSources: merged.fieldSources,
            currency,
            action: "Template matched — recovering missing fields",
          }),
          loadedPages: loaded.pages,
          firstSlow: false,
          drift: {
            templateKey: templateHit.templateKey,
            templateFingerprint: templateHit.fingerprint,
            templateVersion: tpl?.version,
            templateHold: hold,
            fields: merged.fields,
            confidence: merged.confidence,
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
              confidence: merged.confidence,
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
        },
      };
    }
    return {
      kind: "invoice",
      invoice: await finalizeInvoice({
        file,
        loaded,
        chosen: {
          path: "template",
          fields: templateHit.fields,
          confidence: templateHit.confidence,
          fieldSources: templateHit.fieldSources,
          lineItems,
          currency,
          templateFingerprint: templateHit.fingerprint,
          model: undefined,
          ...(hold ? { templateHold: true } : {}),
        },
        templates,
      }),
    };
  }
  const firstSlow = !templates || Object.keys(templates).length === 0;
  return {
    kind: "processing",
    invoice: buildProcessingSkeleton(file, loaded, { action: "Queued for AI extraction" }),
    loadedPages: loaded.pages,
    firstSlow,
  };
}
/**
 * Builds the "processing" placeholder invoice. Optional `partial` values let a
 * drift recovery job surface the fields a template already read while it waits
 * on the model.
 */
export function buildProcessingSkeleton(file, loaded, partial) {
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
    glAccount: GL_ACCOUNTS[0],
    department: DEPARTMENTS[0],
    memo: "",
    tags: [],
    confidence: partial?.confidence ?? {},
    audit: [
      {
        id: uid(),
        at: now,
        actor: "OCR engine",
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
      confidence: Number(p.confidence.toFixed(2)),
      method: p.method,
    })),
    fieldSources: partial?.fieldSources ?? {},
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
  if (heur.fields.vendor && heur.fields.invoiceNumber)
    cacheVendorHeuristic(String(heur.fields.vendor), heur.fields);
  if (
    CRITICAL_HEURISTIC_FIELDS.every(
      (f) => heur.fields[f] !== undefined && heur.fields[f] !== "" && heur.fields[f] !== 0,
    )
  )
    chosen = {
      path: "ocr",
      fields: heur.fields,
      confidence: heur.confidence,
      fieldSources: heur.fieldSources,
      lineItems: heur.lineItems,
      currency: heur.currency,
      templateFingerprint: undefined,
      model: undefined,
    };
  else {
    const cachedFields = lookupVendorHeuristic(invoice.vendor ?? "");
    if (cachedFields) {
      const mergedFields = { ...heur.fields };
      const mergedConf = { ...heur.confidence };
      const mergedSources = { ...heur.fieldSources };
      for (const [k, v] of Object.entries(cachedFields)) {
        const fk = k;
        if (mergedFields[fk] === undefined || mergedFields[fk] === "" || mergedFields[fk] === 0) {
          mergedFields[fk] = v;
          mergedConf[fk] = mergedConf[fk] ?? 0.85;
          delete mergedSources[fk];
        }
      }
      if (
        CRITICAL_HEURISTIC_FIELDS.every(
          (f) => mergedFields[f] !== undefined && mergedFields[f] !== "" && mergedFields[f] !== 0,
        )
      )
        chosen = {
          path: "ocr",
          fields: mergedFields,
          confidence: mergedConf,
          fieldSources: mergedSources,
          lineItems: heur.lineItems,
          currency: heur.currency,
          templateFingerprint: undefined,
          model: undefined,
        };
      else chosen = mergeVlmResult(heur, await tryVlmPath(pages, onProgress, onToken));
    } else chosen = mergeVlmResult(heur, await tryVlmPath(pages, onProgress, onToken));
  }
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
/** Merges heuristic and VLM results, preferring heuristic reads. */
export function mergeVlmResult(heur, vlmHit) {
  const prepaidToCarry = vlmHit?.prepaid ?? heur.prepaid;
  const prepaidPhraseToCarry = vlmHit?.prepaidPhrase ?? heur.prepaidPhrase;
  if (vlmHit) {
    const mergedFields = { ...heur.fields };
    const mergedConf = { ...heur.confidence };
    const mergedSources = { ...heur.fieldSources };
    for (const [k, v] of Object.entries(vlmHit.fields)) {
      const fk = k;
      if (mergedFields[fk] === undefined || mergedFields[fk] === "" || mergedFields[fk] === 0) {
        mergedFields[fk] = v;
        mergedConf[fk] = vlmHit.confidence[fk] ?? 0.9;
        if (vlmHit.fieldSources[fk] !== undefined) mergedSources[fk] = vlmHit.fieldSources[fk];
      }
    }
    return {
      path: "vlm",
      fields: mergedFields,
      confidence: mergedConf,
      fieldSources: mergedSources,
      lineItems: vlmHit.lineItems.length > 0 ? vlmHit.lineItems : heur.lineItems,
      currency: vlmHit.currency ?? heur.currency,
      templateFingerprint: undefined,
      model: vlmHit.model,
      prepaid: prepaidToCarry,
      prepaidPhrase: prepaidPhraseToCarry,
    };
  }
  return {
    path: "ocr",
    fields: heur.fields,
    confidence: heur.confidence,
    fieldSources: heur.fieldSources,
    lineItems: heur.lineItems,
    currency: heur.currency,
    templateFingerprint: undefined,
    model: undefined,
    prepaid: prepaidToCarry,
    prepaidPhrase: prepaidPhraseToCarry,
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
          confidence: vlm.confidence[field] ?? 0.7,
          page: vlm.fieldSources[field] ?? 1,
        };
      }
  }
  const merged = applyDriftReads({
    fields: drift.fields,
    confidence: drift.confidence,
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
        confidence: merged.confidence,
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
const RECONCILIATION_CONFIDENCE_FACTOR = 0.65;
const MIN_RECONCILED_CONFIDENCE = 0.35;
export function lowerConfidence(confidence) {
  return Number(
    Math.max(MIN_RECONCILED_CONFIDENCE, confidence * RECONCILIATION_CONFIDENCE_FACTOR).toFixed(2),
  );
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
export async function finalizeInvoice(args) {
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
  (chosen.fields.vatNumber && String(chosen.fields.vatNumber),
    findVatNumberIn(documentText, undefined, vendorEmail)?.value);
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
  const adjustedConfidence = { ...chosen.confidence };
  if (reconciliation.mismatch) {
    for (const field of ["subtotal", "tax", "total"])
      if (adjustedConfidence[field] !== undefined)
        adjustedConfidence[field] = lowerConfidence(adjustedConfidence[field]);
  }
  let crossCheck;
  if (chosen.path !== "ocr") {
    const secondary = confirmedReads(
      extractFieldsFromPages(
        loaded.pages.map((p) => ({
          pageNumber: p.pageNumber,
          text: p.text,
          confidence: p.confidence,
        })),
        file.name,
      ),
    );
    if (Object.keys(secondary).length > 0)
      crossCheck = compareExtractions(chosen.fields, secondary);
  }
  const finalConfidence = applyCrossCheck(adjustedConfidence, crossCheck);
  const crossCheckDisagreements = disagreements(crossCheck);
  const auditAction =
    chosen.path === "template"
      ? `Template extraction (${chosen.templateFingerprint})`
      : chosen.path === "vlm"
        ? `AI vision extraction (${chosen.model ?? gemmaModel()}) — new vendor`
        : isImage
          ? "Document scanned and fields extracted"
          : `PDF parsed — ${pageCount} page${pageCount === 1 ? "" : "s"} (${METHOD_LABEL[method]})${loaded.truncated ? `, first 20 processed` : ""}`;
  const auditNote =
    file.name +
    (chosen.path === "template"
      ? " · template match"
      : chosen.path === "vlm"
        ? " · VLM fallback"
        : " · OCR fallback");
  let zoneCheck;
  const sanityTemplate = templates?.[vendor];
  if (sanityTemplate?.fields && Object.keys(sanityTemplate.fields).length > 0)
    try {
      const legacyZones = {};
      let hasZone = false;
      for (const [field, spec] of Object.entries(sanityTemplate.fields)) {
        if (!spec) continue;
        const z = spec._zone;
        if (z) {
          legacyZones[field] = z;
          hasZone = true;
          continue;
        }
        const pageWords = loaded.pages[0]?.words ?? [];
        if (pageWords.length === 0) continue;
        const re = specToZone(spec, pageWords);
        if (re.w > 0 && re.h > 0) {
          legacyZones[field] = re;
          hasZone = true;
        }
      }
      const source = isImage ? await downscaleToJpeg(file) : loaded.pages[0]?.image;
      if (source && hasZone) {
        const detected = await runZoneCheck(
          source,
          {
            vendor,
            invoiceNumber,
            issueDate: issueDate || now.slice(0, 10),
            dueDate: finalDueDate,
            subtotal,
            tax,
            total,
            currency: detectedCurrency ?? "",
          },
          legacyZones,
        );
        if (detected.length) zoneCheck = detected;
      }
    } catch {}
  const fieldPath = {};
  for (const f of Object.keys(chosen.fields))
    fieldPath[f] = chosen.path === "template" ? "template" : chosen.path === "vlm" ? "vlm" : "ocr";
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
    ...(businessRegistrationNumber ? { businessRegistrationNumber } : {}),
    status: "draft",
    ...(chosen.templateHold ? { templateHold: true } : {}),
    lineItems: chosen.lineItems,
    glAccount: GL_ACCOUNTS[0],
    department: DEPARTMENTS[0],
    memo: "",
    tags: [],
    confidence: finalConfidence,
    audit: [
      {
        id: uid(),
        at: now,
        actor: "OCR engine",
        action: auditAction,
        note: auditNote,
      },
      ...(reconciliation.mismatch
        ? [
            {
              id: uid(),
              at: now,
              actor: "OCR engine",
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
              actor: "OCR engine",
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
              actor: "OCR engine",
              action: "Prepaid phrasing detected",
              note: `The document text describes this amount as already paid: "${invoicePrepaid.phrase}". This is an attention flag, not a blocker — the paying screen decides auto-mark vs manual review, but the flag stays on the invoice so it cannot be missed on a high-value payment run.`,
            },
          ]
        : []),
    ],
    source: "upload",
    engine: chosen.path === "template" ? "template" : chosen.path === "vlm" ? "gemma" : "ocr",
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
      confidence: Number(p.confidence.toFixed(2)),
      method: p.method,
    })),
    fieldSources: chosen.fieldSources,
    ...(zoneCheck ? { zoneCheck } : {}),
    ...(crossCheck ? { crossCheck } : {}),
    createdAt: now,
  };
}
/** Builds a VendorTemplate from a confirmed invoice — used by the auto-learn
 * hook (see store.tsx). Operates on the cached `learnPayload` so we don't
 * re-run OCR. */
export function buildTemplateFromInvoice(invoice) {
  const payload = invoice.learnPayload;
  if (!payload || payload.pages.length === 0) return undefined;
  const words = payload.pages[0].words.map((w) => ({ ...w }));
  if (words.length === 0) return undefined;
  const vendorBlock = extractVendorBlock(words);
  if (!vendorBlock) return undefined;
  const fields = {};
  for (const field of Object.keys(invoice.confidence)) {
    if ((invoice.confidence[field] ?? 0) < TEMPLATE_CONFIDENCE_FLOOR) continue;
    const value = invoice[field];
    if (value === undefined || value === "" || value === 0) continue;
    const spec = deriveAnchor(words, field, value);
    if (spec) fields[field] = spec;
  }
  if (Object.keys(fields).length === 0) return undefined;
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
function deriveAnchor(words, field, value) {
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
    if (w.y < anchor.y + anchor.h) continue;
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
