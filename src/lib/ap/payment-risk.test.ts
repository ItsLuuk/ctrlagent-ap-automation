import { describe, expect, it } from "bun:test";
import { releaseIsBlocked, scorePaymentRisk } from "./payment-risk";
import type { Invoice } from "./types";

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv-1",
    vendor: "Acme Corp",
    invoiceNumber: "A-0231",
    total: 2340,
    status: "scheduled",
    lineItems: [],
    provenance: {},
    audit: [],
    ...over,
  }) as unknown as Invoice;

const historyEntry = (vendor: string, total: number) => ({
  vendor,
  total,
  paidAt: "2026-06-01",
});

describe("scorePaymentRisk", () => {
  it("returns no flags for a routine payment", () => {
    const flags = scorePaymentRisk({
      invoice: invoice(),
      scheduled: [invoice()],
      history: [historyEntry("Acme Corp", 2000), historyEntry("Acme Corp", 2600)],
    });
    expect(flags).toHaveLength(0);
  });

  it("flags a first payment", () => {
    const flags = scorePaymentRisk({
      invoice: invoice(),
      scheduled: [invoice()],
      history: [historyEntry("Other Inc", 500)],
    });
    expect(flags.map((f) => f.kind)).toContain("first_payment");
  });

  it("flags an amount far above the vendor average", () => {
    const flags = scorePaymentRisk({
      invoice: invoice({ total: 20000 }),
      scheduled: [invoice({ total: 20000 })],
      history: [historyEntry("Acme Corp", 2000), historyEntry("Acme Corp", 2200)],
    });
    expect(flags.map((f) => f.kind)).toContain("amount_above_average");
  });

  it("does not flag a modestly above-average amount", () => {
    const flags = scorePaymentRisk({
      invoice: invoice({ total: 2600 }),
      scheduled: [invoice({ total: 2600 })],
      history: [historyEntry("Acme Corp", 2000), historyEntry("Acme Corp", 2200)],
    });
    expect(flags.map((f) => f.kind)).not.toContain("amount_above_average");
  });

  it("flags recent bank-detail changes with a phone-verification prompt", () => {
    const flags = scorePaymentRisk({
      invoice: invoice(),
      scheduled: [invoice()],
      history: [historyEntry("Acme Corp", 2000)],
      bankDetailsChangedDaysAgo: 2,
    });
    const flag = flags.find((f) => f.kind === "bank_details_changed");
    expect(flag?.acknowledgePrompt).toContain("verified");
  });

  it("ignores bank changes older than two weeks", () => {
    const flags = scorePaymentRisk({
      invoice: invoice(),
      scheduled: [invoice()],
      history: [historyEntry("Acme Corp", 2000)],
      bankDetailsChangedDaysAgo: 30,
    });
    expect(flags.map((f) => f.kind)).not.toContain("bank_details_changed");
  });

  it("flags a same-vendor same-amount duplicate among scheduled invoices", () => {
    const other = invoice({ id: "inv-2", invoiceNumber: "A-0230", total: 2340 });
    const flags = scorePaymentRisk({
      invoice: invoice(),
      scheduled: [invoice(), other],
      history: [historyEntry("Acme Corp", 2000)],
    });
    expect(flags.map((f) => f.kind)).toContain("duplicate_warning");
  });

  it("compares vendors case-insensitively", () => {
    const flags = scorePaymentRisk({
      invoice: invoice({ vendor: "ACME CORP" }),
      scheduled: [invoice({ vendor: "ACME CORP" })],
      history: [historyEntry("acme corp", 2000)],
    });
    expect(flags).toHaveLength(0);
  });
});

describe("releaseIsBlocked", () => {
  const flags = scorePaymentRisk({
    invoice: invoice(),
    scheduled: [invoice()],
    history: [],
    bankDetailsChangedDaysAgo: 1,
  });
  expect(flags.length).toBeGreaterThan(0);

  it("blocks release until all flags are acknowledged", () => {
    expect(releaseIsBlocked(flags, new Set())).toBe(true);
    expect(releaseIsBlocked(flags, new Set(["bank_details_changed"]))).toBe(true);
    expect(releaseIsBlocked(flags, new Set(["bank_details_changed", "first_payment"]))).toBe(false);
  });
});
