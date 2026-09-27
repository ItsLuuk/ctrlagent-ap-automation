/** Currency-safe money totals and spend analysis for the analytics surface. */
import { money, type Invoice } from "./types";

export type CurrencyTotal = {
  currency: string;
  total: number;
  count: number;
};

export function totalsByCurrency(invoices: Invoice[]): CurrencyTotal[] {
  const map = new Map<string, CurrencyTotal>();
  for (const invoice of invoices) {
    const currency = invoice.currency || "EUR";
    const bucket = map.get(currency) ?? { currency, total: 0, count: 0 };
    bucket.total += invoice.total;
    bucket.count += 1;
    map.set(currency, bucket);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function moneyLine(totals: CurrencyTotal[]): string {
  return totals.length === 0
    ? "—"
    : totals.map((total) => money(total.total, total.currency)).join(" + ");
}

export type SpendDimension = "vendor" | "category" | "department" | "entity" | "period";
export type SpendPeriod = "month" | "quarter";

export type SpendBucket = {
  key: string;
  label: string;
  currency: string;
  total: number;
  count: number;
  invoiceIds: string[];
};

export type SpendAnalysis = {
  realized: CurrencyTotal[];
  openPipeline: CurrencyTotal[];
  buckets: Record<SpendDimension, SpendBucket[]>;
};

const currencyOf = (invoice: Invoice) => invoice.currency || "EUR";
const clean = (value: string | undefined, fallback: string) => value?.trim() || fallback;const periodOf = (date: string | undefined, period: SpendPeriod): string => {
  const match = /^(\d{4})-(\d{2})/.exec(date ?? "");
  if (!match) return "Unknown period";
  const year = match[1]!;
  const month = Number(match[2]);
  if (period === "month") return `${year}-${String(month).padStart(2, "0")}`;
  return `${year}-Q${Math.ceil(month / 3)}`;
};

const dimensionValue = (
  invoice: Invoice,
  dimension: Exclude<SpendDimension, "period">,
): string => {
  if (dimension === "vendor") return clean(invoice.vendor, "Unassigned vendor");
  if (dimension === "category") return clean(invoice.category, "Uncategorized");
  if (dimension === "department") return clean(invoice.department, "Unassigned department");
  return clean(invoice.entity, "Unassigned entity");
};

const makeBuckets = (
  invoices: Invoice[],
  dimension: SpendDimension,
  period: SpendPeriod,
): SpendBucket[] => {
  const grouped = new Map<string, SpendBucket>();
  for (const invoice of invoices) {
    const label =
      dimension === "period"
        ? periodOf(invoice.issueDate, period)
        : dimensionValue(invoice, dimension);
    const currency = currencyOf(invoice);
    const key = `${label}\u0000${currency}`.toLocaleLowerCase();
    const bucket = grouped.get(key) ?? { key, label, currency, total: 0, count: 0, invoiceIds: [] };
    bucket.total += invoice.total;
    bucket.count += 1;
    if (!bucket.invoiceIds.includes(invoice.id)) bucket.invoiceIds.push(invoice.id);
    grouped.set(key, bucket);
  }
  return [...grouped.values()].sort(
    (a, b) => b.total - a.total || a.label.localeCompare(b.label) || a.currency.localeCompare(b.currency),
  );
};

/** Builds realized spend from paid history and keeps open commitments separate. */
export function analyzeSpend(
  paidInvoices: Invoice[],
  openInvoices: Invoice[],
  options: { from?: string; to?: string; currency?: string; period?: SpendPeriod } = {},
): SpendAnalysis {
  const period = options.period ?? "month";
  const inRange = (invoice: Invoice) => {
    const date = (invoice.issueDate ?? "").slice(0, 10);
    if (options.from && date < options.from) return false;
    if (options.to && date > options.to) return false;
    return !options.currency || currencyOf(invoice) === options.currency;
  };
  const paid = paidInvoices.filter(inRange);
  const open = openInvoices.filter(inRange);
  return {
    realized: totalsByCurrency(paid),
    openPipeline: totalsByCurrency(open),
    buckets: {
      vendor: makeBuckets(paid, "vendor", period),
      category: makeBuckets(paid, "category", period),
      department: makeBuckets(paid, "department", period),
      entity: makeBuckets(paid, "entity", period),
      period: makeBuckets(paid, "period", period),
    },
  };
}
