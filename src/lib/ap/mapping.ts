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
  type ExtractedField,
  type ZoneCheckResult,
  type Zone,
  type ZoneField,
  CURRENCY_OPTIONS,
  MAPPING_FIELDS,
  money,
  ZONE_FIELDS,
  ZONE_LABEL,
} from "./types";
import { moneyToNumber, parseDateParts } from "./zones";
import { normalizeIban } from "./iban";

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

/** Edge or corner being dragged during a visual mapping review. */
export type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Keeps manually resized value regions useful while staying on the page. */
export const MIN_RESIZED_ZONE_WIDTH = 0.006;
export const MIN_RESIZED_ZONE_HEIGHT = 0.004;

/** Moves the selected edge(s) by a normalized pointer delta and clamps to the page. */
export function resizeZone(
  zone: Zone,
  direction: ResizeDirection,
  deltaX: number,
  deltaY: number,
): Zone {
  let left = zone.x;
  let top = zone.y;
  let right = zone.x + zone.w;
  let bottom = zone.y + zone.h;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));

  if (direction.includes("w")) {
    left = clamp(left + deltaX, 0, Math.max(0, right - MIN_RESIZED_ZONE_WIDTH));
  }
  if (direction.includes("e")) {
    right = clamp(right + deltaX, Math.min(1, left + MIN_RESIZED_ZONE_WIDTH), 1);
  }
  if (direction.includes("n")) {
    top = clamp(top + deltaY, 0, Math.max(0, bottom - MIN_RESIZED_ZONE_HEIGHT));
  }
  if (direction.includes("s")) {
    bottom = clamp(bottom + deltaY, Math.min(1, top + MIN_RESIZED_ZONE_HEIGHT), 1);
  }

  return {
    x: round4(left),
    y: round4(top),
    w: round4(right - left),
    h: round4(bottom - top),
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
  return proposeAnchorWord(words, region)?.text;
}

function proposeAnchorWord(words: OcrWord[], region: Zone): OcrWord | undefined {
  const { cx, cy } = centerOf(region);
  let best: { word: OcrWord; score: number } | undefined;
  for (const w of words) {
    // Never a word from inside the region: a value anchored on its own text is
    // only ever right once. Next invoice the same words are somewhere else, or
    // gone, and the template would read whatever is nearest instead.
    if (isInside(w, region)) continue;
    if (!isPlausibleAnchorCandidate(w, region, cx)) continue;
    const candidate = lettersAndDigits(w.text);
    if (candidate.length < MIN_ANCHOR_WORD_LENGTH) continue;
    if (ANCHOR_STOPWORDS.has(w.text.toLowerCase())) continue;
    if (isNumericWord(w.text)) continue;
    const { cx: wordCx, cy: wordCy } = centerOf(w);
    const distance = Math.hypot(cx - wordCx, cy - wordCy);
    const score = candidate.length - distance * ANCHOR_DISTANCE_PENALTY;
    if (best === undefined || score > best.score) best = { word: w, score };
  }
  return best?.word;
}

/** True when the word's center falls inside the rectangle. */
function isInside(word: OcrWord, rect: Zone): boolean {
  const { cx, cy } = centerOf(word);
  return cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
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

export function fieldValue(invoice: Invoice, field: ZoneField): string | number | undefined {
  switch (field) {
    case "subtotal":
      return invoice.subtotal;
    case "tax":
      return invoice.tax;
    case "total":
      return invoice.total;
    default:
      // Every other mapped field is a plain string on the invoice, the vendor
      // identity ones included — they are read here exactly as they are
      // written, so mapping an IBAN and typing one take the same path.
      return invoice[field];
  }
}

/* ─── Finding a typed value on the page ─────────────────────────────── */

/**
 * A place on the page where a value was found. This is what a person types
 * their way to: the value is already right, and the only open question is
 * where it lives.
 */
export type ValueLocation = {
  zone: Zone;
  /** The words the match is made of — the box is their union. */
  words: OcrWord[];
  /** The text as printed, for someone choosing between two candidates. */
  text: string;
  /** True when the window *is* the value, false when it merely contains it. */
  exact: boolean;
};

/** How many words in a row one value may span ("Superdoos.nl B.V."). */
const MAX_VALUE_WORDS = 6;
/** Half a cent: closer than this and two amounts are the same amount. */
const MONEY_EPSILON = 0.005;
/** Longest printed form of a value we will consider a plausible match. */
const MAX_VALUE_CHARS = 64;

/** The comparison a field's value needs — the page never prints it verbatim. */
type ValueKind = "money" | "date" | "iban" | "text";

function valueKindFor(field: ZoneField): ValueKind {
  if (field === "subtotal" || field === "tax" || field === "total") return "money";
  if (field === "issueDate" || field === "dueDate") return "date";
  if (field === "iban") return "iban";
  return "text";
}

/** Lowercased, punctuation-split words — "Superdoos.nl B.V." → 3 tokens. */
function textTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/**
 * Scores a printed fragment against the value: 1 when it *is* the value,
 * 0.7 when it merely contains it, undefined when it is something else.
 *
 * Field-aware on purpose. "14-03-2026" and "2026-03-14" are the same day, and
 * "1.234,56" and "1234.56" are the same amount — a plain text search finds
 * neither, and a template learned from a failed search is a template that
 * fails on every future invoice.
 */
function scoreValueFragment(
  kind: ValueKind,
  fragment: string,
  value: string | number,
): number | undefined {
  if (kind === "money") {
    const target = typeof value === "number" ? value : moneyToNumber(value);
    const printed = moneyToNumber(fragment);
    if (target === undefined || printed === undefined) return undefined;
    return Math.abs(printed - target) < MONEY_EPSILON ? 1 : undefined;
  }
  if (kind === "date") {
    const target = parseDateParts(String(value));
    const printed = parseDateParts(fragment);
    if (!target || !printed) return undefined;
    const same =
      target.day === printed.day && target.month === printed.month && target.year === printed.year;
    return same ? 1 : undefined;
  }
  if (kind === "iban") {
    const target = normalizeIban(String(value));
    if (target.length < 5) return undefined;
    return normalizeIban(fragment) === target ? 1 : undefined;
  }
  const target = textTokens(String(value));
  const printed = textTokens(fragment);
  if (target.length === 0 || printed.length === 0) return undefined;
  if (target.length === printed.length && target.every((token, i) => token === printed[i])) {
    return 1;
  }
  for (let start = 0; start + target.length <= printed.length; start += 1) {
    const contains = target.every((token, offset) => {
      const word = printed[start + offset]!;
      if (word === token) return true;
      // A word the OCR split or joined ("B.V" vs "bv") is still the same word.
      return token.length > 3 && word.length > 3 && word.includes(token);
    });
    if (contains) return 0.7;
  }
  return undefined;
}

/** Groups words into the lines they are printed on, left to right. */
function linesOf(words: OcrWord[]): OcrWord[][] {
  const sorted = [...words].sort(
    (first, second) => first.y + first.h / 2 - (second.y + second.h / 2) || first.x - second.x,
  );
  const lines: OcrWord[][] = [];
  for (const word of sorted) {
    const line = lines[lines.length - 1];
    const last = line?.[line.length - 1];
    const sameLine =
      last !== undefined &&
      Math.abs(word.y + word.h / 2 - (last.y + last.h / 2)) <= Math.max(word.h, last.h) * 0.6;
    if (sameLine) line!.push(word);
    else lines.push([word]);
  }
  return lines;
}

/**
 * Every place on the page where this value is printed, best first.
 *
 * One match is an answer. Several is a question the person answers with one
 * click, which is the whole point: the alternative is finding that box by
 * hand, and the person is looking at the page anyway.
 */
export function locateValue(
  words: OcrWord[],
  field: ZoneField,
  value: string | number,
): ValueLocation[] {
  const printed = String(value).trim();
  if (printed === "" || printed.length > MAX_VALUE_CHARS) return [];
  const kind = valueKindFor(field);
  const found: ValueLocation[] = [];
  for (const line of linesOf(words)) {
    const onLine: ValueLocation[] = [];
    for (let start = 0; start < line.length; start += 1) {
      const maxLength = Math.min(MAX_VALUE_WORDS, line.length - start);
      for (let length = 1; length <= maxLength; length += 1) {
        const window = line.slice(start, start + length);
        const text = window.map((word) => word.text).join(" ");
        const score = scoreValueFragment(kind, text, printed);
        if (score === undefined) continue;
        onLine.push({ zone: unionBox(window, REGION_PAD), words: window, text, exact: score === 1 });
      }
    }
    found.push(...collapseOverlaps(onLine));
  }
  return found.sort(
    (first, second) =>
      Number(second.exact) - Number(first.exact) ||
      first.zone.y - second.zone.y ||
      first.zone.x - second.zone.x,
  );
}

/**
 * One entry per place, not per window. "Factuurnummer 2024-001" and "2024-001"
 * are the same occurrence read two ways.
 *
 * The tight reading wins: a window that *is* the value beats one that merely
 * contains it, so the box lands on the value and not on the label beside it.
 * Where both readings are equally good — "€ 1.234,56" either side of the
 * symbol — the wider one wins, so nothing of the value is left out.
 */
function collapseOverlaps(candidates: ValueLocation[]): ValueLocation[] {
  const byPreference = [...candidates].sort(
    (first, second) =>
      Number(second.exact) - Number(first.exact) || second.words.length - first.words.length,
  );
  const kept: ValueLocation[] = [];
  for (const location of byPreference) {
    const sharesAWord = kept.some((other) =>
      other.words.some((word) => location.words.includes(word)),
    );
    if (!sharesAWord) kept.push(location);
  }
  return kept;
}

/**
 * The template to remember for a value that was found: an anchor label and the
 * value's place relative to it, which is exactly what `applyTemplateField`
 * reads back on the next invoice.
 *
 * No label beside the value means no spec. A spec with a made-up anchor is
 * worse than none — it would read some other number on every future invoice,
 * confidently.
 */
export function specForLocation(
  words: OcrWord[],
  field: ZoneField,
  location: ValueLocation,
): AnchorSpec | undefined {
  const anchor = proposeAnchor(words, location.zone);
  if (!anchor) return undefined;
  const spec = buildAnchorSpec(words, field, location.zone, anchor);
  if (!spec.anchor) return undefined;
  return { ...spec, learnedBy: "typed" };
}

export type FieldStatus = "amber" | "green";

/**
 * Below this, a reading is worth a person's eyes. One number for the whole app:
 * the confidence chips, the worklist and the low-confidence notice must not
 * disagree about what "unsure" means.
 */
export const LOW_CONFIDENCE = 0.75;

/**
 * Triage per the design doc: greens need a glance, ambers are the work.
 * Amber when provenance is derived or manual, the sanity check disagreed, or
 * the value is empty.
 */
export function fieldStatus(
  invoice: Invoice,
  field: ZoneField,
  opts?: { zoneCheckMatch?: boolean | undefined },
): FieldStatus {
  const provenance = invoice.provenance?.[field];
  if (provenance === "derived" || provenance === "manual" || provenance === undefined) {
    return "amber";
  }
  if (opts?.zoneCheckMatch === false) return "amber";
  const value = fieldValue(invoice, field);
  if (value === "" || value === 0) return "amber";
  return "green";
}

/**
 * The zone-check result recorded for one field, when the AI reader produced
 * one. A pure query over the invoice, so triage can ask it without the UI (or a
 * component) having to hand the answer in.
 */
export function resultFor(
  results: ZoneCheckResult[] | undefined,
  field: ZoneField,
): ZoneCheckResult | undefined {
  if (!results) return undefined;
  return results.find((r) => r.field === field);
}

/**
 * Fields the DraftMapper maps, in triage display order (ambers first).
 *
 * `fields` decides the membership: the invoice fields on their own, or the
 * vendor identity fields after them when the caller is profiling a first-time
 * vendor and the whole document is one worklist.
 */
export function orderedFields(
  invoice: Invoice,
  statuses: Record<ZoneField, FieldStatus>,
  fields: readonly ZoneField[] = ZONE_FIELDS,
): ZoneField[] {
  return [...fields].sort((a, b) => {
    const amberA = statuses[a] === "amber" ? 0 : 1;
    const amberB = statuses[b] === "amber" ? 0 : 1;
    if (amberA !== amberB) return amberA - amberB;
    return fields.indexOf(a) - fields.indexOf(b);
  });
}

/** The vendor identity values, which live on the invoice beside its own. */
export const IDENTITY_FIELDS: ExtractedField[] = MAPPING_FIELDS.filter(
  (field) => !ZONE_FIELDS.includes(field),
);

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
  absent: readonly ZoneField[] = [],
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
  // A field this vendor never prints is not a mistake in the invoice, and
  // asking for it on every invoice from them is the same mistake every time.
  if (absent.length === 0) return issues;
  return issues.filter((issue) => {
    const field = ISSUE_FIELD[issue.code];
    return field === undefined || !absent.includes(field);
  });
}

/**
 * Which field each validation issue is about. Issues with no field here
 * (currency, coding, the line total) are about the invoice, not about a value
 * that could be missing from the page.
 */
export const ISSUE_FIELD: Partial<Record<InvoiceValidationIssue["code"], ZoneField>> = {
  missing_vendor: "vendor",
  missing_invoice_number: "invoiceNumber",
  missing_issue_date: "issueDate",
  invalid_issue_date: "issueDate",
  missing_due_date: "dueDate",
  invalid_due_date: "dueDate",
  missing_total: "total",
  invalid_total: "total",
};

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
