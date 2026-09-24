import { useEffect, useState } from "react";
import { isPdfInvoice } from "@/lib/ap/file-type";
import "@/lib/ap/pdfjs-polyfill";

/** Hard cap per side, in pixels, before allocating a preview bitmap. */
const MAX_CANVAS_PX = 2000;

/** Target scale for a typical A4/Letter page. */
const TARGET_SCALE = 1.5;

/**
 * Renders the first page of a PDF to a temporary image blob URL so the mapping
 * overlay works for PDF uploads as well as image uploads.
 *
 * PDF.js performs document parsing in its worker. Canvas dimensions are capped
 * before allocation so malformed page-size declarations cannot exhaust the
 * WebView's memory.
 */
export function usePdfPageImage(
  fileUrl: string | undefined,
  fileType: string | undefined,
  hasWords: boolean,
  /** Filename fallback for uploads stored with an empty `fileType`. */
  fileName?: string | undefined,
): string | undefined | null {
  const isPdf = isPdfInvoice(fileType, fileName) && Boolean(fileUrl);
  const [blobUrl, setBlobUrl] = useState<string | undefined | null>(undefined);

  useEffect(() => {
    if (!isPdf || !fileUrl || !hasWords) {
      setBlobUrl(undefined);
      return;
    }

    let cancelled = false;
    let objectUrl: string | undefined;
    let loadingTask: import("pdfjs-dist").PDFDocumentLoadingTask | undefined;

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (!pdfjs.GlobalWorkerOptions.workerPort) {
          const WorkerWrapper = await import("../../lib/ap/pdf-worker?worker");
          pdfjs.GlobalWorkerOptions.workerPort = new WorkerWrapper.default();
        }

        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error(`fetch ${response.status}`);
        const data = await response.arrayBuffer();

        loadingTask = pdfjs.getDocument({ data });
        const pdfDoc = await loadingTask.promise;
        const page = await pdfDoc.getPage(1);
        const natural = page.getViewport({ scale: 1 });
        const scale = Math.min(
          TARGET_SCALE,
          MAX_CANVAS_PX / natural.width,
          MAX_CANVAS_PX / natural.height,
        );
        const viewport = page.getViewport({ scale });
        const width = Math.max(1, Math.min(Math.ceil(viewport.width), MAX_CANVAS_PX));
        const height = Math.max(1, Math.min(Math.ceil(viewport.height), MAX_CANVAS_PX));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        await page.render({ canvas, viewport }).promise;

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        canvas.width = 0;
        canvas.height = 0;
        if (!blob) throw new Error("canvas.toBlob returned null");

        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
        }
      } catch (error) {
        console.warn("[pdf-preview] rasterization failed", error);
        if (!cancelled) setBlobUrl(null);
      } finally {
        await loadingTask?.destroy().catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileUrl, hasWords, isPdf]);

  if (blobUrl === null) return null;
  return blobUrl;
}
