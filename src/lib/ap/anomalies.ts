/**
 * Continuous anomaly monitoring — every open invoice, measured against what its
 * vendor normally sends.
 *
 * This is a domain rule, not a model call: the baselines are robust statistics
 * over the vendor's own history, and every finding carries the numbers it was
 * derived from, because "this looks wrong" is not something anyone can act on
 * while "3.8× the €1,240 median across 7 earlier invoices" is.
 *
 * The scan is chronological and leaves one out. Each invoice is judged only
 * against the invoices that arrived before it, so a wrong invoice cannot pull
 * the line that judges it, and replaying a corpus from the beginning reproduces
 * exactly what each invoice would have been told at the time. That is what makes
 * the check continuous rather than a one-off pass at capture: it re-runs on the
 * whole corpus whenever the corpus changes, and a vendor's habits move with it.
 *
 * Nothing here blocks a payment. A finding is a question for a human; the
 * auto-approval path deliberately stays untouched so no noisy baseline can stop
 * a correct invoice from being paid.
 */
import { duplicatePeer, resolveVendorIdentity } from "./duplicate-detection";
import { money, type Invoice, type VendorProfile } from "./types";
import {
  BASELINE_MIN_SAMPLE,
  buildVendorBaseline,
  daysBetween,
  formatInvoiceNumber,
  isRoundAmount,
  median,
  parseInvoiceNumber,
  type InvoiceNumber,
  type VendorBaseline,
} from "./vendor-baseline";

export type AnomalyKind =
  "number_gap" | "amount_outlier" | "timing_change" | "benign_duplicate" | "round_amount";

/** `info` explains, `warn` asks for a look, `high` asks before approving. */
export type AnomalySeverity = "info" | "warn" | "high";

export const ANOMALY_LABEL: Record<AnomalyKind, string> = {
  number_gap: "Invoice number gap",
  amount_outlier: "Unusual amount",
  timing_change: "Timing change",
  benign_duplicate: "Recurring duplicate",
  round_amount: "Round amount",
};

export const ANOMALY_SEVERITY_ORDER: Record<AnomalySeverity, number> = {
  high: 0,
  warn: 1,
  info: 2,
};

export type AnomalyFinding = {
  invoiceId: string;
  vendor: string;
  kind: AnomalyKind;
  severity: AnomalySeverity;
  label: string;
  /** The explanation, with the numbers behind it. */
  detail: string;
  /** The baseline this invoice was measured against, for screens that show it. */
  baseline: {
    sampleSize: number;
    medianTotal: number;
  };
};

/**
 * How far an amount has to sit from the median before it stops looking like
 * this vendor's. Expressed as a multiple of the median absolute deviation,
 * which is 3.5 for a modified z-score — the conventional cut, and loose enough
 * that a retainer with a few cents of drift does not flag every month.
 */
const AMOUNT_OUTLIER_SCALE = 3.5;

/**
 * With a perfectly flat history the deviation is zero, so fall back to a
 * relative move: an invoice double or half the usual amount is worth a look
 * even from a vendor whose totals never vary.
 */
const AMOUNT_RELATIVE_FLOOR = 0.5;

/** At this multiple of the median total, an amount is not a variation. */
const AMOUNT_HIGH_MULTIPLE = 3;

/** Payment terms that move by this many days are a change, not a rounding. */
const TERM_SHIFT_DAYS = 7;

/** Arrival cadence outside this multiple of the usual interval is a change. */
const INTERVAL_FLOOR = 0.5;
const INTERVAL_CEILING = 2;

/** Two invoices count as the same amount within this fraction. */
const AMOUNT_TOLERANCE = 0.01;

/**
 * A vendor whose history is mostly round numbers is not remarkable for one, so
 * the round-amount check only applies where it would be news.
 */
const ROUND_SHARE_CEILING = 0.25;

/** How many repeats of a total make a charge recognisably this vendor's. */
const RECURRING_REPEAT_MIN = 3;

function finding(
  invoice: Invoice,
  baseline: VendorBaseline,
  kind: AnomalyKind,
  severity: AnomalySeverity,
  detail: string,
): AnomalyFinding {
  return {
    invoiceId: invoice.id,
    vendor: invoice.vendor,
    kind,
    severity,
    label: ANOMALY_LABEL[kind],
    detail,
    baseline: { sampleSize: baseline.sampleSize, medianTotal: baseline.medianTotal },
  };
}

function sameAmount(left: number, right: number): boolean {
  if (left <= 0 || right <= 0) return left === right;
  return Math.abs(left - right) / Math.max(left, right) <= AMOUNT_TOLERANCE;
}

/** The step this vendor's invoice numbers normally advance by. */
function typicalNumberStep(numbers: InvoiceNumber[], prefix: string): number {
  const series = numbers.filter((number) => number.prefix === prefix);
  const steps: number[] = [];
  for (const [index, number] of series.entries()) {
    const previous = index > 0 ? series[index - 1] : undefined;
    if (!previous) continue;
    const step = number.value - previous.value;
    if (step > 0) steps.push(step);
  }
  const step = steps.length > 0 ? median(steps) : 1;
  return step >= 1 ? Math.round(step) : 1;
}

/**
 * A hole in the vendor's own numbering: numbers between the last one they sent
 * and this one that nobody has ever sent. A common cause is an invoice that was
 * issued and never reached the business, which is a conversation worth having
 * with the vendor rather than a payment error.
 */
function numberGapFinding(invoice: Invoice, baseline: VendorBaseline): AnomalyFinding | undefined {
  const candidate = parseInvoiceNumber(invoice.invoiceNumber);
  const last = baseline.lastNumber;
  if (!candidate || !last || candidate.prefix !== last.prefix) return undefined;

  if (candidate.value < last.value) {
    const behind = last.value - candidate.value;
    return finding(
      invoice,
      baseline,
      "number_gap",
      "warn",
      `Number ${candidate.raw} arrived after ${last.raw} — ${behind} position${
        behind === 1 ? "" : "s"
      } behind this vendor's latest, so ${formatInvoiceNumber(last, last.value)} and up may not have been billed.`,
    );
  }

  const step = typicalNumberStep(baseline.numbers, candidate.prefix);
  const missing = candidate.value - last.value - step;
  if (missing < 1) return undefined;
  const firstMissing = formatInvoiceNumber(last, last.value + step);
  const lastMissing = formatInvoiceNumber(last, candidate.value - 1);
  return finding(
    invoice,
    baseline,
    "number_gap",
    "warn",
    `${missing} invoice number${missing === 1 ? "" : "s"} (${firstMissing}–${lastMissing}) ${
      missing === 1 ? "is" : "are"
    } missing between ${last.raw} and ${candidate.raw}; this vendor advances by ${step}.`,
  );
}

/** A total that no longer resembles what this vendor charges. */
function amountOutlierFinding(
  invoice: Invoice,
  baseline: VendorBaseline,
): AnomalyFinding | undefined {
  if (baseline.medianTotal <= 0) return undefined;
  const deviation = Math.abs(invoice.total - baseline.medianTotal);
  const scale =
    baseline.amountMad > 0 ? baseline.amountMad : baseline.medianTotal * AMOUNT_RELATIVE_FLOOR;
  if (scale <= 0) return undefined;
  if (deviation / scale < AMOUNT_OUTLIER_SCALE) return undefined;

  const multiple = invoice.total / baseline.medianTotal;
  const severity: AnomalySeverity = multiple >= AMOUNT_HIGH_MULTIPLE ? "high" : "warn";
  const direction = multiple >= 1 ? "above" : "below";
  const factor = multiple >= 1 ? multiple : 1 / Math.max(multiple, 0.01);
  return finding(
    invoice,
    baseline,
    "amount_outlier",
    severity,
    `${money(invoice.total, invoice.currency)} is ${factor.toFixed(1)}× ${direction} the ${money(
      baseline.medianTotal,
      invoice.currency,
    )} median of this vendor's ${baseline.sampleSize} earlier invoices.`,
  );
}

/**
 * Timing: when the invoice arrived relative to the vendor's rhythm, and what it
 * asks to be paid in. A vendor that has always paid at 30 days asking for 14 is
 * the one that matters here, so a term change outranks a cadence change.
 */
function timingFinding(
  invoice: Invoice,
  baseline: VendorBaseline,
  previousIssueDate: string | undefined,
): AnomalyFinding | undefined {
  const term = daysBetween(invoice.issueDate, invoice.dueDate);
  if (
    !Number.isNaN(term) &&
    baseline.terms.length >= 2 &&
    baseline.medianTermDays > 0 &&
    Math.abs(term - baseline.medianTermDays) >= TERM_SHIFT_DAYS
  ) {
    return finding(
      invoice,
      baseline,
      "timing_change",
      "high",
      `Due ${term} days after the invoice date; this vendor's last ${baseline.terms.length} invoices ran ${baseline.medianTermDays} days.`,
    );
  }

  if (!previousIssueDate || baseline.intervals.length < 2) return undefined;
  const gap = daysBetween(previousIssueDate, invoice.issueDate);
  const usual = baseline.medianIntervalDays;
  if (Number.isNaN(gap) || gap <= 0 || usual < 3) return undefined;
  if (gap < usual * INTERVAL_FLOOR) {
    return finding(
      invoice,
      baseline,
      "timing_change",
      "warn",
      `Arrived ${gap} days after the previous invoice; this vendor bills about every ${usual} days.`,
    );
  }
  if (gap > usual * INTERVAL_CEILING) {
    return finding(
      invoice,
      baseline,
      "timing_change",
      "warn",
      `Arrived ${gap} days after the previous invoice — longer than this vendor's usual ${usual} days, which often means a catch-up invoice.`,
    );
  }
  return undefined;
}

/**
 * A duplicate signal the vendor's own history accounts for: the same total, at
 * the usual interval, many times over. Saying so is the point — the duplicate
 * check cannot tell a re-sent invoice from a standing order, and the baseline
 * can.
 */
function benignDuplicateFinding(
  invoice: Invoice,
  baseline: VendorBaseline,
  corpus: Invoice[],
  profiles: Record<string, VendorProfile>,
): AnomalyFinding | undefined {
  const peer = duplicatePeer(invoice, corpus, profiles);
  if (!peer || baseline.medianTotal <= 0) return undefined;
  if (baseline.repeatedAmountCount < RECURRING_REPEAT_MIN) return undefined;
  if (!sameAmount(invoice.total, baseline.medianTotal)) return undefined;

  const gap = daysBetween(peer.issueDate, invoice.issueDate);
  const usual = baseline.medianIntervalDays;
  if (usual > 0) {
    if (Number.isNaN(gap)) return undefined;
    if (Math.abs(gap - usual) > Math.max(3, usual * 0.34)) return undefined;
  }

  return finding(
    invoice,
    baseline,
    "benign_duplicate",
    "info",
    `Same ${money(invoice.total, invoice.currency)} as ${baseline.repeatedAmountCount} earlier invoices${
      usual > 0 ? `, about every ${usual} days` : ""
    } — this vendor's standing charge rather than a second billing.`,
  );
}

/** A round total where this vendor's history is not round. */
function roundAmountFinding(
  invoice: Invoice,
  baseline: VendorBaseline,
): AnomalyFinding | undefined {
  if (!isRoundAmount(invoice.total)) return undefined;
  if (baseline.roundShare >= ROUND_SHARE_CEILING) return undefined;
  const percent = Math.round(baseline.roundShare * 100);
  return finding(
    invoice,
    baseline,
    "round_amount",
    "warn",
    `${money(invoice.total, invoice.currency)} is a round number, while ${percent}% of this vendor's last ${baseline.sampleSize} invoices were not.`,
  );
}

function chronological(invoices: Invoice[]): Invoice[] {
  return [...invoices].sort((a, b) => {
    if (a.issueDate !== b.issueDate) return a.issueDate < b.issueDate ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

/**
 * Findings for the invoices still being worked, learned from everything the
 * business has on file.
 *
 * `active` is what gets reported on and `corpus` is what is learned from: a
 * completed invoice still teaches the next one, but only an open one is worth
 * somebody's time today. The caller decides that split, so a screen that wants
 * a retrospective can ask for it by passing the same list twice.
 */
export function scanVendorAnomalies(
  active: Invoice[],
  corpus: Invoice[],
  profiles: Record<string, VendorProfile> = {},
): AnomalyFinding[] {
  const byVendor = new Map<string, Invoice[]>();
  for (const invoice of corpus) {
    const key = resolveVendorIdentity(invoice, profiles);
    byVendor.set(key, [...(byVendor.get(key) ?? []), invoice]);
  }

  const findings: AnomalyFinding[] = [];
  for (const invoice of active) {
    const key = resolveVendorIdentity(invoice, profiles);
    const siblings = chronological(byVendor.get(key) ?? [invoice]);
    const index = siblings.findIndex((candidate) => candidate.id === invoice.id);
    const prior =
      index >= 0 ? siblings.slice(0, index) : siblings.filter((c) => c.id !== invoice.id);
    // A vendor with fewer invoices than this has no habit to measure against.
    if (prior.length < BASELINE_MIN_SAMPLE) continue;

    const baseline = buildVendorBaseline(key, prior);
    if (!baseline) continue;
    const previousIssueDate = prior[prior.length - 1]?.issueDate;

    const candidates = [
      amountOutlierFinding(invoice, baseline),
      numberGapFinding(invoice, baseline),
      timingFinding(invoice, baseline, previousIssueDate),
      roundAmountFinding(invoice, baseline),
      benignDuplicateFinding(invoice, baseline, corpus, profiles),
    ];
    for (const candidate of candidates) {
      if (candidate) findings.push(candidate);
    }
  }

  return findings.sort(
    (a, b) =>
      ANOMALY_SEVERITY_ORDER[a.severity] - ANOMALY_SEVERITY_ORDER[b.severity] ||
      a.invoiceId.localeCompare(b.invoiceId),
  );
}

/** The kinds found for one invoice, in the order they were reported. */
export function anomalyKindsFor(findings: AnomalyFinding[], invoiceId: string): AnomalyKind[] {
  return findings.filter((entry) => entry.invoiceId === invoiceId).map((entry) => entry.kind);
}
