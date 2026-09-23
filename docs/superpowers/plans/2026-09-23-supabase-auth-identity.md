# Supabase Auth, Orgs, Roles, Real Audit Actor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded audit personas with a signed-in Supabase user (org + roles + invite), exempt SoD when the org has one member, and remove human demo actors from runtime paths.

**Architecture:** Desktop-only Tauri renderer talks to Supabase Auth + Postgres (RLS by `org_id`). Session yields `Actor { name, roles }` for every transition/audit write. Invoice/vendor data stays in local IndexedDB (follow-on migration). Pure `state-machine` gains optional `soleUser` on transition input only.

**Tech Stack:** Tauri 2, React 19, TanStack Router (manual Tauri tree), `@supabase/supabase-js`, Bun tests, Zod available.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-23-supabase-auth-identity-design.md`
- **No git repo** — do not `git init` / commit. Verification = `bun test` + scoped `npx eslint` + `npx prettier --write` on touched files.
- Never run full `npm run lint` (times out).
- PowerShell: quote paths with single quotes when `$` appears (`invoices.$id.tsx`).
- Roles ⊆ `processor` | `approver` | `treasury` (plus existing `system` on `ActorRole`).
- Sole-user SoD: skip name conflicts iff `soleUser === true`; role gates always apply.
- System actors unchanged: `system`, `OCR engine`, `Foundry`.
- Joiner default roles: `["processor"]`.
- Owner first signup: all three roles + `is_owner`.
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (document in `.env.example`; never commit secrets).
- Brand copy: no exclamation points; domain vocabulary (`vendor` not supplier).

---

### Task 1: Sole-user SoD exemption (pure state machine)

**Files:**
- Modify: `src/lib/ap/state-machine.ts` (SoD block ~278–297; `TransitionInput` ~227–231; `availableTransitions` ~410–416)
- Test: `src/lib/ap/state-machine.test.ts`

**Interfaces:**
- Produces: `TransitionInput.soleUser?: boolean`; `availableTransitions(invoice, actor, opts?: { soleUser?: boolean })`.
- Later tasks pass `soleUser` from session (`orgMemberCount === 1`).

- [ ] **Step 1: Write failing tests**

Add to `state-machine.test.ts` under `segregation of duties`:

```ts
it("lets a sole user with all roles confirm then approve the same invoice", () => {
  const sole: Actor = {
    name: "Sole Finance",
    roles: ["processor", "approver", "treasury"],
  };
  const confirmed = invoice("draft");
  const r1 = transition(confirmed, { transition: "confirm", actor: sole, soleUser: true });
  expect(r1.ok).toBe(true);
  const review = invoice("review", [auditEntry(TRANSITION_LABEL.confirm, "Sole Finance")]);
  const r2 = transition(review, {
    transition: "approve",
    actor: sole,
    note: "ok",
    soleUser: true,
  });
  expect(r2.ok).toBe(true);
});

it("still blocks SoD for the same dual-role actor when not sole user", () => {
  const dual: Actor = { name: "Dana Dual", roles: ["processor", "approver"] };
  const inv = invoice("review", [auditEntry(TRANSITION_LABEL.confirm, "Dana Dual")]);
  const r = transition(inv, {
    transition: "approve",
    actor: dual,
    note: "ok",
    soleUser: false,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.kind).toBe("sod");
});

it("still enforces role gates for a sole user missing the role", () => {
  const soleProcessor: Actor = { name: "Only Proc", roles: ["processor"] };
  const inv = invoice("review", [auditEntry(TRANSITION_LABEL.confirm, "Someone Else")]);
  const r = transition(inv, {
    transition: "approve",
    actor: soleProcessor,
    note: "x",
    soleUser: true,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.kind).toBe("role");
});

it("availableTransitions accepts soleUser option", () => {
  const sole: Actor = {
    name: "Sole Finance",
    roles: ["processor", "approver", "treasury"],
  };
  const inv = invoice("review", [auditEntry(TRANSITION_LABEL.confirm, "Sole Finance")]);
  expect(availableTransitions(inv, sole, { soleUser: true })).toContain("approve");
  expect(availableTransitions(inv, sole)).not.toContain("approve");
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun test src/lib/ap/state-machine.test.ts
```

Expected: new tests fail (unknown property / SoD still blocks).

- [ ] **Step 3: Implement**

In `TransitionInput`:

```ts
export type TransitionInput = {
  transition: TransitionId;
  actor: Actor;
  note?: string | undefined;
  /** Org has exactly one member: skip name-based SoD (role gates still apply). */
  soleUser?: boolean;
};
```

In SoD branch, only run conflict check when not sole user:

```ts
const responsibility = SOD_RESPONSIBILITIES[input.transition];
if (responsibility && !input.actor.roles.includes("system") && !input.soleUser) {
  // existing sodState / conflict logic unchanged
}
```

`availableTransitions`:

```ts
export function availableTransitions(
  invoice: Pick<Invoice, "status" | "audit">,
  actor: Actor,
  opts?: { soleUser?: boolean },
): TransitionId[] {
  return (Object.keys(TRANSITIONS) as TransitionId[]).filter(
    (id) => transition(invoice, { transition: id, actor, soleUser: opts?.soleUser }).ok,
  );
}
```

- [ ] **Step 4: Full state-machine suite green**

```bash
bun test src/lib/ap/state-machine.test.ts
```

Expected: all pass including pre-existing SoD tests (default `soleUser` undefined → old behavior).

---

### Task 2: Supabase client, env, SQL migration

**Files:**
- Create: `src/lib/auth/supabase.ts`
- Create: `src/lib/auth/types.ts`
- Create: `supabase/migrations/20260923_auth_orgs.sql`
- Create: `.env.example`
- Modify: `package.json` (add dependency `@supabase/supabase-js`)

**Interfaces:**
- Produces: `getSupabase(): SupabaseClient`; `OrgRole = "processor" | "approver" | "treasury"`; `AuthProfile`, `OrgMember`, `SessionOrg` types.

- [ ] **Step 1: Install dependency**

```bash
npm install @supabase/supabase-js
```

- [ ] **Step 2: `.env.example`**

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

- [ ] **Step 3: `src/lib/auth/types.ts`**

```ts
export type OrgRole = "processor" | "approver" | "treasury";

export type AuthProfile = {
  id: string;
  displayName: string;
};

export type OrgMember = {
  orgId: string;
  userId: string;
  isOwner: boolean;
  roles: OrgRole[];
};

export type SessionOrg = {
  orgId: string;
  orgName: string;
  isOwner: boolean;
  roles: OrgRole[];
  memberCount: number;
};
```

- [ ] **Step 4: `src/lib/auth/supabase.ts`**

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anon) {
    throw new Error(
      "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — copy .env.example to .env and fill in your Supabase project.",
    );
  }
  client = createClient(url, anon);
  return client;
}
```

- [ ] **Step 5: `supabase/migrations/20260923_auth_orgs.sql`**

```sql
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code_hash text,
  invite_expires_at timestamptz
);

create table if not exists public.org_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  is_owner boolean not null default false,
  roles text[] not null default '{}',
  primary key (org_id, user_id)
);

-- One org per user in this phase
create unique index if not exists org_members_user_unique on public.org_members (user_id);

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;

create or replace function public.is_org_member(org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from org_members m
    where m.org_id = org and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_owner(org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from org_members m
    where m.org_id = org and m.user_id = auth.uid() and m.is_owner
  );
$$;

create policy "read own profile" on public.profiles
  for select using (id = auth.uid());
create policy "update own profile" on public.profiles
  for update using (id = auth.uid());
create policy "insert own profile" on public.profiles
  for insert with check (id = auth.uid());

create policy "members read org" on public.organizations
  for select using (public.is_org_member(id));
create policy "owners update org invite" on public.organizations
  for update using (public.is_org_owner(id));

create policy "members read membership" on public.org_members
  for select using (public.is_org_member(org_id));
create policy "owners update membership" on public.org_members
  for update using (public.is_org_owner(org_id));

-- Create org + owner membership in one call (signup path)
create or replace function public.create_org_with_owner(
  org_name text,
  profile_name text,
  initial_roles text[]
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  new_org uuid;
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  insert into public.profiles (id, display_name) values (uid, profile_name)
    on conflict (id) do update set display_name = excluded.display_name;
  insert into public.organizations (name) values (org_name) returning id into new_org;
  insert into public.org_members (org_id, user_id, is_owner, roles)
    values (new_org, uid, true, initial_roles);
  return new_org;
end;
$$;

-- Join with invite code (plaintext code; server hashes compare)
create or replace function public.join_org_with_invite(
  invite_code text,
  profile_name text,
  default_roles text[]
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target public.organizations%rowtype;
  code_hash text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  -- Hash matches client SHA-256 hex of the code (see invite.ts)
  code_hash := encode(digest(invite_code, 'sha256'), 'hex');
  select * into target from public.organizations
    where invite_code_hash = code_hash
      and invite_expires_at > now()
    limit 1;
  if not found then raise exception 'invalid or expired invite'; end if;
  insert into public.profiles (id, display_name) values (uid, profile_name)
    on conflict (id) do update set display_name = excluded.display_name;
  insert into public.org_members (org_id, user_id, is_owner, roles)
    values (target.id, uid, false, default_roles);
  return target.id;
end;
$$;

-- Owner sets invite code (stores sha256 hex + expiry)
create or replace function public.set_invite_code(
  org uuid,
  code_hash text,
  expires_at timestamptz
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_org_owner(org) then raise exception 'not owner'; end if;
  update public.organizations
    set invite_code_hash = set_invite_code.code_hash,
        invite_expires_at = set_invite_code.expires_at
    where id = org;
end;
$$;

-- Owner clears invite (single-use: join already leaves code until regenerate; clear after join optional)
create or replace function public.clear_invite(org uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_org_owner(org) then raise exception 'not owner'; end if;
  update public.organizations
    set invite_code_hash = null, invite_expires_at = null
    where id = org;
end;
$$;

grant execute on function public.create_org_with_owner to authenticated;
grant execute on function public.join_org_with_invite to authenticated;
grant execute on function public.set_invite_code to authenticated;
grant execute on function public.clear_invite to authenticated;
```

Note: `digest` requires `pgcrypto`; enable with `create extension if not exists pgcrypto;` at top of migration.

- [ ] **Step 6: Verify client module loads (no env = clear error)**

Add temporary check via bun one-liner optional; at minimum `npx eslint src/lib/auth/supabase.ts src/lib/auth/types.ts`.

---

### Task 3: Invite pure helpers

**Files:**
- Create: `src/lib/auth/invite.ts`
- Test: `src/lib/auth/invite.test.ts`

**Interfaces:**
- Produces: `generateInviteCode(): string`; `sha256Hex(code: string): Promise<string>`; `INVITE_TTL_MS`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "bun:test";
import { generateInviteCode, sha256Hex, INVITE_TTL_MS } from "./invite";

describe("invite codes", () => {
  it("generates a non-empty code", () => {
    const code = generateInviteCode();
    expect(code.length).toBeGreaterThanOrEqual(8);
  });
  it("hashes deterministically", async () => {
    const a = await sha256Hex("ABC123");
    const b = await sha256Hex("ABC123");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("has a positive TTL", () => {
    expect(INVITE_TTL_MS).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Fail → implement**

```ts
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function generateInviteCode(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").toUpperCase().slice(0, 12);
}

export async function sha256Hex(code: string): Promise<string> {
  const data = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 3: Green**

```bash
bun test src/lib/auth/invite.test.ts
```

---

### Task 4: Auth session context (Actor + org)

**Files:**
- Create: `src/lib/auth/auth-context.tsx`
- Create: `src/lib/auth/auth-context.test.ts` (pure helpers extracted where possible)

**Interfaces:**
- Consumes: `getSupabase`, types, invite helpers.
- Produces: `AuthProvider`, `useAuth(): { status, actor, soleUser, isOwner, org, signIn, signUpCreateOrg, signUpJoinOrg, signOut, refreshOrg, regenerateInvite, setMemberRoles, members }`.
- `actor: Actor | null` where `Actor` from `@/lib/ap/state-machine` (`name = profile.display_name`, `roles` from membership).
- `soleUser: boolean` (`memberCount === 1`).

- [ ] **Step 1: Pure helper tests (session → actor)**

```ts
// src/lib/auth/auth-context.test.ts
import { describe, expect, it } from "bun:test";
import { actorFromSession } from "./session-actor";
import type { AuthProfile, SessionOrg } from "./types";

const profile: AuthProfile = { id: "u1", displayName: "Ada Ops" };
const org: SessionOrg = {
  orgId: "o1",
  orgName: "Acme",
  isOwner: true,
  roles: ["processor", "approver", "treasury"],
  memberCount: 1,
};

describe("actorFromSession", () => {
  it("maps display name and roles", () => {
    const a = actorFromSession(profile, org);
    expect(a).toEqual({
      name: "Ada Ops",
      roles: ["processor", "approver", "treasury"],
    });
  });
  it("returns null without profile or org", () => {
    expect(actorFromSession(null, org)).toBeNull();
    expect(actorFromSession(profile, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Create `session-actor.ts`**

```ts
import type { Actor } from "@/lib/ap/state-machine";
import type { AuthProfile, SessionOrg } from "./types";

export function actorFromSession(
  profile: AuthProfile | null,
  org: SessionOrg | null,
): Actor | null {
  if (!profile || !org) return null;
  return { name: profile.displayName, roles: org.roles };
}

export function soleUserFromOrg(org: SessionOrg | null): boolean {
  return org !== null && org.memberCount === 1;
}
```

- [ ] **Step 3: Green session-actor tests**

```bash
bun test src/lib/auth/auth-context.test.ts
```

- [ ] **Step 4: Implement `auth-context.tsx`**

Responsibilities (full file in implementation; shape):

```tsx
type AuthStatus = "loading" | "signedOut" | "signedIn";

type AuthCtx = {
  status: AuthStatus;
  actor: Actor | null;
  soleUser: boolean;
  isOwner: boolean;
  org: SessionOrg | null;
  profile: AuthProfile | null;
  members: Array<AuthProfile & { isOwner: boolean; roles: OrgRole[] }>;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signUpCreateOrg: (input: {
    email: string;
    password: string;
    displayName: string;
    orgName: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  signUpJoinOrg: (input: {
    email: string;
    password: string;
    displayName: string;
    inviteCode: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  regenerateInvite: () => Promise<string | null>;
  setMemberRoles: (userId: string, roles: OrgRole[]) => Promise<{ ok: boolean; error?: string }>;
};
```

Load flow:
1. `supabase.auth.getSession()`
2. Load `profiles` row + `org_members` for user + org name + `memberCount` (`select count` same org).
3. Derive `actor` / `soleUser`.

Sign up create org:
1. `auth.signUp({ email, password })`
2. `rpc("create_org_with_owner", { org_name, profile_name, initial_roles: all three })`
3. Refresh org; generate invite client-side for Settings (store via `set_invite_code`).

Sign up join:
1. `auth.signUp`
2. `rpc("join_org_with_invite", { invite_code, profile_name, default_roles: ["processor"] })`
3. Refresh org.

Errors: map Supabase messages to user-facing strings (invalid invite → "That invite code isn’t valid or has expired.").

Export `useAuth()` throwing if outside `AuthProvider`.

- [ ] **Step 5: Lint**

```bash
npx eslint src/lib/auth
```

---

### Task 5: Login / Sign-up routes + Tauri guard

**Files:**
- Create: `src/routes/login.tsx` (file route for web tree if kept)
- Create: `src/components/ap/login-screen.tsx` (shared UI)
- Modify: `src/tauri/router.tsx` (register `/login`)
- Modify: `src/tauri/root.tsx` (wrap `AuthProvider`)
- Modify: `src/routes/__root.tsx` (wrap `AuthProvider` for parity if web remains)
- Create: `src/lib/auth/require-auth.ts` (optional helper)

**Interfaces:**
- Consumes: `useAuth`, `AuthProvider`.
- Produces: Route `/login`; all other routes redirect when `status === "signedOut"`.

- [ ] **Step 1: Login screen component**

`login-screen.tsx`: tabs or mode toggle — **Sign in** | **Create account** | **Join with code**.

Fields:
- Sign in: email, password
- Create: email, password, display name, organization name
- Join: email, password, display name, invite code

Uses `Button`, `Input`, `Label` from existing UI; `sonner` toasts; after success `navigate({ to: "/" })`.

- [ ] **Step 2: Register `/login` in Tauri router**

```tsx
import { Route as LoginRoute } from "../routes/login";
// in addChildren:
withTree(LoginRoute, "/login", "/login"),
```

- [ ] **Step 3: `AuthProvider` in `TauriShell`**

```tsx
export function TauriShell({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={tauriQueryClient}>
      <AuthProvider>
        <ApProvider>
          <UploadJobsProvider>
            {children}
            <Toaster position="bottom-right" />
          </UploadJobsProvider>
        </ApProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Guard**

In `RootShell`/`TauriShell` children path or a small `RequireAuth` wrapper used by app routes:

```tsx
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (status === "signedOut") navigate({ to: "/login", replace: true });
  }, [status, navigate]);
  if (status === "loading") return null; // or route-fallback spinner
  if (status === "signedOut") return null;
  return <>{children}</>;
}
```

Apply around app content in `TauriShell` **excluding** `/login` — simplest: guard inside `login` route’s sibling by checking pathname, or wrap each app route’s Shell. **Chosen approach:** wrap `children` in `TauriShell` with a component that reads `useRouterState` pathname; if `pathname === "/login"` render children unguarded; else `RequireAuth`.

- [ ] **Step 5: Manual check**

`npm run dev:tauri` (or `vite` tauri config) → unauthenticated lands on login; after sign-up create org → inbox.

---

### Task 6: Wire session actor through runtime (kill hardcoded humans)

**Files:**
- Modify: `src/routes/invoices.$id.tsx` (~225–236, `advance` call sites)
- Modify: `src/routes/index.tsx` (remove `PROCESSOR` const; use `useAuth`)
- Modify: `src/components/ap/remove-from-queue.tsx`
- Modify: `src/components/ap/use-draft-mapping.ts` (~401)
- Modify: `src/components/ap/vendor-profile-registration.tsx` (`PROCESSOR_ACTOR`)
- Modify: `src/lib/ap/store.tsx` (fallback actor at updateInvoice ~407, linkPo ~474)
- Modify: `src/lib/ap/samples.ts` (neutral sample actors)
- Modify: `src/lib/ap/store.tsx` `applyTransition` (thread `soleUser`)

**Interfaces:**
- Consumes: `useAuth().actor`, `soleUser`.
- Produces: all human audit `actor` strings = `profile.displayName`.

- [ ] **Step 1: `applyTransition` accepts `soleUser`**

Extend store `Ctx["applyTransition"]` input with `soleUser?: boolean` and pass through to `transition()`.

- [ ] **Step 2: `invoices.$id.tsx`**

Replace personas block:

```tsx
const { actor, soleUser } = useAuth();
// guard already ensures actor non-null when signed in; fallback for types:
const sessionActor: Actor = actor ?? { name: "unknown", roles: [] };

const editor = sessionActor; // corrections attributed to signed-in user
```

Every `advance(...)` call: pass `sessionActor`; when calling `applyTransition`, include `soleUser`.

For transitions that need a **role the UI implies** but user may hold multiple: use full `sessionActor.roles` (machine already checks membership).

Replace:
```ts
const actors = { processor: ..., approver: ..., treasury: ... };
```
with `sessionActor` only (remove `editor` ternary on status).

- [ ] **Step 3: Other components**

- `remove-from-queue.tsx`: `const { actor, soleUser } = useAuth();` then `availableTransitions(invoice, actor, { soleUser })` and `removeInvoice(invoice.id, actor, note)`.
- `use-draft-mapping.ts`: `actor: sessionActor` (from `useAuth` in hook or parent prop — prefer `useAuth` inside hook file).
- `vendor-profile-registration.tsx`: delete `PROCESSOR_ACTOR`; use `useAuth().actor` for `updateInvoice` actor name strings and `applyTransition`.
- `index.tsx`: delete `PROCESSOR`; restore path uses `useAuth().actor`.

- [ ] **Step 4: Store defaults**

```ts
actor: actor ?? "unknown",
```

in `updateInvoice` and `linkPo` audit writes (never invent "Luuk Koppen").

- [ ] **Step 5: `samples.ts`**

Replace `"Dana Whitfield"` → `"Sample Approver"`; `"Luuk Koppen"` → `"Sample Processor"`; `"Payments"` stays `"Payments"` (treasury desk label) or `"Sample Treasury"` — **use Sample Processor / Sample Approver / Sample Treasury** for consistency. Demo-only data.

- [ ] **Step 6: Grep gate**

```bash
rg -n "Dana Whitfield|Luuk Koppen|PROCESSOR_ACTOR" src
```

Expected: no hits outside comments/docs/tests fixtures that intentionally use other names (update tests if they assert Luuk in samples).

- [ ] **Step 7: Tests**

```bash
bun test
```

Fix any sample/approval tests asserting old names (`approval.test.ts` uses Dana in fixture audit — update fixture actor string if test still passes behaviorally; prefer rename fixture to `"Ada Approver"`).

---

### Task 7: Settings — invite + team roles

**Files:**
- Modify: `src/routes/settings.tsx` (new Section below Company details)
- Create: `src/components/ap/team-section.tsx` (keeps settings file smaller)

**Interfaces:**
- Consumes: `useAuth()` → `isOwner`, `members`, `regenerateInvite`, `setMemberRoles`, `org`.
- Produces: UI only; no new store keys.

- [ ] **Step 1: `team-section.tsx`**

- If not owner: list members + own roles (read-only).
- If owner:
  - Invite code display (after regenerate) + **Regenerate invite** button (toast shows code once).
  - Table: name, roles (checkboxes processor/approver/treasury), owner badge.
  - Save roles via `setMemberRoles`.

- [ ] **Step 2: Mount in settings**

```tsx
<TeamSection />
```

after business profile sections.

- [ ] **Step 3: Lint**

```bash
npx eslint src/routes/settings.tsx src/components/ap/team-section.tsx
```

---

### Task 8: Drop web as supported runtime (package scripts)

**Files:**
- Modify: `package.json`

**Decision (spec):** Desktop only; web scripts removed or marked unsupported.

- [ ] **Step 1: Edit scripts**

Remove `"dev": "vite dev"` and `"build": "vite build"` **or** replace with echo pointing at tauri:

```json
"dev": "npm run dev:tauri",
"build": "npm run build:tauri"
```

**Chosen:** remap `dev`/`build` to Tauri variants so Lovable/docs examples don’t break; desktop remains the real target. Keep `preview` only if harmless.

- [ ] **Step 2: Document**

One line in README Status or Getting started: desktop primary (`npm run tauri:dev`). Do **not** rewrite full positioning (out of scope).

---

### Task 9: Verification sweep

**Files:** none (commands only)

- [ ] **Step 1: Full unit suite**

```bash
bun test
```

Expected: 0 fail (all prior + new auth/SoD tests).

- [ ] **Step 2: Scoped lint + format**

```bash
npx eslint src/lib/auth src/lib/ap/state-machine.ts src/lib/ap/state-machine.test.ts src/lib/ap/store.tsx src/lib/ap/samples.ts src/components/ap/remove-from-queue.tsx src/components/ap/vendor-profile-registration.tsx src/components/ap/team-section.tsx src/components/ap/login-screen.tsx src/routes/settings.tsx src/routes/login.tsx src/routes/index.tsx
```

```bash
npx prettier --write src/lib/auth src/lib/ap/state-machine.ts src/lib/ap/store.tsx src/components/ap/team-section.tsx src/components/ap/login-screen.tsx src/routes/login.tsx
```

PowerShell path for invoice route if edited:

```bash
npx eslint 'src/routes/invoices.$id.tsx'
```

- [ ] **Step 3: Persona grep**

```bash
rg -n "Dana Whitfield|Luuk Koppen" src
```

Expected: no runtime hits (tests/samples use Sample * names).

- [ ] **Step 4: Manual E2E (needs live Supabase project)**

1. Create org account → Settings shows invite.
2. Second machine/profile join with code → member appears with `processor`.
3. Confirm draft → audit shows real display name, not Dana/Luuk.
4. Sole user: confirm → approve → release without SoD toast.
5. After second member joins: same person cannot confirm+approve if both names equal — assign different display names and verify SoD returns.

---

## Self-review notes

- Spec coverage: SoD (T1), Supabase+SQL (T2), invite (T3), session/Actor (T4), guard/login (T5), persona removal + store fallback + samples (T6), owner team UI (T7), desktop-only scripts (T8), tests/gates (T9).
- `soleUser` threading: store `applyTransition` + `availableTransitions` call sites in T1/T6/T7 UI.
- No git steps (constraint).
- Invoice content migration: explicitly out of scope (spec).
