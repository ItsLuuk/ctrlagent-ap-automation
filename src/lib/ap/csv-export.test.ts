import { describe, expect, it } from "bun:test";
import { approvedForHandoff, bookkeepingCsv, CSV_COLUMNS } from "./csv-export";
import type { PurchaseOrder } from "./purchase-order";
import type { Invoice } from "./types";

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
  lineItems: [],
  tags: [],
  confidence: {},
  audit: [],
  glAccount: "6030",
  department: "Marketing",
  memo: "Q4 conference booth",
  createdAt: "2026-09-13T00:00:00Z",
  ...over,
});

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
    expect(CSV_COLUMNS).toHaveLength(18);
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
    expect(cells[7]).toBe("3250.00");
    expect(cells[8]).toBe("276.25");
    expect(cells[9]).toBe("3526.25");
  });

  it("leaves optional identity fields blank instead of inventing values", () => {
    const row = lines(bookkeepingCsv([invoice({ vatNumber: undefined, iban: undefined })]))[1]!;
    const cells = row.split(",");
    expect(cells[4]).toBe("");
    expect(cells[5]).toBe("");
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
    const vendors = lines(csv)
      .slice(1)
      .map((row) => row.split(",")[1]);
    expect(vendors).toEqual(["2026-08-01", "2026-08-01", "2026-09-13"]);
    const firstRow = lines(csv)[1]!;
    expect(firstRow.startsWith("A-1,")).toBe(true);
  });
});
