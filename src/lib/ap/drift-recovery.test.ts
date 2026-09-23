import { describe, expect, it } from "bun:test";
import {
  applyDriftReads,
  extractFieldsFromPages,
  recoverFieldsFromText,
  type PageRead,
} from "./ocr";

const page = (text: string): PageRead => ({ pageNumber: 1, text, confidence: 0.95 });

const NORTHWIND_PAGE = page(
  [
    "Northwind Services B.V.",
    "Factuurnummer: NW-20481",
    "Factuurdatum: 12-04-2026",
    "Totaal te betalen 1.210,00",
  ].join("\n"),
);

describe("recoverFieldsFromText", () => {
  it("recovers the drifted fields the text scan can read", () => {
    const reads = recoverFieldsFromText([NORTHWIND_PAGE], "northwind-20481.pdf", [
      "invoiceNumber",
      "total",
      "dueDate",
    ]);
    expect(reads.invoiceNumber?.value).toBe("NW-20481");
    expect(reads.total?.value).toBe(1210);
    // No due date on the page, so it stays unrecovered.
    expect(reads.dueDate).toBeUndefined();
  });

  it("does not treat the file-name vendor fallback as a read", () => {
    const noVendorLine = page(["Factuur", "BTW NR 123", "€ 10,00"].join("\n"));
    // The extractor still reports a vendor (the file name), but it is a
    // placeholder, so recovery must not count it as a read.
    expect(extractFieldsFromPages([noVendorLine], "unreadable-scan.pdf").vendor).toBeDefined();
    const reads = recoverFieldsFromText([noVendorLine], "unreadable-scan.pdf", ["vendor"]);
    expect(reads.vendor).toBeUndefined();
  });

  it("does no work when nothing is missing", () => {
    expect(recoverFieldsFromText([NORTHWIND_PAGE], "northwind.pdf", [])).toEqual({});
  });
});

describe("applyDriftReads", () => {
  const base = {
    fields: { vendor: "Northwind Services B.V.", subtotal: 1000 },
    confidence: { vendor: 0.9, subtotal: 0.8 },
    fieldSources: { vendor: 1, subtotal: 1 },
  };

  it("writes recovered reads and records which reader supplied each", () => {
    const merged = applyDriftReads({
      ...base,
      missing: ["invoiceNumber", "total"],
      reads: {
        invoiceNumber: { value: "NW-20481", confidence: 0.85, page: 1 },
        total: { value: 1210, confidence: 0.9, page: 1 },
      },
      source: "ocr",
    });

    expect(merged.fields.invoiceNumber).toBe("NW-20481");
    expect(merged.fields.total).toBe(1210);
    expect(merged.confidence.invoiceNumber).toBe(0.85);
    expect(merged.fieldSources.total).toBe(1);
    expect(merged.recoveredBy).toEqual({ invoiceNumber: "ocr", total: "ocr" });
    expect(merged.stillMissing).toEqual([]);
  });

  it("leaves fields with no read missing for the next reader", () => {
    const merged = applyDriftReads({
      ...base,
      missing: ["invoiceNumber", "total"],
      reads: { invoiceNumber: { value: "NW-20481", confidence: 0.85, page: 1 } },
      source: "vlm",
    });

    expect(merged.fields.total).toBeUndefined();
    expect(merged.recoveredBy).toEqual({ invoiceNumber: "vlm" });
    expect(merged.stillMissing).toEqual(["total"]);
  });

  it("preserves the template values it did read", () => {
    const merged = applyDriftReads({
      ...base,
      missing: ["invoiceNumber"],
      reads: {},
      source: "ocr",
    });

    expect(merged.fields.vendor).toBe("Northwind Services B.V.");
    expect(merged.fields.subtotal).toBe(1000);
    expect(merged.stillMissing).toEqual(["invoiceNumber"]);
  });

  it("ignores reads for fields that were not missing", () => {
    const merged = applyDriftReads({
      ...base,
      missing: ["invoiceNumber"],
      reads: { total: { value: 9999, confidence: 0.9, page: 1 } },
      source: "ocr",
    });

    expect(merged.fields.total).toBeUndefined();
    expect(merged.recoveredBy).toEqual({});
  });
});
