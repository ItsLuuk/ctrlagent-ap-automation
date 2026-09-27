import { describe, expect, it } from "bun:test";
import { convert, putRate, rateFor, type FxRate } from "./fx";

const rate = (base: string, quote: string, value: number, at = "2026-01-01T00:00:00Z"): FxRate => ({
  base,
  quote,
  rate: value,
  at,
});

describe("rateFor", () => {
  it("returns 1 for the same currency without touching the table", () => {
    expect(rateFor([], "EUR", "EUR")).toBe(1);
  });

  it("uses the direct leg when one exists", () => {
    const rates = [rate("EUR", "USD", 1.1)];
    expect(rateFor(rates, "EUR", "USD")).toBe(1.1);
  });

  it("inverts the opposite leg rather than failing", () => {
    const rates = [rate("EUR", "USD", 1.1)];
    expect(rateFor(rates, "USD", "EUR")).toBeCloseTo(1 / 1.1, 10);
  });

  it("takes the latest entry for a pair", () => {
    const rates = [
      rate("EUR", "USD", 1.05, "2026-01-01T00:00:00Z"),
      rate("EUR", "USD", 1.12, "2026-02-01T00:00:00Z"),
      rate("EUR", "USD", 1.09, "2026-01-15T00:00:00Z"),
    ];
    expect(rateFor(rates, "EUR", "USD")).toBe(1.12);
  });

  it("returns undefined when neither leg exists", () => {
    expect(rateFor([rate("EUR", "USD", 1.1)], "EUR", "JPY")).toBeUndefined();
    expect(rateFor([], "EUR", "USD")).toBeUndefined();
  });

  it("ignores zero and negative rates", () => {
    expect(rateFor([rate("EUR", "USD", 0)], "EUR", "USD")).toBeUndefined();
  });
});

describe("convert", () => {
  it("converts through the rate and reports missing pairs as undefined", () => {
    const rates = [rate("EUR", "GBP", 0.85)];
    expect(convert(100, "EUR", "GBP", rates)).toBeCloseTo(85, 6);
    expect(convert(100, "GBP", "CHF", rates)).toBeUndefined();
    expect(convert(42, "EUR", "EUR", rates)).toBe(42);
  });
});

describe("putRate", () => {
  it("keeps one entry per pair, newest wins", () => {
    let table = putRate([], rate("EUR", "USD", 1.1));
    table = putRate(table, rate("EUR", "USD", 1.2, "2026-03-01T00:00:00Z"));
    expect(table).toHaveLength(1);
    expect(rateFor(table, "EUR", "USD")).toBe(1.2);
  });

  it("leaves other pairs alone", () => {
    let table = putRate([rate("EUR", "GBP", 0.85)], rate("EUR", "USD", 1.1));
    expect(table).toHaveLength(2);
    expect(rateFor(table, "EUR", "GBP")).toBe(0.85);
  });
});
