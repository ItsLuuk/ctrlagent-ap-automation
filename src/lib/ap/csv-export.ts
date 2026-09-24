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
 *  - And only with somewhere to send the money. A row whose vendor has no IBAN
 *    on the document *or* in the vendor profile is a promise, not an entry, so
 *    it is held back and named by the caller instead of shipping as a blank
 *    column the accountant discovers after the payment run.
 *  - Payment identifiers resolve document-first, profile-second: a first-time
 *    vendor's bank details are typed during registration and only ever land on
 *    the vendor record, so reading the invoice alone dropped the IBAN the
 *    operator had just validated.
 *  - `registration_number` joins the header beside `iban` and `vat_number` as
 *    the vendor's KvK. Header-name importers are unaffected; positional ones
 *    need the extra column.
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
import type { VendorMaster } from "./vendor-master";

const BOM = "\uFEFF";
const CRLF = "\r\n";

export const CSV_COLUMNS = [
  "invoice_number",
  "invoice_date",
  "due_date",
  "vendor",
  "vat_number",
  "iban",
  "registration_number",
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

/** The three identifiers a bookkeeping row needs to be actionable. */
export type PaymentIdentifiers = {
  iban: string;
  vatNumber: string;
  registrationNumber: string;
};

/** The first value that actually carries text; blanks are treated as absent. */
function firstText(...values: Array<string | undefined>): string {
  return values.find((value) => value !== undefined && value.trim() !== "")?.trim() ?? "";
}

/**
 * A row's payment identifiers: what this document said, then what the vendor
 * profile says. The document wins — it is the evidence attached to this
 * invoice — and the profile is the fallback for the first-time vendor whose
 * bank details the extractor never found and the operator typed by hand.
 *
 * Missing stays missing: nothing is inferred from the vendor name, the country
 * or a sibling field, so a row can still be short a column rather than wrong.
 */
export function paymentIdentifiers(
  invoice: Pick<Invoice, "vendor" | "iban" | "vatNumber" | "businessRegistrationNumber">,
  vendors: Record<string, VendorMaster> = {},
): PaymentIdentifiers {
  const profile = vendors[invoice.vendor ?? ""];
  return {
    iban: firstText(invoice.iban, profile?.iban),
    vatNumber: firstText(invoice.vatNumber, profile?.vatNumber),
    registrationNumber: firstText(
      invoice.businessRegistrationNumber,
      profile?.businessRegistrationNumber,
    ),
  };
}

/**
 * The rows the file may contain: approved, captured, and payable. This is the
 * gate the CSV and the inbox button share, so the count the operator sees is
 * the count of rows in the file.
 */
export function exportableForHandoff(
  invoices: Invoice[],
  vendors: Record<string, VendorMaster> = {},
): Invoice[] {
  return approvedForHandoff(invoices).filter(
    (invoice) => paymentIdentifiers(invoice, vendors).iban !== "",
  );
}

/**
 * Approved rows the file refused, so the UI can name them instead of letting a
 * missing IBAN surface as a blank cell three days later. Non-approved and
 * sample records are never in here: they were never headed for the file.
 */
export function invoicesMissingPaymentRoute(
  invoices: Invoice[],
  vendors: Record<string, VendorMaster> = {},
): Invoice[] {
  return approvedForHandoff(invoices).filter(
    (invoice) => paymentIdentifiers(invoice, vendors).iban === "",
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
} /** The CSV file for every exportable invoice. Header only when none qualify. */
export function bookkeepingCsv(
  invoices: Invoice[],
  purchaseOrders: PurchaseOrder[] = [],
  vendors: Record<string, VendorMaster> = {},
): string {
  const poNumberById = new Map(purchaseOrders.map((po) => [po.id, po.number]));
  const rows = exportableForHandoff(invoices, vendors)
    .sort(
      (a, b) =>
        a.issueDate.localeCompare(b.issueDate) || a.invoiceNumber.localeCompare(b.invoiceNumber),
    )
    .map((invoice) => {
      const ids = paymentIdentifiers(invoice, vendors);
      return [
        text(invoice.invoiceNumber),
        text(invoice.issueDate),
        text(invoice.dueDate),
        text(invoice.vendor),
        text(ids.vatNumber),
        text(ids.iban),
        text(ids.registrationNumber),
        text(invoice.currency),
        amount(invoice.subtotal),
        amount(invoice.tax),
        amount(invoice.total),
        text(invoice.glAccount),
        text(invoice.department),
        text(invoice.poId ? (poNumberById.get(invoice.poId) ?? "") : ""),
        text(invoice.memo ?? ""),
      ].join(",");
    });
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
