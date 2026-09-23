import { describe, expect, it } from "bun:test";
import { FIXTURES } from "./fixtures";
import { runFixtures } from "./run";
import { formatReport } from "./score";

/**
 * Baseline floors. These are the *current* measured accuracy, set just below
 * the observed values so an extraction regression fails loudly. Raise them as
 * extraction improves — never lower them to make a red test green.
 */
const OVERALL_PRECISION_FLOOR = 0.95;
const OVERALL_RECALL_FLOOR = 0.9;
const HIGH_VALUE_FIELD_RECALL_FLOOR = 0.85;

const report = runFixtures();

describe("extraction eval", () => {
  it("scores every fixture", () => {
    console.log(`\n${formatReport(report)}\n`);
    expect(report.fixtureCount).toBe(FIXTURES.length);
    expect(report.checkCount).toBeGreaterThan(0);
  });

  it("exercises all three extraction sources", () => {
    const sources = report.bySource.map((entry) => entry.source).sort();
    expect(sources).toEqual(["heuristic", "template", "vlm"]);
  });

  it("holds the overall precision/recall baseline", () => {
    expect(report.overall.precision).toBeGreaterThanOrEqual(OVERALL_PRECISION_FLOOR);
    expect(report.overall.recall).toBeGreaterThanOrEqual(OVERALL_RECALL_FLOOR);
  });

  it("keeps high-value identity fields readable", () => {
    for (const field of ["vendor", "invoiceNumber", "total"] as const) {
      const metrics = report.byField.find((entry) => entry.field === field);
      expect(metrics).toBeDefined();
      expect(metrics!.recall).toBeGreaterThanOrEqual(HIGH_VALUE_FIELD_RECALL_FLOOR);
    }
  });

  it("reads the happy-path fixtures without errors", () => {
    for (const id of [
      "heuristic/nl-standard",
      "template/clean",
      "vlm/clean",
      "vlm/dutch-decimal-strings",
      "vlm/european-amounts-with-symbols",
    ] as const) {
      const result = report.results.find((entry) => entry.id === id);
      expect(result).toBeDefined();
      const { wrong, missing, unexpected } = result!.score.counts;
      expect({ id, wrong, missing, unexpected }).toEqual({
        id,
        wrong: 0,
        missing: 0,
        unexpected: 0,
      });
    }
  });
});
