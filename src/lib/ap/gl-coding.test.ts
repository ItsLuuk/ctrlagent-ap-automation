import { describe, expect, it } from "bun:test";
import { suggestGlCoding } from "./gl-coding";
import type { Invoice } from "./types";

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv-1",
    vendor: "Acme Facilities B.V.",
    invoiceNumber: "INV-42",
    issueDate: "2026-09-15",
    dueDate: "2026-10-15",
    currency: "EUR",
    subtotal: 1000,
    tax: 210,
    total: 1210,
    status: "review",
    lineItems: [{ id: "line-1", description: "Monthly cleaning", quantity: 1, unitPrice: 1000, amount: 1000 }],
    glAccount: "",
    department: "",
    memo: "",
    tags: [],
    confidence: {},
    audit: [],
    source: "upload",
    createdAt: "2026-09-15T00:00:00Z",
    ...over,
  }) as Invoice;

describe("AI-suggested GL coding", () => {
  it("suggests the account and dimensions learned for a vendor/category", () => {
    const previous = invoice({
      id: "past-1",
      status: "paid",
      glAccount: "6200",
      category: "Facilities",
      department: "Operations",
      costCenter: "CC-100",
      project: "FLOOR-1",
      location: "HQ",
    });

    const suggestion = suggestGlCoding(invoice({ category: "Facilities" }), [previous]);

    expect(suggestion).toMatchObject({
      confidence: expect.any(Number),
      basedOn: 1,
      fields: {
        glAccount: "6200",
        category: "Facilities",
        department: "Operations",
        costCenter: "CC-100",
        project: "FLOOR-1",
        location: "HQ",
      },
    });
    expect(suggestion!.reason).toContain("Acme Facilities B.V.");
  });

  it("prefers the coding used by similar category invoices", () => {
    const facilities = invoice({
      id: "facilities",
      status: "paid",
      category: "Facilities",
      glAccount: "6200",
      department: "Operations",
    });
    const marketing = invoice({
      id: "marketing",
      status: "paid",
      category: "Marketing",
      glAccount: "6030",
      department: "Marketing",
    });

    const suggestion = suggestGlCoding(invoice({ category: "Facilities" }), [marketing, facilities]);
    expect(suggestion?.fields.glAccount).toBe("6200");
  });

  it("learns from a corrected invoice on the next suggestion", () => {
    const corrected = invoice({ id: "corrected", status: "paid", glAccount: "6010", department: "Facilities" });
    const first = suggestGlCoding(invoice(), [corrected]);
    expect(first?.fields.glAccount).toBe("6010");

    const nextCorrection = invoice({ id: "next", status: "paid", glAccount: "6200", department: "Operations" });
    expect(suggestGlCoding(invoice(), [corrected, nextCorrection])?.fields.glAccount).toBe("6200");
  });

  it("does not suggest coding learned for another vendor", () => {
    const other = invoice({ id: "other", vendor: "Other Vendor", status: "paid", glAccount: "9999" });
    expect(suggestGlCoding(invoice(), [other])).toBeUndefined();
  });
});
