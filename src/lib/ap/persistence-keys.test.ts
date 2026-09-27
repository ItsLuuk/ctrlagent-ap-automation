/**
 * Every persisted key reads before anything writes it.
 *
 * The bug this exists for: `ap-automation-vendors-v1` was hydrated from a mount
 * `useEffect` declared *after* the effect that persists it. On every boot the
 * persist effect wrote the initial empty object first, and the read then found
 * that — so vendor-master was silently wiped in every session after the one that
 * wrote it. Nothing threw. Every other list was already correct, and nothing
 * stopped the next one from repeating the mistake: the rule was implicit, in
 * the order of two `useEffect` declarations nobody reads on purpose.
 *
 * So the rule is pinned here once, for every key, instead of one regression per
 * list. A key is discovered from the source rather than listed by hand, so a
 * newly persisted list is covered the moment it exists; the table below is the
 * review checklist, and a key that appears without being added there fails.
 *
 * Two rules, both structural because that is where the bug lived:
 *  1. A persisted key is read before the first thing writes it (source order).
 *  2. No key is read inside a `useEffect`. An effect read runs *after* mount
 *     effects that write, so it is always at the mercy of declaration order.
 *     State that survives a reload is read during render, in the `useState`
 *     initializer, where nothing has written yet.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const AP_DIR = dirname(fileURLToPath(import.meta.url));
const LIB_DIR = resolve(AP_DIR, "..");
/** The React store moved out of the domain directory but still persists keys. */
const APP_DIR = join(LIB_DIR, "app");

/** Every source in the AP lib: the store, and the modules that persist beside it. */
const SOURCES = [AP_DIR, APP_DIR].flatMap((dir) =>
  readdirSync(dir, { recursive: true })
    .filter((name): name is string => typeof name === "string")
    .filter(
      (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.includes("fixtures/"),
    )
    .map((name) => join(dir, name)),
);

/** The keys this install persists, and what each one is. Reviewed by hand. */
const KNOWN_KEYS: Record<string, string> = {
  "ap-automation-invoices-v1": "the working queue",
  "ap-automation-history-v1": "completed records",
  "ap-automation-removed-v1": "records taken out of the queue",
  "ap-automation-templates-v1": "legacy vendor templates (kept in sync)",
  "ap-automation-vendors-v1": "vendor master",
  "ap-automation-business-profile-v1": "legacy single-entity profile (migrated on boot)",
  "ap-automation-operator-name-v1": "the workspace operator identity",
  "ap-automation-purchase-orders-v1": "purchase orders",
  "ap-automation-vendor-templates-v2": "learned vendor templates",
  "ap-automation-vendor-embeddings-v1": "vendor fingerprint embeddings",
  "ap-automation-vendor-profiles-v1": "vendor profile store",
  "ap-automation-file-hashes-v1": "uploaded-file hashes (duplicate gate)",
  "ap-automation-sync-events-v1": "ERP sync events",
  "ap-automation-sod-policy-v1": "configurable segregation-of-duties controls",
  "ap-automation-vendor-bank-changes-v1": "pending vendor bank-change approvals",
  "ap-automation-entities-v1": "legal entities (multi-entity registry)",
  "ap-automation-active-entity-v1": "the entity currently active",
  "ap-automation-fx-rates-v1": "operator-maintained exchange rates for consolidation",
  "ap-automation-compliance-pack-v1": "procurement readiness framework and residency selection",
};

/** Keys intentionally read once for migration and never written by the new source of truth. */
const READ_ONLY_MIGRATION_KEYS = new Set(["ap-automation-business-profile-v1"]);

/** Reads that go through a helper rather than `localStorage.getItem` directly. */
const READER_HELPERS = new Set(["readStoredInvoices", "readAllPos", "readAllTemplates"]);

type Site = {
  /** The key literal, when the call names one. */
  key: string | undefined;
  kind: "read" | "write" | "remove";
  line: number;
  file: string;
};

type FileFacts = {
  consts: Map<string, string>;
  sites: Site[];
  /** Reads that sit inside a `useEffect` call. */
  effectReads: Site[];
};

const calleeName = (expression: ts.Expression): string | undefined =>
  ts.isIdentifier(expression) ? expression.text : undefined;

const localStorageMethod = (expression: ts.Expression): string | undefined => {
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  if (expression.expression.getText() !== "localStorage") return undefined;
  return expression.name.text;
};

function parse(file: string): FileFacts {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const name = file
    .slice(LIB_DIR.length + 1)
    .split("\\")
    .join("/");
  const consts = new Map<string, string>();
  const sites: Site[] = [];
  const effectReads: Site[] = [];

  // `const KEY = "ap-automation-…"` — the indirection every call site uses.
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        ts.isStringLiteral(declaration.initializer)
      ) {
        consts.set(declaration.name.text, declaration.initializer.text);
      }
    }
  }

  const resolveKey = (argument: ts.Expression | undefined): string | undefined => {
    if (!argument) return undefined;
    if (ts.isStringLiteral(argument)) return argument.text;
    if (ts.isIdentifier(argument)) return consts.get(argument.text);
    return undefined;
  };

  const record = (node: ts.CallExpression, kind: Site["kind"], key: string | undefined) => {
    const site: Site = {
      key,
      kind,
      line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      file: name,
    };
    sites.push(site);
    return site;
  };

  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const call = calleeName(node.expression);
      if (call && READER_HELPERS.has(call)) {
        record(node, "read", resolveKey(node.arguments[0]));
      }
      const method = localStorageMethod(node.expression);
      if (method === "getItem") {
        record(node, "read", resolveKey(node.arguments[0]));
      } else if (method === "setItem") {
        record(node, "write", resolveKey(node.arguments[0]));
      } else if (method === "removeItem") {
        // Cleanup is not persistence: a retired key may be removed without
        // being read first (the theme key is the current example).
        record(node, "remove", resolveKey(node.arguments[0]));
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(source);

  // Second pass: the same reads, but only those inside a `useEffect(...)` call.
  const withinEffects = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node.expression) === "useEffect") {
      const inside = (inner: ts.Node) => {
        if (ts.isCallExpression(inner)) {
          const call = calleeName(inner.expression);
          const method = localStorageMethod(inner.expression);
          const isRead = (call !== undefined && READER_HELPERS.has(call)) || method === "getItem";
          if (isRead) {
            effectReads.push({
              key: resolveKey(inner.arguments[0]),
              kind: "read",
              line: source.getLineAndCharacterOfPosition(inner.getStart()).line + 1,
              file: name,
            });
          }
        }
        ts.forEachChild(inner, inside);
      };
      node.forEachChild(inside);
      return;
    }
    ts.forEachChild(node, withinEffects);
  };
  withinEffects(source);

  return { consts, sites, effectReads };
}

const facts = SOURCES.map(parse);

const sitesFor = (key: string, file: FileFacts) => file.sites.filter((site) => site.key === key);
const readsOf = (key: string) =>
  facts.flatMap((file) => sitesFor(key, file).filter((site) => site.kind === "read"));
const writesOf = (key: string) =>
  facts.flatMap((file) => sitesFor(key, file).filter((site) => site.kind === "write"));

describe("persisted keys", () => {
  it("finds every key the app persists, so this test cannot fall behind", () => {
    const found = new Set(
      facts
        .flatMap((file) =>
          file.sites.filter((site) => site.kind !== "remove").map((site) => site.key),
        )
        .filter((key): key is string => typeof key === "string"),
    );
    const missing = [...found].filter((key) => !(key in KNOWN_KEYS)).sort();
    expect(
      missing,
      "a new persisted key needs a line in KNOWN_KEYS — add it and confirm it reads before it writes",
    ).toEqual([]);
    // And the other direction: a key the app no longer writes should not linger
    // in the checklist either.
    const stale = Object.keys(KNOWN_KEYS)
      .filter((key) => !found.has(key))
      .sort();
    expect(stale, "KNOWN_KEYS lists a key the app no longer reads or writes").toEqual([]);
  });

  for (const key of Object.keys(KNOWN_KEYS)) {
    const what = KNOWN_KEYS[key];

    it(`${key} (${what}) is read before anything writes it`, () => {
      const reads = readsOf(key);
      const writes = writesOf(key);
      expect(
        reads.length,
        `${key} is persisted but never read — nothing would survive a reload`,
      ).toBeGreaterThan(0);
      if (READ_ONLY_MIGRATION_KEYS.has(key)) {
        expect(writes, `${key} is now owned by a canonical store and must not be rewritten`).toEqual(
          [],
        );
        return;
      }
      // Compare only within a module. Source line numbers across modules do not
      // describe runtime order, while an effect and its reader in one component
      // do. Every current key has both operations in the same module — except
      // a read-only migration source (the legacy profile key, superseded by
      // the entity registry): with no write anywhere there is no boot order
      // to lose, so the pairing is required only when the key is written.
      const ordered = facts
        .map((file) => {
          const fileReads = sitesFor(key, file).filter((site) => site.kind === "read");
          const fileWrites = sitesFor(key, file).filter((site) => site.kind === "write");
          return { file, fileReads, fileWrites };
        })
        .filter(({ fileReads, fileWrites }) => fileReads.length > 0 && fileWrites.length > 0);
      const writtenSomewhere = readsOf(key).length > 0 &&
        facts.some((file) => file.sites.some((site) => site.key === key && site.kind === "write"));
      if (writtenSomewhere) {
        expect(
          ordered.length,
          `${key} is read and written in different modules; pin their boot order explicitly`,
        ).toBeGreaterThan(0);
        for (const { file, fileReads, fileWrites } of ordered) {
          const firstRead = Math.min(...fileReads.map((site) => site.line));
          const firstWrite = Math.min(...fileWrites.map((site) => site.line));
          expect(
            firstRead,
            `${key} is written at ${firstWrite} before it is read at ${firstRead} in ${file.sites[0]?.file ?? "one module"} — the read happens after the write and loses`,
          ).toBeLessThan(firstWrite);
        }
      }
    });

    it(`${key} (${what}) is never hydrated from an effect`, () => {
      const inEffect = facts.flatMap((file) =>
        file.effectReads.filter((site) => site.key === key || site.key === undefined),
      );
      // A keyless read inside an effect is the template/vendor lookup, which is
      // allowed to resolve late only because its own storage read is not.
      const offenders = inEffect.filter((site) => site.key !== undefined);
      expect(
        offenders.map((site) => `${site.file}:${site.line}`),
        `${key} is read inside a useEffect — state that must survive a reload is read during render, in the useState initializer`,
      ).toEqual([]);
    });
  }
});
