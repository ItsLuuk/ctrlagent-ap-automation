# Inbox Bucket Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the invoice inbox into three buckets — Needs you / In flight / Later — and open the queue on Needs you instead of every record.

**Architecture:** Pure view-layer split. Bucket constants + an exhaustive `Record<InvoiceStatus, Bucket>` go in `types.ts` beside the existing `AWAITING_PERSON`; `src/routes/index.tsx` swaps its `"all"`-centric `Filter` union for the three buckets (default `needsYou`), rebuilds the tab strip with per-bucket counts, and sorts per-bucket. No state-machine, store, or data-shape changes.

**Tech Stack:** TanStack Start/Router, React 19, Tailwind v4, bun test (unit), Playwright (e2e).

## Global Constraints

- Every `InvoiceStatus` (9 values) lands in exactly one bucket; compile-time exhaustiveness via `Record<InvoiceStatus, Bucket>` — no status may be unmapped or double-mapped.
- Bucket membership: Needs you = `vendor_profile, draft, review, failed`; In flight = `processing`; Later = `scheduled, rejected, paid, archived`.
- No `"All"` tab. Default filter = `"needsYou"`.
- `history` and `removed` filters keep current behavior: appended as tabs only when their counts > 0; their row rendering, sort, and Restore/Archive actions unchanged.
- Tab counts hide at 0 (label only); the three bucket tabs always render.
- Vocabulary: canonical words only (`queue`, `invoice`, `judgment`) — `vocabulary.test.ts` scans `src/routes` copy; avoid banned synonyms (`backlog`, `worklist`) and banned words (`error`).
- Zero-state copy for empty Needs you uses the brand line: "Nothing needs your judgment right now."
- This working directory is **not a git repository** — skip all commit steps; verification is tests + lint only.
- Full spec: `docs/superpowers/specs/2026-09-23-inbox-bucket-split-design.md`.

---

### Task 1: Bucket constants + exhaustiveness test

**Files:**
- Modify: `src/lib/ap/types.ts:29-39` (immediately after `AWAITING_PERSON`, before `APPROVAL_AHEAD`)
- Test: `src/lib/ap/buckets.test.ts` (new)

**Interfaces:**
- Consumes: existing `AWAITING_PERSON`, `InvoiceStatus` from `src/lib/ap/types.ts`
- Produces: `NEEDS_YOU: InvoiceStatus[]`, `IN_FLIGHT: InvoiceStatus[]`, `LATER: InvoiceStatus[]`, `Bucket` type, `BUCKET_BY_STATUS: Record<InvoiceStatus, Bucket>` — consumed by Task 2

- [ ] **Step 1: Write the failing test**

Create `src/lib/ap/buckets.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  AWAITING_PERSON,
  BUCKET_BY_STATUS,
  IN_FLIGHT,
  LATER,
  NEEDS_YOU,
  type Bucket,
  type InvoiceStatus,
} from "./types";

const ALL_STATUSES: InvoiceStatus[] = [
  "vendor_profile",
  "draft",
  "review",
  "scheduled",
  "rejected",
  "paid",
  "archived",
  "processing",
  "failed",
];

describe("inbox buckets", () => {
  test("NEEDS_YOU aliases AWAITING_PERSON", () => {
    expect(NEEDS_YOU).toEqual(AWAITING_PERSON);
  });

  test("IN_FLIGHT is processing only", () => {
    expect(IN_FLIGHT).toEqual(["processing"]);
  });

  test("LATER is scheduled, rejected, paid, archived", () => {
    expect(LATER).toEqual(["scheduled", "rejected", "paid", "archived"]);
  });

  test("every status maps to exactly one bucket", () => {
    const bucketOf = (s: InvoiceStatus): Bucket => BUCKET_BY_STATUS[s];
    for (const s of ALL_STATUSES) {
      const memberships = [
        NEEDS_YOU.includes(s),
        IN_FLIGHT.includes(s),
        LATER.includes(s),
      ].filter(Boolean);
      expect(memberships, `${s} must sit in exactly one bucket`).toHaveLength(1);
      expect(bucketOf(s)).toBeDefined();
    }
  });

  test("BUCKET_BY_STATUS agrees with the three lists", () => {
    for (const s of ALL_STATUSES) {
      if (NEEDS_YOU.includes(s)) expect(BUCKET_BY_STATUS[s]).toBe("needsYou");
      else if (IN_FLIGHT.includes(s)) expect(BUCKET_BY_STATUS[s]).toBe("inFlight");
      else expect(BUCKET_BY_STATUS[s]).toBe("later");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/ap/buckets.test.ts`
Expected: FAIL — `BUCKET_BY_STATUS` (and siblings) not exported from `./types`.

- [ ] **Step 3: Add constants to `src/lib/ap/types.ts`**

Insert after line 29 (`export const AWAITING_PERSON ...`):

```ts
/** The inbox opens here: every stage whose next step is a person's. Same set
 *  as AWAITING_PERSON — the name reads correctly at tab/filter call sites. */
export const NEEDS_YOU = AWAITING_PERSON;

/** The machine mid-read: nothing for a person to do until it lands or fails. */
export const IN_FLIGHT: InvoiceStatus[] = ["processing"];

/** Waiting on handoff or already settled — real, but not today's work. */
export const LATER: InvoiceStatus[] = ["scheduled", "rejected", "paid", "archived"];

export type Bucket = "needsYou" | "inFlight" | "later";

/** Exhaustive by type: adding an InvoiceStatus without a bucket is a compile error. */
export const BUCKET_BY_STATUS: Record<InvoiceStatus, Bucket> = {
  vendor_profile: "needsYou",
  draft: "needsYou",
  review: "needsYou",
  failed: "needsYou",
  processing: "inFlight",
  scheduled: "later",
  rejected: "later",
  paid: "later",
  archived: "later",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/ap/buckets.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run full unit suite for regressions**

Run: `bun test src/lib/ap/`
Expected: all PASS (no existing test imports these names, so only unexpected breakage fails here).

---

### Task 2: Inbox route — filter, tabs, counts, sort

**Files:**
- Modify: `src/routes/index.tsx` — `Filter` type (line 58), `filterLabel` (89-94), default state (107), `counts` (110-120), `filters` (129-138), `active` fallback (142), `rows` (144-177), empty-state block (508-521), tab count badge (335), subtitle (312-320)

**Interfaces:**
- Consumes: `NEEDS_YOU`, `IN_FLIGHT`, `LATER`, `Bucket`, `BUCKET_BY_STATUS` from Task 1 (extend the existing `@/lib/ap/types` import at lines 21-29)
- Produces: rendered inbox with three bucket tabs defaulting to `needsYou`; no exported API

- [ ] **Step 1: Replace the `Filter` union and default**

Line 58 becomes:

```ts
type Filter = Bucket | "history" | "removed";
```

Line 107 becomes:

```ts
const [filter, setFilter] = useState<Filter>("needsYou");
```

Extend the `@/lib/ap/types` import (lines 21-29) to add `BUCKET_BY_STATUS`, `IN_FLIGHT`, `LATER`, `NEEDS_YOU`, `type Bucket`. Drop `STATUS_ORDER` from the import if Step 3 removes its last use.

- [ ] **Step 2: Rewrite `filterLabel`**

Replace lines 89-94:

```ts
/** The name a tab shows. Buckets have fixed names; history/removed are their own lists. */
function filterLabel(filter: Filter): string {
  if (filter === "needsYou") return "Needs you";
  if (filter === "inFlight") return "In flight";
  if (filter === "later") return "Later";
  if (filter === "history") return "History";
  if (filter === "removed") return "Removed";
  return filter;
}
```

- [ ] **Step 3: Rebuild `counts`**

Replace lines 110-120:

```ts
const counts = useMemo(() => {
  const map = {
    needsYou: 0,
    inFlight: 0,
    later: 0,
    history: history.length,
    removed: removed.length,
  } as Record<Filter, number>;
  for (const i of invoices) map[BUCKET_BY_STATUS[i.status]] += 1;
  return map;
}, [invoices, history, removed]);
```

(`STATUS_ORDER` no longer used in `counts`.)

- [ ] **Step 4: Rebuild the tab list `filters`**

Replace lines 122-138 (including the old doc comment):

```ts
/**
 * The three buckets always render — they are the inbox's structure, not a
 * population-dependent offer. History and Removed stay conditional: a tab that
 * could only show an empty list is noise.
 */
const filters = useMemo(() => {
  const tabs: Filter[] = ["needsYou", "inFlight", "later"];
  if (counts.history > 0) tabs.push("history");
  if (counts.removed > 0) tabs.push("removed");
  return tabs;
}, [counts]);
```

Line 142 fallback becomes:

```ts
const active = filters.includes(filter) ? filter : (filters[0] ?? "needsYou");
```

- [ ] **Step 5: Filter + sort `rows` per bucket**

Replace the non-history/non-removed branch of `rows` (lines 159-176), keeping `matchesQuery`, history, and removed branches unchanged:

```ts
// Needs you leads with the costliest wait (failed, then approval, then the
// two draft stages). In flight sorts newest first — the spinner rows are the
// youngest. Later ranks scheduled → rejected → paid → archived, then newest.
const needsYouOrder: Partial<Record<InvoiceStatus, number>> = {
  failed: 0,
  review: 1,
  vendor_profile: 2,
  draft: 3,
};
const laterOrder: Partial<Record<InvoiceStatus, number>> = {
  scheduled: 0,
  rejected: 1,
  paid: 2,
  archived: 3,
};
const byRecency = (a: (typeof invoices)[number], b: (typeof invoices)[number]) =>
  new Date(b.issueDate || b.createdAt).getTime() - new Date(a.issueDate || a.createdAt).getTime();

const bucketRows = invoices.filter((i) => {
  const bucket = BUCKET_BY_STATUS[i.status];
  return (
    (active === "needsYou" && bucket === "needsYou") ||
    (active === "inFlight" && bucket === "inFlight") ||
    (active === "later" && bucket === "later")
  );
});

return bucketRows.filter(matchesQuery).sort((a, b) => {
  if (active === "needsYou")
    return (needsYouOrder[a.status] ?? 99) - (needsYouOrder[b.status] ?? 99);
  if (active === "later") return (laterOrder[a.status] ?? 99) - (laterOrder[b.status] ?? 99);
  return byRecency(a, b); // inFlight
});
```

Remove the old `attentionOrder` block (lines 159-176) it replaces. `InvoiceStatus` import stays (used by the order maps).

- [ ] **Step 6: Hide zero counts on tab badges**

Line 335 — replace the always-on count span:

```tsx
{filterLabel(f)}
{counts[f] > 0 ? (
  <span className="ml-1.5 font-mono opacity-60">{counts[f]}</span>
) : null}
```

- [ ] **Step 7: Per-bucket subtitle + empty state**

Subtitle — replace the bucket branch of lines 317-319 (history/removed branches unchanged) so each bucket names its own condition:

```tsx
: active === "inFlight"
  ? countOf(totals.inFlight, "invoice") === "1 invoice"
    ? "1 invoice is processing."
    : `${countOf(totals.inFlight, "invoice")} are processing.`
  : active === "later"
    ? `${countOf(totals.later, "invoice")} waiting for handoff or done.`
    : totals.needsYou > 0
      ? `${countOf(totals.needsYou, "invoice")} ${totals.needsYou === 1 ? "needs" : "need"} your judgment.`
      : "Nothing needs your judgment right now."
```

Add to the `totals` memo (lines 179-192):

```ts
inFlight: invoices.filter((i) => IN_FLIGHT.includes(i.status)).length,
later: invoices.filter((i) => LATER.includes(i.status)).length,
```

(These are counts, not money lists — store numbers, not arrays; adjust `sumOf` callers only if you convert — do NOT: keep `needsYou` as-is for the Stat tile, add the two new fields as numbers.)

Empty table — replace lines 508-521 body so an empty bucket is not blamed on search:

```tsx
{rows.length === 0 && (
  <tr>
    <td colSpan={8} className="px-4 py-12 text-center">
      {query.trim() ? (
        <>
          <p className="text-sm font-medium">No record matches your search.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Clear the search to see the whole list.
          </p>
        </>
      ) : active === "needsYou" ? (
        <p className="text-sm font-medium">Nothing needs your judgment right now.</p>
      ) : active === "inFlight" ? (
        <p className="text-sm font-medium">Nothing is processing right now.</p>
      ) : active === "later" ? (
        <p className="text-sm font-medium">Nothing is waiting for later.</p>
      ) : (
        <p className="text-sm font-medium">No record matches your search.</p>
      )}
    </td>
  </tr>
)}
```

- [ ] **Step 8: Verify `STATUS_ORDER` usage**

Run: `grep -n "STATUS_ORDER" src/routes/index.tsx`
If only the import remains, remove `STATUS_ORDER` from the import list (lines 21-29). If other uses exist, leave the import.

- [ ] **Step 9: Lint the touched files**

Run: `npx eslint src/routes/index.tsx src/lib/ap/types.ts src/lib/ap/buckets.test.ts`
Expected: no errors. Fix any unused-import complaints (likely `STATUS_ORDER`, possibly `InvoiceStatus` if TypeScript flags it — it is still used, do not remove).

- [ ] **Step 10: Run unit suite**

Run: `bun test src/lib/ap/`
Expected: all PASS.

---

### Task 3: E2E smoke markers + full verification

**Files:**
- Modify: `tests/e2e/routes-smoke.spec.ts:43-50` (`SCREENS["/"].seeded` markers)

**Interfaces:**
- Consumes: bucket tab labels `Needs you`, `In flight`, `Later` rendered by Task 2
- Produces: smoke suite asserting the new default surface

Context: seeded fixtures are Northwind (`review`), Atlas (`draft`), Helix+Vertex (`scheduled`), plus coverage clones for `vendor_profile`/`failed`/`processing`/`rejected`. Default tab `needsYou` therefore shows Northwind + Atlas + vendor_profile clone + failed clone; `In flight` shows the processing clone; `Later` shows Helix + Vertex + rejected clone. The existing marker `Northwind Cloud Systems` still passes on the default tab — the gap is that nothing asserts the split itself.

- [ ] **Step 1: Update seeded markers for `/`**

Replace lines 44-50:

```ts
"/": {
  seeded: [
    "Invoice inbox",
    "Work queue",
    "Needs you",
    "In flight",
    "Later",
    "Northwind Cloud Systems",
  ],
  empty: ["No invoices yet", "Upload invoice", "The system handles the routine"],
},
```

Do not assert absence of `Helix Legal LLP` here — `assertRendered` is containment-only; the Later-tab exclusion is covered by Task 1's partition test plus manual check below.

- [ ] **Step 2: Run the routes smoke suite**

Run: `bun run test:routes`
Expected: all PASS. Failure modes and fixes:
- `"/ rendered without "needs you"` → tab label mismatch in `filterLabel` (Task 2 Step 2).
- `"/ rendered without "Northwind Cloud Systems"` → default filter is not `needsYou` or bucket membership wrong.
- Any error-surface assertion → runtime exception in `index.tsx`; read the test output message for the thrown error.

- [ ] **Step 3: Run the full unit suite**

Run: `bun test src/lib/ap/`
Expected: all PASS (445+ tests).

- [ ] **Step 4: Lint the whole repo**

Run: `npm run lint`
Expected: no new errors (repo may carry pre-existing warnings — compare against files touched: `types.ts`, `index.tsx`, `buckets.test.ts`, `routes-smoke.spec.ts`).

- [ ] **Step 5: Manual verification (dev server)**

Run: `npm run dev`, open the app:

1. Default landing shows **Needs you** tab active with its count badge; In flight and Later tabs visible with correct counts.
2. Upload an invoice → row appears under **In flight** (click the tab) with spinner row; count moves.
3. Job completes → row leaves In flight, appears under Needs you; badge counts update without reload.
4. Needs you empty (clear/complete everything or fresh storage) → "Nothing needs your judgment right now."
5. History/Removed tabs still appear only when non-empty and render unchanged.

- [ ] **Step 6: Run the CSV export regression**

Run: `bun run test:e2e tests/e2e/csv-export.spec.ts`
Expected: PASS — the Export CSV button lives in the stat band (untouched), but this confirms the default-tab change did not hide the promoted scheduled sample path.

---

## Self-Review Notes

- Spec coverage: constants (Task 1), Filter/default/tabs/counts/sort/empty states (Task 2), smoke + manual checks (Task 3). Stat band and row rendering intentionally untouched per spec.
- No placeholders: every step carries exact code or exact commands.
- Type consistency: `Bucket`, `BUCKET_BY_STATUS`, `NEEDS_YOU`, `IN_FLIGHT`, `LATER` named identically across Task 1 definition, Task 2 usage, and Task 1's test.
- Deviation from spec §"history/removed": spec's "not tabs" phrasing meant "not bucket tabs" — they remain conditional tabs exactly as today (per Q3 decision "stay behind their existing filters"). Implemented as unchanged behavior.
