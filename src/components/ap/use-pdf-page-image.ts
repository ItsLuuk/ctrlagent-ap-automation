/**
 * Renders the first page of a PDF to a temporary image blob URL so the
 * mapping overlay (zone drawing, click-to-assign) can work for PDF uploads,
 * not just images. The PDF blob URL returned by the upload pipeline can't
 * be fed into an <img> tag directly — pdfjs must rasterize it first.
 *
 * For image invoices the caller still uses the original `fileUrl` directly;
 * this hook is only activated for PDFs that also carry OCR words (meaning
 * the upload pipeline has already processed them and `learnPayload` exists).
 *
 * Rendering uses an OffscreenCanvas to keep the main-thread bitmap off the
 * critical path, caps dimensions before allocation so hostile PDFs can't
 * blow the tab's memory budget, and disables XFA unconditionally.
 */
import { useEffect, useState } from "react";
import { isPdfInvoice } from "@/lib/ap/file-type";
import "@/lib/ap/pdfjs-polyfill";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfDoc = any;

/** Hard cap per side, in pixels. Hostile/malformed PDFs can declare page sizes
 *  in the tens of thousands of points; a 1:1 bitmap for a 30 000 pt page is
 *  ~900 megapixels and will OOM the tab. When the natural viewport exceeds
 *  the cap we scale down — the preview remains usable for zone drawing.
 *
 *  Arbitrarily chosen large enough for readable zone overlays on A4/Letter,
 *  small enough that even 4× A0 at 1:1 stays well under a gigapixel. */
const MAX_CANVAS_PX = 2000;

/** Target scale for a typical A4/Letter page; the cap clamps anything larger. */
const TARGET_SCALE = 1.5;

export function usePdfPageImage(
  fileUrl: string | undefined,
  fileType: string | undefined,
  hasWords: boolean,
  /** Filename fallback for uploads stored with an empty `fileType`. */
  fileName?: string | undefined,
): string | undefined | null {
  const isPdf = isPdfInvoice(fileType, fileName) && !!fileUrl;
  const [blobUrl, setBlobUrl] = useState<string | undefined | null>(undefined);

  useEffect(() => {
    if (!isPdf || !fileUrl || !hasWords) return;
    let cancelled = false;
    let pdfDoc: PdfDoc | undefined;
    // The loading task — not the resolved document proxy — is what owns
    // `destroy()` in this pdfjs build (see the same pattern in ocr.ts).
    let loadingTask: PdfDoc;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (!pdfjs.GlobalWorkerOptions.workerPort) {
          const WorkerWrapper = await import("../../lib/ap/pdf-worker?worker");
          pdfjs.GlobalWorkerOptions.workerPort = new WorkerWrapper.default();
        }
        const resp = await fetch(fileUrl);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const buffer = await resp.arrayBuffer();
        // `disableXfa` is honoured by pdf.js at runtime but missing from its
        // published `DocumentInitParameters`, hence the narrow cast.
        const params = { data: buffer, disableXfa: true } as unknown as Parameters<
          typeof pdfjs.getDocument
        >[0];
        loadingTask = pdfjs.getDocument(params);
        pdfDoc = await loadingTask.promise;

        const page = await pdfDoc.getPage(1);
        const natural = page.getViewport({ scale: 1 });
        const scale = Math.min(
          TARGET_SCALE,
          MAX_CANVAS_PX / natural.width,
          MAX_CANVAS_PX / natural.height,
        );
        const viewport = page.getViewport({ scale });
        const width = Math.min(Math.ceil(viewport.width), MAX_CANVAS_PX);
        const height = Math.min(Math.ceil(viewport.height), MAX_CANVAS_PX);

        // OffscreenCanvas keeps the backing store off the main-thread compositor
        // path for the duration of the render; we still end up with a main-thread
        // canvas to call toBlob on, but the expensive paint is isolated.
        const offscreen = new OffscreenCanvas(width, height);
        await page.render({ canvas: offscreen, viewport }).promise;

        // Transfer the rendered bitmap back to a real canvas solely for toBlob.
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(offscreen, 0, 0);
        // `close()` is part of the OffscreenCanvas spec but is absent in some
        // WebView2/Chromium builds, and this run types against a DOM lib that
        // does not declare it. Absence must be tolerated: the render above has
        // already succeeded, and throwing here threw it away — the mapper then
        // sat on "Rendering the first page…" with no document to map onto.
        const closable = offscreen as OffscreenCanvas & { close?: () => void };
        if (typeof closable.close === "function") closable.close();

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        canvas.width = canvas.height = 0;
        if (!blob) throw new Error("canvas.toBlob returned null");
        if (!cancelled) setBlobUrl(URL.createObjectURL(blob));
      } catch (err) {
        // Surface the failure instead of hanging on "Rendering the first page…".
        console.warn("[pdf-preview] rasterization failed", err);
        if (!cancelled) setBlobUrl(null);
      } finally {
        // Cleanup must never throw out of the finally block: an unhandled
        // "destroy is not a function" here reversed a successful rasterization
        // into a failed preview (and logged an uncaught page error).
        try {
          await (loadingTask ?? pdfDoc)?.destroy?.();
        } catch {
          /* releasing the document is best-effort */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isPdf, fileUrl, hasWords]);

  if (blobUrl === null) return null; // render attempted and failed
  return blobUrl;
}
