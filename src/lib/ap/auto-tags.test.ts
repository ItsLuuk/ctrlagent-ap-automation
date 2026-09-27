import { describe, expect, it } from "bun:test";
import { computeAutoTags, retagAll } from "./auto-tags";
import type { Invoice } from "./types";

const base = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv-1",
    vendor: "Acme B.V.",
    invoiceNumber: "AC-001",
    issueDate: "2026-04-12",
    dueDate: "2026-05-12",
    currency: "EUR",
    subtotal: 1000,
    tax: 210,
    total: 1210,
    status: "draft",
    lineItems: [],
    glAccount: "",
    department: "",
    memo: "",
    tags: [],
    confidence: {},
    audit: [],
    source: "upload",
    createdAt: new Date(0).toISOString(),
    ...over,
  }) as Invoice;

describe("computeAutoTags", () => {
  it("tags first-time vendor", () => {
    const invoice = base();
    const tags = computeAutoTags(invoice, [invoice], {});
    expect(tags).toContain("First-time vendor");
  });

  it("tags recurring vendor when other invoices exist", () => {
    const first = base({ id: "inv-1" });
    const second = base({ id: "inv-2" });
    const tags = computeAutoTags(second, [first, second], {});
    expect(tags).toContain("Recurring");
    expect(tags).not.toContain("First-time vendor");
  });

  it("tags high value invoice", () => {
    const invoice = base({ total: 15_000 });
    const tags = computeAutoTags(invoice, [invoice], {});
    expect(tags).toContain("High value");
  });

  it("does not tag low value as high", () => {
    const invoice = base({ total: 500 });
    const tags = computeAutoTags(invoice, [invoice], {});
    expect(tags).not.toContain("High value");
  });

  it("tags late invoice when past due date", () => {
    const invoice = base({ dueDate: "2020-01-01", status: "draft" });
    const tags = computeAutoTags(invoice, [invoice], {});
    expect(tags).toContain("Late");
  });

  it("does not tag paid invoice as late", () => {
    const invoice = base({ dueDate: "2020-01-01", status: "paid" });
    const tags = computeAutoTags(invoice, [invoice], {});
    expect(tags).not.toContain("Late");
  });

  it("does not tag a rejected invoice as late — that money is not owed", () => {
    const invoice = base({ dueDate: "2020-01-01", status: "rejected" });
    const tags = computeAutoTags(invoice, [invoice], {});
    expect(tags).not.toContain("Late");
  });

  it("drops a stale tag when the list is re-derived", () => {
    const stale = base({ id: "a", dueDate: "2020-01-01", status: "rejected", tags: ["Late"] });
    expect(retagAll([stale], {})[0]!.tags).not.toContain("Late");

    const solo = base({ id: "b", vendor: "Acme", tags: [] });
    const pair = base({ id: "c", vendor: "Acme", tags: [] });
    for (const invoice of retagAll([solo, pair], {})) {
      expect(invoice.tags).toContain("Recurring");
      expect(invoice.tags).not.toContain("First-time vendor");
    }
  });

  it("tags international vendor with non-NL IBAN", () => {
    const invoice = base({ iban: "DE89370400440532013000" });
    const tags = computeAutoTags(invoice, [invoice], {});
    expect(tags).toContain("International");
  });

  it("tags international vendor with GmbH in name", () => {
    const invoice = base({ vendor: "Siemens GmbH" });
    const tags = computeAutoTags(invoice, [invoice], {});
    expect(tags).toContain("International");
  });

  it("does not tag NL vendor as international", () => {
    const invoice = base({ iban: "NL91ABNA0417164300" });
    const tags = computeAutoTags(invoice, [invoice], {});
    expect(tags).not.toContain("International");
  });

  it("tags duplicate risk for same vendor + same amount within window", () => {
    const first = base({ id: "inv-1", total: 1000, issueDate: "2026-04-10" });
    const second = base({ id: "inv-2", total: 1000, issueDate: "2026-04-12" });
    const tags = computeAutoTags(second, [first, second], {});
    expect(tags).toContain("Duplicate risk");
  });

  it("does not tag duplicate when amounts differ significantly", () => {
    const first = base({ id: "inv-1", total: 1000, issueDate: "2026-04-10" });
    const second = base({ id: "inv-2", total: 5000, issueDate: "2026-04-12" });
    const tags = computeAutoTags(second, [first, second], {});
    expect(tags).not.toContain("Duplicate risk");
  });

  it("re-checks active records against a prior paid period", () => {
    const active = base({ id: "active", invoiceNumber: "AC-001", total: 1000 });
    const paid = base({ id: "paid", invoiceNumber: "AC-001", total: 1000, status: "paid" });
    const tags = retagAll([active], {}, [active, paid])[0]!.tags;
    expect(tags).toContain("Duplicate risk");
  });

  it("tags needs receipt for high-value first-time vendor", () => {
    const invoice = base({ total: 15_000 });
    const tags = computeAutoTags(invoice, [invoice], {});
    expect(tags).toContain("Needs receipt");
    expect(tags).toContain("First-time vendor");
    expect(tags).toContain("High value");
  });

  it("returns sorted tags", () => {
    const invoice = base({ total: 15_000, iban: "DE89370400440532013000" });
    const tags = computeAutoTags(invoice, [invoice], {});
    const sorted = [...tags].sort();
    expect(tags).toEqual(sorted);
  });
});
