import { describe, it, expect } from "bun:test";
import { extractFieldsFromPages, type PageRead } from "./ocr";
import type { BusinessProfile } from "./types";

const OWN_BUSINESS: BusinessProfile = {
  name: "Mijn Bedrijf B.V.",
  address: "Industrieweg 42, 1012 AB Amsterdam",
  email: "info@mijnbedrijf.nl",
  iban: "NL91ABNA0417164300",
  vatNumber: "NL123456789B01",
  businessRegistrationNumber: "12345678",
};

function pages(text: string): PageRead[] {
  return [{ pageNumber: 1, text, confidence: 0.95 }];
}

describe("business profile filtering", () => {
  it("excludes own business name from vendor candidates", () => {
    const text = [
      "Factuur van:",
      "Mijn Bedrijf B.V.",
      "",
      "Geleverd aan:",
      "TechStart B.V.",
      "Industrieweg 42",
      "1012 AB Amsterdam",
      "",
      "Factuur nr: F001",
      "Datum: 01-01-2026",
      "Totaal: € 1.000,00",
    ].join("\n");

    // Without business profile — might pick up own name
    const without = extractFieldsFromPages(pages(text), "test.pdf");
    // With business profile — should NOT pick up own name
    const withProfile = extractFieldsFromPages(pages(text), "test.pdf", OWN_BUSINESS);

    // The vendor should not be the user's own business
    expect(withProfile.vendor).not.toBe("Mijn Bedrijf B.V.");
    // The vendor should ideally be TechStart B.V. (the supplier)
    expect(withProfile.vendor).toBe("TechStart B.V.");
  });

  it("excludes own VAT number from extraction", () => {
    const text = [
      "TechStart B.V.",
      "Factuur nr: F002",
      "Datum: 01-01-2026",
      "",
      "BTW nr: NL987654321B01",
      "Totaal: € 500,00",
    ].join("\n");

    const withProfile = extractFieldsFromPages(pages(text), "test.pdf", OWN_BUSINESS);
    // Should NOT extract the user's own VAT number
    expect(withProfile.vatNumber).not.toBe("NL123456789B01");
    // Should extract the vendor's VAT number instead
    expect(withProfile.vatNumber).toBe("NL987654321B01");
  });

  it("excludes own IBAN from extraction", () => {
    const text = [
      "TechStart B.V.",
      "Factuur nr: F003",
      "Datum: 01-01-2026",
      "",
      "IBAN: NL20INGB0001234567",
      "Totaal: € 750,00",
    ].join("\n");

    const withProfile = extractFieldsFromPages(pages(text), "test.pdf", OWN_BUSINESS);
    // Should NOT extract the user's own IBAN
    expect(withProfile.iban).not.toBe("NL91ABNA0417164300");
    // Should extract the vendor's IBAN instead
    expect(withProfile.iban).toBe("NL20INGB0001234567");
  });

  it("excludes own email from extraction", () => {
    const text = [
      "TechStart B.V.",
      "Email: contact@techstart.nl",
      "Factuur nr: F004",
      "Datum: 01-01-2026",
      "Totaal: € 300,00",
    ].join("\n");

    const withProfile = extractFieldsFromPages(pages(text), "test.pdf", OWN_BUSINESS);
    // Should NOT extract the user's own email
    expect(withProfile.vendorEmail).not.toBe("info@mijnbedrijf.nl");
    // Should extract the vendor's email instead
    expect(withProfile.vendorEmail).toBe("contact@techstart.nl");
  });

  it("excludes own address from extraction", () => {
    const text = [
      "TechStart B.V.",
      "Keizersgracht 100",
      "1015 AA Amsterdam",
      "",
      "Factuur nr: F005",
      "Datum: 01-01-2026",
      "Totaal: € 400,00",
    ].join("\n");

    const withProfile = extractFieldsFromPages(pages(text), "test.pdf", OWN_BUSINESS);
    // Should NOT extract the user's own address
    expect(withProfile.address).not.toContain("Industrieweg 42");
    // Should extract the vendor's address instead
    expect(withProfile.address).toContain("Keizersgracht");
  });

  it("still extracts correctly when no business profile is set", () => {
    const text = [
      "TechStart B.V.",
      "Factuur nr: F006",
      "Datum: 01-01-2026",
      "BTW nr: NL111222333B01",
      "IBAN: NL20INGB0001234567",
      "Totaal: € 600,00",
    ].join("\n");

    const result = extractFieldsFromPages(pages(text), "test.pdf");
    expect(result.vendor).toBe("TechStart B.V.");
    expect(result.invoiceNumber).toBe("F006");
    expect(result.issueDate).toBe("2026-01-01");
    expect(result.total).toBe(600);
    expect(result.vatNumber).toBe("NL111222333B01");
    expect(result.iban).toBe("NL20INGB0001234567");
  });

  it("still extracts correctly when business profile is empty", () => {
    const text = [
      "TechStart B.V.",
      "Factuur nr: F007",
      "Datum: 01-01-2026",
      "Totaal: € 800,00",
    ].join("\n");

    const emptyProfile: BusinessProfile = {
      name: "",
      address: "",
      email: "",
      iban: "",
      vatNumber: "",
      businessRegistrationNumber: "",
    };

    const result = extractFieldsFromPages(pages(text), "test.pdf", emptyProfile);
    expect(result.vendor).toBe("TechStart B.V.");
    expect(result.total).toBe(800);
  });

  it("extracts vendor from real-world Dutch invoice with own info on bill-to", () => {
    // Simulates a typical Dutch invoice where:
    // - Top-left: vendor info (TechStart B.V.)
    // - Top-right or below: bill-to info (Mijn Bedrijf B.V.)
    const text = [
      "TechStart B.V.",
      "Keizersgracht 100",
      "1015 AA Amsterdam",
      "KVK: 87654321",
      "BTW: NL987654321B01",
      "",
      "Factuur nr: TS-2026-042",
      "Factuurdatum: 12 april 2026",
      "Vervaldatum: 12 mei 2026",
      "",
      "Geadresseerde:",
      "Mijn Bedrijf B.V.",
      "Industrieweg 42",
      "1012 AB Amsterdam",
      "BTW: NL123456789B01",
      "",
      "Omschrijving              Bedrag",
      "Consultancy uren    € 2.000,00",
      "Reiskosten            €  150,00",
      "",
      "Subtotaal            € 2.150,00",
      "BTW 21%              €   451,50",
      "Totaal te betalen    € 2.601,50",
      "",
      "IBAN: NL20INGB0001234567",
      "Betalingskenmerk: F2026-042",
    ].join("\n");

    const result = extractFieldsFromPages(pages(text), "techstart.pdf", OWN_BUSINESS);

    // Vendor should be TechStart, not Mijn Bedrijf
    expect(result.vendor).toBe("TechStart B.V.");
    // VAT should be TechStart's, not the user's
    expect(result.vatNumber).toBe("NL987654321B01");
    // IBAN should be TechStart's, not the user's
    expect(result.iban).toBe("NL20INGB0001234567");
    // Total should be correct
    expect(result.total).toBe(2601.5);
    // Invoice number
    expect(result.invoiceNumber).toBe("TS-2026-042");
  });
});
