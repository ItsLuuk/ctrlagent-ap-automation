# Invoice Mapping — Build Plan

Date: 2026-09-19
Source vision: `Draft invoice mapping.md` (three-pane teaching screen)
Status: Plan
Related: `2026-09-18-zone-coding-design.md` (approved, wired, not surfaced), `2026-09-18-three-stage-pipeline-design.md`, `Pipeline rework.md`

## Where we are today

The learning loop already exists end-to-end in code; what's missing is almost
everything the user sees and does:

**Wired and working (don't rebuild):**

- Pipeline: preprocess → layout OCR (per-word boxes) → vendor fingerprint +
  embedding → template match (`template-store.ts`, `MATCH_THRESHOLD 0.78`) →
  `applyTemplateField` anchor+region extraction → VLM/heuristic fallback
  (`ocr.ts`: `extractQuickPhase` / `runBackgroundJob`, background jobs in
  `upload-jobs.tsx`).
- Auto-learn: on `addInvoice`, novel-path invoices derive an `AnchorSpec`
  template via `buildTemplateFromInvoice` (value-words + nearest anchor label).
- Manual templates: `ZoneEditor` (drag boxes on image invoices) →
  `store.upsertTemplate(vendor, zones)` (legacy `_zone` shape).
- Template sanity pass: `runZoneCheck` (crop + Tesseract + compare) →
  `zoneCheck[]` on the invoice; `ZoneCheckChip` component exists.
- Data model: `Invoice.zones`, `zoneCheck`, `learnPayload`, `fieldPath`,
  `confidence`, `fieldSources`; `VendorTemplate` with anchor-relative regions
  and versioning; types for line items, `ZONE_FIELDS` (7 scalar fields).

**Built but never reachable from any route:**

- `ZoneEditor` — `doc-preview.tsx` accepts `editingZones`/`onSaveZones`, but
  `invoices.$id.tsx` passes neither.
- `ZoneCheckChip` — defined, never rendered. `zoneCheck` is computed (legacy
  path only) and displayed nowhere.

**Not built at all (the actual spec):**

- Click-to-link mapping (field → source highlight, region → field popover).
- Confidence triage (green glance / amber work, sorted).
- Line-item region + column mapping (spec calls this the hard part).
- Anchor proposal chip ("anchor: 'Total' ✓") from a drawn region.
- Template preview pane ("what future Acme invoices will look like").
- Confirmation summary in human language ("will look for text near 'Invoice
  No' in the top-right"), training-wheels option, approve-only escape hatch.
- Drift / template-update mode (side-by-side diff when a layout changes).
- Quick-approve gating on totals cross-check; keyboard flow; undo.

## Guiding constraints

1. **Reuse the store, don't fork it.** One write path:
   `upsertTemplate(vendor, fields: AnchorSpec[])` becomes the *only* template
   writer; the legacy `ZoneMap` path in `store.tsx` migrates onto it. The
   legacy `._zone` hack gets absorbed (kept read-only for one release for
   stored invoices).
2. **The Draft screen is the mapping screen.** Don't build a separate
   "template editor" route — Phase 1 upgrades `invoices.$id.tsx` in draft
   status. The doc's promise is "teach once at confirm time".
3. **The 7 scalar fields ship first; line items are a separate phase.** The
   spec's own architecture puts line items in a dedicated sub-mode.
4. **Every phase ends at `tsc --noEmit` clean, `npm run lint` clean,
   `npm run build` green, plus a manual smoke script** (repo has no test
   runner — matching the zone-coding spec's verification gates).
5. Images only at first (ZoneEditor's constraint), PDFs via the existing
   `page.image` render path once the interaction is proven.

---

## Phase 0 — Make what exists reachable (wiring, ~0.5 day)

*Goal: nothing new; the approved zone-coding feature becomes usable and
demoable. This is also the foundation every later phase edits.*

- [ ] `invoices.$id.tsx`: add a **"Code zones"** toggle (draft status, image
      invoices) that passes `editingZones`/`onSaveZones` to `DocPreview`.
- [ ] On save: write `invoice.zones` via `updateInvoice` AND call
      `upsertTemplate(vendor, zones)` (both writes, as the zone spec decided).
- [ ] Render `ZoneCheckChip` next to each of the 7 fields using
      `resultFor(invoice.zoneCheck, field)`; clicking focuses the field input
      (refs via a `fieldRef` map).
- [ ] Fix the legacy-only gate in `finalizeInvoice` (`ocr.ts` ~L1253): run the
      zone check whenever a template matched and the invoice image is
      available — not just when `templates[vendor]` carries legacy `_zone`s.
- [ ] Smoke: draw zones on a sample image invoice → save → re-upload
      same-vendor image → chips appear (green; amber for a perturbed value).

## Phase 1 — Click-to-link mapping on the Draft screen (the core, ~2–3 days)

*Goal: the spec's two-directional linking, replacing the 7-box seed grid with
annotation-first mapping. This is the heart of the product.*

### 1a. Field → source (verify direction)

- [ ] `DraftMapper` state: `activeField: ExtractedField | null`.
- [ ] Focusing a field (click or `Tab`) highlights its zone on the document
      (pulse) and pans the scroll container to it. Data source:
      `invoice.zones[field]`; when absent, show the "empty slot" hint:
      *"Click the invoice number in the document"*.
- [ ] Reuse `learnPayload.pages[0].words` to **compute a suggested zone** for
      any field missing one (find the value text, take the bounding box ±
      padding) so highlighting works even when the user hasn't drawn yet.

### 1b. Region → field (correct direction)

- [ ] Document click in map mode opens the **Assign popover**
      (`Popover`, already in deps): `[Invoice #] [Date] [Total] … [Ignore]`,
      built from `ZONE_FIELDS`.
- [ ] Assignment stores a zone derived from the clicked word's bbox
      (`learnPayload` words; nearest word within a tolerance of the click).
- [ ] New `DraftMapper` component replaces the flat `Field` grid on the
      middle pane for `status === "draft"`: triaged list —
      - **amber first** (`confidence < 0.75` or zoneCheck mismatch or empty
        value), then greens;
      - green rows render value + confidence chip only (no input chrome);
        click to expand into edit mode (inline editing with the existing
        `Field` inputs);
      - cross-check line: "Line items sum to $X vs total $Y" with amber chip
        when |sum − total| > 0.02 (pure computation, no backend).
- [ ] Confirm buttons per the spec's escape hatches:
      - **Confirm & save template** — persists the invoice mapping to the
        vendor template via the new `upsertTemplate` write path, then the
        existing "Submit for approval" flow;
      - **Approve invoice only** — submit without touching the template;
      - **Undo** (`⌘Z`) of the last assignment (local history stack, max 20).
- [ ] Confirmation summary card (one line per mapped field, human language):
      *"Invoice # — will look for text near 'Factuurnummer' in the top-right"*.
      Copy generated from the saved `AnchorSpec` (anchor text + region
      quadrant). Confidence promise line beneath: "Next invoices from
      {vendor} will be read from this template."

### 1c. Anchor proposal (robustness detail)

- [ ] When a zone is drawn/assigned, run the anchor heuristic already in
      `ocr.ts` (`ANCHOR_LABELS`, nearest-label search) against the words in
      the payload; propose `anchor: "Total"` as a small editable chip:
      `anchor: "Total" ✓` with tooltip "We look for this text on future
      invoices to find the value — safer if layouts shift."
- [ ] Zone + anchor + type → `AnchorSpec` saved into the vendor template.

**Verify:** draft an image invoice with a novel vendor; map 3 fields by
clicking the document; confirm; upload a second same-vendor invoice → fields
come back via template path (`engine === "template"`) with chips green.

## Phase 2 — Template preview pane + confidence promise UI (~1–2 days)

*Goal: the third pane — the spec's "magic" — making teaching visible.*

- [ ] Right-side collapsible **Template preview** pane on the draft screen
      (replaces the current hardcoded reviewer/audit block on lg screens):
      - ghosted overlay list of mapped fields with their anchor + region
        quadrant ("Invoice # — top-right, anchor 'Factuurnummer'");
      - live updates as mappings change (single source of truth: the draft
        mapping state, not the saved template);
      - when the vendor already has a template: show current version
        (`v3 · updated 2 Apr`) and the **diff** — fields whose anchor/region
        changed vs. stored template, with "will update on confirm" note.
- [ ] Confirmation summary gains the **training-wheels** option:
      *"Save template, but ask me to confirm the next 2 invoices"* — persists
      `confirmNextCount: 2` on the vendor template.
- [ ] Template apply path (`tryTemplatePath`) respects `confirmNextCount`:
      when > 0, the invoice is created but held in draft with a banner
      "Template draft — please confirm this extraction" and the count
      decrements on confirm.

## Phase 3 — Line items sub-mode (~2–3 days)

*Goal: the spec's dedicated repeating-structure pattern, as a modal/expanded
mode from the line items card.*

- [ ] **Table region drawing**: AI proposes the region from `learnPayload`
      (cluster of amount-bearing rows); user drags edges (single-resizable-
      box pattern reused from `ZoneEditor`).
- [ ] **Column mapping strip**: one row of dropdowns over detected columns →
      field (`description`, `qty`, `unitPrice`, `amount`) / ignore / custom.
      Row detection from word x-histograms (existing `OcrWord` data).
- [ ] **Live parsed preview** table next to the region; errors obvious by
      construction (misaligned column shows garbage).
- [ ] Toggles: "exclude Subtotal/Tax/Total rows", "merge multi-line
      descriptions".
- [ ] Persist to the vendor template (`line_items` spec block per Pipeline
      rework schema); template path parses rows in-region when present.
- [ ] Zone-check analog for line items: sum of parsed amounts vs. invoice
      total chip.

## Phase 4 — Drift handling & template update mode (~1–2 days)

*Goal: the durable promise — templates evolve instead of silently breaking.*

- [ ] Detection (cheap, no ML): template path field-hit rate < threshold
      (e.g. 2+ fields missing) OR `zoneCheck` mismatch on ≥ 1 field →
      re-run the fallback path for the missing fields, store invoice with
      `templateDrift: { fields, resolvedBy }`.
- [ ] Draft screen renders **template update mode**: side-by-side old anchor
      (old zone overlay, grey) vs. newly drawn/mapped zone (accent), diff
      line "Acme changed their layout — update template?"; confirm bumps
      `version` (already supported by `upsertTemplate`).
- [ ] A "Templates" management entry (reads `readAllTemplates`): list, per
      vendor: version, field count, last used, "update mapping" (opens the
      draft mapper seeded from the stored template + most recent invoice).

## Phase 5 — Polish & throughput (opportunistic, after value is proven)

- [ ] Zoom-to-region on focus (scale transform on the document container).
- [ ] Keyboard flow: `Tab` cycles fields (auto-pan), `Enter` accepts, arrows
      move between candidate words in the popover.
- [ ] Quick-approve gating: when all fields green AND sum-check passes, the
      confirm button pulses with "All fields verified — approve in one
      click"; auto-approve for reruns when template confidence ≥ 0.9 and
      `confirmNextCount === 0` (invoice lands directly in "For approval",
      logged in audit + a "Recently auto-approved" filter).
- [ ] Native-resolution zoom (full-res blob viewer instead of the fit-width
      img), confidence "why" tooltips (`fieldPath` + anchor text on hover).
- [ ] PDF page selection for mapping (map per page; zone registration map per
      the zone spec's error-handling section).

## Explicit non-goals (this plan)

- No auto-alignment engine, no new ML models, no backend — everything stays
  browser-local (localStorage + cached `learnPayload`), consistent with the
  zone-coding and pipeline rework decisions.
- No line-item cell-level mapping — columns only, per the spec.
- No multi-page zone editing in Phases 0–2 (page 1 only; Phase 5 removes the
  limit).

## Suggested PR sequence

| PR | Contents | Phase |
|---|---|---|
| 1 | Phase 0 wiring + chip rendering + zone-check gate fix | 0 |
| 2 | `DraftMapper` field→source + region→field + confirm summary | 1 |
| 3 | Anchor proposal chips + new `upsertTemplate(fields)` write path | 1 |
| 4 | Template preview pane + training-wheels confirm | 2 |
| 5 | Line-item sub-mode | 3 |
| 6 | Drift detection + update mode + templates manager | 4 |

## Verification per phase (repo convention)

- `bun run lint` clean (or `npm run lint`), `tsc --noEmit` 0 errors,
  `npm run build` green.
- Manual smoke per phase documented in the PR (Phase 0 script above; later
  phases: full first-invoice → confirm → second-invoice-template-hit loop
  with image samples from `samples.ts`).
