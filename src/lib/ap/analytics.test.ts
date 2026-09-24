import { describe, expect, it } from "bun:test";
import { moneyLine, totalsByCurrency } from "./analytics";
import type { Invoice } from "./types";

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv-1",
    vendor: "Acme Corp",
    invoiceNumber: "A-1",
    total: 1000,
    status: "paid",
    lineItems: [],
    provenance: {},
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
