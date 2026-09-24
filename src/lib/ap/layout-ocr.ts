/**
 * Layout-aware word matching. Provides fuzzy anchor-word lookup over OCR word
 * lists so template specs can find labels even when the exact text differs
 * slightly from what was stored (OCR noise, casing, etc.).
 */
import type { OcrWord } from "./types";

export type LayoutOcrResult = {
  text: string;
  confidence: number;
  words: OcrWord[];
};

/** Runs Tesseract.js in layout mode and returns per-word bounding boxes. */
export async function layoutRecognize(
  blob: Blob,
  onProgress?: (p: { stage: string; progress: number }) => void,
): Promise<LayoutOcrResult> {
  const { default: Tesseract } = await import("tesseract.js");
  const bitmap = await createImageBitmap(blob).catch(() => null);
  const width = bitmap?.width ?? 1;
  const height = bitmap?.height ?? 1;
  if (bitmap) bitmap.close();
  const result = await Tesseract.recognize(blob, "eng+nld", {
    logger: (m: { status: string; progress: number }) =>
      onProgress?.({ stage: m.status, progress: m.progress ?? 0 }),
  });
  const data = result.data as {
    text?: string;
    confidence?: number;
    words?: Array<{
      text: string;
      confidence: number;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }>;
  };
  const rawWords = data.words ?? [];
  const words: OcrWord[] = [];
  for (const w of rawWords) {
    const text = (w.text ?? "").trim();
    if (!text) continue;
    const b = w.bbox;
    if (!b) continue;
    const x = Math.max(0, Math.min(1, b.x0 / width));
    const y = Math.max(0, Math.min(1, b.y0 / height));
    const wN = Math.max(0, Math.min(1 - x, (b.x1 - b.x0) / width));
    const hN = Math.max(0, Math.min(1 - y, (b.y1 - b.y0) / height));
    words.push({
      text,
      x,
      y,
      w: wN,
      h: hN,
      confidence: (w.confidence ?? 0) / 100,
    });
  }
  return {
    text: data.text ?? "",
    confidence: (data.confidence ?? 70) / 100,
    words,
  };
}

/** Cheap string-distance match for finding an anchor word in the OCR stream. */
export function nearestWord(words: OcrWord[], query: string): OcrWord | undefined {
  const needle = query.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (!needle) return undefined;
  let best: { word: OcrWord; score: number } | undefined;
  for (const w of words) {
    const hay = w.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (!hay) continue;
    const score = sharedCharScore(needle, hay);
    if (best === undefined || score > best.score) best = { word: w, score };
  }
  // Threshold — reject anything below 0.45 similarity.
  return best && best.score >= 0.45 ? best.word : undefined;
}

/** Bigram-style overlap; fast and tolerant of OCR typos. */
function sharedCharScore(a: string, b: string): number {
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (!longer.length) return 0;
  // Substring containment is worth a lot for short anchors like "datum".
  if (longer.includes(shorter)) return shorter.length / longer.length;
  let matches = 0;
  const used = new Set<number>();
  for (let i = 0; i < shorter.length; i++) {
    for (let j = 0; j < longer.length; j++) {
      if (used.has(j)) continue;
      if (shorter[i] === longer[j]) {
        matches++;
        used.add(j);
        break;
      }
    }
  }
  return matches / longer.length;
}
