/**
 * Guards for the domain vocabulary.
 *
 * These tests are the reason the glossary can't quietly rot: they check that
 * user-facing copy in `src/components/ap` and `src/routes` uses the canonical
 * term, that the module and `Branding/brand-voice.md` §4 still agree, and that
 * the plural helpers behave.
 *
 * The copy scan is a net, not a proof. It reads JSX text nodes, quoted literals
 * and template literals, strips `${…}` expressions (so an identifier called
 * `bill` is not copy), and keeps only prose — Tailwind class lists, paths,
 * identifiers and code fragments are dropped. Copy that is all-lowercase and
 * unpunctuated can still slip through; the point is that the realistic drift
 * (a synonym in a sentence) fails the suite.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  BANNED_JARGON,
  BANNED_SYNONYMS,
  BANNED_WORDS,
  TERMS,
  bannedPattern,
  canonicalFor,
  countOf,
  term,
  type TermKey,
} from "./vocabulary";

const SRC_ROOT = join(import.meta.dir, "../..");
const COPY_DIRS = ["components/ap", "routes"];
/**
 * Copy that lives in a lib because it is pure and tested — the approval verdict
 * says the For approval page's one sentence, so it is scanned like any screen.
 */
const COPY_FILES = ["lib/ap/approval.ts"];
const BRAND_VOICE = join(import.meta.dir, "../../../Branding/brand-voice.md");

type Candidate = { text: string; line: number };

/** Code, not copy: statements, operators, comparisons and keywords. */
const CODE_NOISE =
  /[;{}]|=>|\|\||&&|[=!]==?|\breturn\b|\bconst\b|\bfunction\b|\bimport\b|\? \(/;
/** Class lists, ids and bare identifiers: only css-ish characters and no words. */
const CSS_ISH = /^[a-z0-9\s:./[\]%_#\-()]+$/;

/** Text a user can actually read: JSX text nodes and literals. */
function copyCandidates(source: string): Candidate[] {
  const lineAt = (index: number) => source.slice(0, index).split("\n").length;
  const out: Candidate[] = [];
  const push = (raw: string, index: number) => {
    // JSX nodes and templates span lines; collapse whitespace before checking.
    const text = stripExpressions(raw.replace(/\s+/g, " ")).trim();
    if (!looksLikeCopy(text)) return;
    out.push({ text, line: lineAt(index) });
  };
  for (const m of source.matchAll(/>([^<>{}]{2,})</g)) push(m[1] ?? "", m.index ?? 0);
  for (const m of source.matchAll(/"([^"\n\\]{2,})"/g)) push(m[1] ?? "", m.index ?? 0);
  for (const m of source.matchAll(/`([^`]{2,})`/g)) push(m[1] ?? "", m.index ?? 0);
  return out;
}

function looksLikeCopy(text: string): boolean {
  if (text.length < 3) return false;
  if (!/[a-z]/.test(text)) return false;
  if (CODE_NOISE.test(text)) return false;
  if (/^(https?:|[@./\\]|[a-z]{2}:)/.test(text)) return false;
  // No spaces at all means an identifier, path or single class, never a sentence.
  if (!text.includes(" ")) return false;
  if (CSS_ISH.test(text)) return false;
  return true;
}

/** Drops `${…}` (and nested braces) so only the words a user reads remain. */
function stripExpressions(text: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "$" && text[i + 1] === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (depth > 0) {
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      continue;
    }
    out += char;
  }
  return out;
}

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function scanCopy(): { file: string; candidate: Candidate }[] {
  const out: { file: string; candidate: Candidate }[] = [];
  for (const dir of COPY_DIRS) {
    for (const file of tsxFiles(join(SRC_ROOT, dir))) {
      const source = readFileSync(file, "utf8");
      for (const candidate of copyCandidates(source)) out.push({ file, candidate });
    }
  }
  for (const file of COPY_FILES) {
    const full = join(SRC_ROOT, file);
    const source = readFileSync(full, "utf8");
    for (const candidate of copyCandidates(source)) out.push({ file: full, candidate });
  }
  return out;
}

const rel = (path: string) => path.slice(SRC_ROOT.length + 1).replace(/\\/g, "/");

describe("domain vocabulary", () => {
  it("pluralizes canonical terms", () => {
    expect(term("invoice")).toBe("invoice");
    expect(term("invoice", 1)).toBe("invoice");
    expect(term("invoice", 0)).toBe("invoices");
    expect(term("invoice", 2)).toBe("invoices");
    expect(term("syncFailure", 3)).toBe("sync failures");
    // Uncountable terms never gain an "s".
    expect(term("confidence", 4)).toBe("confidence");
    expect(countOf(0, "exception")).toBe("0 exceptions");
    expect(countOf(1, "issue")).toBe("1 issue");
  });

  it("maps synonyms to their canonical term", () => {
    expect(canonicalFor("Suppliers")).toBe("vendor");
    expect(canonicalFor(" payment run ")).toBe("handoff");
    expect(canonicalFor("score")).toBe("confidence");
    expect(canonicalFor("invoice")).toBeUndefined();
    expect(canonicalFor("ERROR")).toBeUndefined();
  });

  it("scans a meaningful amount of copy", () => {
    // If the extractor silently stops matching, the guards below pass vacuously.
    expect(scanCopy().length).toBeGreaterThan(40);
  });

  it("uses the canonical term in every user-facing string", () => {
    const synonyms = bannedPattern(Object.keys(BANNED_SYNONYMS));
    const words = bannedPattern([...BANNED_WORDS, ...BANNED_JARGON]);
    const violations: string[] = [];
    for (const { file, candidate } of scanCopy()) {
      const synonym = candidate.text.match(synonyms);
      if (synonym) {
        const hit = synonym[0];
        violations.push(
          `${rel(file)}:${candidate.line} — "${candidate.text}" uses "${hit}", use "${term(
            canonicalFor(hit) as TermKey,
          )}"`,
        );
      }
      const banned = candidate.text.match(words);
      if (banned) {
        violations.push(
          `${rel(file)}:${candidate.line} — "${candidate.text}" uses "${banned[0]}", name what happened instead`,
        );
      }
    }
    expect(violations.join("\n")).toBe("");
  });

  it("has no exclamation points in user-facing copy", () => {
    const violations = scanCopy()
      .filter(({ candidate }) => candidate.text.includes("!"))
      .map(({ file, candidate }) => `${rel(file)}:${candidate.line} — "${candidate.text}"`);
    expect(violations.join("\n")).toBe("");
  });

  it("keeps brand-voice.md §4 and the module in agreement", () => {
    const rows = vocabularyTable();
    expect(rows.length).toBeGreaterThan(5);
    const problems: string[] = [];
    for (const [canonical, synonyms] of rows) {
      const key = (Object.keys(TERMS) as TermKey[]).find((k) => TERMS[k].one === canonical);
      if (!key) {
        problems.push(`"${canonical}" in the table has no TERMS entry`);
        continue;
      }
      for (const synonym of synonyms) {
        const mapped = canonicalFor(synonym);
        if (mapped !== key) {
          problems.push(`"${synonym}" should map to "${key}" but maps to "${mapped ?? "nothing"}"`);
        }
      }
    }
    // Reverse direction: every canonical term the module bans a synonym for
    // must still have a row in the table.
    const documented = new Set(rows.map(([canonical]) => canonical));
    for (const key of new Set(Object.values(BANNED_SYNONYMS))) {
      if (!documented.has(TERMS[key].one)) {
        problems.push(`the table has no row for "${TERMS[key].one}"`);
      }
    }
    expect(problems.join("\n")).toBe("");
  });
});

/** Parses the "We say / We never say" rows out of brand-voice.md §4. */
function vocabularyTable(): [canonical: string, synonyms: string[]][] {
  const section = readFileSync(BRAND_VOICE, "utf8").split("## 4. Domain Vocabulary")[1];
  if (!section) throw new Error("brand-voice.md no longer has a §4 Domain Vocabulary");
  const rows: [string, string[]][] = [];
  for (const line of section.split("\n").slice(1)) {
    if (!line.startsWith("|")) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = line.split("|").map((cell) => cell.trim());
    const canonical = cells[1];
    const synonyms = cells[2];
    if (!canonical || !synonyms) continue;
    if (canonical === "We say" || canonical.startsWith("---")) continue;
    rows.push([
      canonical,
      synonyms
        .split(",")
        .map((synonym) => synonym.trim())
        .filter(Boolean),
    ]);
  }
  return rows;
}
