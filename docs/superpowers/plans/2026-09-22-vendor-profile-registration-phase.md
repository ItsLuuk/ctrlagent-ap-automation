# Vendor Profile Registration Phase — Implementation Plan

**Goal:** Add a true new phase before Draft per
`docs/superpowers/specs/2026-09-22-vendor-profile-registration-phase-design.md`.

**Architecture:** Status and transition changes flow through the existing state
machine. Pure logic in lib modules (unit-tested). One new screen component, one
new route branch, small surgical changes to the Pipeline render and upload path.
No re-implementation of Draft / approval.

**Tech Stack:** React 19, Tailwind v4, TanStack Router/Start, `bun:test`, sonner toasts.

## Global Constraints

- New status goes through `state-machine.ts`. UI never sets `Invoice.status`
  directly — only via `transition()` / `applyTransition`.
- `vendor_profile` is reachable only via `register-profile` (system) on upload.
- `vendor_profile → draft` requires `vendor-profile-confirmed` transition; reason
  optional.
- `npm run build` must pass after every task; new files formatted with
  `npx prettier --write`.
- Existing write path reused: `updateInvoice`, `saveTemplate`/`upsertTemplate`,
  `applyTransition(id, { transition, actor })`, `upsertVendor`.

---

### Task 1: Extend `VendorMaster` with department

**Files:**
- Modify: `src/lib/ap/vendor-master.ts`
- Test: `src/lib/ap/vendor-master.test.ts` (extend existing)

**Interfaces:**
- Consumes: existing `DEPARTMENTS` from `./types`.
- Produces: `Department` type re-export, `VendorMaster.department?`,
  `PROFILE_FIELDS` now 7 entries.

- [ ] **Step 1: Update the failing test** — extend the existing test to cover the
  new field.

- [ ] **Step 2: Run** `bun test src/lib/ap/vendor-master.test.ts` — fails on
  missing exports.

- [ ] **Step 3: Update `vendor-master.ts`** — add the import + type + field;
  meter becomes 7.

- [ ] **Step 4: Run** `bun test src/lib/ap/` — no regressions.

---

### Task 2: State machine — new status + transitions

**Files:**
- Modify: `src/lib/ap/types.ts` (status + label)
- Modify: `src/lib/ap/state-machine.ts` (transitions, SoD)
- Test: extend `src/lib/ap/state-machine.test.ts` if it exists, otherwise new.

**Interfaces:**
- New status: `"vendor_profile"`.
- New transitions: `register-profile`, `vendor-profile-confirmed`,
  `vendor-profile-rejected`.
- `archive.from` extended to include `"vendor_profile"`.

- [ ] **Step 1: Tests first.**
  - `register-profile` from upload-only entry, system actor, creates
    `vendor_profile`.
  - `vendor-profile-confirmed` from `vendor_profile` → `draft`, requires
    processor role.
  - `vendor-profile-confirmed` rejected for non-processor (only system / processor).
  - `vendor-profile-rejected` requires reason, goes to `rejected`.
  - `archive` from `vendor_profile`.
  - SoD: actor who registered the profile cannot `approve` the same invoice
    (treated as same "confirmed" responsibility).

- [ ] **Step 2: Implement** — extend `STATUS_LABEL`, `STATUS_ORDER`,
  `STATUS_BY_PHASE`, `TRANSITION_LABEL`, `TRANSITIONS`, `SOD_RESPONSIBILITIES`.

- [ ] **Step 3: Update `transition()`** — extend the immutable guard so paid
  still can't go anywhere except `re-open`, no other rule changes.

- [ ] **Step 4: Run** `bun test src/lib/ap/state-machine*.test.ts`.

---

### Task 3: Pipeline render — 4 steps

**Files:**
- Modify: `src/components/ap/status.tsx`
- Modify: `src/lib/colors.ts` (status tones for `vendor_profile` if missing)

**Interfaces:**
- New leading step in `PIPELINE_STEPS`.
- `statusToStep` returns 0 for `vendor_profile`.
- `currentPhaseLabel` returns `Vendor profile` for `vendor_profile`.

- [ ] **Step 1: Update `PIPELINE_STEPS`** — add `{ key: "vendor_profile",
  label: "Vendor profile", icon: UserCircle }`. Import the icon.

- [ ] **Step 2: Update `statusToStep`** — explicit branch for `vendor_profile`
  returns 0. Keep `processing`/`failed` returning the draft index for now.

- [ ] **Step 3: Update `currentPhaseLabel`** — handle `vendor_profile`.

- [ ] **Step 4: Add status tone** for `vendor_profile` in `colors.ts` if absent
  (otherwise it'll show neutral).

- [ ] **Step 5: Build** — `npm run build 2>&1 | Select-Object -Last 3`.

---

### Task 4: Vendor profile registration screen

**Files:**
- Create: `src/components/ap/vendor-profile-registration.tsx`
- Modify: `src/routes/invoices.$id.tsx` (route the new status)

**Interfaces:**
- Consumes: `useAp` (`upsertVendor`, `updateInvoice`, `applyTransition`,
  `vendors`); existing `VendorProfileCard`; `SYSTEM_ACTOR`; processor actor.
- Produces: a screen for `status === "vendor_profile"` showing:
  - Document preview (reuse `DocumentPane` if accessible, otherwise a
    placeholder).
  - Full expanded `VendorProfileCard`.
  - Primary action: Save profile & open draft.
  - Secondary action: Reject with reason.
  - Empty profile initial state seeded from extracted vendor fields on the
    invoice (name, address, iban, vatNumber, businessRegistrationNumber,
    vendorEmail).

- [ ] **Step 1: Create the component** — props `invoice: Invoice`. Local
  `profileDraft: VendorMaster` initialized from extraction. `handleSave` calls
  `upsertVendor` then `applyTransition` with `vendor-profile-confirmed`.

- [ ] **Step 2: Reuse the existing `IbanField`** — already exists inside
  `vendor-profile-card.tsx`. The new screen mounts the card, no duplication.

- [ ] **Step 3: Wire route** in `src/routes/invoices.$id.tsx` — add a branch for
  `status === "vendor_profile"`. Existing `useDraftMapperView` switch extended.

- [ ] **Step 4: Build** — verify it compiles.

- [ ] **Step 5: Manual check in dev** — open an invoice with that status (or
  force one via test data) and confirm the screen renders.

---

### Task 5: Upload routing — DB lookup sets `vendor_profile`

**Files:**
- Modify: wherever the upload handler creates the invoice (likely
  `src/components/ap/upload-dialog.tsx` + `src/lib/ap/store.tsx`).

**Interfaces:**
- Consumes: `vendors` map, the new invoice record (with extracted `vendor`).
- Produces: invoice with `status: "vendor_profile"` when no vendor-master
  record exists; `status: "draft"` when one does. Audit entry written via
  `applyTransition` with `system` actor.

- [ ] **Step 1: Locate the create-from-upload path.** Grep for
  `createInvoice`, `addInvoice`, `status: "draft"` near upload.

- [ ] **Step 2: Centralize the decision.** A single helper `decideInitialStatus`
  (pure, unit-testable) returns `"vendor_profile" | "draft"` based on
  `vendors[vendor]`.

- [ ] **Step 3: Wire** the helper into the create path. Audit `system` action
  `Vendor profile registered`.

- [ ] **Step 4: Test the helper** — known vendor → draft; unknown → vendor_profile.

- [ ] **Step 5: Build.**

---

### Task 6: Pass department on confirm

**Files:**
- Modify: `src/components/ap/vendor-profile-registration.tsx` (the save handler).

**Interfaces:**
- Consumes: `VendorMaster.department`.
- Produces: on `vendor-profile-confirmed`, the invoice's `department` is set to
  the vendor's `department` if the invoice has none.

- [ ] **Step 1: Build the seed logic.** Local `handleSave` reads the profile
  draft, calls `updateInvoice({ department: profile.department ?? invoice.department })`
  alongside the transition.

- [ ] **Step 2: Build + manual check.**

---

### Task 7: Verification pass

- [ ] **Step 1: Full unit suite** — `bun test src/lib/ap/`.
- [ ] **Step 2: Full build** — `npm run build 2>&1 | Select-Object -Last 3`.
- [ ] **Step 3: Spec coverage walkthrough** (manual `npm run dev`):
  - Upload with new vendor name → invoice has `vendor_profile`.
  - Save profile → status flips to `draft`, `Invoice.department` seeded.
  - Existing draft invoices unchanged.
  - Pipeline renders 4 steps.
  - Reject path goes to `rejected`.