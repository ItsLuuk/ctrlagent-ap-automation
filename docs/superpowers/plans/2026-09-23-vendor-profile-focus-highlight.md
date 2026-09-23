# Vendor Profile Focus Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight the vendor's region on the document as each vendor-profile registration field receives focus, mirroring how review rows point at their region.

**Architecture:** Pure derivation + capture-phase delegation. A `PROFILE_ZONE_FIELD` constant maps six profile fields to `ZoneField`s; registration derives `isImage`/`zones`/`highlight` exactly as review does and passes `highlight` to the existing `DocPreview` prop. One focus/blur capture-handler pair on the card's expanded form container reads `data-profile-field` via `closest()` — no per-input handlers, no `DocPreview` changes.

**Tech Stack:** TanStack Start/Router, React 19, Tailwind v4, bun test (unit), Playwright (e2e).

## Global Constraints

- Highlight trigger: **focus only** — appears on focus (click/tab/programmatic), clears on blur. No hover.
- Document types: **image uploads only** — PDF iframe and sample-paper rendition get no overlay (same limitation as review today).
- Missing zone: **silent no-highlight** — focus works, nothing overlays; never draw-on-focus, never vendor-block fallback.
- `department` has no entry in `PROFILE_ZONE_FIELD` — focusing it clears/keeps the overlay absent.
- **No `DocPreview` component changes of any kind** (`src/components/ap/doc-preview.tsx` is read-only for this plan).
- `isImage` predicate must match review exactly: `Boolean(invoice.fileUrl && isImageInvoice(invoice.fileType, invoice.fileName))` (`src/routes/invoices.$id.tsx:272`).
- Blur guard: clear only when `relatedTarget`'s field differs from the blurred field (or is absent) — prevents IBAN 4-control flicker.
- Zone availability reality: `suggestZone` (`src/lib/ap/mapping.ts:308`) only knows the 7 `ZONE_FIELDS` — of the profile map, only `name → vendor` can be suggested from OCR; the other five highlight only when `invoice.zones` holds a persisted zone. Do not add fallbacks.
- This working directory is **not a git repository** — skip all commit steps; verification is tests + lint only.
- Lint scope: `npx eslint <touched files>` — repo-wide `npm run lint` times out at 180s+.
- Full spec: `docs/superpowers/specs/2026-09-23-vendor-profile-focus-highlight-design.md`.

---

### Task 1: `PROFILE_ZONE_FIELD` constant + unit test

**Files:**
- Modify: `src/lib/ap/vendor-master.ts` (new import at top; constant after `ProfileField` type, line 57)
- Test: `src/lib/ap/vendor-master.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `ProfileField` (already in `vendor-master.ts`), `ZoneField` type from `./types`
- Produces: `PROFILE_ZONE_FIELD: Partial<Record<ProfileField, ZoneField>>` — consumed by Task 3

- [ ] **Step 1: Write the failing test**

Add to `src/lib/ap/vendor-master.test.ts` — extend the import at lines 2-11 with `PROFILE_ZONE_FIELD` (keep existing imports), and append:

```ts
describe("PROFILE_ZONE_FIELD", () => {
  it("maps the six document-backed profile fields to zone fields", () => {
    expect(PROFILE_ZONE_FIELD).toEqual({
      name: "vendor",
      email: "vendorEmail",
      address: "address",
      iban: "iban",
      vatNumber: "vatNumber",
      businessRegistrationNumber: "businessRegistrationNumber",
    });
  });

  it("omits department — it has no position on the document", () => {
    expect(PROFILE_ZONE_FIELD.department).toBeUndefined();
  });

  it("uses only ProfileField keys", () => {
    for (const key of Object.keys(PROFILE_ZONE_FIELD)) {
      expect(PROFILE_FIELDS).toContain(key);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/ap/vendor-master.test.ts`
Expected: FAIL — `PROFILE_ZONE_FIELD` not exported from `./vendor-master`.

- [ ] **Step 3: Add the constant to `src/lib/ap/vendor-master.ts`**

Add at the very top of the file (before the doc comment is fine — type-only import):

```ts
import type { ZoneField } from "./types";
```

Insert immediately after line 57 (`export type ProfileField = ...`):

```ts
/** Profile field → document zone field, for focus-follows-highlight on registration.
 *  department is absent — it has no position on the document. */
export const PROFILE_ZONE_FIELD: Partial<Record<ProfileField, ZoneField>> = {
  name: "vendor",
  email: "vendorEmail",
  address: "address",
  iban: "iban",
  vatNumber: "vatNumber",
  businessRegistrationNumber: "businessRegistrationNumber",
};
```

Note: the file already has mid-file `import` statements (lines 67-68) — a top-of-file type import matches the codebase's mixed style; `types.ts` does not import `vendor-master.ts`, so no cycle.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/ap/vendor-master.test.ts`
Expected: PASS (all existing tests + 3 new).

- [ ] **Step 5: Run full unit suite for regressions**

Run: `bun test src/lib/ap/`
Expected: all PASS.

---

### Task 2: IBAN sub-controls get `data-profile-field="iban"`

**Files:**
- Modify: `src/components/ap/vendor-profile-card.tsx:366` (country `SelectTrigger`), `:406` (bank `SelectTrigger`), `:427` (bank custom `Input`), `:446` (account `Input`)

**Interfaces:**
- Consumes: existing `data-profile-field="iban"` on the check `Input` (line 385)
- Produces: all four IBAN sub-controls discoverable by `closest("[data-profile-field]")` — consumed by Task 3's delegated handler

Context: spec assumes "one handler covers all fields including IBAN's four sub-controls", but only the check-digit input carries the attribute today. Without this task, focusing the country/bank/account controls leaves the field lookup `undefined` and the highlight mis-tracks while tabbing inside the IBAN group.

- [ ] **Step 1: Add the attribute to the country trigger (line 366)**

```tsx
<SelectTrigger
  data-profile-field="iban"
  aria-label="IBAN country code"
  title={cfg ? `${country} — ${cfg.name}` : "Country code"}
  className={`${iosInput} w-full font-mono font-semibold uppercase sm:w-[104px] sm:shrink-0`}
>
```

- [ ] **Step 2: Add the attribute to the bank select trigger (line 406)**

```tsx
<SelectTrigger
  data-profile-field="iban"
  aria-label="IBAN bank code"
  title={bank || cfg?.bankPlaceholder || "Bank code"}
  className={`${iosInput} w-full font-mono font-semibold uppercase sm:min-w-0 sm:flex-1`}
>
```

- [ ] **Step 3: Add the attribute to the bank custom input (line 427)**

```tsx
<Input
  data-profile-field="iban"
  aria-label="IBAN bank code"
  inputMode={bankInputMode}
  autoCapitalize="characters"
  autoCorrect="off"
  spellCheck={false}
  maxLength={bankLen}
  placeholder={cfg?.bankPlaceholder ?? "RABO"}
  className={`${iosInput} w-full font-mono font-semibold uppercase sm:min-w-0 sm:flex-1`}
  value={showCustomBank ? (bankIsListed ? "" : bank) : bank}
  onChange={(e) => {
    setBankCustom(true);
    reassemble({ bank: e.target.value });
  }}
  onBlur={(e) => {
    if (!e.target.value) setBankCustom(false);
  }}
/>
```

- [ ] **Step 4: Add the attribute to the account input (line 446)**

```tsx
<Input
  data-profile-field="iban"
  aria-label="IBAN account number"
  inputMode="text"
  autoCapitalize="characters"
  autoCorrect="off"
  spellCheck={false}
  placeholder="0123456789"
  className={`${iosInput} w-full font-mono uppercase tracking-wide sm:min-w-0 sm:flex-[2]`}
  value={account}
  onChange={(e) => reassemble({ account: e.target.value })}
/>
```

- [ ] **Step 5: Lint the card**

Run: `npx eslint src/components/ap/vendor-profile-card.tsx`
Expected: no errors.

---

### Task 3: Registration wiring — focus state, capture handlers, zones, `highlight`

**Files:**
- Modify: `src/components/ap/vendor-profile-registration.tsx` — imports (lines 11, 22, 23-31), new state + handlers (after line 70), zones derivation (before `return`, after `handleReject`), `DocPreview` line 226, `VendorProfileCard` lines 230-236
- Modify: `src/components/ap/vendor-profile-card.tsx` — props signature (lines 492-505), expanded form container (line 601)

**Interfaces:**
- Consumes: `PROFILE_ZONE_FIELD` from Task 1; `data-profile-field` attributes including Task 2's IBAN attrs; existing `DocPreview` prop `highlight?: Zone | undefined` (`doc-preview.tsx:58`); `suggestZone` from `@/lib/ap/mapping`; `isImageInvoice` from `@/lib/ap/file-type`; review's derivation pattern (`invoices.$id.tsx:272-285`)
- Produces: rendered registration screen with focus-follows-highlight; no exported API

- [ ] **Step 1: Extend imports in `vendor-profile-registration.tsx`**

Line 11 becomes:

```ts
import { useMemo, type FocusEvent } from "react";
```

Line 22 becomes:

```ts
import type { Invoice, Zone, ZoneField } from "@/lib/ap/types";
```

Insert after line 15 (`import { Save, X } from "@/components/icons";` — actually after the icons import block ends at 14, keep alphabetical-ish with existing style; add these two):

```ts
import { isImageInvoice } from "@/lib/ap/file-type";
import { suggestZone } from "@/lib/ap/mapping";
```

Extend the `@/lib/ap/vendor-master` import (lines 23-31) with `PROFILE_ZONE_FIELD` (add to the value-import list; keep `type ProfileField`).

- [ ] **Step 2: Add focus state + field lookup + capture handlers**

Insert immediately after line 70 (`const seedRef = useRef(...)`), before `handleChange`:

```ts
/** Profile field currently focused — drives the document highlight. */
const [focusedProfileField, setFocusedProfileField] = useState<ProfileField | undefined>(undefined);

/** Nearest field-tagged control for a focus event endpoint, or undefined. */
const fieldOf = (node: EventTarget | null): ProfileField | undefined => {
  if (!(node instanceof Element)) return undefined;
  const host = node.closest("[data-profile-field]") as HTMLElement | null;
  return (host?.dataset.profileField as ProfileField | undefined) ?? undefined;
};

/** One delegated pair on the form container — capture phase, covers every control. */
const handleFocusCapture = (e: FocusEvent<HTMLDivElement>) => {
  setFocusedProfileField(fieldOf(e.target));
};

/** Blur guard: clear only when the next focus target's field differs (or is gone). */
const handleBlurCapture = (e: FocusEvent<HTMLDivElement>) => {
  if (fieldOf(e.target) !== fieldOf(e.relatedTarget)) setFocusedProfileField(undefined);
};
```

The existing programmatic save-gate focus (`profileFocus`, lines 68/94 + card's `focusField` effect at 529-539) is untouched: focusing an input fires `focusin`, the capture handler picks it up, and the save-gate jump now points at the document too.

- [ ] **Step 3: Add `isImage` + zones derivation**

Insert immediately after `handleReject` (after line 192), before `return (`:

```ts
/** Same predicate review uses — an uploaded image file (not PDF, not sample). */
const isImage = Boolean(invoice.fileUrl && isImageInvoice(invoice.fileType, invoice.fileName));

/** Where each profile field sits on the page, for focus → document jump. */
const zones = useMemo(() => {
  const out: Partial<Record<ZoneField, Zone>> = {};
  if (!isImage) return out;
  for (const mapped of Object.values(PROFILE_ZONE_FIELD)) {
    if (!mapped) continue;
    const zone = invoice.zones?.[mapped] ?? suggestZone(invoice, mapped);
    if (zone) out[mapped] = zone;
  }
  return out;
}, [invoice, isImage]);

const zoneField = focusedProfileField ? PROFILE_ZONE_FIELD[focusedProfileField] : undefined;
const highlight = zoneField ? zones[zoneField] : undefined;
```

Notes:
- `if (!mapped) continue` guards `Object.values` on a `Partial` (TS types the value `ZoneField | undefined`).
- `if (zone)` mirrors review's truthy guard (`invoices.$id.tsx:280`) — a `suggestZone` miss stays absent, i.e. silent no-highlight per spec.
- `department` focus → `zoneField` `undefined` → `highlight` `undefined` → overlay clears.

- [ ] **Step 4: Pass capture handlers to the card**

Replace lines 230-236:

```tsx
<VendorProfileCard
  vendor={profileDraft}
  onChange={handleChange}
  focusField={profileFocus}
  onFocusDone={() => setProfileFocus(null)}
  requiredFields={REQUIRED_PROFILE_FIELDS}
  onFocusCapture={handleFocusCapture}
  onBlurCapture={handleBlurCapture}
/>
```

- [ ] **Step 5: Wire the `DocPreview` highlight (line 226)**

```tsx
<DocPreview invoice={invoice} highlight={highlight} />
```

- [ ] **Step 6: Accept + spread the handlers in `vendor-profile-card.tsx`**

Extend the props signature (lines 492-505):

```tsx
export function VendorProfileCard({
  vendor,
  onChange,
  focusField,
  onFocusDone,
  requiredFields,
  onFocusCapture,
  onBlurCapture,
}: {
  vendor: VendorMaster;
  onChange: (field: ProfileField, value: string) => void;
  focusField: ProfileField | null;
  onFocusDone: () => void;
  /** Fields the current phase gates on — marked with a required asterisk. */
  requiredFields?: readonly ProfileField[];
  /** Capture-phase focus delegation from the registration screen (document highlight). */
  onFocusCapture?: FocusEventHandler<HTMLDivElement>;
  onBlurCapture?: FocusEventHandler<HTMLDivElement>;
}) {
```

Extend the card's `react` import (check line ~10-15 for the existing `useState`/`useEffect` line) with `type FocusEventHandler`.

Attach to the expanded form container (line 601):

```tsx
<div
  className="space-y-3 px-4 py-3"
  onFocusCapture={onFocusCapture}
  onBlurCapture={onBlurCapture}
>
```

Both handlers are optional — other `VendorProfileCard` call sites (none currently pass them) render unchanged. The slim/known-vendor branch (lines 542-573) has no field inputs, so no container change there.

- [ ] **Step 7: Lint both touched components**

Run: `npx eslint src/components/ap/vendor-profile-registration.tsx src/components/ap/vendor-profile-card.tsx`
Expected: no errors. Fix unused-import complaints if any (none expected — `FocusEvent`/`FocusEventHandler`/`useMemo`/`suggestZone`/`isImageInvoice`/`PROFILE_ZONE_FIELD`/`Zone`/`ZoneField` are all used).

- [ ] **Step 8: Run unit suite**

Run: `bun test src/lib/ap/`
Expected: all PASS.

---

### Task 4: Verification — routes smoke + manual checklist

**Files:**
- No file changes — verification only

**Interfaces:**
- Consumes: rendered registration route (`routes-smoke` seeded `vendor_profile` coverage clone), Task 1-3 behavior
- Produces: green verification signal

- [ ] **Step 1: Run the routes smoke suite**

Run: `bun run test:routes`
Expected: all PASS (18/18). Any registration-route failure = runtime exception in `vendor-profile-registration.tsx` or `vendor-profile-card.tsx` — read the test output for the thrown message.

- [ ] **Step 2: Lint all touched files together**

Run: `npx eslint src/lib/ap/vendor-master.ts src/lib/ap/vendor-master.test.ts src/components/ap/vendor-profile-registration.tsx src/components/ap/vendor-profile-card.tsx`
Expected: no errors.

- [ ] **Step 3: Run the full unit suite**

Run: `bun test src/lib/ap/`
Expected: all PASS (455+ tests).

- [ ] **Step 4: Manual verification (dev server)**

Run: `npm run dev`, open an image-upload invoice in `vendor_profile` status:

1. Tab/click through fields → highlight follows each focus, clears on blur.
2. `department` focus → no highlight.
3. Tab between IBAN country/check/bank/account → highlight stays (no flicker).
4. Save with gaps → first gap focused **and** highlighted (programmatic focus path).
5. PDF-upload invoice → no overlay (accepted limitation).
6. Click outside the form (e.g. Save button loses focus to nowhere / reject textarea) → highlight clears.

E2E focus→overlay assertion: **skipped** — no image-upload fixture exists in the Playwright suite (spec: "evaluate at plan time; manual check is the fallback"). Existing `routes-smoke` coverage of the registration route (Task 4 Step 1) guards the render path.

---

## Self-Review Notes

- Spec coverage: field→zone map (Task 1), focus state + delegated capture handlers + blur guard (Task 3 Step 2), zones derivation + `highlight` wiring (Task 3 Steps 3-5), IBAN four-sub-control coverage (Task 2 — spec assumed the attrs existed; they did not on 3 of 4 controls, so the task closes that gap), programmatic save-gate focus follows free (Task 3 Step 2 note), edge cases (blur-to-nowhere / PDF / department) fall out of the derivation, testing section (Task 4 + Task 1 unit tests). Out-of-scope items untouched: no `DocPreview` changes, no hover, no draw-on-focus, no shared-hook refactor, no PDF rasterization.
- Placeholder scan: every step carries exact code or exact commands; no TBD/TODO/"similar to Task N".
- Type consistency: `PROFILE_ZONE_FIELD` (Task 1 definition → Task 3 use), `focusedProfileField` / `fieldOf` / `handleFocusCapture` / `handleBlurCapture` (Task 3 Steps 2/4), `onFocusCapture`/`onBlurCapture` (Task 3 Step 4 card call → Step 6 card props), `highlight` (Step 3 derivation → Step 5 `DocPreview` prop, matches `doc-preview.tsx:58`).
- Plan-time deviation from spec §2: spec's handler-location sentence ("on the form container inside VendorProfileCard's expanded mode") is implemented as two optional props passed from registration and spread on that container — registration owns the state, the card owns the DOM node. Same event coverage, no state moved into the card.
