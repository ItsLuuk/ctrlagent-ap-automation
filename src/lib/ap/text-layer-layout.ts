/**
 * PDF text-layer layout reconstruction.
 *
 * getTextContent() returns items in content-stream order, not reading order.
 * That ordering is unreliable for multi-column or header-body-footer invoices.
 * This module re-derives reading order from three freebies PDF.js gives us on
 * every text item:
 *
 *  - transform[3]  → font size (height in PDF units)
 *  - FontDescriptor → font name, from which we approximate weight (bold vs
 *    regular) by name convention
 *  - item transform → pixel position (already normalised in textLayerWordsFromPage)
 *
 * We do two things here that the current code does not:
 *
 *  1. Clusters words into lines by y-proximity before anything else reads them,
 *     so "reconstruct lines from coordinates — y-cluster then x-sort" actually
 *     happens on the text layer, not only on the OCR path.
 *  2. Attaches font size + an isBold flag to each OcrWord so downstream
 *     heuristics (vendor = largest top-block text; totals = usually bold) can
 *     use typographic signals instead of proximity regex.
 *
 * The word type is extended with two optional fields. Existing consumers that
 * destructure only { text, x, y, w, h, confidence } continue to work — the new
 * fields are additive.
 */
import type { OcrWord } from "./types";

/** Extended word with typographic signals from the PDF text layer. */
export type TextLayerWord = OcrWord & {
  /** Font size in PDF points at 72 DPI (transform[3] magnitude). */
  fontSize?: number;
  /** True when the font name suggests a bold/black/heavy face. */
  isBold?: boolean;
  /** The raw font name from the FontDescriptor, lowercased (for debugging). */
  fontName?: string;
};

/** Common font-name tokens that indicate a bold or heavier weight face. */
const BOLD_TOKENS = new Set([
  "bold",
  "black",
  "heavy",
  "extrabold",
  "semibold",
  "semi-bold",
  "medium",
  "demi",
  "ot-bold",
  "bd",
  "bf",
]);

/**
 * Approximates whether a PDF font name indicates a bold/heavy weight.
 * This is a heuristic, not a cmap query — many PDFs embed generic names like
 * "Helvetica-Bold" or "Arial Bold" and some lie. We treat the absence of any
 * bold token as "probably regular", not "definitely regular".
 */
export function fontIsBold(fontName: string | undefined): boolean {
  if (!fontName) return false;
  const lower = fontName.toLowerCase();
  // Tokenise on the usual separators: hyphen, space, dot, slash.
  const tokens = lower.split(/[-\s.\\/]+/);
  if (tokens.some((t) => t.length >= 2 && BOLD_TOKENS.has(t))) return true;
  // Concatenated font names (e.g. "robotoheavettf") have no separator between
  // the family and the weight — fall back to a substring check for the longer
  // weight tokens so those still resolve without false-positives on short tokens.
  return BOLD_TOKENS.has("heavy") && lower.includes("heavy");
}

/**
 * Extracts font size (points) from a PDF.js text item's transform matrix.
 *
 * transform = [a, b, c, d, e, f] where the item is rendered as a 1×1 unit
 * square transformed by that matrix. For text items the typical case is:
 *   a = cos, b = sin, c = -sin, d = cos  (rotation+scale)
 *   d (or a) carries the scale factor → font size in points.
 *
 * We take Math.abs(d) when available, falling back to Math.abs(a), then to
 * item.height, then to a default. The value is in PDF user space units (points
 * at 72 DPI), which is what font size means in the PDF model.
 */
export function fontSizeOf(item: TextLayerWord & { transform?: number[]; height?: number }): number | undefined {
  const t = item.transform;
  if (Array.isArray(t) && t.length >= 4) {
    const d = t[3];
    if (typeof d === "number" && isFinite(d) && Math.abs(d) > 0) return Math.abs(d);
    const a = t[0];
    if (typeof a === "number" && isFinite(a) && Math.abs(a) > 0) return Math.abs(a);
  }
  if (typeof item.height === "number" && isFinite(item.height) && item.height > 0) return Math.abs(item.height);
  return undefined;
}

/**
 * Clusters words into lines by y-proximity.
 *
 * Two words are on the same line when their vertical centres are within
 * LINE_Y_TOLERANCE * max(fontSizeA, fontSizeB) / pageHeight of each other.
 * The tolerance scales with font size in normalised coordinates, so small text
 * gets tighter clustering and large headings don't swallow adjacent lines.
 *
 * `pageHeight` is the PDF page height in points at the scale the words were
 * normalised against (viewport.height for a scale-1 viewport). Pass the same
 * value used to normalise `y` so the tolerance is comparable.
 *
 * Within a line, words are sorted left-to-right by x. Lines are returned
 * top-to-bottom by their mean y.
 */
export function clusterWordsToLines(
  words: Array<TextLayerWord & { y: number; x: number; fontSize?: number }>,
  pageHeight = 842,
): Array<Array<TextLayerWord & { y: number; x: number }>> {
  if (words.length === 0) return [];

  const withY = words.map((w) => ({
    ...w,
    cy: w.y + (w.h ?? 0) / 2,
  }));

  // Sort top-to-bottom first so clustering is deterministic.
  withY.sort((a, b) => a.y - b.y);

  const lines: Array<Array<TextLayerWord & { y: number; x: number }>> = [];
  let currentLine: typeof withY = [];
  let currentMaxFont = 0;

  for (const w of withY) {
    const f = w.fontSize ?? currentMaxFont ?? 10;
    if (currentLine.length === 0) {
      currentLine.push(w);
      currentMaxFont = Math.max(currentMaxFont, f);
      continue;
    }
    const last = currentLine[currentLine.length - 1]!;
    const lastCenter = last.y + (last.h ?? 0) / 2;
    const thisCenter = w.y + (w.h ?? 0) / 2;
    const gap = Math.abs(thisCenter - lastCenter);
    const tolerance = (Math.max(f, currentMaxFont) * LINE_Y_TOLERANCE) / pageHeight;
    if (gap <= tolerance) {
      currentLine.push(w);
      currentMaxFont = Math.max(currentMaxFont, f);
    } else {
      lines.push(currentLine);
      currentLine = [w];
      currentMaxFont = f;
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);

  // Within each line, sort left-to-right.
  for (const line of lines) {
    line.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
  }
  return lines;
}

/** Tolerance in font-size multiples for y-clustering of text-layer words. */
const LINE_Y_TOLERANCE = 2.0;

/**
 * Extracts a FontDescriptor name for a PDF.js text item, if available.
 *
 * PDF.js sometimes exposes font information through the text content item's
 * `fontName` or through the owning page's fonts. We try the most common
 * shapes; when none is available the word simply has no fontName.
 */
export function fontNameOf(item: { fontName?: string; [key: string]: unknown }): string | undefined {
  if (typeof item.fontName === "string" && item.fontName.trim()) return item.fontName.toLowerCase();
  return undefined;
}

/**
 * Builds a TextLayerWord[] from a PDF.js getTextContent() result + viewport,
 * with font size + bold flag attached.
 *
 * This is the text-layer equivalent of the current textLayerWordsFromPage, but
 * with typographic signals. The geometry is identical to the existing function
 * (so the zone / template / drift machinery keeps working); we only add the two
 * extra fields and keep the original words intact for consumers that ignore them.
 */
export async function textLayerWordsWithFont(page: PDFPageProxy): Promise<TextLayerWord[]> {
  const content = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  const vx = viewport.transform[4] ?? 0;
  const vy = viewport.transform[5] ?? 0;
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;

  const words: TextLayerWord[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim() || !Array.isArray(item.transform)) continue;
    const t = item.transform;
    const tx = t[4] ?? 0;
    const ty = t[3] ?? 0;
    const x = (viewport.transform[0] * tx + viewport.transform[2] * ty + vx) / pageWidth;
    const baselineY = viewport.transform[1] * tx + viewport.transform[3] * ty + vy;
    const height = Math.abs(t[3] ?? 0) || 10;
    const y = Math.max(0, Math.min(1, (baselineY - height) / pageHeight));
    const width = Math.max(1, item.width ?? item.str.length * height * 0.5);
    const safeX = Math.max(0, Math.min(1, x));

    const fontSize = fontSizeOf(item as unknown as TextLayerWord);
    const fontName = fontNameOf(item);
    const isBold = fontName != null ? fontIsBold(fontName) : false;

    words.push({
      text: item.str.trim(),
      x: safeX,
      y,
      w: Math.min(1 - safeX, width / pageWidth),
      h: Math.min(1 - y, height / pageHeight),
      confidence: 0.98,
      fontSize,
      isBold,
      fontName,
    });
  }
  return words;
}
