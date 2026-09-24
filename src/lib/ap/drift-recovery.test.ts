import { describe, expect, it } from "bun:test";
import {
  applyDriftReads,
  extractFieldsFromPages,
  recoverFieldsFromText,
  mergeVlmResult,
  type PageRead,
} from "./ocr";

const page = (text: string): PageRead => ({ pageNumber: 1, text });

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
    ], undefined);
    expect(reads.invoiceNumber?.value).toBe("NW-20481");
    expect(reads.invoiceNumber?.provenance).toBe("read");
    expect(reads.total?.value).toBe(1210);
    expect(reads.total?.provenance).toBe("read");
    // No due date on the page, so it stays unrecovered.
    expect(reads.dueDate).toBeUndefined();
  });

  it("does not treat the file-name vendor fallback as a read", () => {
    const noVendorLine = page(["Factuur", "BTW NR 123", "€ 10,00"].join("\n"));
    // The extractor still reports a vendor (the file name), but it is a
    // placeholder, so recovery must not count it as a read.
    expect(extractFieldsFromPages([noVendorLine], "unreadable-scan.pdf").vendor).toBeDefined();
    const reads = recoverFieldsFromText(
      [noVendorLine],
      "unreadable-scan.pdf",
      ["vendor"],
      undefined,
    );
    expect(reads.vendor).toBeUndefined();
  });

  it("does no work when nothing is missing", () => {
    expect(recoverFieldsFromText([NORTHWIND_PAGE], "northwind.pdf", [], undefined)).toEqual({});
  });
});

describe("applyDriftReads", () => {
  const base = {
    fields: { vendor: "Northwind Services B.V.", subtotal: 1000 },
    provenance: { vendor: "read" as const, subtotal: "read" as const },
    fieldSources: { vendor: 1, subtotal: 1 },
  };

  it("writes recovered reads and records which reader supplied each", () => {
    const merged = applyDriftReads({
      ...base,
      missing: ["invoiceNumber", "total"],
      reads: {
        invoiceNumber: { value: "NW-20481", provenance: "read", page: 1 },
        total: { value: 1210, provenance: "read", page: 1 },
      },
      source: "ocr-fallback",
    });

    expect(merged.fields.invoiceNumber).toBe("NW-20481");
    expect(merged.fields.total).toBe(1210);
    expect(merged.provenance.invoiceNumber).toBe("read");
    expect(merged.fieldSources.total).toBe(1);
    expect(merged.recoveredBy).toEqual({
      invoiceNumber: "ocr-fallback",
      total: "ocr-fallback",
    });
    expect(merged.stillMissing).toEqual([]);
  });

  it("preserves template provenance while recording recovered provenance", () => {
    const merged = applyDriftReads({
      fields: { vendor: "Northwind Services B.V.", subtotal: 1000 },
      provenance: { vendor: "exact", subtotal: "derived" },
      fieldSources: { vendor: 1, subtotal: 1 },
      missing: ["invoiceNumber", "total"],
      reads: {
        invoiceNumber: { value: "NW-20481", provenance: "read", page: 1 },
        total: { value: 1210, provenance: "derived", page: 1 },
      },
      source: "ocr-fallback",
    });

    expect(merged.provenance).toEqual({
      vendor: "exact",
      subtotal: "derived",
      invoiceNumber: "read",
      total: "derived",
    });
    expect(merged.recoveredBy).toEqual({
      invoiceNumber: "ocr-fallback",
      total: "ocr-fallback",
    });
  });

  it("leaves fields with no read missing for the next reader", () => {
    const merged = applyDriftReads({
      ...base,
      missing: ["invoiceNumber", "total"],
      reads: { invoiceNumber: { value: "NW-20481", provenance: "read", page: 1 } },
      source: "vlm",
    });

    expect(merged.fields.total).toBeUndefined();
    expect(merged.recoveredBy).toEqual({ invoiceNumber: "vlm" });
    expect(merged.stillMissing).toEqual(["total"]);
  });

  it("uses source-appropriate provenance when a read omits it", () => {
    const text = applyDriftReads({
      ...base,
      missing: ["invoiceNumber"],
      reads: { invoiceNumber: { value: "NW-20481", page: 1 } },
      source: "ocr-fallback",
    });
    const model = applyDriftReads({
      ...base,
      missing: ["invoiceNumber"],
      reads: { invoiceNumber: { value: "NW-20481", page: 1 } },
      source: "vlm",
    });

    expect(text.provenance.invoiceNumber).toBe("read");
    expect(model.provenance.invoiceNumber).toBe("read");
  });

  it("keeps text and VLM recovery provenance distinct in a mixed handoff", () => {
    const text = applyDriftReads({
      ...base,
      missing: ["invoiceNumber", "total"],
      reads: {
        invoiceNumber: { value: "NW-20481", provenance: "read", page: 1 },
        total: { value: 1210, provenance: "derived", page: 1 },
      },
      source: "ocr-fallback",
    });
    const model = applyDriftReads({
      fields: text.fields,
      provenance: text.provenance,
      fieldSources: text.fieldSources,
      missing: ["dueDate"],
      reads: { dueDate: { value: "2026-05-12", provenance: "derived", page: 1 } },
      source: "vlm",
    });

    expect(model.provenance).toEqual({
      vendor: "read",
      subtotal: "read",
      invoiceNumber: "read",
      total: "derived",
      dueDate: "derived",
    });
    expect({ ...text.recoveredBy, ...model.recoveredBy }).toEqual({
      invoiceNumber: "ocr-fallback",
      total: "ocr-fallback",
      dueDate: "vlm",
    });
  });

  it("keeps text-layer reads when VLM fills the remaining drift fields", () => {
    const text = applyDriftReads({
      ...base,
      missing: ["invoiceNumber", "total", "subtotal", "dueDate"],
      reads: recoverFieldsFromText(
        [NORTHWIND_PAGE],
        "northwind-20481.pdf",
        ["invoiceNumber", "total", "subtotal", "dueDate"],
        undefined,
      ),
      source: "ocr-fallback",
    });
    const merged = mergeVlmResult(
      {
        fields: text.fields,
        provenance: text.provenance,
        fieldSources: text.fieldSources,
        lineItems: [],
        currency: "EUR",
      },
      {
        fields: { subtotal: 1000, dueDate: "2026-05-12" },
        provenance: { subtotal: "read", dueDate: "derived" },
        fieldSources: { subtotal: 1, dueDate: 1 },
        lineItems: [],
        currency: "EUR",
      },
    );

    expect(merged.fields).toMatchObject({
      invoiceNumber: "NW-20481",
      total: 1210,
      subtotal: 1000,
      dueDate: "2026-05-12",
    });
    expect(merged.provenance).toEqual({
      vendor: "read",
      subtotal: "read",
      invoiceNumber: "read",
      total: "read",
      dueDate: "derived",
    });
    expect(merged.fieldSources).toMatchObject({ invoiceNumber: 1, total: 1, dueDate: 1 });
  });

  it("preserves template values it did read", () => {
    const merged = applyDriftReads({
      ...base,
      missing: ["invoiceNumber"],
      reads: {},
      source: "ocr-fallback",
    });

    expect(merged.fields.vendor).toBe("Northwind Services B.V.");
    expect(merged.fields.subtotal).toBe(1000);
    expect(merged.stillMissing).toEqual(["invoiceNumber"]);
  });

  it("preserves derived provenance when merging a VLM result", () => {
    const merged = mergeVlmResult(
      {
        fields: {},
        provenance: {},
        fieldSources: {},
        lineItems: [],
        currency: "EUR",
      },
      {
        fields: { dueDate: "2026-05-12" },
        provenance: { dueDate: "derived" },
        fieldSources: { dueDate: 1 },
        lineItems: [],
        currency: "EUR",
      },
    );

    expect(merged.fields.dueDate).toBe("2026-05-12");
    expect(merged.provenance.dueDate).toBe("derived");
    expect(merged.fieldSources.dueDate).toBe(1);
  });

  it("ignores reads for fields that were not missing", () => {
    const merged = applyDriftReads({
      ...base,
      missing: ["invoiceNumber"],
      reads: { total: { value: 9999, provenance: "read", page: 1 } },
      source: "ocr-fallback",
    });

    expect(merged.fields.total).toBeUndefined();
    expect(merged.recoveredBy).toEqual({});
  });
});
