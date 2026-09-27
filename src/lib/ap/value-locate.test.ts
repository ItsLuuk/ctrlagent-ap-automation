/**
 * Locate a typed value on the page, and remember where it lives.
 *
 * This is the path that replaces drawing a box: a person types what the
 * invoice says, and the page is searched for that text. These tests pin the
 * two things it must never get wrong — matching a value the page prints in
 * another format, and inventing a box when there is nothing to anchor to.
 */
import { describe, expect, it } from "bun:test";
import { locateValue, specForLocation } from "./mapping";
import { applyTemplateField } from "./template-apply";
import type { Invoice, OcrWord } from "./types";

const word = (text: string, x: number, y: number, w = 0.08, h = 0.02): OcrWord => ({
  text,
  x,
  y,
  w,
  h,
  confidence: 0.95,
});

/** A page of words, laid out on the lines given. */
function page(lines: string[][]): OcrWord[] {
  const words: OcrWord[] = [];
  lines.forEach((line, lineIndex) => {
    const y = 0.1 + lineIndex * 0.06;
    let x = 0.08;
    for (const text of line) {
      const width = 0.02 + text.length * 0.008;
      words.push(word(text, x, y, width));
      x += width + 0.01;
    }
  });
  return words;
}

const invoiceWith = (words: OcrWord[]): Invoice =>
  ({
    id: "inv-1",
    vendor: "Superdoos.nl B.V.",
    invoiceNumber: "2024-0087",
    issueDate: "2026-03-14",
    dueDate: "2026-04-13",
    currency: "EUR",
    subtotal: 1000,
    tax: 210,
    total: 1210,
    status: "vendor_profile",
    lineItems: [],
    glAccount: "",
    department: "",
    memo: "",
    tags: [],
    audit: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    learnPayload: { pages: [{ pageNumber: 1, words }] },
  }) as unknown as Invoice;

describe("locateValue", () => {
  it("finds a date printed day-first when the stored value is ISO", () => {
    const words = page([["Factuurdatum:", "14-03-2026"]]);
    const found = locateValue(words, "issueDate", "2026-03-14");
    expect(found).toHaveLength(1);
    expect(found[0]!.text).toBe("14-03-2026");
  });

  it("finds a date printed with a month name", () => {
    const words = page([["Factuurdatum:", "14", "maart", "2026"]]);
    expect(locateValue(words, "issueDate", "2026-03-14")).toHaveLength(1);
  });

  it("finds a Dutch-formatted amount stored as a number", () => {
    const words = page([["Totaal", "€", "1.234,56"]]);
    const found = locateValue(words, "total", 1234.56);
    expect(found).toHaveLength(1);
    expect(found[0]!.text).toContain("1.234,56");
  });

  it("finds an English-formatted amount", () => {
    const words = page([["Total", "1,234.56", "EUR"]]);
    expect(locateValue(words, "total", 1234.56)).toHaveLength(1);
  });

  it("does not confuse two different amounts", () => {
    const words = page([["Subtotaal", "1.000,00"], ["BTW", "210,00"], ["Totaal", "1.210,00"]]);
    const found = locateValue(words, "total", 1210);
    expect(found).toHaveLength(1);
    expect(found[0]!.text).toContain("1.210,00");
  });

  it("finds an IBAN printed in spaced groups", () => {
    const words = page([["IBAN", "NL12", "INGB", "0001", "2345", "67"]]);
    expect(locateValue(words, "iban", "NL12INGB0001234567")).toHaveLength(1);
  });

  it("covers a value that spans several words, not just the matching one", () => {
    const words = page([["Van:", "Superdoos.nl", "B.V."], ["Factuurnummer:", "2024-0087"]]);
    const found = locateValue(words, "vendor", "Superdoos.nl B.V.");
    expect(found).toHaveLength(1);
    expect(found[0]!.words).toHaveLength(2);
    // The box has to reach the last word, or the next invoice reads "Superdoos.nl".
    expect(found[0]!.zone.x + found[0]!.zone.w).toBeGreaterThan(
      words[words.length - 2]!.x + words[words.length - 2]!.w,
    );
  });

  it("returns every place the same value is printed, so a person can choose", () => {
    const words = page([
      ["Factuurnummer:", "2024-0087"],
      ["Referentie", "2024-0087"],
    ]);
    expect(locateValue(words, "invoiceNumber", "2024-0087")).toHaveLength(2);
  });

  it("treats one occurrence read two ways as one place", () => {
    const words = page([["Factuurnummer:", "2024-0087"]]);
    const found = locateValue(words, "invoiceNumber", "2024-0087");
    expect(found).toHaveLength(1);
    expect(found[0]!.text).toBe("2024-0087");
  });

  it("returns nothing for a value the page does not print", () => {
    const words = page([["Factuurnummer:", "2024-0087"], ["Totaal", "€", "1.210,00"]]);
    expect(locateValue(words, "dueDate", "2026-04-13")).toEqual([]);
  });

  it("ignores an empty value rather than matching the whole page", () => {
    const words = page([["Factuurnummer:", "2024-0087"]]);
    expect(locateValue(words, "invoiceNumber", "   ")).toEqual([]);
  });
});

describe("specForLocation", () => {
  it("anchors on the label beside the value, never on the value itself", () => {
    const words = page([["Factuurnummer:", "2024-0087"]]);
    const [location] = locateValue(words, "invoiceNumber", "2024-0087");
    const spec = specForLocation(words, "invoiceNumber", location!);
    expect(spec?.anchor).toBe("Factuurnummer:");
    expect(spec?.learnedBy).toBe("typed");
    expect(spec?.type).toBe("string");
  });

  it("learns nothing when there is no label to anchor to", () => {
    // A page of numbers: any anchor would be invented, and a spec built on an
    // invented anchor reads the wrong value on every future invoice.
    const words = page([["2024-0087"], ["1210,00"]]);
    const [location] = locateValue(words, "invoiceNumber", "2024-0087");
    expect(specForLocation(words, "invoiceNumber", location!)).toBeUndefined();
  });

  it("reads the next invoice's value through the remembered anchor", () => {
    // The whole point: learn from one invoice, read from the next.
    const first = page([["Factuurnummer:", "2024-0087"], ["Factuurdatum:", "14-03-2026"]]);
    const numberSpec = specForLocation(
      first,
      "invoiceNumber",
      locateValue(first, "invoiceNumber", "2024-0087")[0]!,
    );
    const dateSpec = specForLocation(
      first,
      "issueDate",
      locateValue(first, "issueDate", "2026-03-14")[0]!,
    );
    expect(numberSpec).toBeDefined();
    expect(dateSpec).toBeDefined();

    // Next invoice: different number, different date, same layout.
    const second = page([["Factuurnummer:", "2024-0412"], ["Factuurdatum:", "02-05-2026"]]);
    expect(applyTemplateField(second, numberSpec!, "invoiceNumber")?.value).toBe("2024-0412");
    const date = applyTemplateField(second, dateSpec!, "issueDate");
    expect(String(date?.value)).toContain("2026-05-02");
  });
});
