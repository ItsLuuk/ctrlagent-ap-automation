# Design: Supabase auth, orgs, roles, real audit actor

**Date:** 2026-09-23  
**Status:** Approved (design conversation)  
**Scope:** Auth core only — accounts, organization, roles, invite codes, session → audit `Actor`.  
**Out of scope (follow-on specs):** Billing/subscription, ERP, email, invoice/vendor content migration to Supabase, Storage buckets.

---

## Problem

The audit trail attributes human actions to hardcoded demo personas (`Dana Whitfield` approver, `Luuk Koppen` processor, `Payments` treasury) and similar constants in route/component code. Every action, correction, and query must be recorded against the person actually using the app.

The product pivoted from pure local-first to **desktop-only full SaaS** for identity and multi-user rights (subscription, ERP, and email are later online concerns). Invoice and vendor **content** stays in the local IndexedDB store until a follow-on migration spec.

## Goals

1. Real users sign up, belong to exactly one organization, and hold roles (`processor`, `approver`, `treasury`).
2. Sole org member auto-holds all three roles.
3. Second+ members join via **invite code**.
4. Every state-machine transition and field-correction audit entry uses the signed-in user’s display name and role set.
5. Remove hardcoded human personas from runtime code paths.
6. Segregation of duties (SoD) still blocks multi-user conflicts; **exempt when the org has exactly one member**.

## Non-goals

- Moving invoice, vendor, or file bytes to Supabase.
- Stripe/billing, ERP connectors, transactional email product features.
- Web (browser-only) deployment target.
- Multi-org membership, password-reset UX polish beyond Supabase defaults, SSO.

---

## Architecture

- **Client:** Tauri desktop (existing `dev:tauri` / `build:tauri`). Desktop is the only supported runtime; plain web `dev`/`build` scripts are removed or clearly unsupported in package.json (exact edit in plan).
- **SDK:** `@supabase/supabase-js` in the renderer.
- **Env:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (names confirmed at plan time against Vite/Lovable conventions).
- **Data plane:** Supabase Postgres + Auth; RLS on every table keyed by `org_id` → `org_members`.
- **App data:** IndexedDB invoice/vendor store unchanged; auth layer only supplies identity/`Actor`.

```
Tauri renderer
  ├─ supabase-js (auth session, org/role reads, invite RPC)
  ├─ useSession() → Actor { name, roles }
  ├─ existing local store (invoices, vendors, files)
  └─ state-machine transition(..., actor) → audit.actor = name
```

## Data model

### `profiles`

| Column | Type | Notes |
|--------|------|--------|
| `id` | uuid PK | = `auth.users.id` |
| `display_name` | text not null | Source for `Actor.name` |

Trigger or client insert on first login (plan chooses; must not leave null display names).

### `organizations`

| Column | Type | Notes |
|--------|------|--------|
| `id` | uuid PK | |
| `name` | text not null | From signup |
| `invite_code_hash` | text null | Server-side hash of active code; null = no active invite |
| `invite_expires_at` | timestamptz null | |

### `org_members`

| Column | Type | Notes |
|--------|------|--------|
| `org_id` | uuid FK | |
| `user_id` | uuid FK | = `profiles.id` |
| `is_owner` | boolean | First member = true |
| `roles` | text[] | Subset of `processor`, `approver`, `treasury` |

PK `(org_id, user_id)`. **Invariant:** one org per user for this spec (enforced by app + optional unique on `user_id` if single-membership is required globally).

### RLS (sketch)

- All tables: `using` requires exists membership for `auth.uid()` in target `org_id` (profiles: self or same-org).
- Invite create/update RPC: owner-only (`is_owner`).
- Join RPC: validates code hash + expiry, inserts membership, clears/rotates code policy as implemented (single-use or reusable until regen — **single-use** default).

## Auth flows

### Sign up — create organization

1. Email, password, display name, organization name.
2. Auth user created; `profiles` row; new `organizations` row; `org_members` with `is_owner = true`, `roles = ['processor','approver','treasury']`.
3. Generate invite code (random, client shown once), store hash + expiry on org.

### Sign up — join with invite

1. Email, password, display name, invite code.
2. RPC validates code → membership in that org.
3. Roles for joiner: **empty set until owner assigns** OR default `['processor']` — **decision: default `['processor']`** (can act on drafts; cannot approve/release until owner adds roles). Owner can grant all roles in Settings.

### Login / session / guard

- Supabase session persisted (webview storage); `AuthGate` on all authenticated routes → `/login` when no session.
- Logout clears session; local invoice data remains on device.

### Settings (owner)

- Show invite code + regenerate (new code invalidates old hash).
- List members; edit `roles` per member (owner only).
- Non-owners: read-only membership view (minimal).

## Session → Actor

```ts
// shape only — final API in plan
type Actor = { name: string; roles: Array<"processor"|"approver"|"treasury"> };
```

- `useSession()` loads profile + org_members for current user.
- All call sites that pass `Actor` use this hook/context — not module-level constants.

### Hardcoded persona removal (complete list at plan time; known sites)

| Location | Today |
|----------|--------|
| `src/routes/invoices.$id.tsx` | `actors.processor/approver/treasury` (Dana, Luuk, Payments) |
| `src/routes/index.tsx` | `PROCESSOR` |
| `src/components/ap/remove-from-queue.tsx` | `ACTOR` |
| `src/components/ap/use-draft-mapping.ts` | inline Luuk |
| `src/components/ap/vendor-profile-registration.tsx` | `PROCESSOR_ACTOR` |
| `src/lib/ap/samples.ts` | demo history names → neutral sample labels at plan time |
| Tests referencing personas | update to fixtures; behavior unchanged |

**Unchanged system actors:** `system`, `OCR engine`, `Foundry` (product/brand strings).

## SoD + single-user exemption

- Pure `state-machine` stays free of Supabase/network.
- Transition input (or store wrapper) carries **`orgMemberCount`** (or `soleUser: boolean`) from session context.
- When member count === 1: skip “same actor.name already did confirm/approve/release” conflicts; role checks on `Actor.roles` still apply (user must still hold the role for the transition).
- When member count ≥ 2: existing name-based SoD unchanged.
- Tests: sole user with all roles can confirm → approve → release; two users same name still blocked (existing); multi-role sole user passes; multi-user without required role still fails role gate.

## Errors

| Case | Behavior |
|------|----------|
| Invalid/expired invite | Toast; stay on join form |
| Bad credentials | Supabase error → toast (no stack leak) |
| Offline / Supabase unreachable | Toast; no partial local “fake session” |
| RLS reject | Treat as signed-out or forbidden; prompt sign-in |
| Signed-out write attempt | Guard prevents UI; RLS is backstop |

## Testing

- **Unit (`bun test`):** SoD exemption matrix; invite pure helpers (generate/hash/validate/expiry) if client-held; role array validation; Actor derivation from fixture session payloads.
- **Component/integration:** mocked supabase client for login gate and Settings role edit (as feasible without live network).
- **Manual / optional e2e:** real Supabase project — signup, invite join, audit row shows real `display_name`.
- **Quality gates:** full `bun test`; scoped `npx eslint` on touched files; `npx prettier --write` on touched files. Full `npm run lint` remains out (times out).

## Rollout / migration

- **Fresh start:** no import from IndexedDB; existing demo/sample rows optional clear on Settings (already exists).
- No backfill of historical audit `actor` strings.
- Supabase project: create tables + RLS before first desktop build with env vars (plan includes SQL migration file under repo, e.g. `supabase/migrations/`).

## Risks

| Risk | Mitigation |
|------|------------|
| Anon key in Tauri bundle | Strict RLS; never service-role in client |
| Desktop offline without session | Cached session; clear UX; local data readable only when signed in per product choice — **decision: require sign-in to open app shell** |
| SoD exemption hides real multi-user conflict later | Exemption only when `orgMemberCount === 1`; re-enable automatic |
| Invite code leakage | Hash at rest; expiry; regenerate; single-use join |
| Positioning docs still say “no accounts” | Separate docs pass (README/POSITIONING) — not code scope |

## Decisions log

| Decision | Choice |
|----------|--------|
| Provider | Supabase |
| Client | Direct supabase-js from Tauri (Approach A) |
| Runtime | Desktop only; remove web target |
| Join method | Invite code |
| Existing local content | Start fresh (no migration) |
| This spec | Auth core only |
| Sole-user SoD | Exempt name conflicts when orgMemberCount === 1 |
| Joiner default roles | `['processor']` |
| Invoice store | Local until follow-on SaaS content migration |
