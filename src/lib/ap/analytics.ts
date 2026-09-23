/**
 * Money totals, grouped the only way that is honest: one currency at a time.
 *
 * The inbox's work band is the only reader — "open payables" and "overdue" are
 * never added across currencies, and never formatted with a currency the data
 * does not have.
 *
 * The dashboard this module once fed is gone. What it counted was money already
 * approved or paid, so on a queue of invoices still waiting for a person it read
 * as four dashes and an empty list; its own numbers (cycle time, hands-off rate)
 * were the tool's self-portrait. The figure worth keeping — what is late — now
 * sits in the band, where the work is.
 */
import { money, type Invoice } from "./types";

export type CurrencyTotal = {
  currency: string;
  total: number;
  count: number;
};

/** Amounts of different currencies are never added: a mixed total is a number
 *  nobody can read, and one symbol on it states a currency the data lacks. */
export function totalsByCurrency(invoices: Invoice[]): CurrencyTotal[] {
  const map = new Map<string, CurrencyTotal>();
  for (const inv of invoices) {
    const currency = inv.currency || "EUR";
    const bucket = map.get(currency) ?? { currency, total: 0, count: 0 };
    bucket.total += inv.total;
    bucket.count += 1;
    map.set(currency, bucket);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/**
 * The sums as one line, a currency at a time — `€1,240.00 + $600.00`, never a
 * single blended figure. Shared by every money figure in the band, so the same
 * euro account cannot read in euros beside one tile and in dollars beside the
 * next.
 */
export function moneyLine(totals: CurrencyTotal[]): string {
  return totals.length === 0 ? "—" : totals.map((t) => money(t.total, t.currency)).join(" + ");
}
