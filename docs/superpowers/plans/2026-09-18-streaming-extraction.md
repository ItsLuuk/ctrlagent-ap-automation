# Streaming Vision Extraction + Input Shrink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream Ollama vision output live into the upload dialog (feel) and shrink vision input to 768px (real speed), preserving extraction accuracy.

**Architecture:** `gemma.ts` switches the Ollama call to `stream: true` and reads NDJSON lines, accumulating into the same parse path; a new `onToken` callback threads up through `ocr.ts` to `upload-dialog.tsx`, which renders elapsed timer, model badge, and a streaming token pane. `VISION_MAX_EDGE` drops to 768.

**Tech Stack:** TypeScript, TanStack Start, Fetch API NDJSON reader, Radix Progress, lucide-react.

## Global Constraints

- `VISION_MAX_EDGE = 768` (from 1024). Verbatim.
- `num_ctx: 4096` unchanged.
- Request body gets `stream: true`; `AbortSignal.timeout(240000)` retained.
- Accumulated streamed text parsed by existing `parseGemmaPage` (not a new parser).
- `onToken(text: string)` callback name, consistent across all three files.
- Dutch prompt, schema, merge/confidence, engine marker, Tesseract fallback, multi-page flow: UNCHANGED.
- Repo NOT git-initialized — no commits. Verification: `node_modules\.bin\tsc.exe --noEmit` (0 errors), `npm run lint` (no NEW errors; ~45 pre-existing prettier errors), `npm run build`. No test runner.

---

### Task 1: Stream the vision request + shrink input in `gemma.ts`

**Files:**
- Modify: `src/lib/ai/gemma.ts`

**Interfaces:**
- Produces (consumed by Tasks 2-3): `extractPageWithVision(imageB64: string, page: number, totalPages: number, models: string[], onProgress?: (p: GemmaProgress) => void, onToken?: (text: string) => void): Promise<VisionPageResult>` — same `VisionPageResult` return, new trailing `onToken`.

- [ ] **Step 1: Add a streaming response reader**

Add next to `postJson`:

```ts
/** Reads an Ollama /api/chat stream (NDJSON); appends all content to text, emits tokens. */
async function readJsonStream(
  response: Response,
  onToken?: (text: string) => void,
): Promise<string> {
  if (!response.body) throw new Error("no stream body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as { message?: { content?: string } };
        const chunk = msg.message?.content ?? "";
        if (chunk) {
          text += chunk;
          onToken?.(chunk);
        }
      } catch {
        /* skip malformed line */
      }
    }
  }
  if (buffer.trim()) {
    try {
      const msg = JSON.parse(buffer.trim()) as { message?: { content?: string } };
      const chunk = msg.message?.content ?? "";
      if (chunk) {
        text += chunk;
        onToken?.(chunk);
      }
    } catch {
      /* ignore trailing partial line */
    }
  }
  return text;
}
```

- [ ] **Step 2: Switch `extractPageWithVision` to streaming**

Replace the body of `extractPageWithVision` (currently a single loop over models with `postJson`) so the signature gains `onToken` and the request uses it:

```ts
export async function extractPageWithVision(
  imageB64: string,
  page: number,
  totalPages: number,
  models: string[],
  onProgress?: (p: GemmaProgress) => void,
  onToken?: (text: string) => void,
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
          stream: true,
          format: "json",
          options: { temperature: 0, num_ctx: 4096 },
          messages: [{ role: "user", content: GEMMA_PROMPT, images: [imageB64] }],
        },
        240000,
      );
      if (!r.ok) continue;
      const content = await readJsonStream(r, onToken);
      const parsed = content ? parseGemmaPage(content) : null;
      if (parsed) return { page: parsed, model };
    } catch {
      /* try next model */
    }
  }
  return { page: null, model: undefined };
}
```

- [ ] **Step 3: Shrink vision input**

Replace `const VISION_MAX_EDGE = 1024;` with `const VISION_MAX_EDGE = 768;`.

- [ ] **Step 4: Verify Task 1**

Run: `node_modules\.bin\tsc.exe --noEmit` — expect PASS (Task 2-3 not yet consuming `onToken`; extra optional param is fine).
Run: `npm run lint` — no NEW errors.

---

### Task 2: Thread `onToken` through `ocr.ts`

**Files:**
- Modify: `src/lib/ap/ocr.ts`

**Interfaces:**
- Consumes: `extractPageWithVision(..., onProgress?, onToken?)` from `../ai/gemma` (Task 1).
- Produces (consumed by Task 3): `extractInvoiceFromFile(file: File, onProgress?: (p: OcrProgress) => void, onToken?: (text: string) => void): Promise<ExtractedInvoice>` — delegates tokens from the gemma phase.

- [ ] **Step 1: Thread through `tryGemmaImages`**

Change the signature at ocr.ts:531 to:

```ts
async function tryGemmaImages(
  blobs: (Blob | undefined)[],
  totalPages: number,
  onProgress?: (p: OcrProgress) => void,
  onToken?: (text: string) => void,
): Promise<
  | {
      fields: ExtractedFields;
      currency: string | undefined;
      model: string | undefined;
    }
  | undefined
> {
```

In the call to `extractPageWithVision` (currently `(b64, i + 1, totalPages, models, onProgress)`), append `onToken`:

```ts
      const { page, model } = await extractPageWithVision(
        b64,
        i + 1,
        totalPages,
        models,
        onProgress,
        onToken,
      );
```

- [ ] **Step 2: Thread through `extractInvoiceFromFile`**

Change the signature at ocr.ts:584 to:

```ts
export async function extractInvoiceFromFile(
  file: File,
  onProgress?: (p: OcrProgress) => void,
  onToken?: (text: string) => void,
): Promise<ExtractedInvoice> {
```

Forward `onToken` at both vision call sites inside the function:
- the single-image branch currently calls `tryGemmaImages([file], 1, onProgress)` → append `, onToken`.
- the PDF branch currently calls `tryGemmaImages(..., onProgress)` → append `, onToken` (its actual current args are `(pdf.pages, pdf.totalPages!, onProgress, pdf.lineItems)`) — read the surrounding lines at ocr.ts:629-645 and append `onToken` as the final argument.

- [ ] **Step 3: Verify Task 2**

Run: `node_modules\.bin\tsc.exe --noEmit` — PASS, 0 errors.
Run: `npm run lint` — no NEW errors.
Run: `npm run build` — PASS.

---

### Task 3: Live streaming UI in `upload-dialog.tsx`

**Files:**
- Modify: `src/components/ap/upload-dialog.tsx`

**Interfaces:**
- Consumes: `extractInvoiceFromFile(file, onProgress?, onToken?)` from `@/lib/ap/ocr` (Task 2).

- [ ] **Step 1: Add state**

In `UploadDialog`, after `const [pageInfo, setPageInfo] = useState("");` add:

```ts
  const [elapsed, setElapsed] = useState(0);
  const [stream, setStream] = useState("");
  const elapsedRef = useRef<number | null>(null);
  const streamPaneRef = useRef<HTMLPreElement>(null);
```

- [ ] **Step 2: Wire timer + stream into `handleFile`**

Current `handleFile` sets `busy/progress/stage/pageInfo` then calls `extractInvoiceFromFile(file, onProgress)`. Change it to:

```ts
  const handleFile = async (file: File) => {
    setBusy(true);
    setProgress(2);
    setStage("uploading");
    setPageInfo("");
    setStream("");
    setElapsed(0);
    elapsedRef.current = window.setInterval(() => {
      setElapsed((s) => s + 1);
    }, 1000);
    try {
      const invoice = await extractInvoiceFromFile(
        file,
        (p) => {
          setStage(p.stage);
          setProgress(Math.max(5, Math.round(p.progress * 100)));
          setPageInfo(
            p.totalPages && p.totalPages > 1 && p.page ? `Page ${p.page} of ${p.totalPages}` : "",
          );
        },
        (t) => {
          setStream((s) => s + t);
          streamPaneRef.current?.scrollTo(0, streamPaneRef.current.scrollHeight);
        },
      );
      addInvoice(invoice);
      setOpen(false);
      toast.success("Invoice captured", {
        description: `${invoice.vendor} — review the extracted fields before submitting.`,
      });
      void navigate({ to: "/invoices/$id", params: { id: invoice.id } });
    } catch {
      toast.error("We couldn't read that file", { description: "Try a PDF or a clearer image." });
    } finally {
      if (elapsedRef.current !== null) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
      setBusy(false);
      setProgress(0);
      setStage("");
      setPageInfo("");
      setStream("");
      setElapsed(0);
    }
  };
```

- [ ] **Step 3: Derive model badge + render streaming pane**

Inside the `busy ? (...)` block, replace the progress page with:

```tsx
            <div className="space-y-3">
              <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
              <p className="text-sm font-medium capitalize">{stage || "processing"}…</p>
              <Progress value={progress} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                {pageInfo
                  ? `${pageInfo} · read on this device`
                  : stage.includes("AI reading")
                    ? "AI reading this document …"
                    : "Reading the document on this device"}
              </p>
              {stream && (
                <pre
                  ref={streamPaneRef}
                  className="m-0 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 p-2 text-left text-[10px] leading-snug text-muted-foreground"
                >
                  {stream}
                  <span className="animate-pulse text-foreground">▍</span>
                </pre>
              )}
              <p className="text-xs tabular-nums text-muted-foreground">
                {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
              </p>
            </div>
```

- [ ] **Step 4: Verify Task 3**

Run: `node_modules\.bin\tsc.exe --noEmit` — PASS, 0 errors.
Run: `npm run lint` — no NEW errors.
Run: `npm run build` — PASS.

- [ ] **Step 5: Live smoke**

Ollama running, dev server on 8081/8082. Upload a real scanned invoice:
- Tokens appear progressively in the pane during the AI phase; pane auto-scrolls.
- Timer counts 0:01, 0:02… during `busy`, resets on close.
- Model badge text shows `AI reading page 1 of 1 (gemma3:4b-it-qat)`.
- Extracted invoice matches prior run; per-page time drops vs 1024px.

---

## Self-Review

- **Spec coverage:** streaming (`readJsonStream`, `stream: true`, `onToken` threading, UI pane) = Tasks 1-3; input shrink (`VISION_MAX_EDGE` 768) = Task 1 S3; `num_ctx` unchanged = Task 1 S2 body; error handling = `readJsonStream` throws → model loop catch → Tesseract fallback (existing path untouched). No gaps.
- **Placeholder scan:** all code inline, no TBD/TODO/describe-only steps. Task 2 S2 flags one read-before-edit dependency (PDF-branch call args) explicitly rather than guessing.
- **Type consistency:** `onToken: (text: string) => void` identical across `gemma.ts` (Task 1), `ocr.ts` (Task 2), `upload-dialog.tsx` (Task 3). `VISION_MAX_EDGE = 768` verbatim. `num_ctx: 4096` verbatim. `extractPageWithVision` return type `VisionPageResult` unchanged.