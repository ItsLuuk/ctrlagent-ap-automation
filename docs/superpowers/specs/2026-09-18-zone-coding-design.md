# Zone Coding — Invoice Field Anchors & Sanity Check

Date: 2026-09-18
Status: Approved (design)
Scope: Single implementation phase

## Problem

AP invoices re-read from scratch every time. The Draft phase currently does the
full AI extraction (gemma 4B, ~30-40s decode) with the user then manually
correcting fields. This spec adds a lightweight feedback loop: the user anchors
the position of each header field on an invoice (zones). Those anchors become a
vendor template. Future invoices from the same vendor keep the full AI read, but
each anchored field is also re-read from its crop with fast Tesseract OCR and
compared to the AI value. Mismatches are flagged for the human. This raises
accuracy at near-zero latency and teaches recurring layouts — the speed/quality
win is avoiding silent re-reading and correction loops, not skipping the AI.

## Decisions (approved)

- **Zone fields** (7 scalar header fields, no line items):
  `vendor`, `invoiceNumber`, `issueDate`, `dueDate`, `subtotal`, `tax`, `total`.
- **Reuse rule**: auto-match templates by vendor name. AI extraction already
  yields `vendor`; the template lookup keys on it.
- **Layout fidelity**: "mostly similar" — zones are normalized (0..1) and padded;
  no auto-alignment engine. Re-dragging a zone on a new invoice becomes that
  vendor's new default; that manual loop IS the alignment.
- **Date presentation**: DD-MM-YYYY / European Dutch. `shortDate` switches to
  `nl-NL`. Canonical stored date format stays `YYYY-MM-DD` (schema regex,
  `<input type="date">`), and the AI prompt keeps outputting `YYYY-MM-DD`.
  The zone check compares semantic dates: OCR crop text is parsed day-first
  (e.g. `04-03-2026`), compared against the AI value, and displayed as DD-MM-YYYY.
- **Outcome**: flags only, no auto-correction. Human stays in the loop.

## Non-goals

- No auto scale/translate alignment engine.
- No line-item zones (multi-row boxes).
- No small-model (2B) crop reads (future speed phase; Tesseract first).
- Unmatched vendors: nothing changes. No template/OCR failure: silent.

## Architecture

### Data model (`src/lib/ap/types.ts`)

```ts
export type Zone = { x: number; y: number; w: number; h: number }; // normalized 0..1

export type ZoneField = "vendor" | "invoiceNumber" | "issueDate" | "dueDate"
  | "subtotal" | "tax" | "total";

export type ZoneMap = Partial<Record<ZoneField, Zone>>;

export type VendorTemplate = { fields: ZoneMap; updatedAt: string };

export type ZoneCheckResult = {
  field: ZoneField;
  ai: string;      // formatted value the AI extracted (DD-MM-YYYY dates)
  ocr: string;     // what Tesseract read from the crop
  match: boolean;
};
```

`Invoice` gains optional `zones?: ZoneMap` (the anchors drawn on that draft) and
`zoneCheck?: ZoneCheckResult[]` (result of the sanity pass).

### Storage (`store.tsx`)

- New key `ap-automation-templates-v1` → `Record<string /*vendor*/, VendorTemplate>`.
- `upsertTemplate(vendor, zones)`: merge, latest per field wins, set `updatedAt`.
- `resetDemo` clears templates (and history/invoices as today).
- Persist/load effects symmetrical with existing invoices/history pattern.
- Zone/zoneCheck on Invoices persist via the existing invoice key (strip
  `fileUrl` on write as already done).

### Zone drawing UX (`doc-preview.tsx` + draft view in `invoices.$id.tsx`)

- Draft gains a **"Code zones"** toggle on the invoice preview.
- Overlays 7 resizable/draggable boxes (one per `ZoneField`), seeded from the
  AI-derived field positions if unknown — seeded centered-per-field-label when
  `zones` absent. Minimal initial design: boxes snap to the preview image
  (relative coords converted to normalized 0..1 on release).
- **"Save zones"** action: writes normalized boxes to the invoice's `zones` AND
  upserts the vendor template.
- No zones drawn / no save → no template mutation; boxes don't gate submit.

### Sanity check (`ocr.ts` / `gemma.ts`)

- After successful AI extraction and only when `vendor` present: look up template.
- For each template field present: crop the zone (+ `ZONE_PAD` ≈ 0.02 normalized
  each side, clamped) from the page image (768px downscale, reused), run
  Tesseract `eng+nld` on the crop, compare.
- **Compare rules**:
  - dates: parse OCR text day-first (DD-MM-YYYY, DD-MM-YY, YYYY-MM-DD, with
    `.`/`/`/`-` separators, `mrt`/`maart` months tolerated) → compare day/month/year
    to AI value's components.
  - money: strip `EUR`/`€`, space/nb-space thousands, comma decimals → numeric
    compare with tolerance 0.02.
  - strings (`vendor`, `invoiceNumber`): trim, lowercase, whitespace-collapse;
    equality or contains.
- Build `zoneCheck` from per-field results. Store on the invoice. Failure of any
  single Tesseract read, or missing template → that field is skipped (no entry).

### UI for results

- Draft and For approval show amber chips: "Zone check — invoiceNumber: AI
  `2026-0914` vs OCR `2026-0917`", scrolls/focuses the field. Green when matched
  (subtle), no chip when absent or skipped.

### Date presentation change (`types.ts` `shortDate`)

- Switch to `toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" })`
  → `04-03-2026`. Affected: invoice lists, detail, history, chips. `money`
  unchanged.

## Data flow (future invoice, matched vendor)

```
upload → AI extraction (unchanged, engine gemma) [30-40s]
       → vendor known → template[vendor]?
           ├─ no  → store invoice, no zone metadata
           └─ yes → for each zone field:
                     crop page image at zone (+pad)
                     Tesseract(eng+nld) → text
                     compare(field, text, aiValue) → match?/ocr
                     → zoneCheck[]
       → invoice stored with zones+zoneCheck → Draft shows chips
```

## Error handling

- Tesseract or template lookup failure: skip silently, invoice usable as today.
- Malformed template JSON in storage: ignored (try/catch on parse, like invoices).
- Zones on a PDF: per-page registration map; only pages with images checked;
  crop errors per page skip.

## Testing

- No test runner in repo; verification gates: `tsc --noEmit` 0 errors,
  `npm run lint` no new prettier errors, `npm run build` pass.
- Manual smoke: draw zones on a sample vendor, save; re-extract same-vendor
  invoice; verify: (a) matching fields show green/correct, (b) a perturbed value
  (e.g. wrong invoice number) flags amber, (c) vendor without template unaffected,
  (d) reset-demo clears templates, (e) history chip rendering.

## Open questions

None. Dates explicitly: display DD-MM-YYYY, storage YYYY-MM-DD, crop parsing
day-first.