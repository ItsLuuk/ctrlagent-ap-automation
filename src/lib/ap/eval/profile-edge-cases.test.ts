/**
 * Profile field edge-case tests.
 *
 * These test `extractFieldsFromPages` directly on the vendor profile fields
 * (address, vendorEmail, iban, vatNumber) — the eval framework only scores
 * zone fields + currency, so these edge cases need their own assertions.
 */
import { describe, expect, it } from "bun:test";
import { extractFieldsFromPages, type PageRead } from "../ocr";
import type { OcrWord } from "../types";

const page = (n: number, text: string): PageRead => ({
  pageNumber: n,
  text,
  confidence: 0.95,
});

// ---------------------------------------------------------------------------
// Multi-page profile fields
// ---------------------------------------------------------------------------
describe("profile edge cases: multi-page", () => {
  it("extracts IBAN from page 3 when vendor is on page 1", () => {
    const r = extractFieldsFromPages(
      [
        page(1, "Acme Nederland B.V.\nKeizersgracht 123\n1012 AB Amsterdam\nFactuurnummer: AC-100"),
        page(2, "Consulting 1.000,00\nTraining 500,00"),
        page(3, "Subtotaal 1.500,00\nBTW 21% 315,00\nTotaal 1.815,00\n\nIBAN: NL91ABNA0417164300\nBTW: NL812345678B01"),
      ],
      "acme-multi.pdf",
    );
    expect(r.vendor).toBe("Acme Nederland B.V.");
    expect(r.address).toContain("Keizersgracht 123");
    expect(r.iban).toBe("NL91ABNA0417164300");
    expect(r.vatNumber).toBe("NL812345678B01");
    expect(r.total).toBe(1815);
  });

  it("extracts email from page 2 when vendor is on page 1", () => {
    const r = extractFieldsFromPages(
      [
        page(1, "Bouwbedrijf Van den Berg B.V.\nIndustrieweg 28\n5612 AB Eindhoven\nFactuurnummer: BVB-042"),
        page(2, "Bouwmaterialen 2.500,00\nSubtotaal 2.500,00\nBTW 21% 525,00\nTotaal 3.025,00\n\nIBAN NL55RABO0319564893\nE-mail: facturatie@vandenberg-bouw.nl"),
      ],
      "bvb.pdf",
    );
    expect(r.vendor).toBe("Bouwbedrijf Van den Berg B.V.");
    expect(r.vendorEmail).toBe("facturatie@vandenberg-bouw.nl");
    expect(r.iban).toBe("NL55RABO0319564893");
    expect(r.total).toBe(3025);
  });

  it("extracts all profile fields across 3 pages", () => {
    const r = extractFieldsFromPages(
      [
        page(1, [
          "Conclusion ICT B.V.",
          "Oudegracht 123",
          "3511 PC Utrecht",
          "",
          "Factuurnummer: CIC-2026-0842",
          "Factuurdatum: 15-04-2026",
          "Vervaldatum: 15-05-2026",
        ].join("\n")),
        page(2, [
          "Software ontwikkeling 40 uur  6.000,00",
          "Project management 16 uur  2.400,00",
          "Reiskosten 1 245,00",
        ].join("\n")),
        page(3, [
          "Subtotaal 8.645,00",
          "BTW 21% 1.815,45",
          "Totaal te betalen 10.460,45",
          "",
          "IBAN: NL91ABNA0417164300",
          "BTW: NL812345678B01",
          "E-mail: facturatie@conclusion.nl",
        ].join("\n")),
      ],
      "cic.pdf",
    );
    expect(r.vendor).toBe("Conclusion ICT B.V.");
    expect(r.address).toContain("Oudegracht 123");
    expect(r.vendorEmail).toBe("facturatie@conclusion.nl");
    expect(r.iban).toBe("NL91ABNA0417164300");
    expect(r.vatNumber).toBe("NL812345678B01");
    expect(r.total).toBe(10460.45);
  });
});

// ---------------------------------------------------------------------------
// Ambiguous emails
// ---------------------------------------------------------------------------
describe("profile edge cases: ambiguous emails", () => {
  it("prefers vendor email over customer email", () => {
    const r = extractFieldsFromPages(
      [
        page(1, [
          "Acme B.V.",
          "E-mail: info@acme.nl",
          "",
          "Klant:",
          "PostNL Pakketten B.V.",
          "E-mail: klantenservice@postnl.nl",
          "",
          "Factuurnummer: AC-200",
          "Totaal 250,00",
        ].join("\n")),
      ],
      "acme-postnl.pdf",
    );
    expect(r.vendor).toBe("Acme B.V.");
    expect(r.vendorEmail).toBe("info@acme.nl");
  });

  it("prefers real email over noreply", () => {
    const r = extractFieldsFromPages(
      [
        page(1, [
          "Exact Online B.V.",
          "Databankweg 12",
          "3833 AN Leusden",
          "",
          "From: noreply@exact.nl",
          "E-mail: facturatie@exact.nl",
          "",
          "Factuurnummer: EOL-88901",
          "Totaal 1.292,28",
        ].join("\n")),
      ],
      "exact.pdf",
    );
    expect(r.vendor).toBe("Exact Online B.V.");
    expect(r.vendorEmail).toBe("facturatie@exact.nl");
  });

  it("finds email when vendor name matches domain", () => {
    const r = extractFieldsFromPages(
      [
        page(1, [
          "Adviesbureau De Jong B.V.",
          "Prinsessegracht 10",
          "2514 AP Den Haag",
          "",
          "E-mail: contact@dejong-advies.nl",
          "",
          "Factuurnummer: DJ-456",
          "Totaal 750,00",
        ].join("\n")),
      ],
      "dj.pdf",
    );
    expect(r.vendorEmail).toBe("contact@dejong-advies.nl");
  });

  it("finds email with Dutch label", () => {
    const r = extractFieldsFromPages(
      [
        page(1, [
          "Stichting Warmte Nederland",
          "Warmtestraat 1, 5611 AB Eindhoven",
          "E-mail: info@warmtenederland.nl",
          "Factuurnummer: SWN-042",
          "Totaal 1.754,50",
        ].join("\n")),
      ],
      "stichting.pdf",
    );
    expect(r.vendorEmail).toBe("info@warmtenederland.nl");
  });
});

// ---------------------------------------------------------------------------
// Multiple IBANs
// ---------------------------------------------------------------------------
describe("profile edge cases: multiple IBANs", () => {
  it("prefers vendor IBAN over customer IBAN (NL over BE)", () => {
    const r = extractFieldsFromPages(
      [
        page(1, [
          "Acme B.V.",
          "",
          "Klant:",
          "PostNL Pakketten B.V.",
          "IBAN: BE68539007547034",
          "",
          "Ons IBAN: NL91ABNA0417164300",
          "",
          "Factuurnummer: AC-300",
          "Totaal 100,00",
        ].join("\n")),
      ],
      "acme-dual.pdf",
    );
    expect(r.iban).toBe("NL91ABNA0417164300");
  });

  it("prefers NL IBAN over DE IBAN when both present", () => {
    const r = extractFieldsFromPages(
      [
        page(1, [
          "Twijgen Transport B.V.",
          "Havenweg 5",
          "1000 AA Amsterdam",
          "",
          "Klant IBAN: DE89370400440532013000",
          "IBAN: NL20INGB0001234567",
          "",
          "Factuurnummer: TT-789",
          "Totaal 5.000,00",
        ].join("\n")),
      ],
      "twijgen.pdf",
    );
    expect(r.iban).toBe("NL20INGB0001234567");
  });

  it("prefers labelled IBAN over unlabelled", () => {
    const r = extractFieldsFromPages(
      [
        page(1, [
          "Siemens GmbH",
          "Werner-von-Siemens-Str. 1",
          "80333 München",
          "",
          "Bankverbindung / IBAN: DE89370400440532013000",
          "Unser Konto: DE15500105171829969543",
          "",
          "Rechnung Nr: SI-789",
          "Gesamtbetrag € 5.000,00",
        ].join("\n")),
      ],
      "siemens.pdf",
    );
    expect(r.iban).toBe("DE89370400440532013000");
  });

  it("finds IBAN near vendor name when on different line", () => {
    const r = extractFieldsFromPages(
      [
        page(1, [
          "Stichting Wonen Zuid",
          "Postbus 3456",
          "6202 PL Maastricht",
          "",
          "Factuurnummer: SWZ-2026-0123",
          "Totaal 3.751,00",
          "",
          "IBAN: NL84RABO0123456789",
          "BTW: NL861112223B01",
        ].join("\n")),
      ],
      "wonen.pdf",
    );
    expect(r.vendor).toBe("Stichting Wonen Zuid");
    expect(r.iban).toBe("NL84RABO0123456789");
    expect(r.vatNumber).toBe("NL861112223B01");
  });
});

// ---------------------------------------------------------------------------
// Spatial proximity filtering (word coordinates)
// ---------------------------------------------------------------------------

/** Helper: creates an OcrWord with normalized coordinates. */
function w(
  text: string,
  x: number,
  y: number,
  h = 0.03,
  conf = 0.95,
): OcrWord {
  const charWidth = 0.008;
  return { text, x, y, w: text.length * charWidth, h, confidence: conf };
}

function pageWithWords(
  n: number,
  text: string,
  words: OcrWord[],
): PageRead {
  return { pageNumber: n, text, confidence: 0.95, words };
}

describe("profile edge cases: spatial proximity (word coords)", () => {
  it("prefers email near vendor name over email near customer", () => {
    // Vendor "Acme" at top-left, customer "PostNL" at bottom-right
    const vendorEmail = "info@acme.nl";
    const customerEmail = "klantenservice@postnl.nl";
    const words: OcrWord[] = [
      // Vendor block (top-left)
      w("Acme", 0.05, 0.05),
      w("B.V.", 0.15, 0.05),
      w("E-mail:", 0.05, 0.10),
      w(vendorEmail, 0.15, 0.10),
      // Customer block (bottom-right)
      w("PostNL", 0.55, 0.60),
      w("B.V.", 0.65, 0.60),
      w("E-mail:", 0.55, 0.65),
      w(customerEmail, 0.55, 0.70),
    ];
    const r = extractFieldsFromPages(
      [
        pageWithWords(
          1,
          "Acme B.V.\nE-mail: info@acme.nl\n\nPostNL B.V.\nE-mail: klantenservice@postnl.nl\nFactuurnummer: AC-1\nTotaal EUR 100,00",
          words,
        ),
      ],
      "acme-postnl.pdf",
    );
    expect(r.vendorEmail).toBe(vendorEmail);
  });

  it("prefers IBAN near vendor name over IBAN near customer", () => {
    // Vendor IBAN (top-left, near vendor name), customer IBAN (bottom-right)
    const vendorIban = "NL91ABNA0417164300";
    const customerIban = "BE68539007547034";
    const words: OcrWord[] = [
      // Vendor block
      w("Acme", 0.05, 0.05),
      w("B.V.", 0.15, 0.05),
      w("IBAN:", 0.05, 0.10),
      w(vendorIban, 0.15, 0.10),
      // Customer block
      w("PostNL", 0.55, 0.60),
      w("IBAN:", 0.55, 0.65),
      w(customerIban, 0.55, 0.70),
    ];
    const r = extractFieldsFromPages(
      [
        pageWithWords(
          1,
          `Acme B.V.\nIBAN: ${vendorIban}\nPostNL B.V.\nIBAN: ${customerIban}\nTotaal EUR 100,00`,
          words,
        ),
      ],
      "acme-postnl.pdf",
    );
    expect(r.iban).toBe(vendorIban);
  });

  it("falls back to text proximity when words are not available", () => {
    // Same scenario as above but without word coordinates
    const vendorIban = "NL91ABNA0417164300";
    const customerIban = "BE68539007547034";
    const r = extractFieldsFromPages(
      [
        page(
          1,
          `Acme B.V.\nIBAN: ${vendorIban}\nPostNL B.V.\nIBAN: ${customerIban}\nTotaal EUR 100,00`,
        ),
      ],
      "acme-postnl.pdf",
    );
    // Should still prefer NL IBAN (existing heuristic)
    expect(r.iban).toBe(vendorIban);
  });

  it("still prefers NL IBAN even when spatial proximity is similar", () => {
    // Both IBANs are at similar distances from vendor name
    // NL should still win as a tiebreaker
    const words: OcrWord[] = [
      w("Acme", 0.05, 0.05),
      w("B.V.", 0.15, 0.05),
      w("NL-IBAN:", 0.05, 0.10),
      w("NL91ABNA0417164300", 0.20, 0.10),
      w("DE-IBAN:", 0.05, 0.15),
      w("DE89370400440532013000", 0.20, 0.15),
    ];
    const r = extractFieldsFromPages(
      [
        pageWithWords(
          1,
          "Acme B.V.\nNL-IBAN: NL91ABNA0417164300\nDE-IBAN: DE89370400440532013000\nTotaal EUR 100,00",
          words,
        ),
      ],
      "acme.pdf",
    );
    expect(r.iban).toBe("NL91ABNA0417164300");
  });
});

// ---------------------------------------------------------------------------
// Real-world footer block (Superdoos invoice): vendor details in the page
// footer, read bottom-up, with customer block at the top of the page.
// ---------------------------------------------------------------------------
describe("profile edge cases: real footer block", () => {
  it("maps a reversed vendor footer block to the right profile fields", () => {
    const text = [
      "Orbi Earplugs",
      "Ravelijnstraat 40",
      "4102 AM Culemborg",
      "BTW nummer: NL005169491B25",
      "Kvk nummer: 95691537",
      "Subtotaal € 79,95",
      "€ Totaal 96,74",
      "Hiervan is 96,74 euro reeds betaald op 20-01-2025 door middel",
      "van Mollie (iDEAL).",
      "Kvk: 73408441",
      "BTW nr: NL8595.20.572.B01",
      "5107 RJ Dongen",
      "de Slof 10G",
      "Superdoos B.V.",
      "E-mail: klantenservice@superdoos.nl",
      "IBAN: NL95 RABO 0336 3818 32",
    ].join("\n");
    const r = extractFieldsFromPages([page(1, text)], "superdoos.pdf");
    expect(r.vendor).toBe("Superdoos B.V.");
    expect(r.address).toBe("de Slof 10G, 5107 RJ Dongen");
    expect(r.vendorEmail).toBe("klantenservice@superdoos.nl");
    expect(r.iban).toBe("NL95RABO0336381832");
    expect(r.vatNumber).toBe("NL859520572B01");
    expect(r.businessRegistrationNumber).toBe("73408441");
  });
});
