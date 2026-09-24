/**
 * PDF producer-string scanner.
 *
 * getMetadata().info.Producer is a freebie from PDF.js — a single string the
 * author embedded at save time. For NL SaaS generators it is remarkably
 * specific (e.g. "Moneybird", "Exact Online", "AFAS Safari", "eBoekhouden.nl
 * Webservice") and stable across invoices from the same generator. We use it
 * to pre-seed anchor hints for the text-layer path so the long tail of unknown
 * vendors still gets a decent first read without a VLM round-trip.
 *
 * Tables are small and explicit: new generators are added here, not inferred.
 * A generator not in the table simply returns undefined and the existing flow
 * continues unchanged.
 */
import type { OcrWord } from "./types";

/** Lower-cased, trimmed producer strings we recognise and the hints they yield. */
const TABLE: Array<{ producer: string; hint: GeneratorHint }> = [
  {
    producer: "moneybird",
    hint: {
      vendorRegion: "top-center",
      totalLabelHint: "Totaal te betalen",
      dateLabelHint: "Factuurdatum",
      invoiceNumberLabelHint: "Factuurnummer",
    },
  },
  {
    producer: "exact online",
    hint: {
      vendorRegion: "top-left",
      totalLabelHint: "Totaal",
      dateLabelHint: "Factuurdatum",
      invoiceNumberLabelHint: "Factuurnummer",
    },
  },
  {
    producer: "afas safari",
    hint: {
      vendorRegion: "top-left",
      totalLabelHint: "Totaal",
      dateLabelHint: "Factuurdatum",
      invoiceNumberLabelHint: "Factuurnummer",
    },
  },
  {
    producer: "eboekhouden.nl",
    hint: {
      vendorRegion: "top-left",
      totalLabelHint: "Totaal te betalen",
      dateLabelHint: "Factuurdatum",
      invoiceNumberLabelHint: "Factuurnummer",
    },
  },
  {
    producer: "wefact",
    hint: {
      vendorRegion: "top-left",
      totalLabelHint: "Totaal te betalen",
      dateLabelHint: "Factuurdatum",
      invoiceNumberLabelHint: "Factuurnummer",
    },
  },
  {
    producer: "mollie",
    hint: {
      vendorRegion: "top-center",
      totalLabelHint: "Totaal",
      dateLabelHint: "Datum",
      invoiceNumberLabelHint: "Factuurnummer",
    },
  },
];

/** Anchoring hints a recognised generator pre-seeds for the text-layer path. */
export type GeneratorHint = {
  /** Where the vendor block usually lives on the first page (for zone priority). */
  vendorRegion: "top-left" | "top-center" | "top-right";
  /** Label commonly used for the total on NL invoices from this generator. */
  totalLabelHint: string;
  /** Label commonly used for the issue date. */
  dateLabelHint: string;
  /** Label commonly used for the invoice number. */
  invoiceNumberLabelHint: string;
};

/**
 * Reads `getMetadata().info.Producer` and, when it matches a known NL
 * generator, returns the anchoring hint for that generator. Returns null when
 * the producer is absent, unrecognised, or the metadata call failed.
 */
export async function scanProducer(pdf: PDFDocumentProxy): Promise<GeneratorHint | null> {
  let meta: PDFMetadata | null = null;
  try {
    meta = await pdf.getMetadata();
  } catch {
    return null;
  }
  const producer = meta?.info?.Producer;
  if (typeof producer !== "string") return null;
  const key = producer.trim().toLowerCase();
  const row = TABLE.find((r) => key.includes(r.producer));
  return row?.hint ?? null;
}

/** Checks whether `producer` matches a known NL generator (case-insensitive substring). */
export function recognizesProducer(producer: string): boolean {
  const key = producer.trim().toLowerCase();
  return TABLE.some((r) => key.includes(r.producer));
}
