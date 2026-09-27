/**
 * Hydration-order chaos test for the AP store.
 *
 * `persistence-keys.test.ts` pins the rule statically: a persisted key is read
 * before anything writes it, and never from a `useEffect`. This test checks
 * the same guarantee *dynamically*. It reconstructs the store's boot from its
 * own source — the render-phase `useState` initialisers, then every
 * `useEffect` — and replays boot under every possible effect order.
 *
 * Why an ordering is worth chaos-testing: React runs effects in declaration
 * order, and today every hydrating read runs during render, before any effect
 * can write. The moment a hydration read moves back into an effect, the store
 * survives only because of the order two effects happen to be declared in —
 * one refactor, one inserted effect, or one dependency-driven re-run away from
 * writing empty state over the user's real data. Nothing throws when that
 * happens; the data is simply gone.
 *
 * So every permutation answers "which of those orders breaks it?". If none
 * does, the guarantee is structural rather than lucky; if one does, the
 * failure names the key, the writing effect and the order that lost it.
 *
 * The model of React this test assumes: all `useState` initialisers run during
 * render (before any effect), then effects run, then callbacks fire on
 * interaction — everything except effect order is fixed, so effect order is
 * the axis of chaos.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const STORE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../app/store.tsx");

/**
 * Reader helpers that take the storage key as an argument, so the call site
 * says which key it hydrates.
 */
const KEYED_READERS = new Set(["readStoredInvoices"]);

/**
 * Reader helpers that take no key argument, mapped to the storage key each one
 * hydrates. `readAllTemplates` maps to the v2 template key (its own store);
 * the legacy template key is read directly in the initialiser, so it is
 * covered on its own rather than through this mapping.
 */
const READER_HELPERS: Record<string, string> = {
  readAllProfiles: "ap-automation-vendor-profiles-v1",
  readAllTemplates: "ap-automation-vendor-templates-v2",
  readAllPos: "ap-automation-purchase-orders-v1",
};

type Op = {
  kind: "read" | "write" | "remove";
  key: string;
  line: number;
};

type Effect = {
  /** Line the `useEffect(` starts on — used to name a failing order. */
  line: number;
  ops: Op[];
};

type Boot = {
  /** Reads that run during render, before any effect. */
  render: Op[];
  effects: Effect[];
  /** Reads/writes outside render and effects: callbacks, which fire after boot. */
  callbacks: Op[];
  /** Every key the module ever reads — a write to any other key clobbers. */
  readKeys: Set<string>;
};

function parseStore(path: string): Boot {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  // `const KEY = "ap-automation-…"` — the indirection every call site uses.
  const consts = new Map<string, string>();
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

  const callee = (expression: ts.Expression): string | undefined =>
    ts.isIdentifier(expression) ? expression.text : undefined;

  const resolveKey = (argument: ts.Expression | undefined): string | undefined => {
    if (!argument) return undefined;
    if (ts.isStringLiteral(argument)) return argument.text;
    if (ts.isIdentifier(argument)) return consts.get(argument.text);
    return undefined;
  };

  /** The storage operation a single call performs, when it performs one. */
  const storageOp = (node: ts.CallExpression): Op | undefined => {
    const line = lineOf(node);
    const name = callee(node.expression);
    if (name && KEYED_READERS.has(name)) {
      const key = resolveKey(node.arguments[0]);
      return key ? { kind: "read", key, line } : undefined;
    }
    if (name && name in READER_HELPERS) {
      const helperKey = READER_HELPERS[name];
      return helperKey ? { kind: "read", key: helperKey, line } : undefined;
    }
    if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
    const { expression, name: method } = node.expression;
    if (!ts.isIdentifier(expression) || expression.text !== "localStorage") return undefined;
    const key = resolveKey(node.arguments[0]);
    if (!key) return undefined;
    if (method.text === "getItem") return { kind: "read", key, line };
    if (method.text === "setItem") return { kind: "write", key, line };
    if (method.text === "removeItem") return { kind: "remove", key, line };
    return undefined;
  };

  /** Every storage operation reachable from `node`, in source order. */
  const collectOps = (node: ts.Node, ops: Op[]): void => {
    const walk = (inner: ts.Node): void => {
      if (ts.isCallExpression(inner)) {
        const op = storageOp(inner);
        if (op) ops.push(op);
      }
      ts.forEachChild(inner, walk);
    };
    walk(node);
  };

  const render: Op[] = [];
  const effects: Effect[] = [];
  const callbacks: Op[] = [];

  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = callee(node.expression);
      // Render phase: everything inside a useState initialiser runs before the
      // first effect, so it can never lose a race with one.
      if (name === "useState") {
        const initializer = node.arguments[0];
        if (initializer) collectOps(initializer, render);
        return;
      }
      // Effect phase: the one ordering this test is not allowed to rely on.
      if (name === "useEffect") {
        const body = node.arguments[0];
        const ops: Op[] = [];
        if (body) collectOps(body, ops);
        effects.push({ line: lineOf(node), ops });
        return;
      }
      const op = storageOp(node);
      if (op) callbacks.push(op);
    }
    ts.forEachChild(node, walk);
  };
  walk(source);

  const readKeys = new Set<string>();
  for (const op of [...render, ...effects.flatMap((effect) => effect.ops), ...callbacks])
    if (op.kind === "read") readKeys.add(op.key);

  return { render, effects, callbacks, readKeys };
}

const boot = parseStore(STORE_PATH);

/** Effects that touch storage are the only ones whose order can matter. */
const storageEffects = boot.effects.filter((effect) =>
  effect.ops.some((op) => op.kind !== "remove"),
);

/** Every write the module performs, effects and callbacks alike. */
const writtenKeys = (): string[] =>
  [...boot.effects, { ops: boot.callbacks }]
    .flatMap((effect) => effect.ops)
    .filter((op) => op.kind === "write")
    .map((op) => op.key);

/**
 * Replays boot under one effect order. Returns the first key written before
 * anything read it — the clobber the real store would have performed.
 */
function clobber(order: number[]): string | undefined {
  const read = new Set(boot.render.filter((op) => op.kind === "read").map((op) => op.key));
  const run = (ops: Op[], where: string): string | undefined => {
    for (const op of ops) {
      if (op.kind === "read") {
        read.add(op.key);
        continue;
      }
      if (op.kind === "remove") continue;
      if (!read.has(op.key))
        return `${op.key} written at store.tsx:${op.line} ${where} before it was read`;
    }
    return undefined;
  };
  for (const [position, effectIndex] of order.entries()) {
    const effect = storageEffects[effectIndex];
    if (!effect) continue;
    const failure = run(
      effect.ops,
      `by the effect at store.tsx:${effect.line} (position ${position + 1} of ${order.length})`,
    );
    if (failure) return failure;
  }
  return run(boot.callbacks, "from a callback");
}

function permutations(values: number[]): number[][] {
  if (values.length <= 1) return [values];
  const out: number[][] = [];
  for (const [index, value] of values.entries()) {
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const tail of permutations(rest)) out.push([value, ...tail]);
  }
  return out;
}

/** Deterministic shuffle — a chaos test that flakes would be worse than none. */
function shuffle(values: number[], seed: number): number[] {
  const out = [...values];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    const current = out[i];
    const other = out[j];
    if (current === undefined || other === undefined) continue;
    out[i] = other;
    out[j] = current;
  }
  return out;
}

describe("store hydration under chaotic effect order", () => {
  it("finds the store's reads and effects, so this test cannot fall behind", () => {
    // A store with no storage-touching effects has nothing to race — what
    // needs to keep working is the extraction itself.
    expect(boot.render.length, "no render-phase reads were found in store.tsx").toBeGreaterThan(0);
    expect(
      storageEffects.length,
      "no storage-touching effects were found in store.tsx",
    ).toBeGreaterThan(0);
    expect(
      [...boot.readKeys],
      "the extracted keys do not look like this app's persisted keys",
    ).toContain("ap-automation-invoices-v1");
  });

  it("hydrates every key it persists during render, before any effect runs", () => {
    const rendered = new Set(boot.render.map((op) => op.key));
    const hydratedLate = [...new Set(writtenKeys())]
      .filter((key) => !rendered.has(key))
      .sort();
    expect(
      hydratedLate,
      "a key is persisted from state that is not read during render — under some effect order it writes empty state over the user's data",
    ).toEqual([]);
  });

  it("reads every key it writes somewhere in the module", () => {
    const neverRead = [...new Set(writtenKeys())]
      .filter((key) => !boot.readKeys.has(key))
      .sort();
    expect(neverRead, "a key is written but never read — nothing would survive a reload").toEqual(
      [],
    );
  });

  it("survives every ordering of the store's effects", () => {
    const indexes = storageEffects.map((_, index) => index);
    // Exhaustive while the store is small enough for a failure to stay
    // readable; sampled with a fixed seed once it is not, so a growing store
    // can neither hide the race nor make this flaky.
    const orders =
      indexes.length <= 8
        ? permutations(indexes)
        : Array.from({ length: 5000 }, (_, sample) => shuffle(indexes, sample + 1));

    const failures = new Set<string>();
    for (const order of orders) {
      const failure = clobber(order);
      if (failure) failures.add(failure);
      if (failures.size >= 5) break;
    }
    expect(
      [...failures],
      `${orders.length} effect orderings replayed against store.tsx; any entry is a boot sequence that wipes persisted state`,
    ).toEqual([]);
  });
});
