# AI Vision Model Selection — Design

Date: 2026-09-18

## Goal

Replace the single fixed Ollama vision model (`gemma3:4b-it-qat`) with automatic
selection across the two locally installed vision models, preferring the smarter
one (`ornith-1.5:9b`) and retrying a page with gemma3 when ornith yields nothing
usable. Prompt stays Dutch-locked. No UI changes.

## Current state

- `src/lib/ai/gemma.ts`: `DEFAULT_GEMMA_MODEL = "gemma3:4b-it-qat"`. `gemmaModel()`
  reads `gemma-model` from localStorage, falls back to the constant. Per-page
  extraction (`extractPageWithGemma`) retries the same model once, returns
  `GemmaPage | null`.
- `src/lib/ap/ocr.ts`: when Ollama is healthy, `tryGemmaImages` sends every page
  image through `extractPageWithGemma`, merges results, records engine as
  `"gemma"`.
- No settings UI. Tesseract (`eng+nld`) is the last-resort fallback when Ollama is
  down.

## Changes

### `src/lib/ai/gemma.ts`

- Add `export const VISION_MODELS = ["ornith-1.5:9b", "gemma3:4b-it-qat"]`.
- Add `export function imageExtractModelOrder(): string[]`: returns `[saved]` when
  the `gemma-model` localStorage override exists, else `VISION_MODELS`
  (implemented name; an earlier draft called it `visionModelOrder`).
- Keep `gemmaModel()`/`DEFAULT_GEMMA_MODEL` unchanged (compat + guaranteed
  fallback constant; audit label reuse).
- Generalize `extractPageWithGemma` → `extractPageWithVision`:
  - Accept an ordered model list; iterate, first non-null `GemmaPage` wins.
  - One Ollama request per model, no internal same-model retry loop.
  - Progress stage names the model: `AI reading page 2 of 5 (ornith-1.5:9b)` then
    `(gemma3:4b-it-qat retry)`.
  - Keep `extractPageWithGemma` name as a thin alias? No — update the single
    consumer (`tryGemmaImages`) instead. Remove the old per-model loop.
- Return the winning model name alongside the parsed page so the audit can name it.

### `src/lib/ap/ocr.ts`

- `tryGemmaImages` calls `extractPageWithVision` (ornith first, gemma retry).
- Audit line: `AI vision extraction (${winningModel}) — N page(s)`.
- `engine: "gemma"` stays as the generic AI-vision marker. Record the winning
  model name.

## Unchanged

- Dutch `GEMMA_PROMPT`, schema, parse, merge, confidence logic.
- Tesseract fallback (last resort when Ollama unreachable).
- All UI, types, store.

## Out of scope

- Model picker UI, settings screens.
- Multilingual prompt.