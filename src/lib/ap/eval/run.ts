/**
 * Extraction eval — runner.
 *
 * Drives each fixture through the *real* deterministic stage of the pipeline
 * it exercises, then scores the result. Browser-only stages (canvas
 * preprocessing, Tesseract, the Ollama/llama HTTP call) are out of scope: the
 * fixtures carry the OCR text / raw model JSON those stages would have
 * produced, so the parsing and field-mapping code under test is the same code
 * the app runs.
 */
import { extractFieldsFromPages } from "../ocr";
import { gemmaToFields, mergeGemmaPages, parseGemmaPage } from "../../ai/gemma";
import { applyTemplateField } from "../template-apply";
import type { AnchorSpec, ZoneField } from "../types";
import {
  SCORED_FIELDS,
  buildReport,
  scoreFixture,
  type EvaluationReport,
  type FieldValues,
  type FixtureSource,
} from "./score";
import { FIXTURES, type Fixture } from "./fixtures";

type HeuristicFixture = Extract<Fixture, { source: "heuristic" }>;
type VlmFixture = Extract<Fixture, { source: "vlm" }>;
type TemplateFixture = Extract<Fixture, { source: "template" }>;

/** Copies only present values — empty/undefined fields stay unset. */
function collect(
  source: Partial<Record<(typeof SCORED_FIELDS)[number], string | number | undefined>>,
): FieldValues {
  const out: FieldValues = {};
  for (const field of SCORED_FIELDS) {
    const value = source[field];
    if (value !== undefined) out[field] = value;
  }
  return out;
}

function predictHeuristic(fixture: HeuristicFixture): FieldValues {
  const fields = extractFieldsFromPages(fixture.pages, fixture.fileName);
  return collect({
    vendor: fields.vendor,
    invoiceNumber: fields.invoiceNumber,
    issueDate: fields.issueDate,
    dueDate: fields.dueDate,
    subtotal: fields.subtotal,
    tax: fields.tax,
    total: fields.total,
    currency: fields.currency,
  });
}

function predictVlm(fixture: VlmFixture): FieldValues {
  const merged = mergeGemmaPages(fixture.rawPages.map(parseGemmaPage));
  const fields = gemmaToFields(merged);
  return collect({
    vendor: fields.vendor,
    invoiceNumber: fields.invoiceNumber,
    issueDate: fields.issueDate,
    dueDate: fields.dueDate,
    subtotal: fields.subtotal,
    tax: fields.tax,
    total: fields.total,
    currency: fields.currency,
  });
}

function predictTemplate(fixture: TemplateFixture): FieldValues {
  const out: FieldValues = {};
  for (const [field, spec] of Object.entries(fixture.specs) as [
    ZoneField,
    AnchorSpec | undefined,
  ][]) {
    if (!spec) continue;
    const hit = applyTemplateField(fixture.words, spec, field);
    if (hit !== undefined) out[field] = hit.value;
  }
  return out;
}

/** Runs one fixture through the stage it labels and returns predicted values. */
export function predict(fixture: Fixture): FieldValues {
  if (fixture.source === "heuristic") return predictHeuristic(fixture);
  if (fixture.source === "vlm") return predictVlm(fixture);
  return predictTemplate(fixture);
}

/** Scores every fixture and aggregates into the report. */
export function runFixtures(fixtures: Fixture[] = FIXTURES): EvaluationReport {
  const results = fixtures.map((fixture) => ({
    id: fixture.id,
    source: fixture.source as FixtureSource,
    score: scoreFixture(fixture.expected, predict(fixture)),
  }));
  return buildReport(results);
}
