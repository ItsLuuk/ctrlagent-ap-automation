# AI Vision Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically pick the smarter locally-installed Ollama vision model (`ornith-1.5:9b`) for invoice image extraction, retrying a page with `gemma3:4b-it-qat` when ornith yields nothing — with no UI changes and the Dutch prompt untouched.

**Architecture:** `gemma.ts` gains an ordered model-constant list and a model-agnostic per-page extractor that returns the winning model. `ocr.ts` calls the new extractor and records the winning model in the audit line. `engine: "gemma"` stays as the generic AI-vision marker.

**Tech Stack:** TypeScript, TanStack Start, Ollama HTTP API (`/api/chat`, vision via base64 image), zod.

## Global Constraints

- Model IDs verbatim: `ornith-1.5:9b` and `gemma3:4b-it-qat` (confirmed via `ollama list`).
- Prompt (`GEMMA_PROMPT`), zod schema, merge logic, confidence logic: UNCHANGED.
- `engine: "gemma"` marker on invoice: UNCHANGED.
- Tesseract fallback: UNCHANGED (last resort when Ollama unreachable).
- `gemmaModel()` / `DEFAULT_GEMMA_MODEL`: kept for compat; explicit `gemma-model` localStorage override still wins.
- Repo is NOT git-initialized — skip all `git commit` steps.
- No test runner in `package.json` — verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`.

---

### Task 1: Model order + model-agnostic page extractor in `gemma.ts`

**Files:**
- Modify: `src/lib/ai/gemma.ts`

**Interfaces:**
- Produces (consumed by Task 2):
  - `VISION_MODELS: string[]` — `["ornith-1.5:9b", "gemma3:4b-it-qat"]`
  - `imageExtractModelOrder(): string[]` — saved override first, else `VISION_MODELS`
  - `extractPageWithVision(imageB64: string, page: number, totalPages: number, models: string[], onProgress?: (p: GemmaProgress) => void): Promise<VisionPageResult>`
  - `VisionPageResult = { page: GemmaPage | null; model: string | undefined }`
  - `extractPageWithGemma` is REMOVED (single consumer updated in Task 2).
  - `GemmaProgress`, `GemmaPage`, `blobToBase64`, `parseGemmaPage`, `GEMMA_PROMPT`, `ollamaBase`, `gemmaModel`, `DEFAULT_GEMMA_MODEL` unchanged.

- [ ] **Step 1: Add model constants + order function**

Replace the `DEFAULT_GEMMA_MODEL` declaration block with:

```ts
/** Locally-installed vision models, best first. */
export const VISION_MODELS = ["ornith-1.5:9b", "gemma3:4b-it-qat"];

/** User's explicit localStorage override wins; else auto order (best first). */
export function imageExtractModelOrder(): string[] {
  try {
    const saved = localStorage.getItem("gemma-model");
    if (saved) return [saved];
  } catch {
    /* non-browser or blocked storage */
  }
  return [...VISION_MODELS];
}
```

Keep `DEFAULT_GEMMA_MODEL = "gemma3:4b-it-qat"` and `gemmaModel()` exactly as they are.

- [ ] **Step 2: Replace `extractPageWithGemma` with `extractPageWithVision`**

Delete the existing `extractPageWithGemma` function (lines ~277–313). Add in its place:

```ts
export type VisionPageResult = {
  page: GemmaPage | null;
  model: string | undefined;
};

/**
 * Sends one page image to each model in order; first parseable result wins.
 * Returns the winning model name so callers can audit accurately.
 */
export async function extractPageWithVision(
  imageB64: string,
  page: number,
  totalPages: number,
  models: string[],
  onProgress?: (p: GemmaProgress) => void,
): Promise<VisionPageResult> {
  for (const [i, model] of models.entries()) {
    onProgress?.({
      stage: `AI reading page ${page} of ${totalPages} (${model}${i > 0 ? " retry" : ""})`,
      progress: 0.1 + 0.8 * ((page - 1) / totalPages),
      page,
      totalPages,
    });
    try {
      const r = await postJson(
        `${ollamaBase()}/api/chat`,
        {
          model,
          stream: false,
          format: "json",
          options: { temperature: 0 },
          messages: [{ role: "user", content: GEMMA_PROMPT, images: [imageB64] }],
        },
        240000,
      );
      if (!r.ok) continue;
      const data = (await r.json()) as { message?: { content?: string } };
      const parsed = data.message?.content ? parseGemmaPage(data.message.content) : null;
      if (parsed) return { page: parsed, model };
    } catch {
      /* try next model */
    }
  }
  return { page: null, model: undefined };
}
```

- [ ] **Step 3: Verify Task 1**

Run: `npx tsc --noEmit`
Expected: FAIL at `src/lib/ap/ocr.ts:544` — `extractPageWithGemma` no longer exported. This is expected; Task 2 fixes the consumer.

Run: `npm run lint`
Expected: no errors in `src/lib/ai/gemma.ts` (ocr.ts lint may flag the now-missing import — expected).

---

### Task 2: Wire auto model order into extraction + audit in `ocr.ts`

**Files:**
- Modify: `src/lib/ap/ocr.ts`

**Interfaces:**
- Consumes (from Task 1): `extractPageWithVision`, `imageExtractModelOrder`, `VisionPageResult`
- Consumes (unchanged): `blobToBase64`, `gemmaHealthy`, `gemmaModel`, `gemmaToFields`, `mergeGemmaPages`, `GemmaPage`
- Produces: `tryGemmaImages` returns `{ fields: ExtractedFields; currency?: string; model?: string } | undefined`; audit line names the winning model.

- [ ] **Step 1: Update imports**

Replace lines 13–19 by draining imports from `"../ai/gemma"`:

```ts
import {
  blobToBase64,
  extractPageWithVision,
  gemmaHealthy,
  gemmaModel,
  gemmaToFields,
  imageExtractModelOrder,
  mergeGemmaPages,
  type GemmaPage,
} from "../ai/gemma";
```

(Removed: `extractPageWithGemma`. Added: `extractPageWithVision`, `imageExtractModelOrder`.)

- [ ] **Step 2: Rewrite `tryGemmaImages` to track the winning model**

Replace the whole `tryGemmaImages` function (lines ~529–561) with:

```ts
/** Runs each page image through the vision models in order; undefined when nothing usable comes back. */
async function tryGemmaImages(
  blobs: (Blob | undefined)[],
  totalPages: number,
  onProgress?: (p: OcrProgress) => void,
): Promise<{ fields: ExtractedFields; currency: string | undefined; model: string | undefined } | undefined> {
  const models = imageExtractModelOrder();
  const results: (GemmaPage | null)[] = [];
  let winningModel: string | undefined;
  for (let i = 0; i < blobs.length; i++) {
    const blob = blobs[i];
    if (!blob) {
      results.push(null);
      continue;
    }
    try {
      const b64 = await blobToBase64(blob);
      const { page, model } = await extractPageWithVision(b64, i + 1, totalPages, models, onProgress);
      results.push(page);
      winningModel ??= model;
    } catch {
      results.push(null);
    }
  }
  const merged = mergeGemmaPages(results);
  const useful =
    merged.vendor ||
    merged.invoiceNumber ||
    merged.issueDate ||
    merged.dueDate ||
    merged.subtotal ||
    merged.tax ||
    merged.total ||
    merged.lineItems.length > 0;
  if (!useful) return undefined;
  return { fields: gemmaToFields(merged), currency: merged.currency, model: winningModel };
}
```

- [ ] **Step 3: Propagate the winning model into `extractInvoiceFromFile`**

In `extractInvoiceFromFile`:

1. Add a local `let gemmaModelUsed: string | undefined;` next to `let gemmaAttempted = false;` (line ~577).
2. In both `if (gemma)` blocks (image path ~588 and pdf path ~621), set `gemmaModelUsed = gemma.model;` alongside the existing engine/fields/currency assignments.
3. Replace the audit block (lines ~660–663) with:

```ts
  const model = gemmaModelUsed ?? gemmaModel();
  const auditAction =
    engine === "gemma"
      ? `AI vision extraction (${model}) — ${pageCount} page${pageCount === 1 ? "" : "s"}`
      : isImage
        ? "Document scanned and fields extracted"
        : isPdf
          ? `PDF parsed — ${pageCount} page${pageCount === 1 ? "" : "s"} (${METHOD_LABEL[method]})${truncated ? `, first ${MAX_PDF_PAGES} processed` : ""}`
          : "Document uploaded (preview only)";
```

(No other call sites change — `engine`, `ocrText`, `ocrPages`, `fieldSources` are untouched.)

- [ ] **Step 4: Verify Task 2**

Run: `npx tsc --noEmit`
Expected: PASS, zero errors.

Run: `npm run lint`
Expected: PASS, zero errors (note: repo ships with `verbatimModuleSyntax` off; unused-export lint is off by default).

Run: `npm run build`
Expected: PASS — production bundle builds.

- [ ] **Step 5: Smoke test against live Ollama**

With Ollama running and both models pulled:

1. Run `npm run dev`.
2. Open the app, upload a scanned PDF invoice, watch the progress stage: it should show `AI reading page 1 of N (ornith-1.5:9b)` and, only if ornith returns nothing, a `(gemma3:4b-it-qat retry)` line.
3. Open the resulting invoice detail page → audit entry reads `AI vision extraction (ornith-1.5:9b) — N pages`.
4. Stop Ollama, upload again → falls back to Tesseract OCR path ("used on-device OCR" note) as before.

---

## Self-Review Notes

- **Spec coverage:** ornith-first order (Task 1 constants), per-page retry (Task 1 extractor + Task 2 loop), winning-model audit (Task 2 Step 3), Dutch prompt unchanged (no edits to `GEMMA_PROMPT`/schema), engine marker unchanged, no UI (no component files touched). All spec bullets have a task.
- **Placeholders:** none — every step has concrete code or an exact expected command output.
- **Type consistency:** `extractPageWithVision` returns `VisionPageResult`; Task 2 destructures `{ page, model }` — matches. `tryGemmaImages` gains `model` in its return object; Task 2 Step 3 reads `gemma.model` — matches. `winningModel ??= model` uses `string | undefined` defaults — matches return type.