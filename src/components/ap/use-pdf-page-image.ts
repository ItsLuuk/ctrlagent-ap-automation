/**
 * Renders the first page of a PDF to a temporary image blob URL so the
 * mapping overlay (zone drawing, click-to-assign) can work for PDF uploads,
 * not just images. The PDF blob URL returned by the upload pipeline can't
 * be fed into an <img> tag directly — pdfjs must rasterize it first.
 *
 * For image invoices the caller still uses the original `fileUrl` directly;
 * this hook is only activated for PDFs that also carry OCR words (meaning
 * the upload pipeline has already processed them and `learnPayload` exists).
 */
import { useEffect, useState } from "react";
import { isPdfInvoice } from "@/lib/ap/file-type";
import "@/lib/ap/pdfjs-polyfill";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfDoc = any;

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
        pdfDoc = await pdfjs.getDocument({ data: buffer }).promise;
        const page = await pdfDoc.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
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
        await pdfDoc?.destroy().catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isPdf, fileUrl, hasWords]);

  if (blobUrl === null) return null; // render attempted and failed
  return blobUrl;
}
