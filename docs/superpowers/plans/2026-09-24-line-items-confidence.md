# Line-Item Extraction Confidence & Source-Page Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show per-row numeric extraction confidence + source page (`87% · p.2`) and a block-level ConfidenceChip in the Draft line-items field.

**Architecture:** Add optional `confidence` to `LineItem`. Each of the three extractors (VLM, OCR heuristic, template) produces a base score; a new shared `scoreLineItems()` applies sanity penalties and a reconciliation ceiling once, centrally, in `finalizeInvoice`. UI renders numeric % + `p.N` per row and a min-score chip in the block header.

**Tech Stack:** TypeScript, React, zod, bun test.

**Spec:** `docs/superpowers/specs/2026-09-24-line-items-confidence-design.md`

## Global Constraints

- Test runner: `bun test <path>` (see `bunfig.toml`; e2e excluded).
- Lint: `npm run lint` (eslint). Format: `npm run format` (prettier).
- Thresholds: green ≥0.75, amber 0.5–0.75, red <0.5; reconciliation ceiling 0.75 (matches `CONFIDENT_THRESHOLD` / `LOW_CONFIDENCE_THRESHOLD`).
- Confidence values always clamped 0..1; missing page → omit `p.N`; missing confidence → omit %.
- Do not recalculate confidence on user edit — extracted value is sticky.
- Lovable project: never rewrite pushed git history; only additive commits.
- Colors: use `@/lib/colors` (`colorClasses`, `toneClasses`) or existing utility classes (`text-success-foreground`, `text-warning-foreground`, `text-destructive`) — no hardcoded oklch/hex.

---

### Task 1: `LineItem.confidence` type + shared `scoreLineItems`

**Files:**
- Modify: `src/lib/ap/types.ts:78-87` (LineItem)
- Create: `src/lib/ap/confidence.ts`
- Test: `src/lib/ap/confidence.test.ts`

**Interfaces:**
- Produces: `LineItem.confidence?: number` (0..1); `scoreLineItems(items: LineItem[], subtotal?: number | undefined, total?: number | undefined): LineItem[]`; `lineItemsBlockScore(items: LineItem[]): number | undefined`; constants `RECONCILIATION_CEILING = 0.75`, `MISSING_DESC_PENALTY = 0.7`, `BAD_NUMERIC_PENALTY = 0.6`, `DEFAULT_BASE_CONFIDENCE = 0.7`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/ap/confidence.test.ts
import { describe, expect, it } from "bun:test";
import {
  scoreLineItems,
  lineItemsBlockScore,
  RECONCILIATION_CEILING,
} from "./confidence";
import type { LineItem } from "./types";

const item = (over: Partial<LineItem> = {}): LineItem => ({
  id: "li-1",
  description: "Widgets",
  quantity: 2,
  unitPrice: 50,
  amount: 100,
  glAccount: "",
  department: "",
  page: 1,
  confidence: 0.9,
  ...over,
});

describe("scoreLineItems", () => {
  it("multiplies by 0.7 when description is missing", () => {
    const [out] = scoreLineItems([item({ description: "", confidence: 0.9 })]);
    expect(out!.confidence).toBeCloseTo(0.63, 5);
  });

  it("multiplies by 0.6 when quantity is negative", () => {
    const [out] = scoreLineItems([item({ quantity: -1, confidence: 0.9 })]);
    expect(out!.confidence).toBeCloseTo(0.54, 5);
  });

  it("caps all rows at 0.75 when lines do not reconcile with subtotal", () => {
    const rows = scoreLineItems([item(), item({ id: "li-2", amount: 50, confidence: 0.95 })], 500, undefined);
    for (const r of rows) expect(r.confidence!).toBeLessThanOrEqual(RECONCILIATION_CEILING);
  });

  it("leaves scores alone when lines reconcile within 2 cents", () => {
    const [out] = scoreLineItems([item({ amount: 100, confidence: 0.9 })], 100, 121);
    expect(out!.confidence).toBeCloseTo(0.9, 5);
  });

  it("defaults missing base confidence to 0.7 before penalties", () => {
    const [out] = scoreLineItems([item({ confidence: undefined })]);
    expect(out!.confidence).toBeCloseTo(0.7, 5);
  });

  it("clamps into 0..1", () => {
    const [out] = scoreLineItems([item({ confidence: 1.5 })]);
    expect(out!.confidence).toBe(1);
  });

  it("skips reconciliation when subtotal and total are absent", () => {
    const [out] = scoreLineItems([item({ confidence: 0.9 })], undefined, undefined);
    expect(out!.confidence).toBeCloseTo(0.9, 5);
  });
});

describe("lineItemsBlockScore", () => {
  it("returns the minimum row confidence", () => {
    expect(lineItemsBlockScore([item({ confidence: 0.9 }), item({ id: "2", confidence: 0.4 })])).toBe(0.4);
  });

  it("returns undefined for empty list", () => {
    expect(lineItemsBlockScore([])).toBeUndefined();
  });

  it("ignores rows without confidence", () => {
    expect(lineItemsBlockScore([item({ confidence: undefined })])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/ap/confidence.test.ts`
Expected: FAIL — module `./confidence` not found.

- [ ] **Step 3: Add type field + implement**

In `src/lib/ap/types.ts`, `LineItem` (after `page`):

```ts
  page?: number | undefined;
  /** Extraction confidence 0..1 for this row; absent on manually added rows. */
  confidence?: number | undefined;
```

```ts
// src/lib/ap/confidence.ts
import type { LineItem } from "./types";

/** Ceiling when line sum does not match subtotal/total — mirrors cross-check DISAGREEMENT path so triage goes amber. */
export const RECONCILIATION_CEILING = 0.75;
export const MISSING_DESC_PENALTY = 0.7;
export const BAD_NUMERIC_PENALTY = 0.6;
export const DEFAULT_BASE_CONFIDENCE = 0.7;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function linesReconcile(
  items: LineItem[],
  subtotal: number | undefined,
  total: number | undefined,
): boolean {
  const sum = items.reduce((s, li) => s + (Number.isFinite(li.amount) ? li.amount : 0), 0);
  const target =
    subtotal !== undefined && subtotal > 0
      ? subtotal
      : total !== undefined && total > 0
        ? total
        : undefined;
  if (target === undefined) return true;
  return Math.abs(sum - target) <= 0.02;
}

/**
 * Central post-extraction adjustment. Runs once after items are chosen,
 * before the invoice is finalized. Overwrites `confidence` with the
 * adjusted value; never throws.
 */
export function scoreLineItems(
  items: LineItem[],
  subtotal?: number | undefined,
  total?: number | undefined,
): LineItem[] {
  if (items.length === 0) return items;
  let scored = items.map((li) => {
    let score = li.confidence ?? DEFAULT_BASE_CONFIDENCE;
    if (!li.description.trim()) score *= MISSING_DESC_PENALTY;
    if (
      !Number.isFinite(li.quantity) ||
      li.quantity < 0 ||
      !Number.isFinite(li.unitPrice) ||
      li.unitPrice < 0
    ) {
      score *= BAD_NUMERIC_PENALTY;
    }
    return { ...li, confidence: round2(clamp01(score)) };
  });
  if (!linesReconcile(scored, subtotal, total)) {
    scored = scored.map((li) => ({
      ...li,
      confidence: Math.min(li.confidence ?? 0, RECONCILIATION_CEILING),
    }));
  }
  return scored;
}

/** Block score = worst row (min). Derived, not persisted. */
export function lineItemsBlockScore(items: LineItem[]): number | undefined {
  const scores = items
    .map((li) => li.confidence)
    .filter((c): c is number => c !== undefined);
  if (scores.length === 0) return undefined;
  return Math.min(...scores);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/ap/confidence.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ap/types.ts src/lib/ap/confidence.ts src/lib/ap/confidence.test.ts
git commit -m "feat: LineItem.confidence type + shared scoreLineItems"
```

---

### Task 2: VLM extractor base scores

**Files:**
- Modify: `src/lib/ai/gemma.ts:100` (prompt schema), `:162-171` (zod), `:260-277` (mergeGemmaPages)
- Test: `src/lib/ai/gemma.test.ts`

**Interfaces:**
- Consumes: `LineItem.confidence` from Task 1; `DEFAULT_BASE_CONFIDENCE` from `./confidence` (path: `../ap/confidence`).
- Produces: model may emit `lineItems[].confidence` (number 0..1); merged `LineItem.confidence` always set (fallback 0.7).

Note: three existing `gemmaToFields` confidence tests already fail on master (`fields.confidence` undefined — pre-existing). Do not fix them here; only add line-item tests.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/ai/gemma.test.ts`:

```ts
describe("mergeGemmaPages line-item confidence", () => {
  it("passes through a model-reported confidence", () => {
    const merged = mergeGemmaPages([
      parseGemmaPage(
        JSON.stringify({
          lineItems: [
            { description: "Booth panels", quantity: 5, unitPrice: 410, amount: 2050, confidence: 0.88 },
          ],
        }),
      ),
    ]);
    expect(merged.lineItems[0]!.confidence).toBeCloseTo(0.88, 5);
    expect(merged.lineItems[0]!.page).toBe(1);
  });

  it("falls back to 0.7 when the model omits confidence", () => {
    const merged = mergeGemmaPages([
      parseGemmaPage(
        JSON.stringify({
          lineItems: [{ description: "Booth panels", quantity: 5, unitPrice: 410, amount: 2050 }],
        }),
      ),
    ]);
    expect(merged.lineItems[0]!.confidence).toBeCloseTo(0.7, 5);
  });

  it("clamps out-of-range model confidence into 0..1", () => {
    const merged = mergeGemmaPages([
      parseGemmaPage(
        JSON.stringify({
          lineItems: [
            { description: "X", quantity: 1, unitPrice: 10, amount: 10, confidence: 1.4 },
          ],
        }),
      ),
    ]);
    expect(merged.lineItems[0]!.confidence).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/ai/gemma.test.ts -t "line-item confidence"`
Expected: FAIL — `confidence` undefined on merged items (and zod strips unknown keys is fine; we need schema + merge).

- [ ] **Step 3: Implement prompt, schema, merge**

Prompt schema line 100:

```
  "lineItems": [{ "description": string, "quantity": number, "unitPrice": number, "amount": number, "confidence": number }]
```

Add prompt rule after the `lineItems` field rule (~line 116):

```
- lineItems[].confidence: your confidence 0..1 that this row was read correctly from the image (1 = certain).
```

Zod in `gemmaPageSchema` lineItems object — add:

```ts
        confidence: z.unknown().transform(toNum).catch(null),
```

In `mergeGemmaPages` loop (~line 267), after `page,` add:

```ts
        confidence: (() => {
          const c = toNum(li.confidence);
          if (c === null) return DEFAULT_BASE_CONFIDENCE;
          return Math.min(1, Math.max(0, c));
        })(),
```

Import at top of `gemma.ts`:

```ts
import { DEFAULT_BASE_CONFIDENCE } from "../ap/confidence";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/ai/gemma.test.ts -t "line-item confidence"`
Expected: PASS (3 new). Full-file run may still show the 3 pre-existing `gemmaToFields` failures — ignore those.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/gemma.ts src/lib/ai/gemma.test.ts
git commit -m "feat: VLM line-item confidence in prompt, schema, merge"
```

---

### Task 3: OCR heuristic base scores (word-confidence mean)

**Files:**
- Modify: `src/lib/ap/ocr.ts:1111-1147` (`guessLineItemsIn`), call site `:1373-1375`
- Test: `src/lib/ap/ocr.test.ts` (append describe) or new `src/lib/ap/line-items-confidence.test.ts`

**Interfaces:**
- Consumes: `PageRead.words?: OcrWord[]`, `OcrWord.confidence`, `DEFAULT_BASE_CONFIDENCE`.
- Produces: `guessLineItemsIn(text: string, page: number, words?: OcrWord[]): LineItem[]` with `confidence` set per row.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ap/ocr.test.ts` (or new file if imports get heavy):

```ts
import { guessLineItemsIn } from "./ocr";
import type { OcrWord } from "./types";

describe("guessLineItemsIn confidence", () => {
  it("averages OcrWord confidences for words matching the line", () => {
    const text = "Consulting services 100,00";
    const words: OcrWord[] = [
      { text: "Consulting", x: 0.05, y: 0.4, w: 0.1, h: 0.02, confidence: 0.9 },
      { text: "services", x: 0.16, y: 0.4, w: 0.08, h: 0.02, confidence: 0.7 },
      { text: "100,00", x: 0.3, y: 0.4, w: 0.06, h: 0.02, confidence: 0.8 },
      { text: "Header", x: 0.05, y: 0.05, w: 0.06, h: 0.02, confidence: 0.1 },
    ];
    const items = guessLineItemsIn(text, 1, words);
    expect(items).toHaveLength(1);
    expect(items[0]!.confidence).toBeCloseTo((0.9 + 0.7 + 0.8) / 3, 5);
    expect(items[0]!.page).toBe(1);
  });

  it("falls back to 0.7 when no words are provided", () => {
    const items = guessLineItemsIn("Consulting services 100,00", 2);
    expect(items[0]!.confidence).toBeCloseTo(0.7, 5);
    expect(items[0]!.page).toBe(2);
  });

  it("uses 0.7 when no words on the page match the line", () => {
    const items = guessLineItemsIn("Consulting services 100,00", 1, [
      { text: "ZZZ", x: 0, y: 0, w: 0.1, h: 0.1, confidence: 0.2 },
    ]);
    expect(items[0]!.confidence).toBeCloseTo(0.7, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/ap/ocr.test.ts -t "guessLineItemsIn confidence"`
Expected: FAIL — items lack `confidence` (undefined) or arity mismatch is fine (JS ignores extra args; assertions on confidence fail).

- [ ] **Step 3: Implement**

Replace signature and add scoring in `guessLineItemsIn`:

```ts
export function guessLineItemsIn(text, page, words = []) {
  const items = [];
  const wordList = Array.isArray(words) ? words : [];
  for (const line of text.split("\n")) {
    // ... existing filters unchanged through `if (amount < 1) continue;` ...
    const rowConfidence = scoreRowWords(line, wordList);
    items.push({
      // ...existing fields...
      page,
      confidence: rowConfidence,
    });
    if (items.length >= 8) break;
  }
  return items;
}

function scoreRowWords(line: string, words: OcrWord[]): number {
  if (words.length === 0) return DEFAULT_BASE_CONFIDENCE;
  const hits = words.filter((w) => w.text && line.includes(w.text));
  if (hits.length === 0) return DEFAULT_BASE_CONFIDENCE;
  const mean = hits.reduce((s, w) => s + (Number.isFinite(w.confidence) ? w.confidence : 0), 0) / hits.length;
  return Number(Math.min(1, Math.max(0, mean)).toFixed(2));
}
```

Import in `ocr.ts`:

```ts
import { DEFAULT_BASE_CONFIDENCE } from "./confidence";
```

(`OcrWord` already imported / same package — use existing type import.)

Update call site `:1373-1375`:

```ts
  const lineItems = pages
    .flatMap((p) => guessLineItemsIn(p.text, p.pageNumber, p.words))
    .slice(0, multiPage ? 20 : 8);
```

(`PageRead.words` already optional and threaded through `toPageText`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/ap/ocr.test.ts -t "guessLineItemsIn confidence"`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ap/ocr.ts src/lib/ap/ocr.test.ts
git commit -m "feat: OCR line-item base confidence from word scores"
```

---

### Task 4: Template extractor base scores + page backfill

**Files:**
- Modify: `src/lib/ap/mapping.ts:698-748` (`parseLineItemRows`, `parseRowIntoLineItem`)
- Modify: `src/lib/ap/ocr.ts:1751-1761` (`applyLineItemsSpec` — set `page`)
- Test: `src/lib/ap/mapping.test.ts` (extend `parseLineItemRows` describe)

**Interfaces:**
- Consumes: `row: OcrWord[]` already available in `parseRowIntoLineItem`; `DEFAULT_BASE_CONFIDENCE`.
- Produces: template-path `LineItem.confidence` (mean of row word confidences) and `LineItem.page` (page number of words source — set in `applyLineItemsSpec` since `parseLineItemRows` only sees words from one page).

- [ ] **Step 1: Write the failing tests**

Append inside `describe("parseLineItemRows")` in `src/lib/ap/mapping.test.ts`:

```ts
  it("sets confidence from the mean of the row's word confidences", () => {
    const words = [
      { ...word("Consulting", 0.05, 0.4), confidence: 0.9 },
      { ...word("1000,00", 0.7, 0.4), confidence: 0.7 },
    ];
    const rows = parseLineItemRows(words, spec);
    expect(rows[0]!.confidence).toBeCloseTo(0.8, 5);
  });

  it("falls back to 0.7 when the row has no usable word confidences", () => {
    const words = [
      { ...word("Consulting", 0.05, 0.4), confidence: Number.NaN },
      { ...word("1000,00", 0.7, 0.4), confidence: Number.NaN },
    ];
    const rows = parseLineItemRows(words, spec);
    expect(rows[0]!.confidence).toBeCloseTo(0.7, 5);
  });
```

For `applyLineItemsSpec` page — add test in `src/lib/ap/ocr.test.ts`:

```ts
import { applyLineItemsSpec } from "./ocr";

describe("applyLineItemsSpec page backfill", () => {
  it("tags every row with the source page number", () => {
    const spec = {
      region: { x0: 0, y0: 0, x1: 1, y1: 1 },
      columns: [
        { anchor: "Description", field: "description" as const, band: { x0: 0, y0: 0, x1: 0.5, y1: 1 } },
        { anchor: "Amount", field: "amount" as const, band: { x0: 0.5, y0: 0, x1: 1, y1: 1 } },
      ],
    };
    const pages = [
      {
        pageNumber: 1,
        words: [
          word("Consulting", 0.05, 0.4),
          word("1000,00", 0.7, 0.4),
        ],
      },
    ];
    const items = applyLineItemsSpec(pages, spec);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.page).toBe(1);
    expect(items[0]!.confidence).toBeDefined();
  });
});
```

Local `word` helper if not already in `ocr.test.ts`:

```ts
const word = (text: string, x: number, y: number): OcrWord => ({
  text, x, y, w: 0.08, h: 0.02, confidence: 0.95,
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/ap/mapping.test.ts src/lib/ap/ocr.test.ts -t "confidence"`
Expected: FAIL — `confidence` undefined; `page` undefined on template items.

- [ ] **Step 3: Implement**

In `parseRowIntoLineItem` — before return, compute and attach:

```ts
  const rowConfidence =
    row.length > 0
      ? (() => {
          const vals = row
            .map((w) => w.confidence)
            .filter((c) => Number.isFinite(c));
          if (vals.length === 0) return DEFAULT_BASE_CONFIDENCE;
          const mean = vals.reduce((s, c) => s + c, 0) / vals.length;
          return Number(Math.min(1, Math.max(0, mean)).toFixed(2));
        })()
      : DEFAULT_BASE_CONFIDENCE;
  return {
    id: `li-row-${rowIndex}`,
    description: description.slice(0, MAX_DESCRIPTION_LENGTH),
    quantity,
    unitPrice: Number(unitPriceOf(values.unitPrice, amount, quantity).toFixed(2)),
    amount,
    glAccount: "",
    department: "",
    confidence: rowConfidence,
  };
```

Import in `mapping.ts`:

```ts
import { DEFAULT_BASE_CONFIDENCE } from "./confidence";
```

In `applyLineItemsSpec` (`ocr.ts`):

```ts
export function applyLineItemsSpec(pages, spec) {
  const words = pages[0]?.words ?? [];
  if (words.length === 0) return [];
  const pageNumber = pages[0]?.pageNumber ?? 1;
  return parseLineItemRows(words, spec).map((li) => ({
    ...li,
    page: pageNumber,
    id: uid(),
    glAccount: GL_ACCOUNTS[0],
    department: DEPARTMENTS[0],
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/ap/mapping.test.ts src/lib/ap/ocr.test.ts -t "confidence"`
Expected: PASS (and the page-backfill test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ap/mapping.ts src/lib/ap/ocr.ts src/lib/ap/mapping.test.ts src/lib/ap/ocr.test.ts
git commit -m "feat: template line-item confidence + page backfill"
```

---

### Task 5: Central scoring in `finalizeInvoice`

**Files:**
- Modify: `src/lib/ap/ocr.ts` — `finalizeInvoice` (~2335-2493): import, score once after computing subtotal/total, use scored list for reconciliation + invoice return.

**Interfaces:**
- Consumes: `scoreLineItems` from `./confidence`.
- Produces: every path through `finalizeInvoice` (OCR, VLM, template, drift) persists adjusted `LineItem.confidence`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ap/confidence.test.ts` (integration-style, pure function — finalizeInvoice itself is async/IO-heavy; assert the call-site contract via a thin wrapper test on scoring inputs matching finalize's locals):

```ts
describe("finalize contract (score after totals known)", () => {
  it("caps rows when chosen line sum ≠ subtotal", () => {
    // Mirrors finalizeInvoice: subtotal/total read first, then scoreLineItems.
    const chosen = [
      item({ id: "a", amount: 80, confidence: 0.9 }),
      item({ id: "b", amount: 10, confidence: 0.9 }),
    ];
    const subtotal = 500;
    const total = 605;
    const scored = scoreLineItems(chosen, subtotal, total);
    expect(scored.every((li) => li.confidence! <= 0.75)).toBe(true);
  });
});
```

Also verify existing pipeline tests still pass after wiring (they construct invoices directly and won't break).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/ap/confidence.test.ts -t "finalize contract"`
Expected: PASS already (function exists) — this locks the contract. The real gate is Task 5 Step 4 full suite.

- [ ] **Step 3: Wire into finalizeInvoice**

Add import at top of `ocr.ts` (next to other `./` imports):

```ts
import { scoreLineItems } from "./confidence";
```

After `subtotal` / `total` are computed (~line 2357) and BEFORE `reconcileExtraction` (~2378), insert:

```ts
  const scoredLineItems = scoreLineItems(
    chosen.lineItems,
    subtotal > 0 ? subtotal : undefined,
    total > 0 ? total : undefined,
  );
```

Change reconcile call to use `scoredLineItems`:

```ts
  const reconciliation = reconcileExtraction({
    subtotal,
    tax,
    total,
    lineItems: scoredLineItems,
  });
```

Change invoice return `lineItems: chosen.lineItems` → `lineItems: scoredLineItems`.

Also update the `total` fallback that sums line items (line ~2356) to use `chosen.lineItems` (pre-score amounts are identical; scores don't change amounts — no change needed there).

- [ ] **Step 4: Run full unit suite**

Run: `bun test`
Expected: PASS except the 3 pre-existing `gemmaToFields` confidence failures (baseline — record count before/after: should not grow).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ap/ocr.ts src/lib/ap/confidence.test.ts
git commit -m "feat: score line items centrally in finalizeInvoice"
```

---

### Task 6: Per-row UI — numeric % + source page in `LineItemsList`

**Files:**
- Modify: `src/components/ap/line-items-list.tsx` (`DisplayRow` ~104-157; optionally show meta only when present)

**Interfaces:**
- Consumes: `LineItem.confidence`, `LineItem.page`.
- Produces: description cell secondary line `87% · p.2`; pure helper `lineItemMeta(item): string | undefined` exported for tests if desired (optional — UI is thin).

Color map (no hardcoded oklch):

| Range | Class |
|---|---|
| ≥0.75 | `text-success-foreground` |
| ≥0.5 | `text-warning-foreground` |
| <0.5 | `text-destructive` |

- [ ] **Step 1: Add helper + render in DisplayRow**

In `line-items-list.tsx`, add near top (after imports):

```ts
function metaTone(confidence: number): string {
  if (confidence >= 0.75) return "text-success-foreground";
  if (confidence >= 0.5) return "text-warning-foreground";
  return "text-destructive";
}

/** `87% · p.2` — omit missing halves; undefined when neither present. */
export function lineItemMeta(item: Pick<LineItem, "confidence" | "page">): string | undefined {
  const parts: string[] = [];
  if (item.confidence !== undefined && Number.isFinite(item.confidence)) {
    parts.push(`${Math.round(item.confidence * 100)}%`);
  }
  if (item.page !== undefined) parts.push(`p.${item.page}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
```

Replace description cell in `DisplayRow`:

```tsx
      {/* Description */}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{item.description}</span>
        {(() => {
          const meta = lineItemMeta(item);
          if (!meta) return null;
          return (
            <span
              className={cn(
                "block font-mono text-xs",
                item.confidence !== undefined ? metaTone(item.confidence) : "text-muted-foreground",
              )}
            >
              {meta}
            </span>
          );
        })()}
      </span>
```

`InlineEditRow` (new manual rows): no confidence/page — leave unchanged.

- [ ] **Step 2: Unit-test the pure helper**

Create `src/components/ap/line-items-list.test.ts` — **only if** bun picks up tsx-adjacent tests cleanly; otherwise export helper from a tiny `src/lib/ap/line-item-meta.ts` and test there. Prefer the lib split for reliability:

Move `lineItemMeta` + `metaTone` to `src/lib/ap/line-item-meta.ts`:

```ts
import type { LineItem } from "./types";

export function metaTone(confidence: number): string {
  if (confidence >= 0.75) return "text-success-foreground";
  if (confidence >= 0.5) return "text-warning-foreground";
  return "text-destructive";
}

export function lineItemMeta(
  item: Pick<LineItem, "confidence" | "page">,
): string | undefined {
  const parts: string[] = [];
  if (item.confidence !== undefined && Number.isFinite(item.confidence)) {
    parts.push(`${Math.round(item.confidence * 100)}%`);
  }
  if (item.page !== undefined) parts.push(`p.${item.page}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
```

Test `src/lib/ap/line-item-meta.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { lineItemMeta, metaTone } from "./line-item-meta";

describe("lineItemMeta", () => {
  it("joins percent and page", () => {
    expect(lineItemMeta({ confidence: 0.87, page: 2 })).toBe("87% · p.2");
  });
  it("omits missing page", () => {
    expect(lineItemMeta({ confidence: 0.5 })).toBe("50%");
  });
  it("omits missing confidence", () => {
    expect(lineItemMeta({ page: 3 })).toBe("p.3");
  });
  it("returns undefined when neither present", () => {
    expect(lineItemMeta({})).toBeUndefined();
  });
  it("ignores non-finite confidence", () => {
    expect(lineItemMeta({ confidence: Number.NaN, page: 1 })).toBe("p.1");
  });
});

describe("metaTone", () => {
  it("maps thresholds", () => {
    expect(metaTone(0.75)).toBe("text-success-foreground");
    expect(metaTone(0.74)).toBe("text-warning-foreground");
    expect(metaTone(0.5)).toBe("text-warning-foreground");
    expect(metaTone(0.49)).toBe("text-destructive");
  });
});
```

Import in `line-items-list.tsx`:

```ts
import { lineItemMeta, metaTone } from "@/lib/ap/line-item-meta";
```

- [ ] **Step 3: Run tests**

Run: `bun test src/lib/ap/line-item-meta.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ap/line-item-meta.ts src/lib/ap/line-item-meta.test.ts src/components/ap/line-items-list.tsx
git commit -m "feat: per-row confidence % + source page in line items list"
```

---

### Task 7: Block-level ConfidenceChip (Draft header + summary + approval)

**Files:**
- Modify: `src/components/ap/draft-mapper.tsx` — `LineItemsField` header (~820-830); read-only summary header (~780-785)
- Modify: `src/routes/invoices.$id.tsx` — `linesEditor` (~558-622): add chip near CrossCheckLine or above LineItemsList

**Interfaces:**
- Consumes: `lineItemsBlockScore` from `@/lib/ap/confidence`; `ConfidenceChip` from `./status` (already imported in draft-mapper).

- [ ] **Step 1: DraftMapper LineItemsField header**

In `LineItemsField` header, after the count `<p>` (or between title and count):

```tsx
        <div className="flex items-center gap-2">
          <ConfidenceChip value={lineItemsBlockScore(invoice.lineItems)} />
          <p className="font-mono text-xs text-muted-foreground">
            {countOf(invoice.lineItems.length, "item")}
          </p>
        </div>
```

Import: `import { lineItemsBlockScore } from "@/lib/ap/confidence";` (add alongside existing ap imports).

`ConfidenceChip` already returns null for undefined and amber-below-0.75 — matches block semantics (worst row drives triage).

- [ ] **Step 2: Read-only summary block header**

In FieldsPane summary (`~780`), next to the count paragraph:

```tsx
            <span className="flex items-center gap-1.5">
              <ConfidenceChip value={lineItemsBlockScore(invoice.lineItems)} />
              <p className="text-xs font-mono text-muted-foreground">
                {invoice.lineItems.length} item{invoice.lineItems.length !== 1 ? "s" : ""}
              </p>
            </span>
```

- [ ] **Step 3: Approval linesEditor**

In `invoices.$id.tsx` `linesEditor`, above `<LineItemsList>` (after CrossCheckLine):

```tsx
      <div className="flex items-center justify-end">
        <ConfidenceChip value={lineItemsBlockScore(invoice.lineItems)} />
      </div>
```

Import `ConfidenceChip` from `@/components/ap/status` and `lineItemsBlockScore` from `@/lib/ap/confidence` (check existing imports first — add only if missing).

- [ ] **Step 4: Verify visually + lint**

Run: `npm run lint`
Expected: no new errors.

Manual check (optional): `npm run dev`, open a draft invoice with extracted line items — header shows chip; rows show `NN% · p.N`.

- [ ] **Step 5: Commit**

```bash
git add src/components/ap/draft-mapper.tsx src/routes/invoices.\$id.tsx
git commit -m "feat: block confidence chip on draft line-items header"
```

---

### Task 8: Full verification

- [ ] **Step 1: Full unit suite**

Run: `bun test`
Expected: only the 3 pre-existing `gemmaToFields` failures (same as baseline).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean (or no new errors vs baseline).

- [ ] **Step 3: Typecheck if available**

Check `package.json` for a `typecheck`/`tsc` script; if present run it. If not, run:

Run: `npx tsc --noEmit -p tsconfig.json` (or skip if tsconfig is vite-only with no emit config — note result).

- [ ] **Step 4: Routes smoke (optional, if playwright deps installed)**

Run: `npm run test:routes`
Expected: pass; skip if environment lacks browsers.

- [ ] **Step 5: Final commit if any fixups**

```bash
git add -A
git commit -m "chore: verify line-item confidence feature"
```

---

## Self-Review notes (writer)

1. **Spec coverage:** type ✓ (T1), VLM base ✓ (T2), OCR base ✓ (T3), template base+page ✓ (T4), central adjust ✓ (T5), per-row UI ✓ (T6), block chip draft+summary+approval ✓ (T7), tests ✓ each task, error handling (fallbacks/clamps/omit-missing) ✓ in helpers.
2. **Placeholders:** none — all steps carry code.
3. **Type consistency:** `scoreLineItems(items, subtotal?, total?)` used identically T1/T5; `lineItemsBlockScore(items)` T1/T7; `DEFAULT_BASE_CONFIDENCE` T1/T2/T3/T4; `lineItemMeta`/`metaTone` T6.
