import { describe, expect, it } from "bun:test";
import {
  scanProducer,
  recognizesProducer,
  type GeneratorHint,
} from "./pdf-meta";

/** A partial PDFDocumentProxy we control for the producer tests. */
function metaPacket(producer: string | undefined): PDFMetadata {
  return {
    info: producer != null ? { Producer: producer } : undefined,
  } as unknown as PDFMetadata;
}

function docWith(producer: string | undefined): PDFDocumentProxy {
  return {
    getMetadata: () => Promise.resolve(metaPacket(producer)),
  } as unknown as PDFDocumentProxy;
}

describe("recognizesProducer", () => {
  it("recognises Moneybird", () => {
    expect(recognizesProducer("Moneybird")).toBe(true);
    expect(recognizesProducer("  Moneybird  ")).toBe(true);
  });

  it("recognises Exact Online", () => {
    expect(recognizesProducer("Exact Online")).toBe(true);
    expect(recognizesProducer("Exact Online 2024")).toBe(true);
  });

  it("recognises AFAS Safari", () => {
    expect(recognizesProducer("AFAS Safari")).toBe(true);
  });

  it("recognises eBoekhouden.nl", () => {
    expect(recognizesProducer("eBoekhouden.nl Webservice")).toBe(true);
    expect(recognizesProducer("eBoekhouden.nl")).toBe(true);
  });

  it("recognises WeFact", () => {
    expect(recognizesProducer("WeFact")).toBe(true);
  });

  it("recognises Mollie", () => {
    expect(recognizesProducer("Mollie")).toBe(true);
  });

  it("does not recognise an unknown producer", () => {
    expect(recognizesProducer("Adobe InDesign")).toBe(false);
    expect(recognizesProducer("Custom PHP script")).toBe(false);
    expect(recognizesProducer("")).toBe(false);
  });
});

describe("scanProducer", () => {
  const NL_HINT: GeneratorHint = {
    vendorRegion: "top-left",
    totalLabelHint: "Totaal te betalen",
    dateLabelHint: "Factuurdatum",
    invoiceNumberLabelHint: "Factuurnummer",
  };

  it("returns the hint for a recognised producer", async () => {
    const doc = docWith("Moneybird");
    expect(await scanProducer(doc)).toEqual({
      vendorRegion: "top-center",
      totalLabelHint: "Totaal te betalen",
      dateLabelHint: "Factuurdatum",
      invoiceNumberLabelHint: "Factuurnummer",
    });
  });

  it("returns null for an unrecognised producer", async () => {
    expect(await scanProducer(docWith("Adobe InDesign"))).toBeNull();
  });

  it("returns null when metadata is absent", async () => {
    const doc = {
      getMetadata: () => Promise.resolve(null),
    } as unknown as PDFDocumentProxy;
    expect(await scanProducer(doc)).toBeNull();
  });

  it("returns null when info.Producer is missing", async () => {
    const doc = docWith(undefined);
    expect(await scanProducer(doc)).toBeNull();
  });

  it("returns null when getMetadata throws", async () => {
    const doc = {
      getMetadata: () => Promise.reject(new Error("not a PDF")),
    } as unknown as PDFDocumentProxy;
    expect(await scanProducer(doc)).toBeNull();
  });

  it("matches on a substring of the producer string", async () => {
    const doc = docWith("Moneybird 12345");
    const hint = await scanProducer(doc);
    expect(hint).not.toBeNull();
    expect(hint?.vendorRegion).toBe("top-center");
  });
});
