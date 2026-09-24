import { describe, expect, it } from "bun:test";
import { finalizeInvoice } from "./ocr";

const VAT = "NL859520572B01";

function invoiceFile() {
  return new File(["invoice"], "invoice.pdf", { type: "application/pdf" });
}

function loadedPage(text = "") {
  return {
    pages: [
      {
        pageNumber: 1,
        text,
        method: "text-layer",
        words: [],
      },
    ],
    totalPages: 1,
    truncated: false,
  };
}

function chosen(path: "text" | "vlm" | "template", vatNumber: string | undefined) {
  return {
    path,
    fields: {
      vendor: "Acme B.V.",
      invoiceNumber: "AC-42",
      issueDate: "2026-04-12",
      dueDate: "2026-05-12",
      subtotal: 1000,
      tax: 210,
      total: 1210,
      ...(vatNumber ? { vatNumber } : {}),
    },
    provenance: {
      vendor: "read",
      invoiceNumber: "read",
      issueDate: "read",
      dueDate: "read",
      subtotal: "read",
      tax: "read",
      total: "read",
      ...(vatNumber ? { vatNumber: "read" as const } : {}),
    },
    fieldSources: { vendor: 1, total: 1, ...(vatNumber ? { vatNumber: 1 } : {}) },
    lineItems: [],
    currency: "EUR",
    templateFingerprint: path === "template" ? "acme-template" : undefined,
    model: undefined,
  };
}

async function finalize(path: "text" | "vlm" | "template", vatNumber: string | undefined, text = "") {
  return finalizeInvoice({
    file: invoiceFile(),
    loaded: loadedPage(text),
    chosen: chosen(path, vatNumber),
    templates: undefined,
  });
}

describe("finalizeInvoice VAT propagation", () => {
  it("preserves VAT on the heuristic/text path", async () => {
    const invoice = await finalize("text", VAT, `BTW nr: ${VAT}`);

    expect(invoice.vatNumber).toBe(VAT);
    expect(invoice.originalExtraction?.vatNumber).toBe(VAT);
  });

  it("preserves VAT from the VLM path", async () => {
    const invoice = await finalize("vlm", VAT);

    expect(invoice.vatNumber).toBe(VAT);
    expect(invoice.originalExtraction?.vatNumber).toBe(VAT);
  });

  it("preserves VAT from the template path", async () => {
    const invoice = await finalize("template", VAT);

    expect(invoice.vatNumber).toBe(VAT);
    expect(invoice.originalExtraction?.vatNumber).toBe(VAT);
  });

  it("does not invent a VAT number when the chosen result is missing", async () => {
    const invoice = await finalize("vlm", undefined);

    expect(invoice.vatNumber).toBeUndefined();
    expect(invoice.originalExtraction?.vatNumber).toBeUndefined();
  });
});
