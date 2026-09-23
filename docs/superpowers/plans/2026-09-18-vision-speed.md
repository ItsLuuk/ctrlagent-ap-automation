# Vision Speed: shrink input + gemma-primary + num_ctx

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI vision invoice extraction 2-4x faster by swapping the primary model to gemma3:4b-it-qat (ornith becomes the retry), shrinking every vision input to ≤1024px JPEG q80, and capping `num_ctx` at 4096.

**Architecture:** `gemma.ts` owns model order, the vision-request options, and a new `downscaleToJpeg` browser helper. `ocr.ts` feeds every page/photo blob through `downscaleToJpeg` before base64-encoding. Tesseract fallback and text-layer path untouched.

**Tech Stack:** TypeScript, TanStack Start, Ollama `/api/chat`, browser canvas + `createImageBitmap`.

## Global Constraints

- Model IDs verbatim: `gemma3:4b-it-qat` (primary), `ornith-1.5:9b` (retry).
- `VISION_MAX_EDGE = 1024`, `JPEG_QUALITY = 0.8`. Verbatim.
- `num_ctx: 4096` added to the vision request `options`.
- Dutch prompt, zod schema, merge/confidence, `engine: "gemma"` marker, Tesseract fallback, upload UI: UNCHANGED.
- Saved `gemma-model` localStorage override still wins in `imageExtractModelOrder`.
- Repo NOT git-initialized — no commits. Verification: `node_modules\.bin\tsc.exe --noEmit`, `npm run lint` (zero NEW errors; ~45 pre-existing prettier errors exist), `npm run build`. No test runner.

---

### Task 1: Model swap, num_ctx, and `downscaleToJpeg` in `gemma.ts`

**Files:**
- Modify: `src/lib/ai/gemma.ts`

**Interfaces:**
- Produces (consumed by Task 2): `downscaleToJpeg(blob: Blob): Promise<Blob>` — long edge ≤ 1024, JPEG q80, original blob on canvas failure.

- [ ] **Step 1: Swap the model order**

Replace `src/lib/ai/gemma.ts:12`:

```ts
export const VISION_MODELS = ["gemma3:4b-it-qat", "ornith-1.5:9b"];
```

- [ ] **Step 2: Add vision-input constants**

Insert right after the `VISION_MODELS`/`imageExtractModelOrder` block (after line 23):

```ts
/** Vision input is downscaled to this many pixels on the long edge to cut inference time. */
const VISION_MAX_EDGE = 1024;
/** JPEG quality for the downscaled vision input. */
const JPEG_QUALITY = 0.8;
```

- [ ] **Step 3: Add `num_ctx` to the vision request**

Inside `extractPageWithVision`, the `postJson` body's `options` becomes:

```ts
          options: { temperature: 0, num_ctx: 4096 },
```

- [ ] **Step 4: Add `downscaleToJpeg`**

Append near `blobToBase64` (end of file):

```ts
/** Resizes an image blob so its long edge is at most VISION_MAX_EDGE, re-encoded as JPEG. */
export async function downscaleToJpeg(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, VISION_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const jpeg = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  canvas.width = canvas.height = 0;
  return jpeg ?? blob;
}
```

- [ ] **Step 5: Verify Task 1**

Run: `node_modules\.bin\tsc.exe --noEmit` — expect PASS (Task 2 not yet consuming `downscaleToJpeg`; exported so no unused error).
Run: `npm run lint` — expect no NEW errors vs the pre-existing ~45.

---

### Task 2: Feed downscaled JPEGs to vision in `ocr.ts`

**Files:**
- Modify: `src/lib/ap/ocr.ts`

**Interfaces:**
- Consumes (from Task 1): `downscaleToJpeg(blob: Blob): Promise<Blob>`

- [ ] **Step 1: Import `downscaleToJpeg`**

In the import block from `"../ai/gemma"` (ocr.ts:13-21), add `downscaleToJpeg` to the named imports:

```ts
import {
  blobToBase64,
  downscaleToJpeg,
  extractPageWithVision,
  gemmaHealthy,
  gemmaModel,
  gemmaToFields,
  imageExtractModelOrder,
  mergeGemmaPages,
  type GemmaPage,
} from "../ai/gemma";
```

- [ ] **Step 2: Downscale before base64**

In `tryGemmaImages` (ocr.ts:553), replace:

```ts
      const b64 = await blobToBase64(blob);
```

with:

```ts
      const b64 = await blobToBase64(await downscaleToJpeg(blob));
```

- [ ] **Step 3: Verify Task 2**

Run: `node_modules\.bin\tsc.exe --noEmit` — PASS, zero errors.
Run: `npm run lint` — no NEW errors.
Run: `npm run build` — PASS.

- [ ] **Step 4: Live smoke (optional)**

With Ollama running and a scanned invoice: upload in the browser. Expect stage `AI reading page 1 of N (gemma3:4b-it-qat)`; audit reads `AI vision extraction (gemma3:4b-it-qat) — N pages`; per-page time should drop vs ornith.

---

## Self-Review

- **Spec coverage:** model swap (Task 1 S1), input shrink (Task 1 S2/S4 + Task 2), num_ctx (Task 1 S3). All three approved design points have a task. Untouched-list matches Global Constraints.
- **Placeholders:** none — all code inline.
- **Type consistency:** `downscaleToJpeg(blob: Blob): Promise<Blob>` defined in Task 1, used in Task 2 with `await downscaleToJpeg(blob)` inside `blobToBase64(...)` — matches. `VISION_MODELS` order matches design in both tasks.