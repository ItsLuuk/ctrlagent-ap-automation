/**
 * Per-vendor baselines — what this vendor's invoices normally look like.
 *
 * A baseline is derived, not stored: it is rebuilt from the records every time
 * it is asked for, so it cannot drift away from the invoices it was learned
 * from and there is nothing to migrate when the rules change.
 *
 * Every statistic here is robust on purpose. Medians instead of means, and a
 * median absolute deviation instead of a standard deviation, because the whole
 * point of a baseline is to decide which invoices look wrong — one wrong
 * invoice must not be able to move the line that judges the next one.
 */
import { resolveVendorIdentity } from "./duplicate-detection";
import type { Invoice, VendorProfile } from "./types";

/**
 * Invoices a vendor needs before a deviation from its baseline means anything.
 * Below this, a vendor has a pattern, not a habit, and flagging it would be
 * noise dressed up as insight.
 */
export const BASELINE_MIN_SAMPLE = 4;

/** An invoice number split into a comparable series position and its format. */
export type InvoiceNumber = {
  /** Everything before the trailing digits ("2026-", "INV"). */
  prefix: string;
  /** The numeric part, as a number. */
  value: number;
  /** Zero-padding of the original, so a gap can be rendered back the way the vendor writes it. */
  width: number;
  raw: string;
};

export type VendorBaseline = {
  vendorKey: string;
  /** Invoices behind these statistics. */
  sampleSize: number;
  /** Ascending totals. */
  amounts: number[];
  medianTotal: number;
  /** Median absolute deviation from the median: the spread one normal invoice sits inside. */
  amountMad: number;
  minTotal: number;
  maxTotal: number;
  /** Days between consecutive issue dates, ascending. */
  intervals: number[];
  medianIntervalDays: number;
  /** Days between issue and due date, ascending. */
  terms: number[];
  medianTermDays: number;
  /** The most recent invoice date in the baseline. */
  lastIssueDate: string;
  /** Parseable invoice numbers, ascending by series position. */
  numbers: InvoiceNumber[];
  /** The highest parseable invoice number seen so far, for gap detection. */
  lastNumber?: InvoiceNumber | undefined;
  /** Share of past totals that are whole hundreds (0..1). */
  roundShare: number;
  /** How many times the most common total has been billed. */
  repeatedAmountCount: number;
};

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

export function medianAbsoluteDeviation(values: number[], center: number): number {
  if (values.length === 0) return 0;
  return median(values.map((value) => Math.abs(value - center)));
}

/** Whole days from one ISO date to another; NaN-safe. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return Number.NaN;
  return Math.round((end - start) / 86_400_000);
}

/**
 * Splits an invoice number into a series position, so gaps in a sequence can be
 * counted. Numbers that carry no usable series ("rect-01", a UUID, a year-only
 * reference) return undefined: a hole in a series nobody can count is not
 * evidence of anything.
 */
export function parseInvoiceNumber(raw: string): InvoiceNumber | undefined {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.*?)(\d+)$/);
  if (!match) return undefined;
  const digits = match[2] ?? "";
  // A series needs at least two positions to have a step. One trailing digit
  // is a part number or a date, not a position in a sequence.
  if (digits.length < 2) return undefined;
  // A bare year is a period, not a position: 2026 says when, not which.
  if (match[1] === "" && digits.length === 4) return undefined;
  return {
    prefix: match[1] ?? "",
    value: Number(digits),
    width: digits.length,
    raw: trimmed,
  };
}

/** Renders a series position the way the vendor writes it. */
export function formatInvoiceNumber(template: InvoiceNumber, value: number): string {
  return `${template.prefix}${String(value).padStart(template.width, "0")}`;
}

/**
 * A whole-hundreds total. Round amounts are ordinary for some vendors (a
 * standing order, a fixed retainer) and remarkable for others, so this only
 * ever means something next to a vendor's own history.
 */
export function isRoundAmount(total: number): boolean {
  return total > 0 && Number.isFinite(total) && total % 100 === 0;
}

/** The total this vendor bills most often, and how many times it appears. */
function mostRepeatedAmount(amounts: number[]): { amount: number; count: number } {
  const counts = new Map<number, number>();
  for (const amount of amounts) {
    counts.set(amount, (counts.get(amount) ?? 0) + 1);
  }
  let best = { amount: 0, count: 0 };
  for (const [amount, count] of counts) {
    if (count > best.count) best = { amount, count };
  }
  return best;
}

function chronological(invoices: Invoice[]): Invoice[] {
  return [...invoices].sort((a, b) => {
    if (a.issueDate !== b.issueDate) return a.issueDate < b.issueDate ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

/**
 * Learns one vendor's baseline from the invoices it is given. Returns
 * undefined for an empty set — a baseline over nothing is not a small baseline,
 * it is a wrong answer waiting to flag an invoice.
 */
export function buildVendorBaseline(
  vendorKey: string,
  invoices: Invoice[],
): VendorBaseline | undefined {
  const ordered = chronological(invoices);
  if (ordered.length === 0) return undefined;

  const amounts = ordered.map((invoice) => invoice.total).filter((total) => total > 0);
  const medianTotal = median(amounts);
  const intervals: number[] = [];
  const terms: number[] = [];
  const numbers: InvoiceNumber[] = [];

  for (const [index, invoice] of ordered.entries()) {
    const term = daysBetween(invoice.issueDate, invoice.dueDate);
    if (!Number.isNaN(term) && term >= 0) terms.push(term);
    const parsed = parseInvoiceNumber(invoice.invoiceNumber);
    if (parsed) numbers.push(parsed);
    const previous = index > 0 ? ordered[index - 1] : undefined;
    if (!previous) continue;
    const gap = daysBetween(previous.issueDate, invoice.issueDate);
    if (!Number.isNaN(gap) && gap > 0) intervals.push(gap);
  }

  const last = ordered[ordered.length - 1]!;
  const series = [...numbers].sort((a, b) => a.value - b.value);
  const highest = series[series.length - 1];
  const repeated = mostRepeatedAmount(amounts);

  return {
    vendorKey,
    sampleSize: ordered.length,
    amounts,
    medianTotal,
    amountMad: medianAbsoluteDeviation(amounts, medianTotal),
    minTotal: amounts.length > 0 ? Math.min(...amounts) : 0,
    maxTotal: amounts.length > 0 ? Math.max(...amounts) : 0,
    intervals,
    medianIntervalDays: median(intervals),
    terms,
    medianTermDays: median(terms),
    lastIssueDate: last.issueDate,
    numbers: series,
    lastNumber: highest,
    roundShare: amounts.length > 0 ? amounts.filter(isRoundAmount).length / amounts.length : 0,
    repeatedAmountCount: repeated.count,
  };
}

/**
 * Baselines for every vendor in a corpus, keyed by the same vendor identity the
 * duplicate detector uses, so "KPN" and "KPN B.V." share one history.
 */
export function buildVendorBaselines(
  corpus: Invoice[],
  profiles: Record<string, VendorProfile> = {},
): Map<string, VendorBaseline> {
  const grouped = new Map<string, Invoice[]>();
  for (const invoice of corpus) {
    const key = resolveVendorIdentity(invoice, profiles);
    grouped.set(key, [...(grouped.get(key) ?? []), invoice]);
  }
  const baselines = new Map<string, VendorBaseline>();
  for (const [key, invoices] of grouped) {
    const baseline = buildVendorBaseline(key, invoices);
    if (baseline) baselines.set(key, baseline);
  }
  return baselines;
}
