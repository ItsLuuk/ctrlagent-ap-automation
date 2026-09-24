# Line-Item Extraction Confidence & Source-Page Indicator

Date: 2026-09-24
Status: Approved

## Goal

Show extraction confidence and source-page indicators for line items in the Draft line-items field:

- **Both** a block-level confidence score and per-row scores.
- Numeric percentage always visible per row, color-coded.
- Per-row source-page indicator (`p.N`).
- Hybrid scoring: extractor-native base score + shared sanity adjustments.

## Context

- `LineItem` already has optional `page` (`src/lib/ap/types.ts`), populated by the VLM extractor (`gemma.ts`) and OCR heuristic (`ocr.ts`), but never rendered. Template path (`mapping.ts`) does not set it.
- No per-line confidence exists anywhere in the pipeline.
- Header fields already have `confidence` + `fieldSources`, `ConfidenceChip`, and `LOW_CONFIDENCE_THRESHOLD = 0.75`.
- Three line-item extractors: VLM (Gemma), OCR regex heuristic, vendor template (`LineItemsSpec`).

## Design

### 1. Data model & scoring

**Type change** (`src/lib/ap/types.ts`):

```ts
type LineItem = {
  // ...existing fields
  page?: number | undefined;
  confidence?: number; // 0..1, new
};
```

**Base scores per extractor:**

| Path | Base score |
|---|---|
| VLM (`gemma.ts`) | Per-item confidence requested in prompt schema (0–1); fallback `0.7` if missing |
| OCR heuristic (`ocr.ts:guessLineItemsIn`) | Mean of `OcrWord.confidence` for words inside the row span |
| Template (`mapping.ts:parseRowIntoLineItem`) | Mean word confidence in column bands; also set `page` from region word positions (backfills missing `page`) |

**Shared adjustment** — new `scoreLineItems(items, subtotal?, total?)` in `src/lib/ap/confidence.ts`. Runs once, centrally, after extraction completes and items are merged into the invoice (not inside each extractor). Each extractor only produces the base `confidence`; `scoreLineItems` overwrites it with the adjusted value:

- Missing description → ×0.7
- Non-numeric/negative qty/price → ×0.6
- Lines ≠ subtotal/total (existing reconciliation) → cap all rows at 0.75 (mirrors cross-check ceiling)
- Clamp to 0..1

**Block score** = min of per-row scores (worst row drives triage). Derived in UI, not persisted.

### 2. UI

**Per-row** (`src/components/ap/line-items-list.tsx` → `DisplayRow` / `InlineEditRow`):

- Description cell gains trailing metadata line: `87% · p.2`
- Color thresholds: green ≥0.75, amber 0.5–0.75, red <0.5 (aligned with `LOW_CONFIDENCE_THRESHOLD = 0.75`)
- `p.N` only when `item.page` is present
- Muted small text (`text-xs text-muted-foreground`)

**Block header** (`draft-mapper.tsx` `LineItemsField`, near `aria-labelledby="draft-line-items-title"`):

- Existing `ConfidenceChip` showing block score
- Amber highlight when below threshold — consistent with header-field chips

**Read-only summary** (draft-mapper line-items summary block) + **approval-compare** line block: same chip treatment.

**Editing:** confidence/page are read-only metadata. Editing a row does not recalculate the score (user-trusted value stays displayed as extracted — matches header-field behavior post-edit).

## Error handling

- Missing confidence from VLM → fallback `0.7`.
- Missing `page` → omit page indicator (graceful).
- Missing subtotal/total → skip reconciliation cap.
- `scoreLineItems` always returns clamped 0..1 values; never throws.

## Testing

- Unit tests for `scoreLineItems`: penalty multipliers, reconciliation cap, clamping, missing inputs.
- Unit tests for each extractor base-score path (VLM fallback, OCR word-mean, template word-mean + page backfill).
- Component test: row renders `NN% · p.N`, color classes by threshold; block chip shows min score.

## Out of scope

- Bbox-level provenance/persistence.
- Recalculating confidence after user edits.
- Donut service (separate proof-of-concept).
