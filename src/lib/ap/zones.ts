import { money, type ZoneField } from "./types";

const MONTHS: Record<string, number> = {
  // Dutch

  januari: 1,
  februari: 2,
  maart: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  augustus: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mrt: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  okt: 10,
  nov: 11,
  dec: 12,
  // English
  january: 1, march: 3, october: 10,
  mar: 3, oct: 10,
  // German
  januar: 1, februar: 2, märz: 3, maerz: 3, mai: 5, juni: 6, juli: 7, oktober: 10,
  // French
  janvier: 1, février: 2, fevrier: 2, mars: 3, juin: 6, juillet: 7, août: 8, aout: 8,
  octobre: 10, novembre: 11, décembre: 12, decembre: 12,
  // Spanish
  enero: 1, febrero: 2, marzo: 3, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

export type DateLocale = "NL" | "EN" | "DE" | "FR" | "ES";
export type DateParts = { day: number; month: number; year: number; ambiguous?: boolean };

function validDate(d: DateParts): boolean {
  const dt = new Date(d.year, d.month - 1, d.day);
  return dt.getFullYear() === d.year && dt.getMonth() === d.month - 1 && dt.getDate() === d.day;
}

/**
 * Parses EU invoice dates. Dutch remains the default for genuinely ambiguous
 * numerics, while an explicit document locale can select month-first English.
 */
export function parseDateParts(raw: string, locale: DateLocale = "NL"): DateParts | undefined {
  const s = raw.trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const d = { day: Number(m[3]), month: Number(m[2]), year: Number(m[1]) };
    return validDate(d) ? d : undefined;
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const first = Number(m[1]);
    const second = Number(m[2]);
    const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    const day = first > 12 ? first : second > 12 ? second : locale === "EN" ? second : first;
    const month = first > 12 ? second : second > 12 ? first : locale === "EN" ? first : second;
    const ambiguous = first <= 12 && second <= 12;
    const d = { day, month, year } as DateParts;
    if (ambiguous) Object.defineProperty(d, "ambiguous", { value: true, enumerable: false });
    return validDate(d) ? d : undefined;
  }
  m = s.match(/^(\d{1,2})\s+([\p{L}]{3,12})\s+(\d{4})$/u);
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (!month) return undefined;
    const d = { day: Number(m[1]), month, year: Number(m[3]) };
    return validDate(d) ? d : undefined;
  }
  m = s.match(/^([\p{L}]{3,12})\s+(\d{1,2}),?\s+(\d{4})$/u);
  if (m) {
    const month = MONTHS[m[1]!.toLowerCase()];
    if (!month) return undefined;
    const d = { day: Number(m[2]), month, year: Number(m[3]) };
    return validDate(d) ? d : undefined;
  }
  return undefined;
}

/** Dutch-first money like "1.452,00" / "€ 1.234,56"; also plain "1234.5". */
export function moneyToNumber(raw: string): number | undefined {
  const hadEuro = /€|\bEUR\b/i.test(raw);
  const s = raw.replace(/\b[A-Z]{2,3}\b/gi, "").replace(/[€$]/g, "").replace(/\s/g, "");
  if (!s) return undefined;
  let n: number;
  if (/,\d{1,2}$/.test(s)) {
    n = Number(s.replace(/\./g, "").replace(",", "."));
  } else if (/,\d{3}$/.test(s)) {
    // Dutch 3-decimal unit price ("19,950" = 19.95, "0,120" = 0.12).
    // Before this fix, bare 3-decimal commas converted only when a euro
    // marker was present; "19,950" without "€" fell through to
    // Number("19950") — a 1000× error. Same disambiguation as the regex
    // reader's toNumber: small leading group (1–2 digits) + no '.' thousands
    // groups → cents; otherwise English thousands unless a euro marker says
    // otherwise. Bare "123,456" (3-digit lead) stays English-thousands by
    // falling through to the final branch.
    const lead = s.slice(0, s.length - 4);
    if (lead.length <= 2 && !/\./g.test(s)) {
      n = Number(s.replace(",", "."));
    } else if (hadEuro) {
      n = Number(s.replace(/\./g, "").replace(",", "."));
    } else {
      n = Number(s.replace(/,/g, ""));
    }
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) {
    n = Number(s.replace(/\./g, ""));
  } else {
    n = Number(s.replace(/,/g, ""));
  }
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Payment-term days from invoice text ("Betalingsconditie … 14 dagen",
 * "Net 30"). A bare "N dagen" only counts near a payment label — validity
 * ("7 dagen geldig") and delivery ("levertijd") contexts are excluded.
 */
export function findPaymentTermDays(text: string): number | undefined {
  const clamp = (n: number) => (n >= 1 && n <= 365 ? n : undefined);
  const net = text.match(/\bnet\s*(\d{1,3})\b/i);
  if (net) {
    const days = clamp(Number(net[1]));
    if (days !== undefined) return days;
  }
  const labelRe =
    /betalingsconditie|betalingstermijn|betaaltermijn|betaal\s*binnen|te\s*betalen\s*binnen|payment\s*(terms?|due\s*in)|zahlbar|zahlungsbedingung/i;
  const validityRe = /geldig|lever|garantie|retour|tolerantie/i;
  for (const m of text.matchAll(new RegExp(labelRe.source, "gi"))) {
    const window = text.slice(m.index ?? 0, (m.index ?? 0) + 150);
    const daysMatch = window.match(/(\d{1,3})\s*dagen/i);
    if (!daysMatch) continue;
    const lineStart = window.lastIndexOf("\n", daysMatch.index ?? 0) + 1;
    const lineEnd = window.indexOf("\n", (daysMatch.index ?? 0) + daysMatch[0].length);
    const line = window.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (validityRe.test(line)) continue;
    const days = clamp(Number(daysMatch[1]));
    if (days !== undefined) return days;
  }
  return undefined;
}

/** Adds calendar days to a YYYY-MM-DD date (UTC, no TZ drift). */
export function addDaysIso(iso: string, days: number): string | undefined {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Due date from payment terms when no explicit due date is printed. */
export function dueDateFromPaymentTerms(
  text: string,
  issueIso: string | undefined,
): string | undefined {
  if (!issueIso) return undefined;
  const days = findPaymentTermDays(text);
  if (days === undefined) return undefined;
  return addDaysIso(issueIso, days);
}

/**
 * Prepaid detection: the document states the amount was already paid
 * ("reeds betaald … Mollie (iDEAL)"). "Te betalen" (still to pay) never
 * matches — only completed-payment phrasing. Returns the matched snippet
 * for messages, so callers never re-derive it.
 */
export function detectPrepaid(text: string | undefined): { prepaid: boolean; phrase?: string } {
  if (!text) return { prepaid: false };
  const m = text.match(
    /reeds\s+betaald|reeds\s+voldaan|\bal\s+betaald\b|voldaan\s+op|betaald\s+(?:op|via|door\s+middel)|paid\s+in\s+full|payment\s+received/i,
  );
  if (!m) return { prepaid: false };
  const start = Math.max(0, (m.index ?? 0) - 40);
  const snippet = text
    .slice(start, (m.index ?? 0) + 80)
    .replace(/\s+/g, " ")
    .trim();
  return { prepaid: true, phrase: snippet };
}

function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when the AI value and the field-region read agree for this field type. */
export function compareZoneValue(field: ZoneField, ai: unknown, ocrText: string): boolean {
  const text = ocrText.trim();
  if (field === "subtotal" || field === "tax" || field === "total") {
    const aiNum = typeof ai === "number" ? ai : Number(ai);
    const ocrNum = moneyToNumber(text);
    if (!Number.isFinite(aiNum) || ocrNum === undefined) return false;
    return Math.abs(aiNum - ocrNum) <= 0.02;
  }
  if (field === "issueDate" || field === "dueDate") {
    if (typeof ai !== "string") return false;
    const iso = parseDateParts(ai);
    const ocr = parseDateParts(text);
    if (!iso || !ocr) return false;
    return iso.day === ocr.day && iso.month === ocr.month && iso.year === ocr.year;
  }
  const a = normalizeText(typeof ai === "string" ? ai : String(ai ?? ""));
  const b = normalizeText(text);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/** Human-readable AI value for a chip: DD-MM-YYYY dates, currency money, raw text. */
export function formatZoneAi(field: ZoneField, ai: unknown, currency = "EUR"): string {
  if (field === "subtotal" || field === "tax" || field === "total") {
    return money(typeof ai === "number" ? ai : Number(ai) || 0, currency);
  }
  if (field === "issueDate" || field === "dueDate") {
    const iso = parseDateParts(typeof ai === "string" ? ai : String(ai ?? ""));
    if (iso) {
      return `${String(iso.day).padStart(2, "0")}-${String(iso.month).padStart(2, "0")}-${iso.year}`;
    }
    return String(ai ?? "");
  }
  return String(ai ?? "");
}
