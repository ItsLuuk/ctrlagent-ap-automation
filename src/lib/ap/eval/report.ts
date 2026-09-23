/**
 * Extraction eval — CLI entry point.
 *
 * Run with: `bun src/lib/ap/eval/report.ts`
 *
 * The same report is printed by `eval.test.ts`; this entry is for eyeballing
 * metrics without going through the test runner.
 */
import { formatReport } from "./score";
import { runFixtures } from "./run";

if (import.meta.main) {
  console.log(formatReport(runFixtures()));
}
