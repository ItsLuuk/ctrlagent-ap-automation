/**
 * Vendor fingerprinting. The rework doc calls for "normalize top-left 15%
 * text" so we can cheaply identify repeat vendors without round-tripping the
 * VLM. We also export a tiny embedder that turns that text into a vector the
 * template store can use for cosine matching.
 */
import type { OcrWord } from "./types";

/** Normalized rectangle covering the top-left of an invoice. */
const FINGERPRINT_REGION = { x0: 0.0, y0: 0.0, x1: 0.5, y1: 0.15 };

/** Words the fingerprint must filter out (boilerplate that varies between runs). */
const NOISE_WORDS = new Set([
  "factuur",
  "invoice",
  "bill",
  "tax",
  "btw",
  "datum",
  "date",
  "nummer",
  "number",
  "no",
  "nr",
  "kvk",
  "iban",
  "bic",
  "btw-nr",
  "page",
  "pagina",
]);

/** Words we should always drop from a vendor block. */
const NON_VENDOR_WORDS = new Set([
  ...NOISE_WORDS,
  "the",
  "a",
  "an",
  "and",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "is",
  "ltd",
  "llc",
  "inc",
  "co",
  "corp",
  "corporation",
  "company",
  "limited",
  "b.v.",
  "bv",
  "gmbh",
  "ug",
]);

/** Reads the top-left vendor block from OCR words. */
export function extractVendorBlock(words: OcrWord[]): string {
  const inRegion = words.filter(
    (w) =>
      w.x >= FINGERPRINT_REGION.x0 &&
      w.y >= FINGERPRINT_REGION.y0 &&
      w.x + w.w <= FINGERPRINT_REGION.x1 + 0.02 &&
      w.y + w.h <= FINGERPRINT_REGION.y1 + 0.02,
  );
  if (inRegion.length === 0) return "";
  // Sort top-to-bottom, left-to-right.
  inRegion.sort((a, b) => (a.y - b.y) * 1000 + (a.x - b.x));
  const lines: string[] = [];
  let currentY = inRegion[0]!.y;
  let current: string[] = [];
  for (const w of inRegion) {
    if (Math.abs(w.y - currentY) > w.h * 1.4 && current.length) {
      lines.push(current.join(" "));
      current = [];
      currentY = w.y;
    }
    current.push(w.text);
  }
  if (current.length) lines.push(current.join(" "));
  // Keep the first non-noise line that's long enough to be a vendor name.
  for (const line of lines) {
    const cleaned = line
      .replace(/[^\p{L}\p{N}&.\- ]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length < 3) continue;
    const tokens = cleaned
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1 && !NON_VENDOR_WORDS.has(t.replace(/[.,]/g, "")));
    if (tokens.length >= 1) return cleaned;
  }
  return lines[0] ?? "";
}

/**
 * Tiny bag-of-words embedder. Same shape every time so cosine similarity is
 * meaningful; not as good as a real model, but it's free and it never fails.
 * The fingerprint is the hash; the vector is the soft-key.
 */
const VOCAB_SIZE = 256;

export function embedVendorText(text: string): number[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const tokens = normalized.split(/\s+/).filter((t) => t.length > 1);
  const vec = new Array<number>(VOCAB_SIZE).fill(0);
  for (const tok of tokens) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    vec[h % VOCAB_SIZE]! += 1;
  }
  // L2-normalize so cosine is a single dot product.
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

/** Stable fingerprint id from the normalized vendor text. */
export function fingerprintOf(text: string): string {
  let h = 5381;
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) + h + normalized.charCodeAt(i)) >>> 0;
  }
  return `fp_${h.toString(36).slice(0, 12)}`;
}

/** Cosine similarity in [-1, 1]; both inputs are L2-normalized so this is O(n). */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}
