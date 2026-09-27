import { describe, expect, it } from "bun:test";
import {
  MONEY_RE,
  toNumber,
  type ExtractedFields,
  extractFieldsFromPages,
  confirmedReads,
} from "./ocr";

/** Tiny inline page factory so the OCR-parser tests don't need pdfjs. */
const page = (pageNumber: number, text: string, confidence = 0.95) => ({
  pageNumber,
  text,
  confidence,
});

describe("MONEY_RE (ocr.ts §66)", () => {
  it("matches Dutch 2-decimal amounts", () => {
    expect("€ 1.234,56".match(MONEY_RE)?.[0]).toBe("€ 1.234,56");
    expect("1.234,56".match(MONEY_RE)?.[0]).toBe("1.234,56");
  });

  it("matches Dutch 3-decimal unit prices without a euro marker", () => {
    // The bug we fixed: bare "19,950" was NOT matched by MONEY_RE, so a VLM
    // echo of that string bypassed extraction entirely and line items survived
    // only by back-computing unit price from the row total.
    expect("19,950".match(MONEY_RE)?.[0]).toBe("19,950");
    expect("0,120".match(MONEY_RE)?.[0]).toBe("0,120");
    expect("€ 19,950".match(MONEY_RE)?.[0]).toBe("€ 19,950");
  });

  it("does not confuse a 3-decimal Dutch amount with English thousands", () => {
    // "1.234,56" must match the Dutch reading, not be clipped to "1.234".
    expect("1.234,56".match(MONEY_RE)?.[0]).toBe("1.234,56");
    // "14,200.00" (English) must not be clipped to "14,20".
    expect("14,200.00".match(MONEY_RE)?.[0]).toBe("14,200.00");
  });
});

describe("toNumber (ocr.ts §79)", () => {
  it("parses Dutch 2-decimal money", () => {
    expect(toNumber("€ 1.234,56")).toBe(1234.56);
    expect(toNumber("1.234,56")).toBe(1234.56);
  });

  it("parses Dutch 3-decimal unit prices", () => {
    // With euro marker (existing behaviour preserved).
    expect(toNumber("€ 19,950")).toBe(19.95);
    expect(toNumber("€ 0,120")).toBe(0.12);
    // Bare 3-decimal comma without euro marker: small leading group (1-2
    // digits) + no '.' thousands groups → treat as cents (the fix).
    expect(toNumber("19,950")).toBe(19.95);
    expect(toNumber("0,120")).toBe(0.12);
    // A bare "123,456" with a 3-digit leading group stays English thousands.
    expect(toNumber("123,456")).toBe(123456);
    // Euro marker still forces conversion even for a 3-digit lead.
    expect(toNumber("€ 123,456")).toBe(123.456);
  });

  it("rejects non-money text", () => {
    expect(toNumber("no amount here")).toBeUndefined();
    expect(toNumber(undefined)).toBeUndefined();
  });
});

describe("extractFieldsFromPages — 3-decimal unit price on a line", () => {
  it("reads a 3-decimal amount when a label anchors it", () => {
    // When a 3-decimal bare value appears after a recognised label, the regex
    // reader now matches it (MONEY_RE was extended) and toNumber converts it
    // (the euro-gated guard was removed for small leading groups).
    const result = extractFieldsFromPages(
      [page(1, "Subtotaal: 19,950")],
      "test.pdf",
    );
    expect(result.subtotal).toBe(19.95);
  });

  it("reads a 3-decimal total anchored by a Dutch label", () => {
    const result = extractFieldsFromPages(
      [page(1, "Totaal te betalen: 0,120")],
      "test.pdf",
    );
    expect(result.total).toBe(0.12);
  });

  it("still rejects a bare 3-decimal English-thousands value", () => {
    // "123,456" with a 3-digit leading group stays English thousands (123456).
    const result = extractFieldsFromPages(
      [page(1, "Totaal: 123,456")],
      "test.pdf",
    );
    expect(result.total).toBe(123456);
  });
});
