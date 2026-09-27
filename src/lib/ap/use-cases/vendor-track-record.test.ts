import { describe, expect, it } from "bun:test";
import { trackRecordLine, vendorTrackRecord } from "./vendor-track-record";
import type { Invoice } from "../types";

const invoice: Invoice = {
  id: "invoice-1",
  vendor: "Acme B.V.",
  invoiceNumber: "AC-42",
  issueDate: "2026-01-20",
  dueDate: "2026-02-19",
  currency: "EUR",
  subtotal: 1000,
  tax: 210,
  total: 1210,
  status: "draft",
  lineItems: [],
  glAccount: "6020",
  department: "Finance",
  memo: "",
  tags: [],
  audit: [],
  source: "upload",
  createdAt: "2026-01-20T00:00:00.000Z",
};

/** One of this vendor's other invoices, at a stage the record can be read at. */
const other = (over: Partial<Invoice>): Invoice => ({ ...invoice, ...over, id: "other" });

describe("vendorTrackRecord", () => {
  it("counts invoices the template read without a person going back", () => {
    const record = vendorTrackRecord(
      [
        other({ id: "a", status: "paid", engine: "template" }),
        other({ id: "b", status: "review" }),
      ],
      invoice,
    );

    expect(record).toEqual({ read: 1, needed: 0 });
  });

  it("counts the ones that stopped for a person", () => {
    const record = vendorTrackRecord(
      [
        other({ id: "a", status: "draft" }),
        other({ id: "b", status: "failed" }),
        other({ id: "c", status: "draft" }),
      ],
      invoice,
    );

    expect(record).toEqual({ read: 0, needed: 3 });
  });

  it("never counts an invoice a person typed into as read automatically", () => {
    // A later stage only proves the reading was accepted if the template made
    // the values. This is the number someone trusts to skip the next one.
    expect(vendorTrackRecord([other({ id: "a", status: "scheduled" })], invoice).read).toBe(0);
  });

  it("ignores other vendors, and the invoice in front of the reviewer", () => {
    const record = vendorTrackRecord(
      [
        { ...invoice, status: "draft", engine: "template" },
        other({ id: "a", vendor: "KPN B.V.", status: "paid", engine: "template" }),
      ],
      invoice,
    );

    expect(record).toEqual({ read: 0, needed: 0 });
  });

  it("treats a vendor name that only differs in case as the same vendor", () => {
    const record = vendorTrackRecord(
      [other({ id: "a", vendor: "acme b.v.", status: "paid", engine: "template" })],
      invoice,
    );

    expect(record.read).toBe(1);
  });

  it("leaves out what the machine is still reading and what was turned down", () => {
    const record = vendorTrackRecord(
      [other({ id: "a", status: "processing" }), other({ id: "b", status: "rejected" })],
      invoice,
    );

    expect(record).toEqual({ read: 0, needed: 0 });
  });
});

describe("trackRecordLine", () => {
  it("says the compounding out loud", () => {
    expect(trackRecordLine({ read: 14, needed: 1 })).toBe(
      "14 invoices read automatically. This one needed you.",
    );
  });

  it("stays quiet for a vendor with no history yet", () => {
    expect(trackRecordLine({ read: 0, needed: 3 })).toBeNull();
  });
});
