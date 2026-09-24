# Editable Line-Item Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every line-item row on the Draft screen always editable (spreadsheet-style), sharing one field-input component between existing and new rows.

**Architecture:** Extract presentational `RowFields` from the current `InlineEditRow` in `line-items-list.tsx`. Existing rows render a new `EditableRow` that holds local string drafts (so typing `1.` works), validates via a pure `parseLineItemDraft` helper, and commits patches upstream through the existing `onChange(items)` contract. Non-editable contexts (frozen approval invoices) keep rendering `DisplayRow`. New-row add flow keeps its `adding` state but reuses `RowFields` for markup.

**Tech Stack:** React 19 + TypeScript, Vite, bun:test for unit tests, ESLint.

**Spec:** `docs/superpowers/specs/2026-09-24-editable-line-item-rows-design.md`

## Global Constraints

- Only `glAccount`, `department`, `page` are preserved untouched on edit — never exposed as inputs.
- Do not write invalid edits upstream: description (trimmed) required, `quantity > 0`, `unitPrice > 0` (mirrors `commitNewRow`'s `amount > 0` check).
- Editability gates unchanged: Draft passes `editable` + `onChange`; approval passes `editable={canEdit}` and `onChange` only when editable. `LineItemsList` keeps `if (!onChange) return` guards.
- Approval route's 700ms debounce lives upstream (`invoices.$id.tsx`) — do not touch it.
- Commits: `git add` only files belonging to the task (working tree has unrelated changes; never `git add -A`).
- Unit tests use `bun:test` (`describe`/`it`/`expect`), colocated as `*.test.ts`.
- No new dependencies.

---

### Task 1: Pure draft-validation helper

**Files:**
- Create: `src/lib/ap/line-item-edit.ts`
- Test: `src/lib/ap/line-item-edit.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces: `parseLineItemDraft(draft: LineItemDraft): ParsedLineItemEdit` — used by Task 2's `EditableRow`. Types:

```ts
export type LineItemDraft = {
  description: string;
  quantity: string;   // raw input string, e.g. "1." or "2,5"
  unitPrice: string;  // raw input string
};

export type ParsedLineItemEdit =
  | { ok: false }
  | {
      ok: true;
      description: string; // trimmed
      quantity: number;
      unitPrice: number;
      amount: number;      // quantity * unitPrice
    };
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/ap/line-item-edit.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { parseLineItemDraft } from "./line-item-edit";

describe("parseLineItemDraft", () => {
  it("parses a valid draft and computes amount", () => {
    expect(
      parseLineItemDraft({ description: "Widget", quantity: "2", unitPrice: "10.5" }),
    ).toEqual({ ok: true, description: "Widget", quantity: 2, unitPrice: 10.5, amount: 21 });
  });

  it("trims description and accepts comma decimal separator", () => {
    expect(
      parseLineItemDraft({ description: "  Bolt  ", quantity: "1", unitPrice: "2,5" }),
    ).toEqual({ ok: true, description: "Bolt", quantity: 1, unitPrice: 2.5, amount: 2.5 });
  });

  it("rejects blank description", () => {
    expect(parseLineItemDraft({ description: "   ", quantity: "1", unitPrice: "5" })).toEqual({
      ok: false,
    });
  });

  it("rejects non-numeric quantity and price", () => {
    expect(parseLineItemDraft({ description: "X", quantity: "abc", unitPrice: "5" })).toEqual({
      ok: false,
    });
    expect(parseLineItemDraft({ description: "X", quantity: "1", unitPrice: "abc" })).toEqual({
      ok: false,
    });
  });

  it("rejects empty, zero, and negative quantity", () => {
    expect(parseLineItemDraft({ description: "X", quantity: "", unitPrice: "5" })).toEqual({
      ok: false,
    });
    expect(parseLineItemDraft({ description: "X", quantity: "0", unitPrice: "5" })).toEqual({
      ok: false,
    });
    expect(parseLineItemDraft({ description: "X", quantity: "-2", unitPrice: "5" })).toEqual({
      ok: false,
    });
  });

  it("rejects empty, zero, and negative unit price (amount must be > 0)", () => {
    expect(parseLineItemDraft({ description: "X", quantity: "1", unitPrice: "" })).toEqual({
      ok: false,
    });
    expect(parseLineItemDraft({ description: "X", quantity: "1", unitPrice: "0" })).toEqual({
      ok: false,
    });
    expect(parseLineItemDraft({ description: "X", quantity: "1", unitPrice: "-1" })).toEqual({
      ok: false,
    });
  });

  it("accepts in-progress decimal like '1.'", () => {
    expect(parseLineItemDraft({ description: "X", quantity: "1.", unitPrice: "1" })).toEqual({
      ok: true,
      description: "X",
      quantity: 1,
      unitPrice: 1,
      amount: 1,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/ap/line-item-edit.test.ts`
Expected: FAIL — module `./line-item-edit` not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/ap/line-item-edit.ts`:

```ts
export type LineItemDraft = {
  description: string;
  quantity: string;
  unitPrice: string;
};

export type ParsedLineItemEdit =
  | { ok: false }
  | {
      ok: true;
      description: string;
      quantity: number;
      unitPrice: number;
      amount: number;
    };

export function parseLineItemDraft(draft: LineItemDraft): ParsedLineItemEdit {
  const description = draft.description.trim();
  const quantity = Number(draft.quantity);
  const unitPrice = Number(draft.unitPrice.replace(",", "."));
  if (!description) return { ok: false };
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false };
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return { ok: false };
  const amount = quantity * unitPrice;
  if (!(amount > 0)) return { ok: false };
  return { ok: true, description, quantity, unitPrice, amount };
}
```

Note: `Number("1.") === 1` and `Number("") === 0`, so in-progress decimals parse and empty/zero values are rejected by the guards above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/ap/line-item-edit.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ap/line-item-edit.ts src/lib/ap/line-item-edit.test.ts
git commit -m "feat: add parseLineItemDraft validation helper"
```

---

### Task 2: Extract `RowFields`; new row reuses it

**Files:**
- Modify: `src/components/ap/line-items-list.tsx` (replace `InlineEditRow`, lines 21–100)

**Interfaces:**
- Consumes: nothing new.
- Produces: `RowFields` component (not exported — file-local) with props:

```ts
type RowFieldsProps = {
  description: string;
  quantity: string;
  unitPrice: string;
  currency: string;
  onDescriptionChange: (v: string) => void;
  onQuantityChange: (v: string) => void;
  onUnitPriceChange: (v: string) => void;
  autoFocus?: boolean;
  isLast: boolean;
  deleteButton?: React.ReactNode;
};
```

`deleteButton` occupies the 5th grid column when provided; otherwise render an empty `<span />` (current spacer). Task 3 passes the delete button through this prop.

- [ ] **Step 1: Replace `InlineEditRow` with `RowFields`**

In `src/components/ap/line-items-list.tsx`, delete the `InlineEditRow` function (lines 21–100) and insert in its place:

```tsx
/* ── Shared editable field cells ────────────────────────────────────── */

function RowFields({
  description,
  quantity,
  unitPrice,
  currency,
  onDescriptionChange,
  onQuantityChange,
  onUnitPriceChange,
  autoFocus,
  isLast,
  deleteButton,
}: {
  description: string;
  quantity: string;
  unitPrice: string;
  currency: string;
  onDescriptionChange: (v: string) => void;
  onQuantityChange: (v: string) => void;
  onUnitPriceChange: (v: string) => void;
  autoFocus?: boolean;
  isLast: boolean;
  deleteButton?: React.ReactNode;
}) {
  const descRef = useRef<HTMLInputElement>(null);
  const qty = Number(quantity) || 0;
  const price = Number(unitPrice.replace(",", ".")) || 0;
  const amount = qty * price;

  useEffect(() => {
    if (!autoFocus) return;
    // Small delay to ensure the row is rendered before focusing
    const timer = setTimeout(() => descRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [autoFocus]);

  return (
    <div
      className={cn(
        "group grid items-center gap-2 px-4 py-2.5 sm:grid-cols-[1fr_70px_100px_90px_32px]",
        !isLast && "border-b border-border/60",
      )}
    >
      {/* Description */}
      <input
        ref={descRef}
        type="text"
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        placeholder="Description"
        className="min-w-0 truncate rounded-sm bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 focus-visible:bg-accent/60"
      />

      {/* Quantity */}
      <input
        type="text"
        inputMode="numeric"
        value={quantity}
        onChange={(e) => onQuantityChange(e.target.value)}
        placeholder="1"
        className="w-full rounded-sm bg-transparent font-mono text-sm text-right outline-none placeholder:text-muted-foreground/50 focus-visible:bg-accent/60"
      />

      {/* Unit price */}
      <input
        type="text"
        inputMode="decimal"
        value={unitPrice}
        onChange={(e) => onUnitPriceChange(e.target.value)}
        placeholder="0.00"
        className="w-full rounded-sm bg-transparent font-mono text-sm text-right outline-none placeholder:text-muted-foreground/50 focus-visible:bg-accent/60"
      />

      {/* Amount (computed, read-only) */}
      <span className="font-mono text-sm text-right text-foreground">
        {amount > 0 ? money(amount, currency) : ""}
      </span>

      {/* Delete or spacer */}
      {deleteButton ?? <span />}
    </div>
  );
}
```

- [ ] **Step 2: Point the add-row render at `RowFields`**

Replace the `adding &&` block (currently rendering `InlineEditRow`, ~lines 289–301) with:

```tsx
{adding && (
  <RowFields
    description={newDesc}
    quantity={newQty}
    unitPrice={newPrice}
    currency={currency}
    onDescriptionChange={setNewDesc}
    onQuantityChange={setNewQty}
    onUnitPriceChange={setNewPrice}
    autoFocus
    isLast
  />
)}
```

Also add `group` to the row container class in `RowFields` (already included above) so Task 3's delete-button hover styles work; `InlineEditRow` previously lacked it, `DisplayRow` had it — no other markup changes.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS (no unused `InlineEditRow`, no TS errors).

- [ ] **Step 4: Commit**

```bash
git add src/components/ap/line-items-list.tsx
git commit -m "refactor: extract RowFields from InlineEditRow"
```

---

### Task 3: `EditableRow` for committed items

**Files:**
- Modify: `src/components/ap/line-items-list.tsx` (add `EditableRow`, change `items.map` render, add `handleCommitRow`)

**Interfaces:**
- Consumes: `RowFields` (Task 2), `parseLineItemDraft` from `@/lib/ap/line-item-edit` (Task 1), existing `LineItem` type, `DisplayRow` (kept as-is for read-only mode).
- Produces: behavior only — no exports beyond the existing `LineItemsList`.

- [ ] **Step 1: Add `EditableRow` after `DisplayRow`**

```tsx
/* ── Editable row (committed item) ──────────────────────────────────── */

function EditableRow({
  item,
  currency,
  onCommit,
  onDelete,
  isLast,
}: {
  item: LineItem;
  currency: string;
  onCommit: (next: LineItem) => void;
  onDelete: () => void;
  isLast: boolean;
}) {
  // Local string drafts so in-progress input like "1." or "2," survives
  // re-render; keyed by item.id at the call site (remounts on id change).
  const [description, setDescription] = useState(item.description);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [unitPrice, setUnitPrice] = useState(String(item.unitPrice));

  const commit = useCallback(
    (draft: LineItemDraft) => {
      const parsed = parseLineItemDraft(draft);
      if (!parsed.ok) return; // invalid → local input keeps typed text, no upstream write
      onCommit({ ...item, ...parsed });
    },
    [item, onCommit],
  );

  const deleteButton = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
      className="justify-self-end rounded-sm p-1 text-muted-foreground/0 transition-colors ease-out-expo hover:bg-destructive/10 hover:text-destructive group-hover:text-muted-foreground"
      aria-label={`Remove ${description || item.description}`}
    >
      <X className="size-3.5" />
    </button>
  );

  return (
    <RowFields
      description={description}
      quantity={quantity}
      unitPrice={unitPrice}
      currency={currency}
      onDescriptionChange={(v) => {
        setDescription(v);
        commit({ description: v, quantity, unitPrice });
      }}
      onQuantityChange={(v) => {
        setQuantity(v);
        commit({ description, quantity: v, unitPrice });
      }}
      onUnitPriceChange={(v) => {
        setUnitPrice(v);
        commit({ description, quantity, unitPrice: v });
      }}
      isLast={isLast}
      deleteButton={deleteButton}
    />
  );
}
```

Add imports at top of file:

```tsx
import { parseLineItemDraft, type LineItemDraft } from "@/lib/ap/line-item-edit";
```

(`useState`, `useCallback`, `useRef`, `useEffect` are already imported.)

- [ ] **Step 2: Add `handleCommitRow` in `LineItemsList`**

Insert after `handleDelete`:

```tsx
const handleCommitRow = useCallback(
  (id: string, next: LineItem) => {
    if (!onChange) return;
    onChange(items.map((li) => (li.id === id ? { ...li, ...next } : li)));
  },
  [items, onChange],
);
```

`{ ...li, ...next }` — `next` carries only `description`/`quantity`/`unitPrice`/`amount` (from `parseLineItemDraft` spread into a full `LineItem` inside `EditableRow` via `{ ...item, ...parsed }`), so `id`, `glAccount`, `department`, `page` are preserved.

- [ ] **Step 3: Render `EditableRow` for committed items when editable**

Replace the `items.map` block (~lines 277–286):

```tsx
{items.map((item, index) =>
  editable && onChange ? (
    <EditableRow
      key={item.id}
      item={item}
      currency={currency}
      onCommit={(next) => handleCommitRow(item.id, next)}
      onDelete={() => handleDelete(item.id)}
      isLast={!adding && index === items.length - 1}
    />
  ) : (
    <DisplayRow
      key={item.id}
      item={item}
      currency={currency}
      editable={editable}
      onDelete={() => handleDelete(item.id)}
      isLast={!adding && index === items.length - 1}
    />
  ),
)}
```

- [ ] **Step 4: Run lint + unit tests**

Run: `npm run lint`
Expected: PASS.

Run: `bun test src/lib/ap/line-item-edit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ap/line-items-list.tsx
git commit -m "feat: make existing line-item rows always editable"
```

---

### Task 4: Verification

**Files:** none (read-only checks + existing suites)

- [ ] **Step 1: Full lint + unit tests**

Run: `npm run lint`
Expected: PASS.

Run: `bun test src/lib/ap/line-item-edit.test.ts`
Expected: PASS.

- [ ] **Step 2: Routes smoke (if environment allows)**

Run: `npm run test:routes`
Expected: PASS (or note if Playwright browsers are unavailable in this environment — do not block on setup).

- [ ] **Step 3: Manual checks (Draft screen)**

Start `npm run dev`, open a draft uploaded invoice, confirm:

1. Existing rows show inputs; editing description/qty/unit price updates Amount live and persists after navigation away/back.
2. `glAccount`/`department` untouched (not visible as inputs).
3. "+ Add item" flow unchanged: Cancel discards, Add commits valid row, empty row closes without adding.
4. Delete (X) still works on every row, hover-revealed.
5. Frozen approval invoice (status not draft / frozen) still renders read-only spans + no add button.

- [ ] **Step 4: Note results**

Record pass/fail per check in the final report to the user. No commit needed for this task unless a fix was required (then commit the fix separately with `git add <fixed files>`).

---

## Self-Review

- **Spec coverage:** shared `RowFields` (Task 2) ✓; always-editable existing rows (Task 3) ✓; validation mirror of `commitNewRow` (Task 1) ✓; gates unchanged / `DisplayRow` kept for frozen (Task 3 Step 3) ✓; `glAccount`/`department`/`page` preserved (Task 3 Step 2) ✓; debounce untouched (Global Constraints) ✓; testing per spec (Task 1 unit tests + Task 4 manual) ✓.
- **Placeholders:** none — all steps carry concrete code.
- **Type consistency:** `LineItemDraft`/`ParsedLineItemEdit` defined Task 1, imported Task 3 with same names; `RowFields` props defined Task 2, used identically Tasks 2–3; `handleCommitRow(id, next: LineItem)` signature matches call site.
