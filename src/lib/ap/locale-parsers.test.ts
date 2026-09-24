import { describe, expect, it } from "bun:test";
import { parseDateParts, moneyToNumber } from "./zones";
import { extractFieldsFromPages, MONEY_RE } from "./ocr";

const page = (text: string) => [{ pageNumber: 1, text }];

describe("EU locale-aware parsers", () => {
  it("disambiguates numeric dates using document locale", () => {
    expect(parseDateParts("04/03/2026")).toMatchObject({ day: 4, month: 3, year: 2026 });
    expect(parseDateParts("04/03/2026", "EN")).toMatchObject({ day: 3, month: 4, year: 2026 });
    expect(parseDateParts("31/03/2026", "EN")).toMatchObject({ day: 31, month: 3, year: 2026 });
  });

  it("recognizes EU month names", () => {
    expect(parseDateParts("4 March 2026")).toMatchObject({ day: 4, month: 3 });
    expect(parseDateParts("4 März 2026", "DE")).toMatchObject({ day: 4, month: 3 });
    expect(parseDateParts("4 février 2026", "FR")).toMatchObject({ day: 4, month: 2 });
    expect(parseDateParts("4 septiembre 2026", "ES")).toMatchObject({ day: 4, month: 9 });
  });

  it("accepts spaces and narrow no-break spaces as thousands separators", () => {
    expect(moneyToNumber("1 080,00")).toBe(1080);
    expect(moneyToNumber("1\u202f080,00")).toBe(1080);
    expect("Total 1 080,00".match(MONEY_RE)?.[0]).toBe("1 080,00");
  });

  it("extracts English, German, French, and Spanish labels", () => {
    expect(extractFieldsFromPages(page("Invoice number: INV-42\nInvoice date: 03/04/2026\nTotal due: $1,080.00\nAcme Ltd"), "x.pdf")).toMatchObject({ invoiceNumber: "INV-42", issueDate: "2026-04-03", total: 1080 });
    expect(extractFieldsFromPages(page("Rechnungsnummer: DE-42\nRechnungsdatum: 4 März 2026\nGesamtbetrag: 1 080,00\nAcme GmbH"), "x.pdf")).toMatchObject({ invoiceNumber: "DE-42", issueDate: "2026-03-04", total: 1080, vendor: "Acme GmbH" });
    expect(extractFieldsFromPages(page("Numéro de facture: FR-42\nDate de facture: 4 février 2026\nTotal à payer: 1 080,00\nAcme SARL"), "x.pdf")).toMatchObject({ invoiceNumber: "FR-42", issueDate: "2026-02-04", total: 1080, vendor: "Acme SARL" });
    expect(extractFieldsFromPages(page("Número de factura: ES-42\nFecha de factura: 4 septiembre 2026\nTotal a pagar: 1 080,00\nAcme S.L."), "x.pdf")).toMatchObject({ invoiceNumber: "ES-42", issueDate: "2026-09-04", total: 1080, vendor: "Acme S.L." });
  });

  it("accepts a valid foreign IBAN and VAT without NL assumptions", () => {
    const result = extractFieldsFromPages(page("Supplier: Acme Ltd\nVAT number: GB123456789\nIBAN: DE89370400440532013000\nTotal due: 10.00"), "x.pdf");
    expect(result.vatNumber).toBe("GB123456789");
    expect(result.iban).toBe("DE89370400440532013000");
  });
});
