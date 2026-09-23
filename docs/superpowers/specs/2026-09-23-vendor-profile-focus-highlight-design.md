# Vendor Profile Focus Highlight Design

**Date:** 2026-09-23
**Status:** Approved
**Scope:** Highlight the vendor's region on the document as each registration field receives focus, mirroring how a review row points at its region.

## Problem

The vendor profile registration screen (`src/components/ap/vendor-profile-registration.tsx`) renders the document beside the form but never highlights anything: `DocPreview` is mounted without a `highlight` prop (line 226), and no input tracks focus. Review (`Detail` in `src/routes/invoices.$id.tsx`) already has the target behavior — focused row → zone → `%`-positioned overlay in `DocPreview`. Registration should do the same, driven by field focus.

## Decisions (from Q&A)

| Question | Decision |
|---|---|
| Highlight trigger | **Focus only** — appears on focus (click/tab), clears on blur. No hover. |
| Document types | **Image uploads only** — PDF iframe and sample-paper rendition get no overlay (same limitation as review today). |
| Missing zone | **Silent no-highlight** — focus works, nothing overlays; never draw-on-focus, never vendor-block fallback. |

## Design

### 1. Field→zone map — `src/lib/ap/vendor-master.ts`

New constant beside `PROFILE_FIELDS`:

```ts
export const PROFILE_ZONE_FIELD: Partial<Record<ProfileField, ZoneField>> = {
  name: "vendor",
  email: "vendorEmail",
  address: "address",
  iban: "iban",
  vatNumber: "vatNumber",
  businessRegistrationNumber: "businessRegistrationNumber",
};
```

`department` intentionally absent — it has no position on the document. Type import: `ZoneField` from `./types`.

### 2. Focus state — `vendor-profile-registration.tsx`

```ts
const [focusedProfileField, setFocusedProfileField] = useState<ProfileField>();
```

One delegated handler pair on the form container inside `VendorProfileCard`'s expanded mode (the element wrapping all seven field rows) via React capture phase (`onFocusCapture` / `onBlurCapture`):

- Reads `event.target.closest("[data-profile-field]")` — every control already carries `data-profile-field` (inputs, department Select, IBAN's check input). One handler covers all fields including IBAN's four sub-controls.
- **Blur guard:** clear only when `relatedTarget`'s field differs from the blurred field (or is absent). Prevents flicker when tabbing between IBAN's country/check/bank/account controls.

Existing programmatic focus (`profileFocus` save-gate jump) is untouched: focusing an input fires `focusin`, so the highlight follows automatically — the save-gate error jump now points at the document too.

Approach chosen: capture-phase delegation (Approach 1). Per-input `onFocus` (Approach 2) needs 8+ call sites; unifying with review's state into a shared hook (Approach 3) is refactor scope creep.

### 3. Zones + highlight — `vendor-profile-registration.tsx`

Clone review's derivation (`invoices.$id.tsx:275-285`):

```ts
// isImage: same predicate review uses — an uploaded image file (not PDF,
// not sample, not expired session). Match Detail's computation in
// invoices.$id.tsx rather than inventing a second definition.
const zones = useMemo(() => {
  if (!isImage) return {};
  const map: Partial<Record<ZoneField, Zone>> = {};
  for (const field of Object.values(PROFILE_ZONE_FIELD)) {
    map[field] = invoice.zones?.[field] ?? suggestZone(invoice, field);
  }
  return map;
}, [invoice, isImage]);

const zoneField = focusedProfileField
  ? PROFILE_ZONE_FIELD[focusedProfileField]
  : undefined;
const highlight = zoneField ? zones[zoneField] : undefined;
```

Wire the pane (line 226): `<DocPreview invoice={invoice} highlight={highlight} />`.

**No `DocPreview` changes.** It already renders the `aria-hidden` `%`-positioned span, auto-scrolls to the highlight (respecting `prefers-reduced-motion`), and skips rendering when `highlight` is undefined.

**Zone availability reality:** `suggestZone` (`src/lib/ap/mapping.ts:308`) only knows the 7 `ZONE_FIELDS` — of the profile map, only `name → vendor` can be suggested from OCR words. `email`, `address`, `iban`, `vatNumber`, `businessRegistrationNumber` highlight only when `invoice.zones` holds a persisted zone (drawn in review's zone editor or saved from draft mapping). Everything else is silent no-highlight, per decision.

`department` focus → no map entry → `highlight` undefined → overlay clears.

### 4. Edge cases

- **IBAN sub-control tabbing** — blur guard keeps highlight stable across the four controls.
- **Blur to nowhere** (click outside the form) — `relatedTarget` null → clear.
- **PDF / sample / expired-session** — `isImage` false → empty zones map → no overlay (branch condition already in `DocPreview`).
- **Multi-page** — zones are page-1-relative; the overlay sits on the single rendered `<img>`, identical to review.
- **Error handling** — none new: pure synchronous derive + React state.

## Testing

- **Unit** (`bun test`, style of `vendor-master.test.ts`): `PROFILE_ZONE_FIELD` keys ⊆ `ProfileField`, values ⊆ `ZoneField`, `department` absent, all six mapped fields present.
- **E2E:** registration route continues to render (existing routes-smoke coverage). Focus→overlay assertion needs an image-upload fixture — evaluate at plan time; manual check is the fallback.
- **Manual:**
  1. Image-upload invoice in `vendor_profile` → tab/click through fields → highlight follows each focus, clears on blur.
  2. `department` focus → no highlight.
  3. Save with gaps → first gap focused **and** highlighted.
  4. PDF-upload invoice → no overlay (accepted limitation).

## Out of scope

- Rasterizing PDF page 1 in `DocPreview` (Approach B of Q2 — rejected).
- Overlay on the sample-paper rendition.
- Hover preview, draw-on-focus, vendor-block fallback.
- Refactoring review and registration onto a shared highlight hook.
- `DocPreview` component changes of any kind.
