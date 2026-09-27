/**
 * How big a field's value is expected to be.
 *
 * A proposed source region used to be whatever words happened to follow a
 * label, so "Totaal  € 1.234,56  Betalingstermijn 30 dagen" produced one box
 * spanning the rest of the line. That box is not merely untidy: it is what
 * gets saved as the template, so the next invoice from that vendor re-reads
 * the neighbouring columns too.
 *
 * The shape model is the cheapest defence. A total is a short run of
 * characters; a registration number and an email are longer; an address is
 * several words and can wrap. Proposals are cut to the run that fits, and
 * their confidence reflects how well the run actually fits.
 */
import type { ExtractedField, OcrWord } from "./types";

export type FieldShape = {
  /** Widest a value is normally printed, in characters. */
  maxChars: number;
  /** Narrowest a plausible value is, in characters. */
  minChars: number;
  /**
   * How many words one value spans. Values printed as a single token (an
   * IBAN, a KVK, an email) must not be split; a date or a company name is
   * routinely two or three.
   */
  maxWords: number;
  /**
   * True when the value may wrap onto following lines, so a single line's
   * worth of words is not the whole story.
   */
  mayWrap: boolean;
};

/**
 * Expected width per field. Deliberately generous on the upper bound: a
 * proposal that is too wide is trimmed, while one that is too narrow is left
 * alone, because trimming a value that turns out to be longer than expected
 * loses it entirely.
 */
export const FIELD_SHAPE: Record<ExtractedField, FieldShape> = {
  // Money: a symbol, digits, separators. The tightest thing on the page.
  subtotal: { minChars: 3, maxChars: 18, maxWords: 3, mayWrap: false },
  tax: { minChars: 1, maxChars: 18, maxWords: 3, mayWrap: false },
  total: { minChars: 3, maxChars: 20, maxWords: 3, mayWrap: false },
  // Dates: "13 juli 2026" or "2026-07-13". Three words is the most a printed
  // date is ever made of, and a fourth is the next field's label.
  issueDate: { minChars: 6, maxChars: 26, maxWords: 3, mayWrap: false },
  dueDate: { minChars: 6, maxChars: 26, maxWords: 3, mayWrap: false },
  // Identifiers, one printed token apiece but of very different lengths.
  invoiceNumber: { minChars: 3, maxChars: 28, maxWords: 2, mayWrap: false },
  iban: { minChars: 15, maxChars: 34, maxWords: 2, mayWrap: false },
  vatNumber: { minChars: 8, maxChars: 22, maxWords: 2, mayWrap: false },
  businessRegistrationNumber: { minChars: 6, maxChars: 14, maxWords: 2, mayWrap: false },
  vendorEmail: { minChars: 8, maxChars: 64, maxWords: 2, mayWrap: false },
  // Free text: a company name can be long, an address longer and wrapping.
  vendor: { minChars: 3, maxChars: 48, maxWords: 5, mayWrap: true },
  address: { minChars: 5, maxChars: 90, maxWords: 8, mayWrap: true },
};

/** Characters in a run, ignoring the spaces that join its words. */
export function runChars(words: OcrWord[]): number {
  return words.reduce((total, word) => total + word.text.trim().length, 0);
}

/**
 * The longest run from the front of `words` that still looks like this field's
 * value.
 *
 * Words are taken while the run is under the word cap and the next word would
 * not push it past the character cap. A single word longer than the cap is
 * still taken on its own: a longer-than-expected IBAN is a real IBAN, and
 * dropping it would lose the value rather than tidy the box.
 */
export function runForShape(field: ExtractedField, words: OcrWord[]): OcrWord[] {
  const shape = FIELD_SHAPE[field];
  if (words.length === 0) return [];
  const run: OcrWord[] = [];
  for (const word of words) {
    if (run.length >= shape.maxWords) break;
    const next = runChars([...run, word]);
    // First word is always taken, however long: it may be the whole value.
    if (run.length > 0 && next > shape.maxChars) break;
    run.push(word);
  }
  return run;
}

/**
 * How well a run's width suits the field, 0..1.
 *
 * This ranks proposals; it never rejects one. A field printed wider than we
 * expect is still a field, and the reviewer is the right person to say so — a
 * silent rejection would just move the work somewhere the user cannot see it.
 */
export function shapeFit(field: ExtractedField, words: OcrWord[]): number {
  const shape = FIELD_SHAPE[field];
  if (words.length === 0) return 0;
  const chars = runChars(words);
  if (chars > shape.maxChars) {
    // Decays to nothing at twice the cap: a run twice as wide as this field
    // ever prints is not a loose fit for it, it is a different thing.
    return Math.max(0, 1 - (chars - shape.maxChars) / shape.maxChars);
  }
  if (chars < shape.minChars) {
    return Math.max(0, 0.4 + 0.6 * (chars / Math.max(1, shape.minChars)));
  }
  return 1;
}

/**
 * One clause for the reviewer's line, saying what the width judgement was.
 * Empty when the run is exactly the expected size — no news is not news.
 */
export function shapeNote(field: ExtractedField, words: OcrWord[]): string {
  const fit = shapeFit(field, words);
  if (fit >= 0.999) return "";
  const shape = FIELD_SHAPE[field];
  const chars = runChars(words);
  const label = fieldLabelSpoken(field);
  if (chars > shape.maxChars) {
    return `${chars} characters over ${words.length} ${words.length === 1 ? "word" : "words"} — a ${label} is usually about ${shape.maxChars}`;
  }
  return `${chars} characters is narrow for a ${label}`;
}

/** "invoiceNumber" spoken as a person would, and acronyms left alone. */
function fieldLabelSpoken(field: ExtractedField): string {
  if (field === "businessRegistrationNumber") return "registration number";
  if (field === "vendorEmail") return "billing email";
  return field.replace(/([A-Z])/g, " $1").toLowerCase();
}
