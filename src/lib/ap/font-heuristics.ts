/**
 * Font-based heuristics for the PDF text layer.
 *
 * Two freebies from PDF.js we were not using:
 *
 *  1. Vendor identity — the largest text in the top block is, on real invoices,
 *     almost always the seller's name (headers dominate; body is 9–10pt; footers
 *     are 8–9pt). Use the y-clustered top block + font size, not proximity regex.
 *  2. Total detection — totals are frequently bold on NL invoices. A bold,
 *     right-anchored amount on the last text line is a strong total candidate
 *     before we touch regex.
 *
 * These are heuristics, not extraction — they rank candidates or boost
 * confidence. The existing regex readers (extractFieldsFromPages) stay as the
 * primary text-layer reader; these heuristics feed candidate selection and the
 * stage label, and they are what makes the long tail of unknown vendors parse
 * cleanly even before any VLM.
 */
import type { TextLayerWord } from "./text-layer-layout";
import { clusterWordsToLines } from "./text-layer-layout";
import type { OcrWord } from "./types";

/** A candidate value with a confidence boost from a font heuristic. */
export type FontHeuristicHit = {
  value: string;
  page: number;
  confidence: number;
  reason: "largest-top-block" | "bold-amount" | "labelled-amount";
};

/**
 * Returns the vendor name candidate from the top block of text-layer words,
 * using font size as the primary signal.
 *
 * On real NL invoices the vendor name is the largest text in the top ~18% of
 * the page. We y-cluster, take the top block, and pick the line whose mean font
 * size is highest — falling back to the longest line when sizes are equal.
 *
 * Own-business filtering is applied here so the heuristic does not return the
 * customer's name when the layout is inverted (bill-to on top).
 */
export function vendorFromFont(
  words: Array<TextLayerWord | OcrWord>,
  pageNumber = 1,
  ownBusinessName?: string,
): FontHeuristicHit | undefined {
  const withY = words.filter((w) => typeof w.x === "number" && typeof w.y === "number" && w.text.trim());
  if (withY.length === 0) return undefined;

  // Normalise to TextLayerWord so we can read fontSize; fall back to 10 when
  // the word came from OCR or from a text layer without font metadata.
  const typed = withY.map((w) => ({
    ...w,
    fontSize: ("fontSize" in w && w.fontSize) ?? 10,
    isBold: ("isBold" in w && w.isBold) ?? false,
    h: (w as TextLayerWord).h ?? 0.02,
  }));

  const lines = clusterWordsToLines(typed, 842);
  if (lines.length === 0) return undefined;

  // Top block = first 18% of lines by y. Most invoices put the header there.
  const blockCut = Math.max(1, Math.round(lines.length * 0.18));
  const topBlock = lines.slice(0, blockCut);

  // Pick the line with the highest mean font size; tie-break on length.
  let bestLine: typeof topBlock[0] | undefined;
  let bestMean = 0;
  let bestLength = 0;
  for (const line of topBlock) {
    const mean =
      line.reduce((s, w) => s + (w.fontSize ?? 10), 0) / line.length;
    const text = line.map((w) => w.text).join(" ").trim();
    if (
      mean > bestMean ||
      (mean === bestMean && text.length > bestLength)
    ) {
      bestMean = mean;
      bestLength = text.length;
      bestLine = line;
    }
  }
  if (!bestLine) return undefined;

  const candidate = bestLine.map((w) => w.text).join(" ").trim();
  if (candidate.length < 3) return undefined;

  // Filter own business.
  if (ownBusinessName && candidate.toLowerCase().includes(ownBusinessName.toLowerCase().slice(0, 6))) {
    // Try the next-best line in the top block.
    for (const line of topBlock) {
      const text = line.map((w) => w.text).join(" ").trim();
      if (text !== candidate && text.length >= 3) {
        return {
          value: text,
          page: pageNumber,
          confidence: 0.85,
          reason: "largest-top-block",
        };
      }
    }
    return undefined;
  }

  return {
    value: candidate,
    page: pageNumber,
    confidence: Math.min(0.95, 0.75 + Math.min(bestMean / 30, 0.2)),
    reason: "largest-top-block",
  };
}

/** Regular-expression money pattern reused by the bold-amount heuristic. */
const MONEY_RE = /\b\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|\d+,\d{1,2}(?!\d)|\b\d+\.\d{2}\b/g;

/**
 * Finds a bold amount candidate on the page — a strong total-signal before
 * regex ranking.
 *
 * On many NL invoices the total is bold and near the right margin. We scan the
 * last quarter of lines and prefer:
 *   1. A bold amount on a line whose text contains a total label (€ / Totaal /
 *      te betalen / amount due), OR
 *   2. The largest bold amount anywhere in the bottom quarter.
 */
export function totalFromBold(
  lines: Array<Array<TextLayerWord>>,
  pageNumber = 1,
): FontHeuristicHit | undefined {
  if (lines.length === 0) return undefined;

  const bottomQuarter = lines.slice(Math.round(lines.length * 0.75));
  if (bottomQuarter.length === 0) return undefined;

  const labelledTotalLabels = [
    "totaal te betalen",
    "totaal incl",
    "bedrag te voldoen",
    "amount due",
    "total due",
    "grand total",
    "te voldoen",
    "totaal",
  ];

  // Pass 1: bold amount on a line that also carries a total label.
  for (const line of bottomQuarter) {
    const text = line.map((w) => w.text).join(" ").trim().toLowerCase();
    const isLabelled = labelledTotalLabels.some((l) => text.includes(l));
    const amounts = text.match(MONEY_RE);
    if (!amounts) continue;
    // Prefer the rightmost bold word that looks like a number.
    const boldAmount = line
      .slice()
      .reverse()
      .find((w) => w.isBold && MONEY_RE.test(w.text));
    if (boldAmount && isLabelled) {
      return {
        value: boldAmount.text,
        page: pageNumber,
        confidence: 0.9,
        reason: "labelled-amount",
      };
    }
  }

  // Pass 2: largest bold amount in the bottom quarter (label-agnostic).
  let best: { word: TextLayerWord; value: string; score: number } | undefined;
  for (const line of bottomQuarter) {
    for (const w of line) {
      if (!w.isBold || !MONEY_RE.test(w.text)) continue;
      // Right-anchored bold amounts are more likely totals.
      const rightAnchor = w.x + w.w > 0.7 ? 1.4 : 1.0;
      const score = (w.fontSize ?? 10) * rightAnchor;
      if (!best || score > best.score) {
        best = { word: w, value: w.text, score };
      }
    }
  }
  if (!best) return undefined;
  return {
    value: best.value,
    page: pageNumber,
    confidence: 0.78,
    reason: "bold-amount",
  };
}

/**
 * Returns the lines (each an array of TextLayerWord) for the bottom quarter of
 * the page, sorted top-to-bottom. Used by the total-from-bold heuristic and by
 * the zone-check when it needs the totals region.
 */
export function bottomQuarterLines(
  words: Array<TextLayerWord | OcrWord>,
): Array<Array<TextLayerWord>> {
  const typed = words
    .filter((w) => typeof w.x === "number" && typeof w.y === "number" && w.text.trim())
    .map((w) => ({
      ...w,
      fontSize: ("fontSize" in w && w.fontSize) ?? 10,
      isBold: ("isBold" in w && w.isBold) ?? false,
      h: (w as TextLayerWord).h ?? 0.02,
    }));
  const lines = clusterWordsToLines(typed, 842);
  return lines.slice(Math.round(lines.length * 0.75));
}
