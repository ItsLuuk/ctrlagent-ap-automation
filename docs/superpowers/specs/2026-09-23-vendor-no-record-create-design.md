# Vendor identity: create missing record from the reporting row

**Date:** 2026-09-23
**Status:** Approved (design)

## Problem

When the invoice's vendor has no master record, the Vendor identity group shows a single row:

- `vendor:no-record` — document says the vendor name, held side says "No record yet", severity `attention`.

The comment in `identityChecks` claims "the group header above it is where a record gets added," but the header only offers a three-dots menu item labeled **Edit vendor details** — wrong verb for a create, one hop away from the row that reports the gap, and hidden entirely when `onChange` is absent.

The reviewer cannot fill the gap from the place that names it.

## Decisions (locked)

| Decision        | Choice                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First action    | Dialog prefilled from the invoice (not one-click seed, not header-menu jump)                                                                                                                            |
| Save gate       | Same registration gate as VendorProfileRegistration: name + business registration + checksum-valid IBAN                                                                                                 |
| Frozen invoices | Create action still available — invoice write limited to a name-only `updateInvoice` sync when `draft.name !== invoice.vendor` (same as registration line 149); no other invoice fields, no transitions |
| Approach        | **A** — action flag on the pure verdict row; route supplies the React node                                                                                                                              |

## Design

### 1. Verdict (pure) — `src/lib/ap/approval.ts`

Extend `ApprovalCheck`:

```ts
/** Offered by the row itself when the gap can be filled in place. */
action?: "create-vendor-record" | undefined;
```

`identityChecks`, in the `!record` branch only, sets:

```ts
action: "create-vendor-record",
```

on `vendor:no-record`. No other row sets `action`. The module stays free of store and UI imports.

**Test** (`approval.test.ts`):

- `vendor:no-record` carries `action: "create-vendor-record"`.
- A normal identity row (record present) has no `action`.

### 2. Compare row (presentational) — `src/components/ap/approval-compare.tsx`

Add optional prop on `ApprovalCompare` (and pass-through on `Group`):

```ts
checkActions?: Record<string, ReactNode> | undefined;
```

Keyed by check id, same shape as `checkEditors`.

`CheckRow` renders `checkActions?.[check.id]` beneath the value columns (alongside `detail`), only when supplied. The component does not interpret the action — the route owns meaning and behavior.

### 3. Route + create dialog — `src/routes/invoices.$id.tsx` (+ dialog component)

Supply:

```ts
checkActions={
  !vendors[invoice.vendor]
    ? { "vendor:no-record": <CreateVendorRecordButton invoice={invoice} /> }
    : undefined
}
```

Always available while the row exists (including `scheduled` / `paid` / frozen). When a record exists, the row disappears; the map is moot.

`CreateVendorRecordButton`:

- Renders a button ("Create record") in the row action slot.
- Opens a dialog seeded with `seedProfileFromInvoice(invoice)` — **extract and share** from `vendor-profile-registration.tsx` (currently module-private).
- Form fields and validation: `vendorProfileGaps` registration gate (name, business registration, checksum-valid IBAN), same copy/toast behavior as registration.
- Save → `upsertVendor(finalRecord)` → name-only `updateInvoice(invoice.id, { vendor: record.name })` when `record.name !== invoice.vendor` (keeps `vendors[invoice.vendor]` lookup consistent with the new master key; same as registration line 149, no audit entry) → success toast → close dialog.
- **Does not** run a state-machine transition, `applyTransition`, `setStatus`, or `linkPo`; no other invoice fields are written (no department carry — registration-only). The compare row re-renders as the full identity comparison once `vendors[vendor]` exists.

Dialog UI: reuse `VendorProfileCard` (the same card VendorProfileRegistration mounts) for fields + completeness meter; wire Save through `vendorProfileGaps` exactly as registration does. Do not use `EditVendorDialog` — it only collects name/email/logo, too light for the registration gate.

### 4. Testing & verification

| Layer             | Test                                                                          |
| ----------------- | ----------------------------------------------------------------------------- |
| Pure verdict      | `approval.test.ts` — action flag on `vendor:no-record`, absent on normal rows |
| Registration gate | existing `vendor-master.test.ts` unchanged                                    |
| Full suite        | `bun test`                                                                    |
| Lint              | eslint on touched files                                                       |

No new e2e required for this slice; unit coverage pins the pure contract, dialog follows the already-tested gate.

## Out of scope

- Changing which fields registration requires.
- Auto-creating a record without a dialog.
- Invoice-side writes of any kind beyond the name-only `updateInvoice` sync (Option A) needed when the operator renames the vendor in the dialog.
- Header three-dots copy ("Edit vendor details") — left as-is; row is the create path.

## Non-goals / risks

- **Duplicate records:** save keys by name via `upsertVendor` — same as registration; no new dedup logic.
- **Rename → master key sync:** solved by Option A — when `draft.name !== invoice.vendor`, save does a name-only `updateInvoice` so `vendors[invoice.vendor]` resolves the new key (mirrors registration; row no longer stays after a rename).
- **Frozen path:** safe by construction (only the name-only sync runs, when renamed); `upsertVendor` itself remains invoice-neutral.
