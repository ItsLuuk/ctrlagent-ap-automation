import { describe, expect, it } from "bun:test";
import {
  approvedForHandoff,
  bookkeepingCsv,
  CSV_COLUMNS,
  exportableForHandoff,
  invoicesMissingPaymentRoute,
  paymentIdentifiers,
} from "./csv-export";
import type { PurchaseOrder } from "./po-store";
import type { Invoice } from "./types";
import type { VendorMaster } from "./vendor-master";

/** A captured, approved invoice that is actually payable: the export fixture. */
const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: "inv-1",
  vendor: "Superdoos B.V.",
  invoiceNumber: "AP-7741",
  issueDate: "2026-09-13",
  dueDate: "2026-09-28",
  currency: "EUR",
  subtotal: 3250,
  tax: 276.25,
  total: 3526.25,
  status: "scheduled",
  source: "upload",
  iban: "NL91ABNA0417164300",
  lineItems: [],
  tags: [],
  provenance: {},
  audit: [],
  glAccount: "6030",
  department: "Marketing",
  memo: "Q4 conference booth",
  createdAt: "2026-09-13T00:00:00Z",
  ...over,
});

const profile = (over: Partial<VendorMaster> = {}): VendorMaster => ({
  name: "Superdoos B.V.",
  email: "billing@superdoos.example",
  iban: "NL95RABO0336381832",
  vatNumber: "NL123456789B01",
  businessRegistrationNumber: "34298230",
  updatedAt: "2026-09-13T00:00:00Z",
  ...over,
});

/** Vendor master as the store keeps it: keyed by vendor name. */
const master = (...records: VendorMaster[]): Record<string, VendorMaster> =>
  Object.fromEntries(records.map((record) => [record.name, record]));

/** File lines after the BOM, without the empty trailing slot. */
const lines = (csv: string): string[] =>
  csv
    .replace(/^\uFEFF/, "")
    .split("\r\n")
    .filter((line) => line.length > 0);

describe("approvedForHandoff", () => {
  it("keeps approved captured invoices and drops everything else", () => {
    const keep = invoice();
    const drop = [
      invoice({ id: "draft", status: "draft" }),
      invoice({ id: "rejected", status: "rejected" }),
      invoice({ id: "paid-in-history", status: "paid" }),
      invoice({ id: "sample", source: "sample" }),
    ];
    expect(approvedForHandoff([keep, ...drop])).toEqual([keep]);
  });
});

describe("bookkeepingCsv", () => {
  it("starts with a BOM, carries the exact header, and ends every line with CRLF", () => {
    const csv = bookkeepingCsv([invoice()]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(lines(csv)[0]).toBe(CSV_COLUMNS.join(","));
    expect(CSV_COLUMNS).toHaveLength(15);
    expect(CSV_COLUMNS).toContain("registration_number");
  });

  it("exports one row per approved invoice — never drafts, history, or samples", () => {
    const csv = bookkeepingCsv([
      invoice(),
      invoice({ id: "draft", status: "draft", invoiceNumber: "D-1" }),
      invoice({ id: "sample", source: "sample", invoiceNumber: "S-1" }),
    ]);
    expect(lines(csv)).toHaveLength(2);
    expect(lines(csv)[1]).toContain("AP-7741");
    expect(csv).not.toContain("D-1");
    expect(csv).not.toContain("S-1");
  });

  it("writes a header-only file when nothing qualifies", () => {
    expect(lines(bookkeepingCsv([]))).toEqual([CSV_COLUMNS.join(",")]);
  });

  it("escapes commas, quotes, and newlines per RFC 4180", () => {
    const csv = bookkeepingCsv([invoice({ vendor: 'Weird "Co", Ltd\nSecond line' })]);
    expect(csv).toContain('"Weird ""Co"", Ltd\nSecond line"');
  });

  it("neutralises spreadsheet formula injection in text cells", () => {
    const csv = bookkeepingCsv([
      invoice({ vendor: "=SUM(A1)", memo: "\tTabbed", department: "-Danger" }),
    ]);
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain("'\tTabbed");
    expect(csv).toContain("'-Danger");
    // The guard must not touch cells that cannot execute.
    expect(csv).toContain("AP-7741");
  });

  it("formats money with two decimals and a dot, dates as stored ISO", () => {
    const row = lines(bookkeepingCsv([invoice()]))[1]!;
    const cells = row.split(",");
    expect(cells[1]).toBe("2026-09-13");
    expect(cells[2]).toBe("2026-09-28");
    expect(cells[8]).toBe("3250.00");
    expect(cells[9]).toBe("276.25");
    expect(cells[10]).toBe("3526.25");
  });

  it("leaves optional identity fields blank instead of inventing values", () => {
    // Payable through the profile's IBAN only: the row ships, and the two
    // identifiers nobody has recorded stay empty rather than being guessed.
    const row = lines(
      bookkeepingCsv(
        [invoice({ iban: undefined, vatNumber: undefined })],
        [],
        master(profile({ vatNumber: undefined })),
      ),
    )[1]!;
    const cells = row.split(",");
    expect(cells[4]).toBe("");
    expect(cells[5]).toBe("NL95RABO0336381832");
    expect(cells[6]).toBe("34298230");
  });

  it("carries the vendor profile's payment identifiers when the document never read them", () => {
    // The first-time-vendor case: the extractor found no IBAN, so the operator
    // typed it at registration and it only ever landed on the vendor record.
    const unread = invoice({
      iban: undefined,
      vatNumber: undefined,
      businessRegistrationNumber: undefined,
    });
    const csv = bookkeepingCsv([unread], [], master(profile()));
    const cells = lines(csv)[1]!.split(",");
    expect(cells[4]).toBe("NL123456789B01");
    expect(cells[5]).toBe("NL95RABO0336381832");
    expect(cells[6]).toBe("34298230");
  });

  it("prefers what the document carried over the profile", () => {
    // The invoice is the evidence attached to this row; the profile is the
    // fallback, never an override of what the document said.
    const cells = lines(
      bookkeepingCsv(
        [invoice({ iban: "NL20INGB0001234567", vatNumber: "NL999999999B01" })],
        [],
        master(profile()),
      ),
    )[1]!.split(",");
    expect(cells[4]).toBe("NL999999999B01");
    expect(cells[5]).toBe("NL20INGB0001234567");
  });

  it("resolves the linked purchase-order number and blanks unknown ids", () => {
    const pos = [{ id: "po-1", number: "PO-4471" }] as unknown as PurchaseOrder[];
    const csv = bookkeepingCsv(
      [invoice({ poId: "po-1" }), invoice({ id: "inv-2", poId: "ghost" })],
      pos,
    );
    expect(csv).toContain(",PO-4471,");
    expect(csv).not.toContain("ghost");
  });

  it("sorts rows by issue date, then invoice number", () => {
    const csv = bookkeepingCsv([
      invoice({ id: "b", invoiceNumber: "B-2", issueDate: "2026-09-13" }),
      invoice({ id: "a", invoiceNumber: "A-1", issueDate: "2026-08-01" }),
      invoice({ id: "c", invoiceNumber: "A-2", issueDate: "2026-08-01" }),
    ]);
    const dates = lines(csv)
      .slice(1)
      .map((row) => row.split(",")[1]);
    expect(dates).toEqual(["2026-08-01", "2026-08-01", "2026-09-13"]);
    const firstRow = lines(csv)[1]!;
    expect(firstRow.startsWith("A-1,")).toBe(true);
  });
});

describe("the handoff payment route", () => {
  it("resolves identifiers document-first, profile-second, ignoring blanks", () => {
    const ids = paymentIdentifiers(
      invoice({ iban: "   ", vatNumber: undefined }),
      master(profile()),
    );
    expect(ids.iban).toBe("NL95RABO0336381832");
    expect(ids.vatNumber).toBe("NL123456789B01");
    expect(ids.registrationNumber).toBe("34298230");
  });

  it("keeps an approved invoice out of the file when no payment route exists anywhere", () => {
    const routeless = invoice({ id: "no-route", invoiceNumber: "AP-0001", iban: undefined });
    const csv = bookkeepingCsv([routeless], [], {});
    expect(lines(csv)).toEqual([CSV_COLUMNS.join(",")]);
    expect(csv).not.toContain("AP-0001");
    expect(exportableForHandoff([routeless], {})).toEqual([]);
    expect(invoicesMissingPaymentRoute([routeless], {})).toEqual([routeless]);
  });

  it("ships the payable rows and names the one it held back", () => {
    const payable = invoice({ id: "ok", invoiceNumber: "AP-2" });
    const routeless = invoice({ id: "no", invoiceNumber: "AP-1", iban: undefined });
    const rows = [payable, routeless];
    const csv = bookkeepingCsv(rows, [], {});
    expect(lines(csv)).toHaveLength(2);
    expect(csv).toContain("AP-2");
    expect(csv).not.toContain("AP-1");
    expect(exportableForHandoff(rows, {})).toEqual([payable]);
    expect(invoicesMissingPaymentRoute(rows, {})).toEqual([routeless]);
  });

  it("rescues a routeless invoice the moment the profile supplies an IBAN", () => {
    const routeless = invoice({ id: "no", invoiceNumber: "AP-1", iban: undefined });
    const vendors = master(profile());
    expect(exportableForHandoff([routeless], vendors)).toEqual([routeless]);
    expect(invoicesMissingPaymentRoute([routeless], vendors)).toEqual([]);
  });

  it("never refuses a record that was never headed for the file", () => {
    const rows = [
      invoice({ id: "draft", status: "draft", iban: undefined }),
      invoice({ id: "rejected", status: "rejected", iban: undefined }),
      invoice({ id: "paid", status: "paid", source: "upload", iban: undefined }),
      invoice({ id: "sample", source: "sample", iban: undefined }),
    ];
    expect(invoicesMissingPaymentRoute(rows, {})).toEqual([]);
  });
});
