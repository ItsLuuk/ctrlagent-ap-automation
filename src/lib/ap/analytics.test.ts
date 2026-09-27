import { describe, expect, it } from "bun:test";
import { analyzeSpend, moneyLine, totalsByCurrency } from "./analytics";
import { money, type Invoice } from "./types";

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv-1",
    vendor: "Acme Corp",
    invoiceNumber: "A-1",
    total: 1000,
    status: "paid",
    lineItems: [],
    confidence: {},
    audit: [],
    createdAt: "2026-09-01T00:00:00Z",
    ...over,
  }) as unknown as Invoice;

describe("totalsByCurrency", () => {
  it("never adds amounts across currencies", () => {
    const r = totalsByCurrency([
      invoice({ id: "1", total: 100, currency: "EUR" }),
      invoice({ id: "2", total: 250, currency: "EUR" }),
      invoice({ id: "3", total: 400, currency: "USD" }),
    ]);
    expect(r).toEqual([
      { currency: "USD", total: 400, count: 1 },
      { currency: "EUR", total: 350, count: 2 },
    ]);
  });

  it("treats a missing currency as euros, the app's own default", () => {
    expect(totalsByCurrency([invoice({ total: 10 })])).toEqual([
      { currency: "EUR", total: 10, count: 1 },
    ]);
  });
});

describe("spend analysis", () => {
  const paid = invoice({
    id: "paid-1",
    vendor: "Acme",
    category: "Software",
    department: "Engineering",
    entity: "Foundry NL B.V.",
    issueDate: "2026-01-15",
    total: 100,
    currency: "EUR",
  });

  it("separates realized spend from the open pipeline", () => {
    const result = analyzeSpend([paid], [invoice({ id: "open-1", total: 50, status: "scheduled" })]);
    expect(result.realized).toEqual([{ currency: "EUR", total: 100, count: 1 }]);
    expect(result.openPipeline).toEqual([{ currency: "EUR", total: 50, count: 1 }]);
  });

  it("keeps currencies isolated in every dimension and retains exact drill-down ids", () => {
    const result = analyzeSpend(
      [paid, invoice({ id: "paid-2", total: 200, currency: "USD", vendor: "Other" })],
      [],
    );
    const vendor = result.buckets.vendor.find((bucket) => bucket.label === "Acme");
    expect(vendor).toMatchObject({ currency: "EUR", total: 100, invoiceIds: ["paid-1"] });
    expect(result.buckets.vendor.map((bucket) => bucket.currency)).toEqual(["USD", "EUR"]);
  });

  it("groups all explicit dimensions and falls back without inventing coding", () => {
    const legacy = invoice({ id: "legacy", category: undefined, entity: undefined });
    const result = analyzeSpend([paid, legacy], []);
    expect(result.buckets.category.map((bucket) => bucket.label)).toEqual(["Uncategorized", "Software"]);
    expect(result.buckets.department.map((bucket) => bucket.label)).toContain("Unassigned department");
    expect(result.buckets.entity.map((bucket) => bucket.label)).toEqual([
      "Unassigned entity",
      "Foundry NL B.V.",
    ]);
  });

  it("uses invoice issue date for month and quarter periods", () => {
    const q2 = invoice({ id: "q2", issueDate: "2026-05-20" });
    expect(analyzeSpend([q2], [], { period: "month" }).buckets.period[0]?.label).toBe("2026-05");
    expect(analyzeSpend([q2], [], { period: "quarter" }).buckets.period[0]?.label).toBe("2026-Q2");
  });

  it("applies date and currency filters before totals and drill-down", () => {
    const later = invoice({ id: "later", issueDate: "2026-07-01", currency: "USD", total: 300 });
    const result = analyzeSpend([paid, later], [], { from: "2026-07-01", currency: "USD" });
    expect(result.realized).toEqual([{ currency: "USD", total: 300, count: 1 }]);
    expect(result.buckets.vendor[0]?.invoiceIds).toEqual(["later"]);
  });
});

describe("money", () => {
  it("defaults a missing currency to euros", () => {
    expect(money(116.69, "")).toBe("€116.69");
  });
});

describe("moneyLine", () => {
  it("states each currency's own figure, joined", () => {
    expect(
      moneyLine([
        { currency: "EUR", total: 350, count: 2 },
        { currency: "USD", total: 400, count: 1 },
      ]),
    ).toBe("€350.00 + $400.00");
  });

  it("says nothing rather than zero when there is no money", () => {
    expect(moneyLine([])).toBe("—");
  });
});
