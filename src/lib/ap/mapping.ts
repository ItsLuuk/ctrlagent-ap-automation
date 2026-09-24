/**
 * Mapping library — the pure core of the invoice mapping screen.
 *
 * Everything here is pure: it works on the cached per-word OCR payload
 * (`LearnPayload`) carried by novel-path invoices, and on `Zone`/`AnchorSpec`
 * values. The DraftMapper UI drives it; the template pipeline consumes the
 * same specs at read time (`applyTemplateField`, `specToZone`).
 *
 * Region conventions:
 *  - `Zone` is a raw normalized rectangle (0..1 of the page).
 *  - `AnchorSpec.region` is anchor-relative: offsets from the anchor word's
 *    bounding box, expressed in multiples of the anchor's own width/height
 *    (the convention `applyTemplateField` already inverts at read time).
 *
 * Money and date parsing are re-exported from `zones.ts` so the mapping UI,
 * the template pipeline, and the sanity checks share one implementation.
 */
import {
  type AnchorSpec,
  type Invoice,
  type LineItem,
  type LineItemsSpec,
  type LearnPayload,
  type OcrWord,
  type Zone,
  type ZoneField,
  CURRENCY_OPTIONS,
  money,
  ZONE_FIELDS,
  ZONE_LABEL,
} from "./types";
import { moneyToNumber, parseDateParts } from "./zones";

export { moneyToNumber, parseDateParts };

// ---------------------------------------------------------------------------
// Geometry: boxes, hit-testing, anchors
// ---------------------------------------------------------------------------

/** Padding applied around a suggested value region, normalized units. */
const REGION_PAD = 0.012;
/** Smallest zone dimension worth keeping, normalized units. */
const MIN_ZONE_SIZE = 0.005;
/** Click tolerance in "word units" — generous enough for fat-finger clicks. */
const CLICK_TOLERANCE_WORD_UNITS = 8;
/** Smallest anchor-candidate word length (letters/digits only). */
const MIN_ANCHOR_WORD_LENGTH = 3;
/** Score penalty per unit of distance when choosing an anchor word. */
const ANCHOR_DISTANCE_PENALTY = 2;
/** Maximum line items parsed from one region. */
const MAX_LINE_ITEM_ROWS = 40;
/** Row pitch above which two words are considered different table rows. */
const ROW_BREAK_FACTOR = 1.2;
/** Fallback row height for hit-testing, normalized units. */
const FALLBACK_ROW_HEIGHT = 0.012;
/** Line items whose sum-vs-total difference is within this count as matching. */
export const SUM_MATCH_TOLERANCE = 0.02;
/** Padding fractions defining the page quadrants used in human summaries. */
const QUADRANT = { left: 0.4, right: 0.6, top: 0.25, bottom: 0.75 } as const;
/** Longest description kept per parsed line item (matches pipeline limits). */
const MAX_DESCRIPTION_LENGTH = 80;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
/** Rounds normalized coordinates to 4 decimals to keep stored zones compact. */
const round4 = (value: number) => Math.round(value * 10000) / 10000;

/** Merges per-word boxes into one bounding rectangle (with optional padding). */
export function unionBox(words: OcrWord[], pad = 0): Zone {
  if (words.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const w of words) {
    left = Math.min(left, w.x);
    top = Math.min(top, w.y);
    right = Math.max(right, w.x + w.w);
    bottom = Math.max(bottom, w.y + w.h);
  }
  left = clamp01(left - pad);
  top = clamp01(top - pad);
  right = clamp01(right + pad);
  bottom = clamp01(bottom + pad);
  return {
    x: round4(left),
    y: round4(top),
    w: round4(Math.max(MIN_ZONE_SIZE, right - left)),
    h: round4(Math.max(MIN_ZONE_SIZE, bottom - top)),
  };
}

const centerOf = (zone: Zone) => ({
  cx: zone.x + zone.w / 2,
  cy: zone.y + zone.h / 2,
});

/**
 * Finds the OCR word closest to a click (x, y normalized 0..1). Distance is
 * measured in word-size units so small labels compete fairly with headings.
 * undefined when the nearest word is beyond the click tolerance.
 */
export function wordAtPoint(words: OcrWord[], x: number, y: number): OcrWord | undefined {
  let nearest: { word: OcrWord; distance: number } | undefined;
  for (const w of words) {
    const { cx, cy } = centerOf(w);
    const dx = Math.abs(x - cx) / Math.max(w.w, MIN_ZONE_SIZE);
    const dy = Math.abs(y - cy) / Math.max(w.h, MIN_ZONE_SIZE);
    const distance = Math.hypot(dx, dy);
    if (nearest === undefined || distance < nearest.distance) nearest = { word: w, distance };
  }
  return nearest && nearest.distance <= CLICK_TOLERANCE_WORD_UNITS ? nearest.word : undefined;
}

/** Collects words whose centers fall inside a normalized rectangle. */
export function wordsInRect(words: OcrWord[], rect: Zone): OcrWord[] {
  return words.filter((w) => {
    const { cx, cy } = centerOf(w);
    return cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
  });
}

// ---------------------------------------------------------------------------
// Anchor proposal and spec building
// ---------------------------------------------------------------------------

/**
 * Pure filler words that never make sense as an anchor label. Field labels
 * like "Total", "Datum" or "BTW" are deliberately NOT excluded — they are
 * exactly the anchors that make templates robust (see the design doc's
 * `anchor: "Total" ✓` chip).
 */
const ANCHOR_STOPWORDS = new Set(["aan", "to", "van", "from", "en", "and", "the", "a", "€", "$"]);

const lettersAndDigits = (text: string) => text.replace(/[^\p{L}\p{N}]+/gu, "");

const isNumericWord = (text: string) => /^\d/.test(lettersAndDigits(text));

/**
 * Proposes an anchor label for a value region: the most plausible label word
 * to the left of, or directly above, the region. Anchors are what make
 * templates survive small layout drift — hence the "anchor: 'Total' ✓" chip.
 */
export function proposeAnchor(words: OcrWord[], region: Zone): string | undefined {
  const { cx, cy } = centerOf(region);
  let best: { text: string; score: number } | undefined;
  for (const w of words) {
    if (!isPlausibleAnchorCandidate(w, region, cx)) continue;
    const candidate = lettersAndDigits(w.text);
    if (candidate.length < MIN_ANCHOR_WORD_LENGTH) continue;
    if (ANCHOR_STOPWORDS.has(w.text.toLowerCase())) continue;
    if (isNumericWord(w.text)) continue;
    const { cx: wordCx, cy: wordCy } = centerOf(w);
    const distance = Math.hypot(cx - wordCx, cy - wordCy);
    const score = candidate.length - distance * ANCHOR_DISTANCE_PENALTY;
    if (best === undefined || score > best.score) best = { text: w.text, score };
  }
  return best?.text;
}

/** Left-and-overlapping, or directly above the region within a few line heights. */
function isPlausibleAnchorCandidate(w: OcrWord, region: Zone, regionCx: number): boolean {
  const { cx, cy } = centerOf(w);
  const overlapsVertically = cy >= region.y - w.h && cy <= region.y + region.h;
  const isLeftOfRegion = cx < regionCx && overlapsVertically;
  const isDirectlyAbove =
    Math.abs(cx - regionCx) < region.w && cy < region.y && region.y - cy < w.h * 3;
  return isLeftOfRegion || isDirectlyAbove;
}

/** Field type implied by the field name — drives AnchorSpec normalization. */
function specTypeFor(field: ZoneField): AnchorSpec["type"] {
  if (field === "issueDate" || field === "dueDate") return "date";
  if (field === "subtotal" || field === "tax" || field === "total") return "decimal";
  return "string";
}

/** Fallback dimension when an anchor word has degenerate size. */
const FALLBACK_ANCHOR_SIZE = 0.05;

/**
 * Builds the AnchorSpec for a field from a raw zone + anchor label. The
 * anchor word is located on the page; the region is re-expressed relative to
 * it. Without an anchor, the spec keeps page-absolute coordinates (round-
 * tripped by `specToZone`'s anchor-less branch).
 */
export function buildAnchorSpec(
  words: OcrWord[],
  field: ZoneField,
  zone: Zone,
  anchorText: string | undefined,
): AnchorSpec {
  const type = specTypeFor(field);
  if (!anchorText) {
    return {
      anchor: "",
      region: {
        x0: round4(zone.x),
        y0: round4(zone.y),
        x1: round4(zone.x + zone.w),
        y1: round4(zone.y + zone.h),
      },
      type,
    };
  }
  const anchor = locateAnchorWord(words, anchorText, zone) ?? nearestAnchorWord(words, anchorText);
  if (!anchor) {
    return {
      anchor: "",
      region: {
        x0: round4(zone.x),
        y0: round4(zone.y),
        x1: round4(zone.x + zone.w),
        y1: round4(zone.y + zone.h),
      },
      type,
    };
  }
  const anchorWidth = anchor.w || FALLBACK_ANCHOR_SIZE;
  const anchorHeight = anchor.h || FALLBACK_ANCHOR_SIZE;
  return {
    anchor: anchor.text,
    region: {
      x0: round4((zone.x - anchor.x) / anchorWidth),
      y0: round4((zone.y - anchor.y) / anchorHeight),
      x1: round4((zone.x + zone.w - anchor.x) / anchorWidth),
      y1: round4((zone.y + zone.h - anchor.y) / anchorHeight),
    },
    type,
  };
}

/** Prefers the anchor candidate nearest the value zone's top-left corner. */
function locateAnchorWord(words: OcrWord[], anchorText: string, zone: Zone): OcrWord | undefined {
  const candidates = words.filter((w) => w.text.toLowerCase().includes(anchorText.toLowerCase()));
  if (candidates.length === 0) return undefined;
  return wordAtPoint(candidates, clamp01(zone.x), clamp01(zone.y));
}

function nearestAnchorWord(words: OcrWord[], anchorText: string): OcrWord | undefined {
  const needle = lettersAndDigits(anchorText).toLowerCase();
  if (!needle) return undefined;
  let best: OcrWord | undefined;
  for (const w of words) {
    const haystack = lettersAndDigits(w.text).toLowerCase();
    if (haystack.includes(needle) && (best === undefined || w.y < best.y)) best = w;
  }
  return best;
}

/** Re-inflates an AnchorSpec back to a page-absolute Zone for overlay display. */
export function specToZone(spec: AnchorSpec, words: OcrWord[]): Zone {
  if (!spec.anchor) {
    return {
      x: round4(clamp01(spec.region.x0)),
      y: round4(clamp01(spec.region.y0)),
      w: round4(clamp01(spec.region.x1 - spec.region.x0)),
      h: round4(clamp01(spec.region.y1 - spec.region.y0)),
    };
  }
  const anchor = nearestAnchorWord(words, spec.anchor) ?? firstWordTopLeft(words);
  if (!anchor) return { x: 0, y: 0, w: 0, h: 0 };
  const anchorWidth = anchor.w || FALLBACK_ANCHOR_SIZE;
  const anchorHeight = anchor.h || FALLBACK_ANCHOR_SIZE;
  const left = clamp01(anchor.x + spec.region.x0 * anchorWidth);
  const top = clamp01(anchor.y + spec.region.y0 * anchorHeight);
  const right = clamp01(anchor.x + spec.region.x1 * anchorWidth);
  const bottom = clamp01(anchor.y + spec.region.y1 * anchorHeight);
  return {
    x: round4(left),
    y: round4(top),
    w: round4(Math.max(MIN_ZONE_SIZE, right - left)),
    h: round4(Math.max(MIN_ZONE_SIZE, bottom - top)),
  };
}

/** Last-resort anchor stand-in: the page's first word, reading order. */
function firstWordTopLeft(words: OcrWord[]): OcrWord | undefined {
  return [...words].sort((a, b) => a.y - b.y || a.x - b.x)[0];
}

// ---------------------------------------------------------------------------
// Suggestions and triage
// ---------------------------------------------------------------------------

/** Words of the first cached page (the mapping screen maps page 1 first). */
export function firstPageWords(invoice: Invoice): OcrWord[] | undefined {
  const page = invoice.learnPayload?.pages[0];
  if (!page) return undefined;
  return page.words.map((w) => ({ ...w }));
}

const valueTokens = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.,€$]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1);

/**
 * Suggests a zone for a field from the cached words, without any user
 * drawing: finds the OCR words making up the invoice's current value and
 * unions their boxes. Powers field→source highlighting before anything is
 * mapped manually.
 */
export function suggestZone(invoice: Invoice, field: ZoneField): Zone | undefined {
  const words = firstPageWords(invoice);
  if (!words || words.length === 0) return undefined;
  const value = fieldValue(invoice, field);
  if (value === undefined || value === "") return undefined;
  const tokens = valueTokens(String(value));
  if (tokens.length === 0) return undefined;
  const matches = words.filter((w) => {
    const haystack = w.text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}.,€$]+/gu, " ")
      .trim();
    return tokens.some((token) => haystack.includes(token) || token.includes(haystack));
  });
  if (matches.length === 0) return undefined;
  return unionBox(matches, REGION_PAD);
}

function fieldValue(invoice: Invoice, field: ZoneField): string | number | undefined {
  switch (field) {
    case "vendor":
      return invoice.vendor;
    case "invoiceNumber":
      return invoice.invoiceNumber;
    case "issueDate":
      return invoice.issueDate;
    case "dueDate":
      return invoice.dueDate;
    case "subtotal":
      return invoice.subtotal;
    case "tax":
      return invoice.tax;
    case "total":
      return invoice.total;
    default:
      return undefined;
  }
}

export type FieldStatus = "amber" | "green";

/**
 * Triage per the design doc: greens need a glance, ambers are the work.
 * Derived values, failed sanity checks, and empty values need a person's look.
 */
export function fieldStatus(
  invoice: Invoice,
  field: ZoneField,
  opts?: { zoneCheckMatch?: boolean | undefined },
): FieldStatus {
  // A human correction is the resolution of the original read. Keep the old
  // zone-check result for audit/history, but do not keep the field amber after
  // the reviewer has explicitly replaced it.
  if (invoice.provenance?.[field] === "manual") return "green";
  if (opts?.zoneCheckMatch === false) return "amber";
  const value = fieldValue(invoice, field);
  if (value === "" || value === 0) return "amber";
  if (invoice.provenance?.[field] === "derived") return "amber";
  return "green";
}

/** Fields the DraftMapper maps, in triage display order (ambers first). */
export function orderedFields(
  invoice: Invoice,
  statuses: Record<ZoneField, FieldStatus>,
): ZoneField[] {
  return [...ZONE_FIELDS].sort((a, b) => {
    const amberA = statuses[a] === "amber" ? 0 : 1;
    const amberB = statuses[b] === "amber" ? 0 : 1;
    if (amberA !== amberB) return amberA - amberB;
    return ZONE_FIELDS.indexOf(a) - ZONE_FIELDS.indexOf(b);
  });
}

// ---------------------------------------------------------------------------
// Cross-checks and human summaries
// ---------------------------------------------------------------------------

/** Sums line-item amounts, rounded to cents. */
export function lineItemsSum(items: LineItem[]): number {
  return Number(items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));
}

export type TotalsCrossCheck = {
  ok: boolean;
  /** Sum of line-item amounts, rounded to cents. */
  sum: number;
  /** What the lines were compared against (subtotal when present, else total). */
  expected: number;
  /** Which header the lines matched: gross total, net subtotal, or neither. */
  mode: "total" | "subtotal" | "none";
  /** Lines match subtotal-or-total within tolerance. */
  linesOk: boolean;
  /** subtotal + tax ties to total (vacuous when neither header present). */
  totalsOk: boolean;
  /** Human-readable one-liner for queue items and the draft screen. */
  detail: string;
  /**
   * `detail` without its trailing instruction. The compare row states this
   * fact; the lines editor below it is the control that says what to check.
   */
  fact: string;
};

export function totalsCrossCheck(invoice: Invoice): TotalsCrossCheck {
  const sum = lineItemsSum(invoice.lineItems);
  const subtotal = invoice.subtotal ?? 0;
  const tax = invoice.tax ?? 0;
  const total = invoice.total ?? 0;
  if (!invoice.lineItems.length || total === 0) {
    return {
      ok: true,
      sum,
      expected: total,
      mode: "none",
      linesOk: true,
      totalsOk: true,
      detail: "",
      fact: "",
    };
  }
  const matchesTotal = Math.abs(sum - total) <= SUM_MATCH_TOLERANCE;
  const matchesSubtotal = subtotal > 0 && Math.abs(sum - subtotal) <= SUM_MATCH_TOLERANCE;
  const linesOk = matchesTotal || matchesSubtotal;
  const hasHeaders = subtotal > 0 || tax > 0;
  const totalsOk = !hasHeaders || Math.abs(subtotal + tax - total) <= SUM_MATCH_TOLERANCE;
  const ok = linesOk && totalsOk;
  const mode = matchesSubtotal ? "subtotal" : matchesTotal ? "total" : "none";
  const expected = subtotal > 0 ? subtotal : total;
  const parts = crossCheckParts(invoice, { sum, linesOk, totalsOk, mode });
  return {
    ok,
    sum,
    expected,
    mode,
    linesOk,
    totalsOk,
    detail: parts.hint ? `${parts.fact} ${parts.hint}` : parts.fact,
    fact: parts.fact,
  };
}

/**
 * Accurate message for the current totals state — tax-aware, no freight red
 * herring. The fact is the gap itself; the hint is the instruction, kept for
 * the screens whose controls act on it (queue items, the draft screen, the
 * lines editor).
 */
function crossCheckParts(
  invoice: Invoice,
  state: { sum: number; linesOk: boolean; totalsOk: boolean; mode: "total" | "subtotal" | "none" },
): { fact: string; hint?: string } {
  const { currency, subtotal, tax, total } = invoice;
  if (state.linesOk && state.totalsOk) {
    if (state.mode === "subtotal" && (subtotal > 0 || tax > 0)) {
      return {
        fact: `Lines ${money(state.sum, currency)} = subtotal · + ${money(tax, currency)} tax = ${money(total, currency)} total ✓`,
      };
    }
    return { fact: `Line items sum to ${money(state.sum, currency)} — matches the total ✓` };
  }
  if (!state.linesOk) {
    if (subtotal > 0) {
      return {
        fact: `Line items total ${money(state.sum, currency)}, but the subtotal is ${money(subtotal, currency)} (total ${money(total, currency)}).`,
        hint: "Check for a missing freight or discount line.",
      };
    }
    return {
      fact: `Line items total ${money(state.sum, currency)}, but the invoice total is ${money(total, currency)}.`,
      hint: "Check for a missing line.",
    };
  }
  return {
    fact: `Lines match the subtotal ${money(subtotal, currency)}, but subtotal + tax (${money(subtotal + tax, currency)}) does not equal the total ${money(total, currency)}.`,
    hint: "Check the tax.",
  };
}

export type InvoiceValidationIssue = {
  code:
    | "missing_vendor"
    | "missing_invoice_number"
    | "missing_issue_date"
    | "invalid_issue_date"
    | "missing_due_date"
    | "invalid_due_date"
    | "missing_currency"
    | "invalid_currency"
    | "missing_total"
    | "invalid_total"
    | "missing_coding"
    | "line_total_mismatch";
  severity: "error" | "warning";
  message: string;
};

/** Hard gates for the draft confirmation action. Keep this pure so the UI and
 * lifecycle write path can enforce the same minimum trust contract. */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Validation scope: Draft confirms header/vendor only (lines warn), while
 *  approval owns content checking (lines mismatch blocks). */
export type ValidationScope = "confirm" | "approve";

export function validateInvoiceForConfirmation(
  invoice: Invoice,
  scope: ValidationScope = "confirm",
): InvoiceValidationIssue[] {
  const issues: InvoiceValidationIssue[] = [];
  if (!invoice.vendor.trim()) {
    issues.push({ code: "missing_vendor", severity: "error", message: "Vendor is required." });
  }
  if (!invoice.invoiceNumber.trim()) {
    issues.push({
      code: "missing_invoice_number",
      severity: "error",
      message: "Invoice number is required.",
    });
  }
  if (!invoice.issueDate.trim()) {
    issues.push({
      code: "missing_issue_date",
      severity: "error",
      message: "Invoice date is required.",
    });
  } else if (!isValidIsoDate(invoice.issueDate)) {
    issues.push({
      code: "invalid_issue_date",
      severity: "error",
      message: "Use a valid invoice date.",
    });
  }
  if (!invoice.dueDate.trim()) {
    issues.push({
      code: "missing_due_date",
      severity: "error",
      message: "Due date is required.",
    });
  } else if (!isValidIsoDate(invoice.dueDate)) {
    issues.push({
      code: "invalid_due_date",
      severity: "error",
      message: "Use a valid due date.",
    });
  }
  if (!invoice.currency.trim()) {
    issues.push({
      code: "missing_currency",
      severity: "error",
      message: "Choose a currency.",
    });
  } else if (!CURRENCY_OPTIONS.some(({ code }) => code === invoice.currency)) {
    issues.push({
      code: "invalid_currency",
      severity: "error",
      message: "Choose a supported currency from the list.",
    });
  }
  if (!Number.isFinite(invoice.total) || invoice.total <= 0) {
    issues.push({
      code: Number.isFinite(invoice.total) ? "missing_total" : "invalid_total",
      severity: "error",
      message: "Enter a valid invoice total.",
    });
  }
  if (!invoice.glAccount.trim() && !invoice.department.trim()) {
    issues.push({
      code: "missing_coding",
      severity: "error",
      message: "Choose a GL account or department.",
    });
  }
  const crossCheck = totalsCrossCheck(invoice);
  if (invoice.lineItems.length > 0 && invoice.total > 0 && !crossCheck.ok) {
    issues.push({
      code: "line_total_mismatch",
      // Draft can't edit lines anymore — flag for approval instead of blocking.
      severity: scope === "approve" ? "error" : "warning",
      message: crossCheck.detail,
    });
  }
  return issues;
}

const horizontalQuadrant = (cx: number) =>
  cx < QUADRANT.left ? "left" : cx > QUADRANT.right ? "right" : "middle";

const verticalQuadrant = (cy: number) => {
  if (cy < QUADRANT.top) return "top";
  if (cy > QUADRANT.bottom) return "bottom";
  return cy < 0.5 ? "upper" : "lower";
};

/** "top-right"-style location for the human-language summaries. */
function quadrantOf(zone: Zone): string {
  const { cx, cy } = centerOf(zone);
  return `${verticalQuadrant(cy)}-${horizontalQuadrant(cx)}`;
}

/**
 * One human-readable line per mapped field for the confirmation summary:
 * "Invoice # — will look for text near 'Factuurnummer' in the top-right".
 */
export function describeMapping(
  field: ZoneField,
  spec: AnchorSpec,
  zone: Zone | undefined,
): string {
  const label = ZONE_LABEL[field];
  if (!spec.anchor) {
    const where = zone ? quadrantOf(zone) : "saved";
    return `${label} — will read the value at its ${where} position`;
  }
  const where = zone ? quadrantOf(zone) : "top-right";
  return `${label} — will look for text near “${spec.anchor}” in the ${where}`;
}

// ---------------------------------------------------------------------------
// Line-item parsing
// ---------------------------------------------------------------------------

/** Band columns in spec coordinates projected onto the page. */
function bandZoneOf(spec: LineItemsSpec, column: LineItemsSpec["columns"][number]): Zone {
  const regionWidth = spec.region.x1 - spec.region.x0;
  const regionHeight = spec.region.y1 - spec.region.y0;
  return {
    x: spec.region.x0 + column.band.x0 * regionWidth,
    y: spec.region.y0 + column.band.y0 * regionHeight,
    w: (column.band.x1 - column.band.x0) * regionWidth,
    h: (column.band.y1 - column.band.y0) * regionHeight,
  };
}

/** Splits region words into visual rows, optionally dropping total-ish rows. */
function groupRows(words: OcrWord[], excludeTotalRows: boolean): OcrWord[][] {
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: OcrWord[][] = [];
  let current: OcrWord[] = [];
  let rowTop: number | undefined;
  for (const w of sorted) {
    const breaksRow =
      rowTop !== undefined &&
      Math.abs(w.y - rowTop) > Math.max(w.h, FALLBACK_ROW_HEIGHT) * ROW_BREAK_FACTOR;
    if (breaksRow) {
      rows.push(current);
      current = [];
      rowTop = undefined;
    }
    rowTop ??= w.y;
    current.push(w);
  }
  if (current.length) rows.push(current);
  if (!excludeTotalRows) return rows;
  return rows.filter((row) => {
    const text = row
      .map((w) => w.text)
      .join(" ")
      .toLowerCase();
    return !/(sub\s*total|subtotaal|total|totaal|btw|vat|tax|balance|saldo)/.test(text);
  });
}

const parseQuantity = (raw: string | undefined): number | undefined => {
  if (!raw) return undefined;
  const match = raw.match(/\d{1,4}(?:[.,]\d{1,3})?/);
  if (!match) return undefined;
  const quantity = Number(match[0]!.replace(",", "."));
  return Number.isFinite(quantity) ? quantity : undefined;
};

/** Effective unit price: parsed, else amount ÷ quantity. */
const unitPriceOf = (raw: string | undefined, amount: number, quantity: number): number => {
  const parsed = raw ? moneyToNumber(raw) : undefined;
  if (parsed !== undefined) return parsed;
  return quantity > 0 ? amount / quantity : amount;
};

/**
 * Parses line-item rows out of a LineItemsSpec region using the cached words.
 * Column bands are horizontal slices of the region; a row is a vertical run
 * of words sharing a baseline band. Rows lacking a description or an amount
 * are skipped; Subtotal/Tax/Total rows can be excluded.
 */
export function parseLineItemRows(words: OcrWord[], spec: LineItemsSpec): LineItem[] {
  const region: Zone = {
    x: spec.region.x0,
    y: spec.region.y0,
    w: Math.max(MIN_ZONE_SIZE, spec.region.x1 - spec.region.x0),
    h: Math.max(MIN_ZONE_SIZE, spec.region.y1 - spec.region.y0),
  };
  const regionWords = wordsInRect(words, region);
  const rows = groupRows(regionWords, spec.excludeTotalRows ?? true);
  const items: LineItem[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const item = parseRowIntoLineItem(rowIndex, row, spec);
    if (!item) continue;
    items.push(item);
    if (items.length >= MAX_LINE_ITEM_ROWS) break;
  }
  return items;
}

/** Reads one visual row through the column bands; undefined when unusable. */
function parseRowIntoLineItem(
  rowIndex: number,
  row: OcrWord[],
  spec: LineItemsSpec,
): LineItem | undefined {
  const values: Partial<Record<"description" | "quantity" | "unitPrice" | "amount", string>> = {};
  for (const column of spec.columns) {
    if (column.field === "ignore") continue;
    const band = bandZoneOf(spec, column);
    const inBand = row.filter((w) => {
      const { cx, cy } = centerOf(w);
      return cx >= band.x && cx <= band.x + band.w && cy >= band.y && cy <= band.y + band.h;
    });
    if (inBand.length === 0) continue;
    inBand.sort((a, b) => a.x - b.x);
    values[column.field] = inBand.map((w) => w.text).join(" ");
  }
  const description = (values.description ?? "").trim();
  const amount = values.amount ? moneyToNumber(values.amount) : undefined;
  if (!description || amount === undefined) return undefined;
  const quantity = parseQuantity(values.quantity) ?? 1;
  return {
    id: `li-row-${rowIndex}`,
    description: description.slice(0, MAX_DESCRIPTION_LENGTH),
    quantity,
    unitPrice: Number(unitPriceOf(values.unitPrice, amount, quantity).toFixed(2)),
    amount,
    glAccount: "",
    department: "",
  };
}
