import { describe, expect, it } from "bun:test";
import { tryTemplatePath } from "./ocr";
import type { TemplateLookup, TemplateLookupInput } from "./template-lookup";
import type { OcrWord, VendorTemplate } from "./types";

const words: OcrWord[] = [
  { text: "Acme Services B.V.", x: 0.05, y: 0.02, w: 0.25, h: 0.03, confidence: 0.98 },
];

const template: VendorTemplate = {
  vendor_fingerprint: "fp-acme",
  vendor_key: "acme",
  embedding: [1, 0, 0],
  version: 1,
  fields: {
    vendor: {
      anchor: "Acme Services B.V.",
      region: { x0: 0, y0: 0, x1: 1, y1: 1 },
      type: "string",
    },
  },
  updatedAt: "2026-01-20T00:00:00.000Z",
};

const pages = [{ pageNumber: 1, text: "", words }];

describe("tryTemplatePath", () => {
  it("uses the injected template lookup port", async () => {
    const calls: TemplateLookupInput[] = [];
    const lookup: TemplateLookup = (input) => {
      calls.push(input);
      return template;
    };

    const result = await tryTemplatePath(pages, { acme: template }, lookup);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.vendorBlock).toBe("Acme Services B.V.");
    expect(result).toMatchObject({
      templateKey: "acme",
      fields: { vendor: "Acme Services B.V." },
    });
  });

  it("does not call the port when no templates are available", async () => {
    let called = false;
    const lookup: TemplateLookup = () => {
      called = true;
      return template;
    };

    const result = await tryTemplatePath(pages, undefined, lookup);

    expect(called).toBe(false);
    expect(result).toBeUndefined();
  });
});
