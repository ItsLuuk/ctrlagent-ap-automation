# Streaming Vision Extraction + Input Shrink — Design

**Date:** 2026-09-18
**Status:** Approved

## Problem

AI vision extraction (`gemma3:4b-it-qat` on a GTX 1060 3GB, partially CPU-offloaded) takes ~30s per page. The dialog shows a frozen 10% progress bar the whole time — no indication anything is happening. Goal: make the wait feel responsive first, and cut real seconds where it's safe.

## Approach

Two layers, both enabled by the already-working `gemma.ts`/`ocr.ts` vision pipeline:

1. **Stream the model output** — switch the Ollama call from `stream: false` to `stream: true`, surface raw tokens live in the dialog. Motion during the wait.
2. **Shrink vision input** — `VISION_MAX_EDGE` 1024 → 768 (≈9 model tiles instead of 16), cutting the dominant prefill cost.

`num_ctx` stays 4096 — overflow risk is not worth the gain yet; shrinking it is a dial once 768 is validated. Prompt, schema, parsing, merge, confidence, engine marker, Tesseract fallback all untouched.

## Changes

### `src/lib/ai/gemma.ts`

- `extractPageWithVision(imageB64, page, totalPages, models, onProgress, onToken)` —
  new `onToken(text: string)` callback, called per appended chunk.
- Request body: `stream: true`.
- Replace the single `response.json()` read with an NDJSON reader over `response.body`:
  each line → `{ message?: { content?: string } }`, append `content` to accumulator,
  emit `onToken`. Accumulated string parsed by existing `parseGemmaPage` (already strips
  fences). `AbortSignal.timeout(240000)` retained. Non-2xx still falls through to next model.
- `VISION_MAX_EDGE` 1024 → 768.
- `num_ctx: 4096` unchanged.

### `src/lib/ap/ocr.ts`

- `tryGemmaImages(blobs, totalPages, onProgress, onToken?)` — new `onToken` param,
  forwarded to `extractPageWithVision`.
- `extractInvoiceFromFile(file, onProgress, onToken?)` — new `onToken` param forwarded
  through both the single-image and full-PDF vision paths.

### `src/components/ap/upload-dialog.tsx`

- New state: `elapsed` (seconds, `setInterval` while `busy`), `stream` (accumulated token text).
- Render during `busy`:
  - stage text + spinner (existing),
  - model badge — current model pulled from live stage string (`gemma3:4b-it-qat`, plus
    ` retry` suffix when on second model),
  - `mm:ss` elapsed timer under the progress bar,
  - scrollable `<pre>` (max-height ~7rem, `overflow-auto`, `text-xs font-mono`) showing
    streamed tokens, auto-scrolled to bottom,
  - progress bar stays stage-driven (indeterminate during AI phase — no token total).
- Timer + stream cleared in `finally`.

## Error Handling

- Partial stream / malformed line: ignored; accumulated text still parsed at end.
- Stream read error (abort/timeout/network): throw → existing `tryGemmaImages` catch →
  `null` for that page → Tesseract fallback path, unchanged.
- `onToken` never leaves `extractPageWithVision`'s try/try-next-model loop scope.

## Testing

No test runner in repo. Verification:
- `node_modules\.bin\tsc.exe --noEmit` — 0 errors.
- `npm run lint` — no NEW errors (repo has ~45 pre-existing prettier errors).
- `npm run build` — passes.
- Manual: upload real invoice; confirm tokens stream progressively, timer counts up, model
  badge shows `gemma3:4b-it-qat`, extraction matches prior output, and per-page time drops
  vs 1024px.