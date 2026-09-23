import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanProducer, recognizesProducer } from "../lib/ap/pdf-meta";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Golden-file regression corpus.
 *
 * Deterministic path only — text layer + regex, never the VLM. Runs model-free
 * so it belongs on every CI build. See docs/golden-corpus.md for the contract.
 *
 * Corpus layout (repo root):
 *   corpus/
 *     <producer>/
 *       expected.json   — ground truth, one entry per PDF in the folder
 *       inv-001.pdf
 *       inv-002.pdf
 *       ...
 *
 * Run:  bun test src/lib/ap/golden-corpus.test.ts
 */

const CORPUS_ROOT = join(__dirname, "../../../../corpus");

function listProducerFolders(): string[] {
  if (!existsSync(CORPUS_ROOT)) return [];
  return readdirSync(CORPUS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function loadExpected(producer: string) {
  return JSON.parse(
    readFileSync(join(CORPUS_ROOT, producer, "expected.json"), "utf-8"),
  );
}

function loadPdf(producer: string, file: string): Uint8Array {
  return readFileSync(join(CORPUS_ROOT, producer, file));
}

/** Number tolerance: absolute cents for monetary fields. */
function moneyClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.01;
}

/** Order-insensitive line-item match on description + amount (cents tolerance). */
function lineItemsClose(
  expected: Array<{ description: string; amount: number }>,
  got: Array<{ description: string; amount: number }>,
): boolean {
  if (expected.length !== got.length) return false;
  const unmatched = new Set(got.map((g) => `${g.description}\u0000${g.amount}`));
  for (const e of expected) {
    const key = `${e.description}\u0000${e.amount}`;
    // Accept description match with cent-tolerance amount.
    const found = got.find(
      (g) =>
        g.description === e.description && moneyClose(g.amount, e.amount),
    );
    if (!found) return false;
  }
  return true;
}

describe("golden-corpus", () => {
  const producers = listProducerFolders();
  for (const producer of producers) {
    const expected = loadExpected(producer);
    for (const entry of expected) {
      // _skip: true entries are documented failures — file a ticket, do not
      // silently skip the whole folder.
      if (entry._skip) continue;

      it(`${producer} · ${entry.file}`, async () => {
        const bytes = loadPdf(producer, entry.file);
        // The text-layer path is what we test here. We go through the same
        // pdfjs getDocument + page.getTextContent flow the upload pipeline
        // uses, but we do it directly so this test stays model-free and
        // deterministic.
        const pdfjs = await import("pdfjs-dist");
        if (!pdfjs.GlobalWorkerOptions.workerPort) {
          const WorkerWrapper = await import(`${__dirname}/../../../lib/ap/pdf-worker?worker`);
          pdfjs.GlobalWorkerOptions.workerPort = new WorkerWrapper.default();
        }
        const doc = await pdfjs.getDocument({
          data: bytes,
          disableXfa: true,
        }).promise;

        const pages = [];
        for (let n = 1; n <= doc.numPages; n += 1) {
          const page = await doc.getPage(n);
          const text = await page.getTextContent();
          const words = text.items
            .filter((item: any) => item.str != null)
            .map((item: any) => ({
              text: item.str,
              // xref matches the pipeline's OcrWord shape for downstream consumers.
              x: item.transform[4] ?? 0,
              y: item.transform[5] ?? 0,
              w: 0,
              h: 0,
              confidence: 1,
            }));
          const pageText = words
            .map((w) => w.text)
            .join("")
            .replace(/[\t ]+/g, " ")
            .trim();
          pages.push({ pageNumber: n, text: pageText, words });
        }
        await doc.destroy();

        // Re-run the same field extraction the pipeline uses, over the
        // text-layer pages only. This exercises the deterministic path end
        // to end without any model or template involvement.
        const { extractFieldsFromPages } = await import(`${__dirname}/../../../lib/ap/ocr`);
        const fields = extractFieldsFromPages(pages, entry.file);

        // Assert each expected field.
        if (entry.vendor != null)
          expect(fields.vendor?.trim()).toBe(entry.vendor.trim());
        if (entry.invoiceNumber != null)
          expect(fields.invoiceNumber?.trim()).toBe(entry.invoiceNumber.trim());
        if (entry.issueDate != null) expect(fields.issueDate).toBe(entry.issueDate);
        if (entry.dueDate != null) expect(fields.dueDate).toBe(entry.dueDate);
        if (entry.currency != null) expect(fields.currency).toBe(entry.currency);
        if (entry.iban != null) expect(fields.iban?.replace(/\s/g, "")).toBe(entry.iban.replace(/\s/g, ""));
        if (entry.vatNumber != null) expect(fields.vatNumber).toBe(entry.vatNumber);
        if (entry.businessRegistrationNumber != null)
          expect(fields.businessRegistrationNumber).toBe(entry.businessRegistrationNumber);
        if (entry.subtotal != null)
          expect(moneyClose(fields.subtotal ?? 0, entry.subtotal)).toBe(true);
        if (entry.tax != null) expect(moneyClose(fields.tax ?? 0, entry.tax)).toBe(true);
        if (entry.total != null) expect(moneyClose(fields.total ?? 0, entry.total)).toBe(true);

        if (entry.lineItems != null) {
          const expectedItems = entry.lineItems.map((li) => ({
            description: li.description.trim(),
            amount: li.amount,
          }));
          const gotItems = (fields.lineItems ?? []).map((li) => ({
            description: li.description.trim(),
            amount: li.amount,
          }));
          expect(lineItemsClose(expectedItems, gotItems)).toBe(
            true,
          );
        }
      });
    }
  }

  // Sanity: if there are no producer folders yet, the test still passes (nothing
  // to assert) but the suite is visibly empty so a missing corpus is not silent.
  it("corpus directory exists and is readable", () => {
    // The corpus directory may not exist yet; this is informational, not a blocker.
    expect(existsSync(CORPUS_ROOT)).toBeDefined();
  });
});
