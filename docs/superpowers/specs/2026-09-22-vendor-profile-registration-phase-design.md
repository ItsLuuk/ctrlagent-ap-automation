# Vendor Profile Registration Phase — Design Spec

Date: 2026-09-22. Status: approved by user. Approach: true new phase before Draft.

## Goal

Pin the identity of a new vendor (name, address, IBAN, VAT, KVK, business email,
**department**) on a dedicated phase that sits *before* Draft. Once the profile is
saved, the invoice enters the existing Draft flow and never returns to this phase
unless a downstream re-open triggers identity drift.

## Locked decisions

1. **Placement before Draft.** New phase renders as a 4th pipeline step in front of
   the existing three. Status `vendor_profile`. New pipeline:
   `Vendor profile → Draft → For approval → Ready for handoff`.
2. **Trigger = DB lookup on upload.** When an invoice is uploaded, the system looks
   up `vendors[invoice.vendor]`. If absent, the invoice enters `vendor_profile`
   immediately after the upload job (post-processing) instead of `draft`.
4. **Two department fields, vendor-defaults to invoice.**
   - New: `VendorMaster.department` (a `DEPARTMENTS` value).
   - Existing: `Invoice.department` (per-invoice override).
   - On the `vendor_profile → draft` transition, the invoice's `department` seeds
     from the vendor profile unless the invoice already has one.
5. **Department set = existing `DEPARTMENTS`** (Engineering, Finance, Marketing,
   Operations, Sales, People). No new constants.

## §1 Pipeline render — 4 steps

`src/components/ap/status.tsx` (`PIPELINE_STEPS`) gains a leading step:

```ts
{ key: "vendor_profile", label: "Vendor profile", icon: UserCircle }
```

`statusToStep` returns the `vendor_profile` index for the new status. `paid` still
maps to the last step (terminal).

## §2 State machine — new status + transitions

New `InvoiceStatus`: `"vendor_profile"`.

New `TransitionId`s:

- `register-profile` — implicit, written by upload handler on detection of a new
  vendor. Not a user action; system-actor only.
- `vendor-profile-confirmed` — `vendor_profile → draft` (processor). Writes
  vendor-master + carries department into the invoice's `department` field.
- `vendor-profile-rejected` — `vendor_profile → rejected` (processor, reason
  required). Used when the invoice is misidentified.
- `archive` already exists; extend its `from` list to include `vendor_profile`.

SoD extension: `confirmed` covers both the Draft confirm and the profile confirm
  (single responsibility for "I trust this vendor identity"). The same person who
  registered the profile cannot also approve the same invoice for payment, unless
  the system is the actor.

Audit: every transition writes an `AuditEntry`. The `register-profile` audit
entry is written by `system`, not a user.

## §3 VendorMaster — add department

```ts
export type Department = (typeof DEPARTMENTS)[number]; // re-export
export type VendorMaster = {
  name: string;
  email: string;
  logoUrl?: string;
  address?: string;
  iban?: string;
  vatNumber?: string;
  businessRegistrationNumber?: string;
  /** Per-vendor default department — invoices from this vendor prefill this. */
  department?: Department;
  // legacy fields kept
  kvkNumber?: string;
  paymentTerms?: string;
  updatedAt: string;
};

export const PROFILE_FIELDS = [
  "name", "email", "address", "iban", "vatNumber", "businessRegistrationNumber",
  "department",
] as const;
```

Meter becomes 0–7 (was 0–6). `profileCompleteness` unchanged in shape.

## §4 Phase screen — Vendor profile registration

`src/routes/invoices.$id.tsx` already routes by status. The screen for
`status === "vendor_profile"` is a new function component `VendorProfileRegistration`
in `src/components/ap/vendor-profile-registration.tsx`. It renders the document
preview on the left (no zones — review hasn't started yet) and the **full profile
card** on the right (the existing `VendorProfileCard` in expanded mode, since this
is always a new vendor).

Actions:

- **Save profile & open draft** — primary button. Persists the profile via
  `upsertVendor`, transitions `vendor_profile → draft` via the state machine, then
  navigates to the same invoice detail screen now showing the Draft mapper.
- **Reject this invoice** — secondary, with reason textarea. Transitions
  `vendor_profile → rejected`.

The screen is editable inline; the focus is the profile fields, not the document.

## §5 Upload routing — DB lookup on upload

`src/components/ap/upload-dialog.tsx` (and the worker that processes the upload)
calls into the store. After the invoice record is created and the processing job
finishes (or the draft data is ready), the create flow checks `vendors[vendor]`.
If absent, the invoice is created with `status: "vendor_profile"`. If present,
existing `status: "draft"` path is used.

Concretely, the entry point is the store helper that creates invoices. There is
**one place** that decides — no scattered checks.

The status setter goes through `applyTransition` with transition
`register-profile` and actor `SYSTEM_ACTOR`, so the audit log records it.

## §6 Migration

- Existing `VendorMaster` records load unchanged (department is optional).
- `profileCompleteness` returns 7 as `total` for all vendors; existing records
  start at lower fill counts (1–6), not at zero.
- Existing invoices with `status === "draft"` stay on `draft` — no backfill.
  Re-opening a `paid` invoice still goes to `review`, not `vendor_profile`.

## §7 Out of scope (explicit)

- Approval, payment, ERP sync, GL coding — untouched.
- The Draft screen's exception queue still surfaces profile gaps for **known**
  vendors whose record is incomplete. For **new** vendors, profile completeness is
  addressed in the dedicated phase, not on Draft.
- Vendor merge / split / dedupe — Future Features Backlog.

## §8 Edge cases

- **Same vendor name reused but record was deleted.** Treated as new vendor
  (lookup is by exact name match against current `vendors[name]`).
- **Vendor name typo in extraction.** Profile screen lets the user correct the
  name; if corrected, the vendor lookup re-runs on save. If still unmatched after
  correction, the save still completes and writes a new vendor record with the
  corrected name.
- **Processing fails on upload.** Invoice enters `failed`, not `vendor_profile`.
  Manual retry path is unchanged.
- **Department not picked.** Profile is still saveable. Meter shows 6/7. No
  blocking; `vendor-profile-confirmed` does not require department.

## Success criteria

- A first-time vendor invoice reaches the new phase automatically — no manual
  routing. Test: upload + new vendor name → invoice has `status: "vendor_profile"`.
- Saving the profile moves the invoice to Draft with vendor-master populated.
  Test: unit on the transition + the persist-and-route.
- Existing draft/review/scheduled invoices are unaffected.
- Department shows on the vendor's profile card and seeds `Invoice.department`.

## Non-goals

- Profile versioning / history (audit log already covers edits via existing
  `updateInvoice` / `upsertVendor` writes).
- Per-field confidence scoring on the profile (profile fields are not extracted).
- Multi-tenant department configuration.
- Internationalized department labels.