# Three-Stage Pipeline + History — Design

**Date:** 2026-09-18
**Status:** Approved

## Problem

Invoice pipeline currently has 5 statuses (`draft → review → approved → scheduled → paid`). `approved` and `paid` are results of actions, not workflow stages. Ledgerflow should expose exactly three stages: **Draft, For approval, For payment**. Paid invoices leave the queue entirely and live in a new **History** tab.

## Approach

Collapse the status model to three pipeline stages plus two result states (`rejected` stays out-of-band in the queue; `paid` is a result marker used only by History). Approving a bill moves it straight For approval → For payment. Marking paid removes it from the queue and archives it to a separate `history` collection persisted under its own localStorage key. A new `/history` route lists archived invoices read-only.

## Changes

### `src/lib/ap/types.ts`
- `InvoiceStatus` drops `approved` and `paid`. Remaining: `"draft" | "review" | "scheduled" | "rejected"` — EXCEPT keep `"paid"` in the type so History can carry the result marker: `"draft" | "review" | "scheduled" | "rejected" | "paid"`.
- `STATUS_ORDER` = `["draft", "review", "scheduled"]` (the 3 pipeline stages; `paid` never in pipeline/stages).
- `STATUS_LABEL`: `draft: "Draft"`, `review: "For approval"`, `scheduled: "For payment"`, `rejected: "Rejected"`, `paid: "Paid"`.
- `paid` badge style in `status.tsx` `STATUS_STYLES`: muted/neutral (e.g. `border-border bg-muted text-muted-foreground`) — it is a result, not a stage.

### `src/components/ap/status.tsx`
- `STATUS_STYLES` drops `approved`; adds `paid` muted style.
- `Pipeline` renders only `STATUS_ORDER` (3 stages). Rejected chip append unchanged (out-of-band).

### `src/lib/ap/store.tsx`
- Add `history: Invoice[]` to state + context.
- New localStorage key `ap-automation-history-v1` for history.
- Migration on load: existing `invoices` entries with `status === "paid"` move into `history`.
- `addInvoice` pushes to queue only (new uploads start `draft`, ocr.ts:710 unchanged).
- New `markPaid(id, actor, action, note?)`: appends audit entry, removes invoice from `invoices`, unshifts it into `history`.
- `resetDemo` resets both `invoices` (from samples) and `history`.

### `src/lib/ap/samples.ts`
- Replace sample `status: "approved"` and `status: "scheduled"` as needed; the sample `status: "paid"` moves to an exported `sampleHistory` (or the paid sample is dropped and history seeds empty — prefer seeding history with the paid sample so the tab has content).

### `src/routes/index.tsx`
- Stats: "Paid year to date" reads from `history` (sum of `total`), hint unchanged.
- Filter tabs: `["all", ...STATUS_ORDER, "rejected"]` — drops `approved`/`paid` tabs automatically.
- `totals.needsApproval` = `review` count (unchanged); `readyToPay` renames internally to `scheduled` sum.

### `src/routes/invoices.$id.tsx`
- **Draft:** "Submit for approval" → `review` (unchanged, ocr drafts unchanged).
- **For approval (review):** "Approve" → `scheduled` with action "Approved — queued for payment". "Request changes" → `draft`. "Reject" → `rejected`.
- **For payment (scheduled):** "Mark as paid" → `advance` special-cased: instead of `setStatus`, call `markPaid(...)` then navigate to `/history`.
- Remove `approved` action block; remove `paid` badge-block reopen logic (paid invoices no longer reachable from queue). `paid`/`rejected` reopen block now covers only `rejected`.

### New `src/routes/history.tsx`
- Read-only table: vendor name, invoice number, issue date, total, Paid badge, paid date from last audit entry (`action` matching payment / or newest audit `at`). No actions, no links to detail. Empty state: "Nothing has been paid yet."

### `src/components/ap/shell.tsx`
- Add History nav link (`/history`, `History` lucide icon, active style matching inbox).

## Data Flow
```
draft → review (submit) → scheduled (approve) → [markPaid] → history (paid)
             ↘ rejected (reject)  — stays in queue, reopenable to draft
```
- Store: `invoices` = queue (stages + rejected); `history` = paid archive.
- New uploads → `invoices`, status `draft`.

## Error Handling
- History read-only — no mutations possible from history route.
- Persistence failures (localStorage full/corrupt) reuse the existing silent try/catch in store.
- Migration is idempotent: paid invoices only ever sit in `history` after load.

## Non-Goals
- No re-open/edit from History (read-only archive).
- No detail page for history items.
- `approved` wording/icon removed everywhere.

## Testing
No test runner in repo. Verification:
- `node_modules\.bin\tsc.exe --noEmit` — 0 errors.
- `npm run lint` — no NEW errors (~45 pre-existing prettier errors).
- `npm run build` — passes.
- Manual: approve → lands in "For payment"; "Mark as paid" → invoice leaves queue, History tab shows it with Paid badge; Reset demo restores both tabs; rejected stays filterable in queue.