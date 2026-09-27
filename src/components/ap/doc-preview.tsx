import { useEffect, useRef } from "react";
import { FileText } from "@/components/icons";
import {
  money,
  shortDate,
  type Invoice,
  type OcrMethod,
  type OcrPageMethod,
  type Zone,
  type ZoneMap,
} from "@/lib/ap/types";
import { ZoneEditor } from "./zone-editor";
import { isImageInvoice } from "@/lib/ap/file-type";

const OCR_METHOD_LABEL: Record<OcrMethod, string> = {
  "text-layer": "digital text",
  none: "page image",
};

const PAGE_METHOD_LABEL: Record<OcrPageMethod, string> = {
  "text-layer": "digital text",
  none: "page image",
};

function PageStrip({ invoice }: { invoice: Invoice }) {
  if (!invoice.pageCount) return null;
  const pages = invoice.ocrPages ?? [];
  const avg = pages.length ? pages.reduce((s, p) => s + p.confidence, 0) / pages.length : undefined;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border bg-card px-4 py-2 text-xs text-muted-foreground">
      <span className="font-mono font-medium text-foreground">
        {invoice.pageCount} page{invoice.pageCount === 1 ? "" : "s"}
      </span>
      {invoice.ocrMethod ? <span>· {OCR_METHOD_LABEL[invoice.ocrMethod]}</span> : null}
      {avg !== undefined ? <span>· {Math.round(avg * 100)}% avg read confidence</span> : null}
    </div>
  );
}

/** Renders a faithful paper-style rendition of a sample invoice, or the uploaded file. */
export function DocPreview({
  invoice,
  editingZones,
  onSaveZones,
  highlight,
}: {
  invoice: Invoice;
  /** When set, the uploaded-image preview is replaced with the drag-to-anchor
   *  zone editor. Pass `onSaveZones` so the editor can persist the anchors. */
  editingZones?: boolean | undefined;
  onSaveZones?: (zones: ZoneMap) => void;
  /** Normalized region to outline and bring into view — the field a compare row
   *  points at. The overlay is decorative: the row that asked for it carries
   *  the meaning, so nothing here is announced on its own. */
  highlight?: Zone | undefined;
}) {
  const isImage = isImageInvoice(invoice.fileType, invoice.fileName) && !!invoice.fileUrl;
  const showEditor = editingZones && isImage;
  const imageRef = useRef<HTMLImageElement>(null);

  // Bring the highlighted region into view without animating for anyone who
  // asked for reduced motion (accessibility.md §4).
  useEffect(() => {
    if (!highlight || !imageRef.current) return;
    const image = imageRef.current;
    const top =
      image.getBoundingClientRect().top + window.scrollY + highlight.y * image.clientHeight - 160;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? "auto" : "smooth" });
  }, [highlight]);
  if (showEditor && onSaveZones) {
    return (
      <div className="flex justify-center bg-secondary/50 p-4">
        <ZoneEditor invoice={invoice} onSave={onSaveZones} />
      </div>
    );
  }
  if (isImage) {
    return (
      <div className="flex justify-center bg-secondary/50 p-4">
        <div className="relative">
          <img
            ref={imageRef}
            src={invoice.fileUrl}
            alt={invoice.fileName ?? "Uploaded invoice"}
            className="max-w-full rounded-lg bg-card"
          />
          {highlight ? (
            <span
              aria-hidden
              className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/10"
              style={{
                left: `${highlight.x * 100}%`,
                top: `${highlight.y * 100}%`,
                width: `${highlight.w * 100}%`,
                height: `${highlight.h * 100}%`,
              }}
            />
          ) : null}
        </div>
      </div>
    );
  }

  if (invoice.fileUrl) {
    return (
      <div>
        <PageStrip invoice={invoice} />
        <iframe
          title={invoice.fileName ?? "Invoice document"}
          src={invoice.fileUrl}
          className="aspect-[210/297] w-full bg-secondary/50"
        />
      </div>
    );
  }

  if (invoice.source === "upload") {
    const multiPage = (invoice.ocrPages?.length ?? 0) > 1;
    return (
      <div className="space-y-3 p-8 text-center">
        <FileText className="mx-auto size-6 text-muted-foreground" />
        <p className="text-sm font-medium">{invoice.fileName ?? "Uploaded document"}</p>
        <p className="mx-auto max-w-xs text-xs text-muted-foreground">
          The original file preview is only kept for this browser session. Extracted data below is
          saved.
        </p>
        {multiPage ? (
          <ul className="mx-auto max-w-md space-y-1 text-left">
            {invoice.ocrPages!.map((p) => (
              <li
                key={p.pageNumber}
                className="flex items-center justify-between rounded-sm bg-card px-3 py-2 text-xs shadow-whisper"
              >
                <span className="font-medium">Page {p.pageNumber}</span>
                <span className="font-mono text-muted-foreground">
                  {PAGE_METHOD_LABEL[p.method]} · {Math.round(p.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {invoice.ocrText ? (
          <pre className="mx-auto max-h-64 max-w-md overflow-auto rounded-lg bg-card p-3 text-left font-mono text-xs leading-relaxed text-muted-foreground">
            {invoice.ocrText.slice(0, 1200)}
          </pre>
        ) : null}
      </div>
    );
  }

  return (
    <div className="bg-secondary/50 p-6">
      <div className="mx-auto max-w-[620px] rounded-lg bg-card p-8 ">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-base font-semibold tracking-tight">{invoice.vendor}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              billing@{invoice.vendor.toLowerCase().replace(/[^a-z]+/g, "")}.com
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Invoice
            </p>
            <p className="font-mono text-sm">{invoice.invoiceNumber}</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-4 border-y border-border py-4 text-xs">
          <div>
            <p className="text-muted-foreground">Issued</p>
            <p className="mt-1 font-medium">{shortDate(invoice.issueDate)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Due</p>
            <p className="mt-1 font-medium">{shortDate(invoice.dueDate)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Amount due</p>
            <p className="mt-1 font-mono font-medium">{money(invoice.total, invoice.currency)}</p>
          </div>
        </div>

        <table className="mt-6 w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pb-2 font-medium">Description</th>
              <th className="pb-2 text-right font-medium">Qty</th>
              <th className="pb-2 text-right font-medium">Rate</th>
              <th className="pb-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((li) => (
              <tr key={li.id} className="border-t border-border/70">
                <td className="py-2.5 pr-3">{li.description}</td>
                <td className="py-2.5 text-right font-mono">{li.quantity}</td>
                <td className="py-2.5 text-right font-mono">
                  {money(li.unitPrice, invoice.currency)}
                </td>
                <td className="py-2.5 text-right font-mono">
                  {money(li.amount, invoice.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 ml-auto w-48 space-y-1.5 text-xs">
          <Row label="Subtotal" value={money(invoice.subtotal, invoice.currency)} />
          <Row label="Tax" value={money(invoice.tax, invoice.currency)} />
          <div className="border-t border-border pt-1.5">
            <Row label="Total" value={money(invoice.total, invoice.currency)} bold />
          </div>
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          Invoice terms: net 30{invoice.memo ? ` · ${invoice.memo}` : ""}
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={`font-mono ${bold ? "font-medium" : ""}`}>{value}</span>
    </div>
  );
}
