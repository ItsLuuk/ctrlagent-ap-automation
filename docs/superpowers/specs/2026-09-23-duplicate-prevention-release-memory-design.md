# Design: Duplicate prevention dialog + release memory aid

**Date:** 2026-09-23
**Status:** Approved (sections 1–2) + self-review amendments (gate timing, non-archivable peers, portal modal, StatusBadge API)
**Repo:** AP Automation (TanStack Start, React 19, bun test, Playwright)

## Problem

1. **Duplicates:** `duplicatePeer` matches (same vendor, currency, ±1% amount, ≤7 days apart) but only surfaces as an after-the-fact "Duplicate risk" tag. Both copies land in the queue; the user discovers the collision late.
2. **Release amnesia:** "Mark ready for external handoff" writes an audit entry then the button disappears. Status stays `scheduled`; queue badge unchanged. Returning a day later, the only evidence the invoice shipped is the *absence* of a control.

## Goals

- Ask **before** a near-duplicate enters the queue: keep both or replace (archive old, keep new).
- Leave **positive, persistent evidence** after release: queue badge for scanning + sticky detail banner for confirmation.

## Non-goals

- New state-machine transition or status for release.
- New queue filter chip for handed-off invoices (follow-up).
- Changing export/sync payloads (still plain `scheduled`).
- Auto-merge / field-level dedupe.

---

## Section 1 — Duplicate prevention dialog

### Approach

**A + C:** gate in the upload flow (per file, after extract) plus shared helper for all creation entry points; keep `retagAll` on load as defensive net (already exists).

Not B (store-level choke point): modal needs async suspend of `addInvoice` — fragile with multi-file.

### Gate timing (self-review amendment — two paths, one decision point)

Critical-fields are available at different moments depending on route:

| Path | Where extract finishes | Gate runs |
|---|---|---|
| **Template hit** (instant) | `upload-dialog.tsx` `handleFiles` after `extractQuickPhase` returns complete invoice | **before** `addInvoice(routed)` / `register-profile` (line ~193) |
| **Background job** (novel vendor) | `upload-jobs.tsx` `runOne` after `runBackgroundJob` resolves | **after** extract, **before** `updateInvoice` finalizes status + `register-profile` (line ~129). Skeleton already sits in queue as `processing` (inFlight bucket — never Needs you); the gate blocks the flip into `draft`/`vendor_profile` |
| **Failed extract** | `addInvoice(failedInvoice)` with `total: 0` | **no gate** — `duplicatePeer` returns undefined when `total <= 0` |
| **Manual review** (`reviewManually`) | empty draft, `total: 0` | **no gate** — same reason |

User rule "blocks before Needs you" holds on both live paths: template path blocks before add; background path blocks before status leaves `processing`.

### Flow (per file, after extract)

```
extract critical fields OK (total > 0)
        ↓
duplicateGate(incoming, [...active, ...removed])
        ↓
   no match? → commit (addInvoice | finalize skeleton) → queue
        ↓ match
   MODAL (no Escape, no X — must choose) — app-level portal, FIFO if two jobs finish together
   "This matches {peer.invoiceNumber | the invoice from {shortDate}}
    ({money}, {issueDate}), in your queue since {addedAt}.
    Keep both, or replace?"
        ↓                        ↓
   Keep both                Replace  [enabled only if peer archivable*]
        ↓                        ↓
set acknowledgedDuplicateOf   removeInvoice(peer, processor,
  on incoming; then commit       "Replaced by upload — same vendor
  (add | finalize)               and amount as new record"); then commit
        ↓
toast: "Added — kept both; Duplicate risk tag applied"
     | "Added — archived {ref}; this upload replaces it"
```

Ordering on replace: **archive old first, then commit new.** If commit fails, old remains restorable; no half-pair in queue. Background path "commit" = existing `updateInvoice` finalize (id unchanged), not a second `addInvoice`.

\* **Non-archivable peer (self-review amendment):** state machine `archive` only from `vendor_profile | draft | rejected` (`state-machine.ts:147-152`). If peer is `review`/`scheduled`/`paid`/`processing`/`failed`, `removeInvoice` is refused. **Replace button disabled** with inline reason: "That invoice is already in approval — keep both, or resolve it on its record first." Keep both always available.

### Multi-file batches

- Each file gates independently after its own extract; other files keep extracting in parallel.
- Clean files (no match) enter the queue immediately.
- Match dialogs are **sequential, one per match** (only that file is held).
- End-of-batch toast when >1 match: `"5 added · 3 resolved as duplicates"`.

### Acknowledged-pairs marker

- **Shape:** single field on the newer invoice: `acknowledgedDuplicateOf?: string` (peer id).
- **Skip rule:** `duplicateGate` returns clear when either direction is already marked (`candidate.acknowledgedDuplicateOf === new.id` or `new.acknowledgedDuplicateOf === candidate.id`).
- **Keep both** writes the marker on the new invoice.
- **Replace** does **not** write the marker — old is archived; pair link lives in the archive audit note. Re-uploading the same file later matches the *new* active record → prompts again only for a genuine third copy.
- **Match scope:** active queue **+ Removed (archived)** + marker skip. Re-uploading a deliberately-removed file still prompts unless the user previously chose keep-both on that pair.

### Shared helper + portal (self-review amendment)

```ts
// src/lib/ap/duplicate-gate.ts — pure decision, no React
export type DuplicateGateResult =
  | { kind: "clear" }
  | {
      kind: "match";
      peer: Invoice;
      peerArchivable: boolean; // availableTransitions(peer, processor).includes("archive")
    };

export function duplicateGate(
  incoming: Invoice,
  candidates: Invoice[], // caller passes [...invoices, ...removed]
): DuplicateGateResult;
```

Marker written by caller on keep: `{ ...incoming, acknowledgedDuplicateOf: peer.id }` then commit.

**UI:** `DuplicateGateProvider` at app shell (not inside upload-dialog — background jobs finish after dialog may close). API: `await gate.decide(incoming) → "keep" | "replace" | { kind:"clear" }`. Internally FIFO promise queue so two parallel jobs (`MAX_PARALLEL_JOBS = 2`) never stack modals. `role="alertdialog"`, focus trap, Escape/overlay/close disabled until choice.

**Type:** add `acknowledgedDuplicateOf?: string | undefined` to `Invoice` in `src/lib/ap/types.ts` (beside `archivedFrom`).

**Candidates:** `duplicatePeer(invoice, all)` signature unchanged; gate builds `[...invoices, ...removed]` from `useAp()` and applies acknowledgement skip before/after peer lookup.

**Call sites (commit points only):**
1. `upload-dialog.tsx` template-hit branch (~193)
2. `upload-jobs.tsx` `runOne` finalize (~129)
3. native-path drop — same `handleFiles` as (1)
4. `reviewManually` / failed — **skip** (total 0)

### Copy (brand-voice.md)

| Surface | Copy |
|---|---|
| Modal title | Possible duplicate |
| Modal body | This matches **{ref}** ({money}, {date}), in your queue since {time}. Keep both, or replace? |
| Button A (outline) | Keep both |
| Button B (primary/danger-outline) | Replace existing |
| Toast keep | Added — kept both; Duplicate risk tag applied |
| Toast replace | Added — archived {ref}; this upload replaces it |

`{ref}` = `invoice no. N` when `invoiceNumber`, else `the invoice from {shortDate}` (same as `nameOf` in `remove-from-queue.tsx`).

### UI mechanics

- Modal: app-level `DuplicateGateProvider` portal (see above), not upload-dialog-local.
- Non-blocking to other extract jobs — only the gated file's completion awaits its promise; others continue under `MAX_PARALLEL_JOBS`.
- End-of-batch toast counts decided matches from `handleFiles` bookkeeping (background-path matches may land after dialog closed — count what completed during the batch window; late ones toast individually as today).

### Tests

- Unit (`duplicate-gate.test.ts`): clear; match active; match removed; skip when `acknowledgedDuplicateOf` set either direction; `peerArchivable` false for `review`/`scheduled`/`paid`.
- Unit (existing `auto-tags`): untouched; add case with `acknowledgedDuplicateOf` → `retagAll` still tags risk if peer active (marker does **not** suppress tag).
- Unit: `hasHandoffMarker` (Section 2) in same pass.
- E2E: upload duplicate fixture twice → modal → keep both → tag on row; third upload → no modal; replace path → old under Removed (note present), new active; background-path duplicate (novel vendor fixture) → modal fires before row leaves Processing; peer in approval → Replace disabled with reason.
- Regression: Superdoos critical-field path still green.

---

## Section 2 — Release memory aid

### Data

No new state. Single helper:

```ts
export function hasHandoffMarker(invoice: Invoice): boolean {
  return invoice.audit.some((entry) => entry.action === TRANSITION_LABEL.release);
}
```

- Location: `src/lib/ap/auto-tags.ts` (beside `duplicatePeer`) or `src/lib/ap/handoff.ts` if import cycles bite `state-machine` → prefer **auto-tags.ts** (already imports types only; will need `TRANSITION_LABEL` from state-machine — state-machine has no react deps, safe).
- Replaces inline logic at `record-details.tsx:59-61` — one definition, three users.

### Queue badge (scan layer)

**Surface (self-review):** `StatusBadge` in `src/components/ap/status.tsx:24` — only status-aware badge, rendered by inbox table `index.tsx:499` and `history.tsx:81`. Extend API; no new component.

```ts
StatusBadge({ status, handoff?, className })
// handoff?: { actor: string; at: string } | undefined
// when status==="scheduled" && handoff → label "Handed off", Check icon,
// success tone (colorClasses.success), title=
// "Marked ready for external handoff by {actor} · {shortDateTime}"
```

Call sites pass `handoff={hasHandoffMarkerEntry(inv)}` (returns the audit entry or undefined — richer than boolean for tooltip actor/time).

| status | handoff entry | badge |
|---|---|---|
| `scheduled` | none | Ready for handoff (today) |
| `scheduled` | present | **Handed off** + check, success tone, tooltip |
| other | any | status label as today (no override) |

- `STATUS_LABEL.scheduled` / exports / filters / `dynamic-island.tsx` unchanged (follow-up if island should differentiate).
- No new filter chip in v1.

### Detail banner (confirmation layer)

- Placement (self-review): `invoices.$id.tsx` `Detail` — **immediately after** `<ReviewHeader>` (line 704), **before** failed-banner / `DecisionNotice` / content grid. Above the fold; not inside collapsed Record details. Not on Processing/Failed/VendorProfile early-return shells (they never show `scheduled`+marker together in a way that needs it — and status gate excludes them anyway).
- Visibility: `invoice.status === "scheduled" && hasHandoffMarker(invoice)` **both required**.
- Sticky (page scroll, not position:fixed), **no dismiss control**.
- Content:

  **Title:** Marked ready for external handoff (= `TRANSITION_LABEL.release`)
  **Meta:** {actor} · {shortDateTime} (from marker audit entry)
  **Caveat:** Foundry has not sent a payment.

- Success tone border/icon (same family as DecisionNotice approved style) so it reads as settled, not warning.
- Removes the muted-text block at `invoices.$id.tsx` ~672–676 (banner supersedes; that branch becomes empty → delete).
- Release button already hidden when marker exists — unchanged.
- `DecisionNotice` still shows "Approved by …" beneath — complementary, not duplicated (approve ≠ release).

### Edge: marker + status left `scheduled`

Payment-failed / re-open moves status away from `scheduled`. Banner/badge **hidden** (current-state claim). Audit history + Record details "External handoff" fact still show the historical marker. Consistent: banner = now, audit = then.

### Files touched

| File | Change |
|---|---|
| `src/lib/ap/auto-tags.ts` | `hasHandoffMarker()` + `handoffEntry()` (audit entry with actor/at) |
| `src/lib/ap/auto-tags.test.ts` | unit tests |
| `src/lib/ap/types.ts` | `acknowledgedDuplicateOf?: string` on `Invoice` |
| `src/lib/ap/duplicate-gate.ts` + test | Section 1 pure helper |
| `src/components/ap/duplicate-gate-provider.tsx` (new) | portal + FIFO decide() |
| app shell / providers | mount `DuplicateGateProvider` |
| `src/components/ap/upload-dialog.tsx` | gate before template-path `addInvoice` |
| `src/lib/ap/upload-jobs.tsx` | gate before finalize in `runOne` |
| `src/components/ap/status.tsx` | `StatusBadge` optional `handoff` prop |
| `src/routes/index.tsx` | pass `handoff` at line 499 |
| `src/routes/history.tsx` | pass `handoff` at line 81 |
| `src/routes/invoices.$id.tsx` | banner after ReviewHeader; delete muted block ~672–676 |
| `src/components/ap/record-details.tsx` | use shared helper |
| e2e specs | both flows + Superdoos regression |

### Tests

- Unit: `hasHandoffMarker` true/false.
- E2E: schedule → release → detail shows banner (title+actor+caveat); home row badge "Handed off"; hard reload → banner persists; scheduled-without-marker → no banner, neutral badge.

---

## Verification gates (before merge)

- `bun test src/lib/ap/` (expect ≥460 + new)
- `npx eslint` on touched files only
- `bun run test:routes`
- New/updated Playwright specs green
- Manual: Superdoos upload regression still green (don't break critical-field path fixed earlier today)

## Self-review findings (resolved in text above)

1. Two extract paths (template instant vs background skeleton) — gate points specified per path; background skeleton already in queue as `processing`, gate blocks Needs-you promotion only.
2. `archive` rule forbids removing `review`/`scheduled`/`paid` peers — Replace disabled with reason; Keep both always.
3. Modal cannot live only in upload-dialog (jobs finish after close) — app-level provider + FIFO queue.
4. `removeInvoice` moves record to `removed` list — candidates must be `[...invoices, ...removed]`.
5. Manual/failed uploads have `total: 0` — no gate needed (duplicatePeer already clears).
6. Banner must not collide with `DecisionNotice` — placement after ReviewHeader, before DecisionNotice; copy distinct (release vs approve).
7. `StatusBadge` is the single badge component — extend props, don't fork.
8. Invoice type needs new optional field — placed beside `archivedFrom`.

## Open follow-ups (out of scope)

- Filter chip "Handed off"
- `dynamic-island` status label differentiation for handed-off
- Import-path gate if a bulk import UI appears
- Pair-link from archive note back to new record (click-through)
- Replace path for non-archivable peers (would need new transition — state-machine change, separate design)
