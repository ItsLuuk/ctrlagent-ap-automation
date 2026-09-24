import type { VendorTemplate } from "./types";

/** The only template capability the OCR extraction path needs. */
export type TemplateLookupInput = {
  vendorBlock: string;
  embedding: number[];
};

export type TemplateLookup = (input: TemplateLookupInput) => VendorTemplate | undefined;
