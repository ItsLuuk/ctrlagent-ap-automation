# Design: Always-Editable Line-Item Rows on Draft Screen

**Date:** 2026-09-24
**Status:** Approved

## Problem

On the Draft screen (`DraftMapper`), new line-item rows render via `InlineEditRow` (real inputs, wired to `onChange`), but existing/committed rows render via `DisplayRow` (read-only spans; delete button only). Editing an existing row requires delete + re-add.

## Goal

All line-item rows render as inputs permanently (spreadsheet-style). Existing and new rows share one edit path.

## Scope

- Primary file: `src/components/ap/line-items-list.tsx`
- Consumers unchanged: `src/components/ap/draft-mapper.tsx` (Draft), `src/routes/invoices.$id.tsx` (approval)
- Types unchanged: `LineItem` in `src/lib/ap/types.ts`

## Approach

**Extract shared field inputs; single `EditableRow` component for existing + new rows.**

### Component structure

- Extract input cells (description, quantity, unitPrice) from `InlineEditRow` into shared field markup used by one `EditableRow` component.
- `EditableRow` props: `item` (or empty template for new row), `currency`, field-level `onChange`, `onDelete`, optional `autoFocus` for the add-row case.
- Replace `DisplayRow` usage: every committed item renders `EditableRow` with current values.
- New-row flow preserved: "+ Add item" appends a blank `EditableRow` at bottom (existing `adding` state kept).

### Data flow

- Per-field edit: patch that item (`description`, `quantity`, `unitPrice`; recompute `amount = quantity * unitPrice`) → parent `onChange([...items])`.
  - Draft (`draft-mapper.tsx`): immediate `updateInvoice` (matches current add-row behavior).
  - Approval (`invoices.$id.tsx`): existing 700ms debounce unchanged.
- `glAccount`, `department`, `page` preserved untouched on edit (not exposed as inputs, same as current add-row).
- Delete button on every row when `editable`.

### Editability gates (unchanged)

- Draft: `editable` hardcoded true.
- Approval: `editable={canEdit}` + `onChange` presence gates commits — `EditableRow` no-op (or renders spans) when `onChange` undefined; keep existing double-guard (`if (!onChange) return`).

### Edge cases

- Validation: mirror current `commitNewRow` validation — do not write invalid numbers upstream (block invalid qty/price; require description like add-row does).
- Write volume: commit on change matches existing `InlineEditRow` behavior; tune (blur/debounce) only if store writes feel hot.

## Testing

- Manual, Draft screen: edit desc/qty/price on existing row → amount recomputes + persists; delete row; add row still works.
- Manual, approval screen: frozen invoice stays read-only; editable invoice edits persist via debounce.
- Extend `LineItemsList` tests for edit-existing path if tests exist.
