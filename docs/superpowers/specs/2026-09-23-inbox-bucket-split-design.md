# Inbox Bucket Split: Needs You / In Flight / Later

**Date:** 2026-09-23
**Status:** Approved
**Scope:** View-layer split of the invoice inbox so the queue opens on actionable work instead of every record.

## Problem

The inbox defaults to an `"all"` filter (`src/routes/index.tsx:107`), mixing human-gated work with machine-in-flight records. Actionable and in-flight records share one list, separated only by crude sort order (`attentionOrder`) and row styling. `processing` and `failed` have no tab of their own.

## Decision

Split every inbox record into exactly one of three buckets. The inbox opens on **Needs you**. There is no "All" tab.

### Bucket membership

| Bucket | Statuses | Rationale |
|---|---|---|
| **Needs you** | `vendor_profile`, `draft`, `review`, `failed` | Existing `AWAITING_PERSON` constant (`src/lib/ap/types.ts:29`) |
| **In flight** | `processing` | Machine actively working |
| **Later** | `scheduled`, `rejected`, `paid`, `archived` | Waiting on handoff or done; History page still exists separately |

Union of the three sets = all 9 `InvoiceStatus` values. Enforced by compile-time exhaustiveness check.

`history` and `removed` filters remain unchanged, reachable from existing UI affordances — not tabs.

## Design

### 1. Bucket constants — `src/lib/ap/types.ts`

Add beside the existing `AWAITING_PERSON`:

```ts
export const NEEDS_YOU = AWAITING_PERSON;            // vendor_profile, draft, review, failed
export const IN_FLIGHT = ["processing"] as const;    // status === processing
export const LATER = ["scheduled", "rejected", "paid", "archived"] as const;
export type Bucket = "needsYou" | "inFlight" | "later";
```

- `AWAITING_PERSON` stays as-is for backward compatibility; `NEEDS_YOU` aliases it so call-site intent reads clearly.
- A `Record<InvoiceStatus, Bucket>` exhaustiveness map guarantees every status lands in exactly one bucket (compile error otherwise).

**Approach chosen:** pure view-layer split (Approach 1). No state-machine changes. A `bucketFor()` helper can be extracted later mechanically if buckets ever depend on more than `status`.

### 2. Inbox route — `src/routes/index.tsx`

**Filter type** (line 58):

```ts
type Filter = Bucket | "history" | "removed";
// "needsYou" | "inFlight" | "later" | "history" | "removed"
```

**Default** (line 107): `useState<Filter>("needsYou")` — queue opens on work.

**Tab builder** (replaces lines 129-138): always render three tabs — no longer conditional on populated status.

| Tab | Count predicate | Sort within tab |
|---|---|---|
| **Needs you** | `NEEDS_YOU.includes(i.status)` | `attentionOrder` retained: `failed, review, vendor_profile, draft` |
| **In flight** | `i.status === "processing"` | Newest first by invoice date (fall back to insertion order if date absent) |
| **Later** | `LATER.includes(i.status)` | Status rank `scheduled, rejected, paid, archived`, then newest first by invoice date |

Counts badge hidden at 0 — tab label alone keeps the bar quiet.

**Filtering** (~line 152): active bucket filters via membership set; search query applies within the active bucket as today. `history`/`removed` behavior unchanged.

**Stat band** (lines 179-192): `needsYou` tile unchanged (same set). Subtitle at lines 317-319 keeps existing "waiting on you" copy.

**Row rendering** (line 371): unchanged — `processing`/`failed` special rows stay.

### 3. Edge cases

- **Record mid-transition:** status flips atomically via `applyTransition`; bucket recalculates on next render. Buckets derive purely from `status` at render time — no stale-bucket risk.
- **Empty buckets:** existing empty-state treatment. Needs you empty → "all clear" tone, e.g. "Nothing needs you right now."
- **In-flight job fails:** status becomes `failed` → row migrates In flight → Needs you on re-render; count badges update via existing store subscription.
- **Search within bucket:** no matches → existing no-results state, scoped to tab.
- **Error handling:** none new — bucket math is pure sync derives, no async paths added.

## Testing

- New unit test: partition exhaustiveness — all 9 statuses map to exactly one bucket.
- Update `tests/e2e/routes-smoke.spec.ts:118` fixtures — they will need to target the Needs you default tab explicitly (current fixtures assume the all-status list).
- Manual checks:
  1. Default landing = Needs you tab.
  2. Upload invoice → appears under In flight.
  3. Job completes → row migrates to Needs you.
  4. Tab counts track live status changes.

## Out of scope

- State-machine / `phase` field changes (Approach 3 rejected — touches frozen transitions, many tests, not worth it for a view split).
- Exceptions queue (`/exceptions`) — separate attention surface, untouched.
- Assignment/ownership concepts — none exist on records today.
