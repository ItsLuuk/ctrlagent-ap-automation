/**
 * Domain vocabulary — the single source of truth for what Foundry calls things.
 *
 * The prose version of this file is `Branding/brand-voice.md` §4 (Domain
 * Vocabulary). They must not disagree: when a term changes, change it here and
 * in that table in the same commit.
 *
 * Why this exists:
 *  1. `term()` / `countOf()` make a noun and its plural impossible to drift
 *     apart — the old `invoice{n > 1 ? "s" : ""}` pattern appeared in a dozen
 *     files and is how "1 invoices" ships.
 *  2. `BANNED_SYNONYMS` is checked against every user-facing string by
 *     `vocabulary.test.ts`, so copy that reaches for a synonym ("score" for
 *     confidence, "supplier" for vendor) fails the suite instead of shipping.
 *
 * This governs copy, not code. Identifiers may use other words on purpose: the
 * ERP sync kind is literally `"bill"` (`SyncKind`, `syncState.bill`) because that
 * is the ERP's own vocabulary, and extraction patterns must match
 * "supplier"/"leverancier" to find a vendor at all. Those are not copy.
 */

export const TERMS = {
  // Concepts — the canonical nouns from brand-voice.md §4.
  invoice: { one: "invoice", many: "invoices" },
  vendor: { one: "vendor", many: "vendors" },
  template: { one: "template", many: "templates" },
  draft: { one: "draft", many: "drafts" },
  approval: { one: "approval", many: "approvals" },
  handoff: { one: "handoff", many: "handoffs" },
  exception: { one: "exception", many: "exceptions" },
  issue: { one: "issue", many: "issues" },
  confidence: { one: "confidence", many: "confidence" },
  coding: { one: "coding", many: "coding" },
  queue: { one: "queue", many: "queues" },
  // Things copy counts, kept here so their plurals stay consistent too.
  field: { one: "field", many: "fields" },
  sureField: { one: "sure field", many: "sure fields" },
  line: { one: "line", many: "lines" },
  row: { one: "row", many: "rows" },
  check: { one: "check", many: "checks" },
  flag: { one: "flag", many: "flags" },
  item: { one: "item", many: "items" },
  page: { one: "page", many: "pages" },
  syncFailure: { one: "sync failure", many: "sync failures" },
} as const satisfies Record<string, { one: string; many: string }>;

export type TermKey = keyof typeof TERMS;

/**
 * The canonical noun, pluralized for the count.
 * `term("invoice")` → "invoice" · `term("invoice", 1)` → "invoice" ·
 * `term("invoice", 3)` → "invoices"
 */
export function term(key: TermKey, count?: number): string {
  const { one, many } = TERMS[key];
  return count === undefined || count === 1 ? one : many;
}

/** The count and its canonical noun: `countOf(3, "invoice")` → "3 invoices". */
export function countOf(count: number, key: TermKey): string {
  return `${count} ${term(key, count)}`;
}

/**
 * Synonyms that must never appear in user-facing copy, mapped to the canonical
 * term they should have used. Multi-word keys are matched as phrases.
 *
 * Words with no single canonical replacement ("error") live in BANNED_WORDS
 * instead, since the right word depends on the situation.
 */
export const BANNED_SYNONYMS: Record<string, TermKey> = {
  // invoice
  bill: "invoice",
  bills: "invoice",
  // vendor
  supplier: "vendor",
  suppliers: "vendor",
  payee: "vendor",
  merchant: "vendor",
  // template
  script: "template",
  macro: "template",
  rule: "template",
  // draft
  "pending item": "draft",
  "work in progress": "draft",
  // approval
  "sign-off": "approval",
  "sign off": "approval",
  authorization: "approval",
  // handoff
  "payment run": "handoff",
  "batch payment": "handoff",
  disbursement: "handoff",
  // exception
  anomaly: "exception",
  incident: "exception",
  // issue
  blocker: "issue",
  "validation failure": "issue",
  // confidence
  score: "confidence",
  accuracy: "confidence",
  "ai certainty": "confidence",
  // coding
  categorization: "coding",
  class: "coding",
  tagging: "coding",
  // queue
  backlog: "queue",
  worklist: "queue",
};

/**
 * Words banned in copy with no single canonical replacement: name what
 * happened instead ("sync failed", "we couldn't read this document").
 */
export const BANNED_WORDS: string[] = ["error", "errors", "oops"];

/**
 * Internal architecture words that must never reach a label. Unlike the stage
 * names in `STAGE_LABEL`, these have no user-facing form at all.
 */
export const BANNED_JARGON: string[] = ["ocr", "nlp", "gemma", "vlm", "mod-97"];

/** The canonical term for a synonym, or undefined when the word is fine. */
export function canonicalFor(word: string): TermKey | undefined {
  return BANNED_SYNONYMS[word.trim().toLowerCase()];
}

/** Word-boundary matcher for a list of words, longest phrase first so
 *  multi-word terms ("payment run") win over their parts. */
export function bannedPattern(words: string[]): RegExp {
  const escaped = [...new Set(words)]
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "i");
}
