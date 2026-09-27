/**
 * Template apply: given a matched VendorTemplate and the OCR words for a page,
 * extract one field. The algorithm is exactly the doc's "match anchor text,
 * read the region, apply the regex":
 *
 * 1. Find the anchor word (or its nearest fuzzy match) on the page.
 * 2. Translate the region (which is stored relative to the page) to a rect
 *    around the anchor text.
 * 3. Collect all OCR words inside that rect.
 * 4. Concatenate, optionally apply the regex, normalize to the field type.
 */
import type { AnchorSpec, OcrWord, ZoneField } from "./types";
import { moneyToNumber, parseDateParts } from "./zones";

function nearestWord(words: OcrWord[], anchorText: string): OcrWord | undefined {
  if (!anchorText || anchorText.trim().length === 0) return undefined;
  const needle = anchorText.trim().toLowerCase();

  // 1. Exact match.
  for (const w of words) {
    if (w.text.trim().toLowerCase() === needle) return w;
  }
  // 2. Substring match.
  for (const w of words) {
    const wt = w.text.trim().toLowerCase();
    if (wt.includes(needle) || needle.includes(wt)) return w;
  }
  // 3. Levenshtein fuzzy match.
  let best: { word: OcrWord; dist: number } | undefined;
  for (const w of words) {
    const wt = w.text.trim().toLowerCase();
    if (wt.length === 0) continue;
    const d = levenshtein(needle, wt);
    if (d <= 2 && (!best || d < best.dist)) best = { word: w, dist: d };
  }
  return best?.word;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );
  // Every index below is inside the grid just allocated — the `!`s are that
  // claim, not a hope.
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    const row = dp[i]!;
    const prev = dp[i - 1]!;
    for (let j = 1; j <= n; j++) {
      row[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]!
          : 1 + Math.min(prev[j]!, row[j - 1]!, prev[j - 1]!);
    }
  }
  return dp[m]![n]!;
}

export type ApplyResult = { value: string | number; confidence: number } | undefined;

/** Reads a single field off a page using a stored anchor. */
export function applyTemplateField(
  words: OcrWord[],
  spec: AnchorSpec,
  type: ZoneField | undefined,
): ApplyResult {
  if (!spec?.anchor) return undefined;
  const anchor = nearestWord(words, spec.anchor);
  if (!anchor) return undefined;
  // Region is in anchor-relative coordinates: the anchor's left is x0, top is y0.
  const ax = anchor.x;
  const ay = anchor.y;
  const aw = anchor.w;
  const ah = anchor.h;
  const x0 = clamp01(ax + spec.region.x0 * aw);
  const y0 = clamp01(ay + spec.region.y0 * ah);
  const x1 = clamp01(ax + spec.region.x1 * aw);
  const y1 = clamp01(ay + spec.region.y1 * ah);
  if (x1 <= x0 || y1 <= y0) return undefined;
  let inside = words.filter(
    (w) => w.x + w.w / 2 >= x0 && w.x + w.w / 2 <= x1 && w.y + w.h / 2 >= y0 && w.y + w.h / 2 <= y1,
  );
  // Fallback: if the region is empty, search for the nearest value word
  // below the anchor within a generous drift range. This handles layout
  // shifts where values move relative to their anchor between invoices.
  if (inside.length === 0) {
    const driftY = 0.08; // allow up to 8% of page height drift
    const fallbackY1 = clamp01(ay + ah + driftY);
    // Search in a narrow horizontal band near the anchor's right side
    // (where values typically sit on Dutch invoices).
    const fallbackX0 = clamp01(ax + aw * 0.5);
    const fallbackX1 = clamp01(ax + aw + 0.4);
    inside = words
      .filter(
        (w) =>
          w.y + w.h / 2 >= ay + ah * 0.3 &&
          w.y + w.h / 2 <= fallbackY1 &&
          w.x + w.w / 2 >= fallbackX0 &&
          w.x + w.w / 2 <= fallbackX1 &&
          w !== anchor,
      )
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .slice(0, 3);
    if (inside.length === 0) return undefined;
  }
  // Sort left-to-right, top-to-bottom.
  inside.sort((a, b) => (a.y - b.y) * 4 + (a.x - b.x));
  const raw = inside
    .map((w) => w.text)
    .join(" ")
    .replace(/\\s+/g, " ")
    .trim();
  if (!raw) return undefined;
  // Apply optional regex.
  let text = raw;
  if (spec.regex) {
    try {
      const re = new RegExp(spec.regex, "i");
      const m = raw.match(re);
      if (m?.[0]) text = m[0];
    } catch {
      /* malformed regex stored — fall through with raw */
    }
  }
  // Normalize by field type.
  const fieldType: "string" | "number" | "decimal" | "date" =
    spec.type ?? (type ? inferType(type) : "string");
  const value = normalize(text, fieldType);
  if (value === undefined) return undefined;
  // Confidence is the geometric mean of word confidences — anchor gets a small
  // boost because we already committed to a template match.
  const wordConf = geometricMean(inside.map((w) => w.confidence));
  const anchorConf = anchor.confidence;
  const conf = Math.min(0.99, (wordConf * 0.7 + anchorConf * 0.3) * 0.97);
  return { value, confidence: Number(conf.toFixed(2)) };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function inferType(field: ZoneField): "string" | "number" | "decimal" | "date" {
  if (field === "subtotal" || field === "tax" || field === "total") return "decimal";
  if (field === "issueDate" || field === "dueDate") return "date";
  return "string";
}

function geometricMean(values: number[]): number {
  if (values.length === 0) return 0.5;
  let logSum = 0;
  for (const v of values) logSum += Math.log(Math.max(0.01, v));
  return Math.exp(logSum / values.length);
}

function normalize(
  text: string,
  type: "string" | "number" | "decimal" | "date",
): string | number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (type === "number" || type === "decimal") {
    // Strip trailing non-numeric noise that the zone may have captured
    // alongside the value (e.g. a decoy "21%" or text like "incl. btw").
    // Find the last numeric token (with optional decimal part) and discard the rest.
    const numMatch = trimmed.match(/([-]?\\d[\\d.,]*\\d|[-]?\\d)(?:[^\\d]|$)/);
    const cleaned = numMatch ? numMatch[0].replace(/[^\\d.,\\-]/g, "").replace(/[,.$]+$/, "") : trimmed;
    const n = moneyToNumber(cleaned || trimmed);
    return n !== undefined ? Number(n.toFixed(2)) : undefined;
  }
  if (type === "date") {
    const parts = parseDateParts(trimmed);
    if (!parts) return undefined;
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }
  return trimmed;
}
