/**
 * Extraction eval — scoring. Pure, no runtime APIs.
 *
 * A fixture is a labeled invoice: the *expected* field values a human would
 * enter, plus the inputs the extraction pipeline needs. The runner produces
 * *predicted* values; this module compares them per field.
 *
 * Outcome per field:
 *   correct    — expected + predicted + comparator passes      (true positive)
 *   wrong      — expected + predicted + comparator fails       (false positive and false negative)
 *   missing    — expected, not predicted                       (false negative)
 *   unexpected — predicted, not expected                       (false positive)
 *   absent     — neither expected nor predicted                (not scored)
 *
 * precision = correct / (correct + wrong + unexpected)
 * recall    = correct / (correct + wrong + missing)
 *
 * A wrong value counts as both a false positive and a false negative, the
 * standard treatment when a value is present but incorrect.
 */
import { ZONE_FIELDS, type ExtractedField } from "../types";

/** Fields scored per fixture. `currency` rides alongside the zone fields. */
export type ScoredField = ExtractedField | "currency";

export const SCORED_FIELDS: ScoredField[] = [...ZONE_FIELDS, "currency"];

export type FieldValues = Partial<Record<ScoredField, string | number>>;

export type FieldOutcome = "correct" | "wrong" | "missing" | "unexpected" | "absent";

export type Counts = {
  correct: number;
  wrong: number;
  missing: number;
  unexpected: number;
};

const AMOUNT_FIELDS = new Set<ScoredField>(["subtotal", "tax", "total"]);
const AMOUNT_TOLERANCE = 0.01;

/** Legal-form suffixes stripped before comparing vendor names. */
const LEGAL_SUFFIXES =
  /\b(?:b\.?v\.?|n\.?v\.?|llc|ltd|limited|inc|gmbh|ug|corp|corporation|co|company)\b/g;

export function isPresent(value: string | number | undefined | null): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return value.trim() !== "";
}

function normalizeText(value: string | number): string {
  return String(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeVendor(value: string | number): string {
  return normalizeText(value).replace(LEGAL_SUFFIXES, " ").replace(/\s+/g, " ").trim();
}

function normalizeReference(value: string | number): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function toAmount(value: string | number): number {
  if (typeof value === "number") return value;
  return Number(String(value).replace(/[^\d.-]/g, ""));
}

/** Field-aware comparison. Vendors ignore legal forms, references ignore separators. */
export function fieldsMatch(
  field: ScoredField,
  expected: string | number,
  actual: string | number,
): boolean {
  if (AMOUNT_FIELDS.has(field)) {
    const e = toAmount(expected);
    const a = toAmount(actual);
    return Number.isFinite(e) && Number.isFinite(a) && Math.abs(e - a) <= AMOUNT_TOLERANCE;
  }
  if (field === "currency") {
    return String(expected).trim().toUpperCase() === String(actual).trim().toUpperCase();
  }
  if (field === "vendor") {
    const e = normalizeVendor(expected);
    const a = normalizeVendor(actual);
    return Boolean(e) && Boolean(a) && (e === a || e.includes(a) || a.includes(e));
  }
  if (field === "invoiceNumber") {
    return normalizeReference(expected) === normalizeReference(actual);
  }
  return normalizeText(expected) === normalizeText(actual);
}

export type FieldFailure = {
  field: ScoredField;
  outcome: Exclude<FieldOutcome, "correct" | "absent">;
  expected: string | number;
  actual: string | number | undefined;
};

export type FixtureScore = {
  outcomes: Partial<Record<ScoredField, FieldOutcome>>;
  counts: Counts;
  failures: FieldFailure[];
};

export function scoreFixture(expected: FieldValues, predicted: FieldValues): FixtureScore {
  const outcomes: Partial<Record<ScoredField, FieldOutcome>> = {};
  const counts: Counts = { correct: 0, wrong: 0, missing: 0, unexpected: 0 };
  const failures: FieldFailure[] = [];

  for (const field of SCORED_FIELDS) {
    const e = expected[field];
    const a = predicted[field];
    const ePresent = isPresent(e);
    const aPresent = isPresent(a);

    let outcome: FieldOutcome;
    if (!ePresent && !aPresent) outcome = "absent";
    else if (ePresent && !aPresent) outcome = "missing";
    else if (!ePresent && aPresent) outcome = "unexpected";
    else
      outcome = fieldsMatch(field, e as string | number, a as string | number)
        ? "correct"
        : "wrong";

    outcomes[field] = outcome;
    if (outcome === "absent") continue;
    counts[outcome] += 1;
    if (outcome !== "correct") {
      failures.push({
        field,
        outcome,
        expected: e as string | number,
        actual: a,
      });
    }
  }

  return { outcomes, counts, failures };
}

export type Metrics = Counts & {
  precision: number;
  recall: number;
  f1: number;
  /** Number of expected fields — the denominator for recall. */
  support: number;
};

export function mergeCounts(a: Counts, b: Counts): Counts {
  return {
    correct: a.correct + b.correct,
    wrong: a.wrong + b.wrong,
    missing: a.missing + b.missing,
    unexpected: a.unexpected + b.unexpected,
  };
}

export const EMPTY_COUNTS: Counts = { correct: 0, wrong: 0, missing: 0, unexpected: 0 };

export function computeMetrics(counts: Counts): Metrics {
  const { correct, wrong, missing, unexpected } = counts;
  const precisionDen = correct + wrong + unexpected;
  const recallDen = correct + wrong + missing;
  const precision = precisionDen === 0 ? 1 : correct / precisionDen;
  const recall = recallDen === 0 ? 1 : correct / recallDen;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { ...counts, precision, recall, f1, support: recallDen };
}

export type FixtureResult = {
  id: string;
  source: FixtureSource;
  score: FixtureScore;
};

export type FixtureSource = "heuristic" | "vlm" | "template";

export type EvaluationReport = {
  fixtureCount: number;
  checkCount: number;
  overall: Metrics;
  bySource: Array<{ source: FixtureSource } & Metrics>;
  byField: Array<{ field: ScoredField } & Metrics>;
  results: FixtureResult[];
};

export function buildReport(results: FixtureResult[]): EvaluationReport {
  let overallCounts: Counts = EMPTY_COUNTS;
  const sourceCounts = new Map<FixtureSource, Counts>();
  const fieldCounts = new Map<ScoredField, Counts>();
  let checkCount = 0;

  for (const result of results) {
    overallCounts = mergeCounts(overallCounts, result.score.counts);
    sourceCounts.set(
      result.source,
      mergeCounts(sourceCounts.get(result.source) ?? EMPTY_COUNTS, result.score.counts),
    );
    for (const field of SCORED_FIELDS) {
      const outcome = result.score.outcomes[field];
      if (outcome === undefined || outcome === "absent") continue;
      checkCount += 1;
      const fieldCount: Counts = { correct: 0, wrong: 0, missing: 0, unexpected: 0 };
      fieldCount[outcome] = 1;
      fieldCounts.set(field, mergeCounts(fieldCounts.get(field) ?? EMPTY_COUNTS, fieldCount));
    }
  }

  return {
    fixtureCount: results.length,
    checkCount,
    overall: computeMetrics(overallCounts),
    bySource: [...sourceCounts.entries()].map(([source, counts]) => ({
      source,
      ...computeMetrics(counts),
    })),
    byField: SCORED_FIELDS.filter((field) => fieldCounts.has(field)).map((field) => ({
      field,
      ...computeMetrics(fieldCounts.get(field)!),
    })),
    results,
  };
}

const pct = (value: number) => value.toFixed(2);
const pad = (value: string, width: number) => value.padEnd(width);

function metricLine(label: string, width: number, metrics: Metrics): string {
  return (
    `${pad(label, width)}  ` +
    `P ${pct(metrics.precision)}  R ${pct(metrics.recall)}  F1 ${pct(metrics.f1)}  ` +
    `(TP ${metrics.correct} · FP ${metrics.wrong + metrics.unexpected} · FN ${metrics.wrong + metrics.missing} · n ${metrics.support})`
  );
}

/** Renders the report as plain text for the console / CI log. */
export function formatReport(report: EvaluationReport): string {
  const lines: string[] = [];
  lines.push(
    `Extraction eval — ${report.fixtureCount} fixtures, ${report.checkCount} field checks`,
  );
  lines.push("");
  lines.push(metricLine("overall", 10, report.overall));

  lines.push("");
  lines.push("by source");
  for (const source of report.bySource) {
    lines.push(`  ${metricLine(source.source, 9, source)}`);
  }

  lines.push("");
  lines.push("by field");
  for (const field of report.byField) {
    lines.push(`  ${metricLine(field.field, 13, field)}`);
  }

  const failures = report.results.flatMap((result) =>
    result.score.failures.map((failure) => ({ id: result.id, ...failure })),
  );
  if (failures.length > 0) {
    lines.push("");
    lines.push(`failures (${failures.length})`);
    for (const failure of failures) {
      lines.push(
        `  ${pad(failure.id, 28)} ${pad(failure.field, 13)} ` +
          `${failure.outcome}: expected ${JSON.stringify(failure.expected)}, got ${
            failure.actual === undefined ? "—" : JSON.stringify(failure.actual)
          }`,
      );
    }
  }

  return lines.join("\n");
}
