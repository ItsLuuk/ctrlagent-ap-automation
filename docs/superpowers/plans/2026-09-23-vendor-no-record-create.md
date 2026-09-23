# Vendor No-Record Create — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reviewer create a missing vendor master record from the `vendor:no-record` row on the invoice review screen.

**Architecture:** Optional `action` flag on the pure `ApprovalCheck` verdict; `ApprovalCompare` gains a presentational `checkActions` slot; the route supplies a `CreateVendorRecordButton` that opens a dialog seeded via `seedProfileFromInvoice`, gated by `vendorProfileGaps`, saving only through `upsertVendor`. No invoice patch, no state transition.

**Tech Stack:** React 19, Tailwind v4, TanStack Router/Start, `bun:test`, sonner toasts.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-23-vendor-no-record-create-design.md`.
- `approval.ts` stays pure — no store/UI imports.
- Create path never calls `updateInvoice`, `setStatus`, `linkPo`, or `applyTransition`.
- Registration gate unchanged: name + business registration + checksum-valid IBAN (`vendorProfileGaps`).
- Action available on frozen invoices (no `canEdit` gate).
- After every task: `bun test`; touched files via `npx prettier --write` and `npx eslint`.
- Full `npm run lint` times out locally — do not run it.

---

### Task 1: Action flag on the pure verdict

**Files:**
- Modify: `src/lib/ap/approval.ts` (type + `identityChecks`)
- Test: `src/lib/ap/approval.test.ts`

**Interfaces:**
- Consumes: existing `ApprovalCheck`, `identityChecks`, `verdictFor`.
- Produces: `ApprovalCheck.action?: "create-vendor-record" | undefined`; `vendor:no-record` sets it. Later tasks read `check.action` only as "route may supply an action node."

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ap/approval.test.ts` (after the existing `says so once when we hold no vendor record` test, same `describe` / helpers):

```ts
it("offers the create-record action only on the missing-record row", () => {
  const verdict = verdictFor({}, { record: undefined });
  const noRecord = verdict.checks.find((c) => c.id === "vendor:no-record")!;
  expect(noRecord.action).toBe("create-vendor-record");

  const full = verdictFor();
  expect(full.checks.some((c) => c.action !== undefined)).toBe(false);
});
```

- [ ] **Step 2: Run test — fail**

Run: `bun test src/lib/ap/approval.test.ts`
Expected: FAIL — `action` is `undefined` on `vendor:no-record`.

- [ ] **Step 3: Implement**

In `src/lib/ap/approval.ts`, on `ApprovalCheck` (after `code?:`, near `corrected?`):

```ts
/** Offered by the row itself when the gap can be filled in place. */
action?: "create-vendor-record" | undefined;
```

In `identityChecks`, `!record` branch (the object with `id: "vendor:no-record"`), add:

```ts
action: "create-vendor-record",
```

No other check sets `action`.

- [ ] **Step 4: Run test — pass**

Run: `bun test src/lib/ap/approval.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + format**

Run: `npx prettier --write src/lib/ap/approval.ts src/lib/ap/approval.test.ts; npx eslint src/lib/ap/approval.ts src/lib/ap/approval.test.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ap/approval.ts src/lib/ap/approval.test.ts
git commit -m "feat: mark vendor:no-record row with create-record action"
```

---

### Task 2: `checkActions` slot in ApprovalCompare

**Files:**
- Modify: `src/components/ap/approval-compare.tsx`

**Interfaces:**
- Consumes: `ApprovalCheck` from Task 1 (`action` unused by this file — slot is generic by check id).
- Produces: `ApprovalCompare` / `Group` / `CheckRow` accept `checkActions?: Record<string, ReactNode>`; renders node under `detail` when present. Route (Task 5) passes `{ "vendor:no-record": <button …> }`.

- [ ] **Step 1: Extend props**

Find `CheckRow` props type and its `GroupProps` type; add to both (and thread through `Group` → `row` → `CheckRow`, same way `checkEditors` is threaded):

```ts
/** Route-supplied action node(s), keyed by check id. */
checkActions?: Record<string, ReactNode> | undefined;
```

- `ApprovalCompare` root component: accept `checkActions`, pass into each `Group`.
- `Group`: destructure `checkActions`, pass into `CheckRow`.

- [ ] **Step 2: Render in CheckRow**

After the `check.detail` block, still inside the `ListItem`:

```tsx
{action ? <div className="mt-2">{action}</div> : null}
```

Where `action` is resolved at the top of the render body:

```tsx
const action = checkActions?.[check.id];
```

(`CheckRow` must receive `checkActions` prop.)

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit; npx eslint src/components/ap/approval-compare.tsx; npx prettier --write src/components/ap/approval-compare.tsx`
Expected: clean; no behavior change without `checkActions`.

- [ ] **Step 4: Run suite**

Run: `bun test`
Expected: PASS (no component tests; regression only).

- [ ] **Step 5: Commit**

```bash
git add src/components/ap/approval-compare.tsx
git commit -m "feat: render route-supplied action nodes on approval rows"
```

---

### Task 3: Share `seedProfileFromInvoice`

**Files:**
- Modify: `src/lib/ap/vendor-master.ts` (move + export)
- Modify: `src/components/ap/vendor-profile-registration.tsx` (import instead of local fn)

**Interfaces:**
- Consumes: `VendorMaster`, `Invoice`.
- Produces: `export function seedProfileFromInvoice(invoice: Invoice): VendorMaster` from `@/lib/ap/vendor-master`. Task 4 imports it from there.

- [ ] **Step 1: Move the function**

Cut the module-private `seedProfileFromInvoice` out of `vendor-profile-registration.tsx` (lines ~45–56) into `vendor-master.ts` (after `vendorProfileGapLabel` / before audit section is fine), with `export` and the same body + doc comment. Add `import type { Invoice } from "./types";` if `vendor-master.ts` does not already import `Invoice`.

- [ ] **Step 2: Re-import in registration**

In `vendor-profile-registration.tsx`, add `seedProfileFromInvoice` to the existing import from `@/lib/ap/vendor-master`. Remove the now-empty local definition.

- [ ] **Step 3: Run suite + lint**

Run: `bun test; npx eslint src/lib/ap/vendor-master.ts src/components/ap/vendor-profile-registration.tsx; npx prettier --write src/lib/ap/vendor-master.ts src/components/ap/vendor-profile-registration.tsx`
Expected: PASS, clean. Behavior identical.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ap/vendor-master.ts src/components/ap/vendor-profile-registration.tsx
git commit -m "refactor: share seedProfileFromInvoice from vendor-master"
```

---

### Task 4: CreateVendorRecordButton + registration-gated dialog

**Files:**
- Create: `src/components/ap/create-vendor-record.tsx`
- Test: none new — gate covered by existing `vendor-master.test.ts`; wiring verified in Task 5 + full suite.

**Interfaces:**
- Consumes: `seedProfileFromInvoice`, `vendorProfileGaps`, `vendorProfileGapLabel`, `REQUIRED_PROFILE_FIELDS`, `VendorMaster`, `ProfileField` from `@/lib/ap/vendor-master`; `VendorProfileCard`; `useAp().upsertVendor`; `toast` from `sonner`.
- Produces: `export function CreateVendorRecordButton({ invoice }: { invoice: Invoice }): JSX` — button + dialog; on save calls `upsertVendor` only.

- [ ] **Step 1: Implement component**

New file `src/components/ap/create-vendor-record.tsx`:

```tsx
/**
 * Row action: create the missing vendor master record without leaving the
 * review screen. Seeds from the invoice, gates on the same required fields
 * as VendorProfileRegistration, writes vendor-master only — never the invoice.
 *
 * Spec: docs/superpowers/specs/2026-09-23-vendor-no-record-create-design.md
 */
import { useState } from "react";
import { toast } from "sonner";
import { Save, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { VendorProfileCard } from "./vendor-profile-card";
import { useAp } from "@/lib/ap/store";
import type { Invoice } from "@/lib/ap/types";
import {
  REQUIRED_PROFILE_FIELDS,
  seedProfileFromInvoice,
  vendorProfileGapLabel,
  vendorProfileGaps,
  type ProfileField,
  type VendorMaster,
} from "@/lib/ap/vendor-master";

export function CreateVendorRecordButton({ invoice }: { invoice: Invoice }) {
  const { upsertVendor } = useAp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<VendorMaster>(() => seedProfileFromInvoice(invoice));
  const [focusField, setFocusField] = useState<ProfileField | null>(null);
  const gaps = vendorProfileGaps(draft);

  const handleChange = (field: ProfileField, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    if (gaps.length > 0) {
      setFocusField(gaps[0]!);
      toast.error(`Still needed: ${vendorProfileGapLabel(gaps[0]!, draft)}`);
      return;
    }
    upsertVendor({ ...draft, updatedAt: new Date().toISOString() });
    toast.success(`Vendor record created for ${draft.name}`);
    setOpen(false);
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Create record
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Create vendor record</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Seeded from this invoice. Required: vendor name, business registration number,
                  and a valid IBAN.
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <VendorProfileCard
              vendor={draft}
              onChange={handleChange}
              focusField={focusField}
              onFocusDone={() => setFocusField(null)}
              requiredFields={REQUIRED_PROFILE_FIELDS}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={gaps.length > 0}>
                <Save className="size-4" /> Create record
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
```

If the codebase has an existing Dialog primitive (check `src/components/ui/`), use it instead of the raw fixed overlay — match whatever `EditVendorDialog` uses. Keep props/gate/save logic identical.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit; npx eslint src/components/ap/create-vendor-record.tsx; npx prettier --write src/components/ap/create-vendor-record.tsx`
Expected: clean.

- [ ] **Step 3: Run suite**

Run: `bun test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/ap/create-vendor-record.tsx
git commit -m "feat: create-vendor-record dialog, registration-gated, vendor-master only"
```

---

### Task 5: Wire route `checkActions`

**Files:**
- Modify: `src/routes/invoices.$id.tsx` (import + prop next to `checkEditors`, ~line 779–786)

**Interfaces:**
- Consumes: `CreateVendorRecordButton` (Task 4); `vendors` from `useAp()` (already destructured in the invoice component); `ApprovalCompare.checkActions` (Task 2).
- Produces: none — terminal wiring.

- [ ] **Step 1: Import**

```ts
import { CreateVendorRecordButton } from "@/components/ap/create-vendor-record";
```

- [ ] **Step 2: Pass prop**

On `<ApprovalCompare>`, beside `checkEditors={checkEditors}`:

```tsx
checkActions={
  !vendors[invoice.vendor]
    ? { "vendor:no-record": <CreateVendorRecordButton invoice={invoice} /> }
    : undefined
}
```

No `canEdit` / frozen gate. Confirm `vendors` and `invoice` are in scope at that render (same `useAp()` destructuring as `checkEditors`).

- [ ] **Step 3: Typecheck + lint + suite**

Run: `npx tsc --noEmit; npx eslint "src/routes/invoices.$id.tsx"; npx prettier --write "src/routes/invoices.$id.tsx"; bun test`
Expected: clean, all PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/routes/invoices.$id.tsx"
git commit -m "feat: offer create record from vendor:no-record row"
```

---

### Task 6: Full verification

**Files:** none (commands only).

- [ ] **Step 1: Full suite**

Run: `bun test`
Expected: PASS (≥475 tests; +1 from Task 1).

- [ ] **Step 2: Typecheck + lint touched files**

Run:

```bash
npx tsc --noEmit
npx eslint src/lib/ap/approval.ts src/lib/ap/approval.test.ts src/lib/ap/vendor-master.ts src/components/ap/approval-compare.tsx src/components/ap/vendor-profile-registration.tsx src/components/ap/create-vendor-record.tsx "src/routes/invoices.$id.tsx"
```

Expected: clean (pre-existing `store.tsx` warning not in this list).

- [ ] **Step 3: Spec flag check**

Grep: `action: "create-vendor-record"` appears only in `approval.ts`; `updateInvoice` / `applyTransition` absent from `create-vendor-record.tsx`.

Run:

```bash
rg 'action: "create-vendor-record"' src
rg 'updateInvoice|applyTransition' src/components/ap/create-vendor-record.tsx
```

Expected: one hit in approval.ts; second command no hits.

---

## Self-review (author)

- Spec coverage: §1 Task 1, §2 Task 2, §3 seed share Task 3 + dialog Task 4 + wiring Task 5, §4 Tasks 1/6. Header copy / out-of-scope untouched. ✓
- Placeholders: none. ✓
- Type consistency: `action?: "create-vendor-record" | undefined`; `checkActions?: Record<string, ReactNode>`; `seedProfileFromInvoice(invoice: Invoice): VendorMaster` exported from vendor-master in Task 3, imported in Task 4. ✓
