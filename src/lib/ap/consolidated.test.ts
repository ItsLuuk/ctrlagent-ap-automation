import { describe, expect, it } from "bun:test";
import { consolidatedReport, reportHeadline } from "./consolidated";
import { entityFromProfile } from "./entities";
import type { FxRate } from "./fx";
import { EMPTY_BUSINESS_PROFILE, type BusinessProfile, type Invoice } from "./types";

const profile = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  ...EMPTY_BUSINESS_PROFILE,
  ...over,
});

const NL = entityFromProfile(
  profile({ name: "Foundry BV", vatNumber: "NL005169491B25", iban: "NL91ABNA0417164300" }),
);
const US = {
  ...entityFromProfile(profile({ name: "Foundry Inc", iban: "" })),
  id: "ent-us",
  name: "Foundry Inc",
  jurisdiction: "US",
  baseCurrency: "USD",
};

const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: `inv-${Math.random().toString(36).slice(2, 8)}`,
  vendor: "Somebody",
  invoiceNumber: "1",
  issueDate: "2026-09-01",
  dueDate: "2026-09-30",
  currency: "EUR",
  subtotal: 100,
  tax: 21,
  total: 121,
  status: "review",
  lineItems: [],
  glAccount: "6010 · Software & SaaS",
  department: "Engineering",
  memo: "",
  tags: [],
  audit: [],
  source: "sample",
  createdAt: "2026-09-01T00:00:00Z",
  ...over,
});

const usdRate: FxRate = {
  base: "EUR",
  quote: "USD",
  rate: 1.1,
  at: "2026-09-01T00:00:00Z",
};

describe("consolidatedReport", () => {
  it("groups invoices by their entity id and sums per currency", () => {
    const report = consolidatedReport({
      invoices: [
        invoice({ entity: NL.id, total: 100 }),
        invoice({ entity: NL.id, total: 50, currency: "USD" }),
        invoice({ entity: "ent-us", total: 40, currency: "USD" }),
        invoice({ total: 10 }), // legacy record: falls back to the first entity
      ],
      entities: [NL, US],
      rates: [],
      reportingCurrency: "EUR",
    });
    expect(report.entities).toHaveLength(2);
    const nl = report.entities[0]!;
    // Two tagged + the legacy fallback record.
    expect(nl.invoiceCount).toBe(3);
    expect(nl.buckets.map((bucket) => [bucket.currency, bucket.amount])).toEqual([
      ["EUR", 110],
      ["USD", 50],
    ]);
    expect(report.entities[1]!.invoiceCount).toBe(1);
    expect(report.invoiceCount).toBe(4);
  });

  it("converts every bucket when rates exist and consolidates", () => {
    const report = consolidatedReport({
      invoices: [
        invoice({ entity: NL.id, total: 100, currency: "EUR" }),
        invoice({ entity: "ent-us", total: 100, currency: "EUR" }),
      ],
      entities: [NL, US],
      rates: [usdRate],
      reportingCurrency: "EUR",
    });
    expect(report.entities.map((totals) => totals.total)).toEqual([100, 100]);
    expect(report.consolidated).toBe(200);
    expect(report.missingRates).toEqual([]);
    expect(reportHeadline(report)).toContain("€200.00 consolidated");
  });

  it("refuses to print a consolidated total while any rate is missing", () => {
    const report = consolidatedReport({
      invoices: [
        invoice({ entity: NL.id, total: 100, currency: "EUR" }),
        invoice({ entity: "ent-us", total: 100, currency: "USD" }),
      ],
      entities: [NL, US],
      rates: [],
      reportingCurrency: "EUR",
    });
    expect(report.consolidated).toBeUndefined();
    const us = report.entities[1]!;
    expect(us.total).toBeUndefined();
    expect(us.buckets).toEqual([{ currency: "USD", amount: 100 }]);
    expect(report.missingRates).toEqual([{ entityId: "ent-us", entityName: "Foundry Inc", currency: "USD" }]);
    expect(reportHeadline(report)).toContain("missing rates for USD → Foundry Inc");
  });

  it("converts through the inverse leg when only the opposite pair is stored", () => {
    const report = consolidatedReport({
      invoices: [invoice({ entity: "ent-us", total: 110, currency: "USD" })],
      entities: [NL, US],
      rates: [usdRate], // EUR → USD stored; USD → EUR reads inverted
      reportingCurrency: "EUR",
    });
    expect(report.entities[1]!.total).toBeCloseTo(100, 6);
    expect(report.consolidated).toBeCloseTo(100, 6);
  });

  it("reports an empty book without inventing numbers", () => {
    const report = consolidatedReport({
      invoices: [],
      entities: [NL, US],
      rates: [],
      reportingCurrency: "EUR",
    });
    expect(report.invoiceCount).toBe(0);
    expect(report.consolidated).toBe(0);
    expect(report.missingRates).toEqual([]);
  });
});
