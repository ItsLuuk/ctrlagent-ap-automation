/**
 * Bookkeeping CSV export — the last-mile handoff file (docs/POSITIONING.md
 * task: the job should end with a file the accountant can import, not a
 * marker on a record).
 *
 * Deliberate format choices, all pinned by tests:
 *  - One row per invoice, RFC 4180: comma-separated, CRLF line endings,
 *    quotes only where a field needs them.
 *  - UTF-8 BOM so Excel reads Dutch characters; ISO dates; dot decimals —
 *    the combination importers accept without locale guessing.
 *  - Only approved records leave: status `scheduled`, and never the sample
 *    records — demo amounts must never reach a real bookkeeping file.
 *  - Text cells starting with `= + - @` or whitespace get a leading
 *    apostrophe: vendor strings come from documents, and a cell must never
 *    execute as a formula in a spreadsheet.
 *  - Sorted by issue date, then invoice number: the same queue in, the same
 *    file out.
 *
 * The export writes a file and mutates nothing — consistent with the ERP
 * layer's rule that export never implies payment. Foundry sends nothing.
 */
import type { PurchaseOrder } from "./po-store";
import type { Invoice } from "./types";

const BOM = "\uFEFF";
const CRLF = "\r\n";

export const CSV_COLUMNS = [
  "invoice_number",
  "invoice_date",
  "due_date",
  "vendor",
  "vat_number",
  "iban",
  "currency",
  "subtotal",
  "vat_amount",
  "total",
  "gl_account",
  "department",
  "po_number",
  "memo",
] as const;

/**
 * The exportable set: approved and actually captured. `scheduled` is the
 * post-approval status ("ready for external handoff"); sample records carry
 * demo amounts and are labelled as such everywhere else, so they stop here.
 * This is the single predicate — the inbox button, its toast count, and the
 * CSV itself all read from it, so they cannot drift apart.
 */
export function approvedForHandoff(invoices: Invoice[]): Invoice[] {
  return invoices.filter(
    (invoice) => invoice.status === "scheduled" && invoice.source !== "sample",
  );
}

/** Text cell: RFC 4180 escaping plus the spreadsheet formula guard. */
function text(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Money cell: two decimals, dot separator, locale-independent. */
function amount(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "";
}

/** The CSV file for every exportable invoice. Header only when none qualify. */
export function bookkeepingCsv(invoices: Invoice[], purchaseOrders: PurchaseOrder[] = []): string {
  const poNumberById = new Map(purchaseOrders.map((po) => [po.id, po.number]));
  const rows = approvedForHandoff(invoices)
    .sort(
      (a, b) =>
        a.issueDate.localeCompare(b.issueDate) || a.invoiceNumber.localeCompare(b.invoiceNumber),
    )
    .map((invoice) =>
      [
        text(invoice.invoiceNumber),
        text(invoice.issueDate),
        text(invoice.dueDate),
        text(invoice.vendor),
        text(invoice.vatNumber ?? ""),
        text(invoice.iban ?? ""),
        text(invoice.currency),
        amount(invoice.subtotal),
        amount(invoice.tax),
        amount(invoice.total),
        text(invoice.glAccount),
        text(invoice.department),
        text(invoice.poId ? (poNumberById.get(invoice.poId) ?? "") : ""),
        text(invoice.memo ?? ""),
      ].join(","),
    );
  return BOM + [CSV_COLUMNS.join(","), ...rows].join(CRLF) + CRLF;
}

/** Saves the file client-side: a file out, no network. The handoff is the file. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some engines.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
