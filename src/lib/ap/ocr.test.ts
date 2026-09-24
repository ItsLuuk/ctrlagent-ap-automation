import { describe, expect, it } from "bun:test";
import {
  extractFieldsFromPages,
  isValidVatFormat,
  preferAnchoredProfileValue,
  selectVisionPageNumbers,
} from "./ocr";

const page = (pageNumber: number, text: string) => ({ pageNumber, text });

describe("extractFieldsFromPages", () => {
  it("extracts Dutch invoice identity, dates, amounts, and line items", () => {
    const result = extractFieldsFromPages(
      [
        page(
          1,
          [
            "Northwind Services B.V.",
            "Currency: EUR",
            "Factuurnummer: NW-20481",
            "Factuurdatum: 12-04-2026",
            "Vervaldatum: 12-05-2026",
            "Consulting 1.000,00",
            "Subtotaal 1.000,00",
            "BTW 21% 210,00",
            "Totaal te betalen 1.210,00",
          ].join("\n"),
        ),
      ],
      "upload.pdf",
    );

    expect(result.vendor).toBe("Northwind Services B.V.");
    expect(result.invoiceNumber).toBe("NW-20481");
    expect(result.issueDate).toBe("2026-04-12");
    expect(result.dueDate).toBe("2026-05-12");
    expect(result.subtotal).toBe(1000);
    expect(result.tax).toBe(210);
    expect(result.total).toBe(1210);
    expect(result.currency).toBe("EUR");
    expect(result.lineItems.map((item) => item.description)).toContain("Consulting");
  });

  it("does not read a tax rate as the tax amount when the amount is on the next line", () => {
    const result = extractFieldsFromPages(
      [
        page(
          1,
          [
            "Northwind Services B.V.",
            "Subtotaal 1.000,00",
            "BTW 21%",
            "210,00",
            "Totaal 1.210,00",
          ].join("\n"),
        ),
      ],
      "upload.pdf",
    );

    expect(result.tax).toBe(210);
    expect(result.total).toBe(1210);
  });

  it("leaves tax empty when the invoice only shows a tax rate", () => {
    const result = extractFieldsFromPages(
      [page(1, "Northwind Services B.V.\nSubtotaal 1.000,00\nBTW 21%\nTotaal 1.000,00")],
      "upload.pdf",
    );

    expect(result.tax).toBeUndefined();
  });

  it("prefers labelled values on a later page over an unlabelled pattern", () => {
    const result = extractFieldsFromPages(
      [
        page(1, "Reference NW-10000\nAmount 200,00"),
        page(2, "Invoice number: NW-20481\nTotal due: 1.210,00"),
      ],
      "upload.pdf",
    );

    expect(result.invoiceNumber).toBe("NW-20481");
    expect(result.total).toBe(1210);
    expect(result.fieldSources.invoiceNumber).toBe(2);
    expect(result.fieldSources.total).toBe(2);
  });

  it("does not turn invalid calendar dates into extracted values", () => {
    const result = extractFieldsFromPages(
      [page(1, "Invoice date: 31-02-2026\nInvoice number: INV-77")],
      "upload.pdf",
    );

    expect(result.issueDate).toBeUndefined();
    expect(result.invoiceNumber).toBe("INV-77");
  });

  it("extracts supplier profile data and normalizes Dutch payment identifiers", () => {
    const result = extractFieldsFromPages(
      [
        page(
          1,
          [
            "Acme Nederland B.V.",
            "Keizersgracht 123, 1012 AB Amsterdam",
            "Leverancier email: finance@acme.nl",
            "BTW-nummer: NL123456789B01",
            "IBAN: NL91 ABNA 0417 1643 00",
            "Factuurnummer: AC-42",
          ].join("\n"),
        ),
      ],
      "upload.pdf",
    );

    expect(result.vendor).toBe("Acme Nederland B.V.");
    expect(result.address).toBe("Keizersgracht 123, 1012 AB Amsterdam");
    expect(result.vendorEmail).toBe("finance@acme.nl");
    expect(result.iban).toBe("NL91ABNA0417164300");
    expect(result.vatNumber).toBe("NL123456789B01");
    expect(result.fieldSources).toMatchObject({
      address: 1,
      vendorEmail: 1,
      iban: 1,
      vatNumber: 1,
    });
  });

  it("supports ISO dates and US currency formatting", () => {
    const result = extractFieldsFromPages(
      [page(1, "Acme LLC\nInvoice # AC-100\nDate: 2026-09-20\nTotal due: $1,234.56")],
      "upload.pdf",
    );

    expect(result.issueDate).toBe("2026-09-20");
    expect(result.total).toBe(1234.56);
    expect(result.currency).toBe("USD");
  });

  it("extracts Postbus address with postal code on next line", () => {
    const result = extractFieldsFromPages(
      [
        page(
          1,
          [
            "Stichting Groen Amsterdam",
            "Postbus 1234",
            "1012 AB Amsterdam",
            "Factuurnummer: SGA-2026-01",
          ].join("\n"),
        ),
      ],
      "upload.pdf",
    );

    expect(result.vendor).toBe("Stichting Groen Amsterdam");
    expect(result.address).toContain("Postbus");
    expect(result.address).toContain("Amsterdam");
  });

  it("detects V.O.F. and Stichting as vendor names", () => {
    const resultVof = extractFieldsFromPages(
      [page(1, "Partners Advies V.O.F.\nFactuurnummer: PA-001")],
      "upload.pdf",
    );
    expect(resultVof.vendor).toBe("Partners Advies V.O.F.");

    const resultStichting = extractFieldsFromPages(
      [page(1, "Stichting Warmte Nederland\nFactuurnummer: SWN-042")],
      "upload.pdf",
    );
    expect(resultStichting.vendor).toBe("Stichting Warmte Nederland");
  });

  it("normalizes BTW-identificatienummer with various label formats", () => {
    const result1 = extractFieldsFromPages(
      [page(1, "BTW-identificatienummer: NL862345678B01\nTotal 100,00")],
      "upload.pdf",
    );
    expect(result1.vatNumber).toBe("NL862345678B01");

    const result2 = extractFieldsFromPages(
      [page(1, "BTW nr: NL001234567B01\nTotal 100,00")],
      "upload.pdf",
    );
    expect(result2.vatNumber).toBe("NL001234567B01");

    const result3 = extractFieldsFromPages(
      [page(1, "VAT identification number NL123456789B01\nTotal 100,00")],
      "upload.pdf",
    );
    expect(result3.vatNumber).toBe("NL123456789B01");
  });

  it("extracts F-prefix Dutch invoice numbers", () => {
    const result = extractFieldsFromPages(
      [page(1, "Factuurnummer F00123\nTotaal 3.500,00")],
      "upload.pdf",
    );
    expect(result.invoiceNumber).toBe("F00123");
  });

  it("extracts date-based Dutch invoice numbers (YYYYMMDD-XXX)", () => {
    const result = extractFieldsFromPages(
      [page(1, "Factuurnummer: 20260412-003\nTotaal 780,00")],
      "upload.pdf",
    );
    expect(result.invoiceNumber).toBe("20260412-003");
  });

  it("parses line items with Dutch units (stuks, uren, etc.)", () => {
    const result = extractFieldsFromPages(
      [
        page(
          1,
          [
            "Papier A4 10 stuks x €12,50 125,00",
            "Toner cartridge 2 x €89,00 178,00",
            "Consulting 8 uur x €150,00 1.200,00",
            "Subtotaal 1.503,00",
            "Totaal 1.503,00",
          ].join("\n"),
        ),
      ],
      "upload.pdf",
    );
    expect(result.lineItems.length).toBeGreaterThanOrEqual(2);
    const descriptions = result.lineItems.map((i) => i.description);
    expect(descriptions.some((d) => d.includes("Papier"))).toBe(true);
    expect(descriptions.some((d) => d.includes("Toner"))).toBe(true);
  });

  it("extracts supplier IBAN with various spacing patterns", () => {
    const result = extractFieldsFromPages(
      [page(1, "IBAN: NL20 INGB 0001 2345 67\nTotal 100,00")],
      "upload.pdf",
    );
    expect(result.iban).toBe("NL20INGB0001234567");
  });

  it("prefers labelled vendor from 'Factuur van:' line", () => {
    const result = extractFieldsFromPages(
      [page(1, "Factuur van: Acme B.V.\nFactuurnummer: AC-1")],
      "upload.pdf",
    );
    expect(result.vendor).toBe("Acme B.V.");
  });

  it("extracts multiple Dutch supplier fields together", () => {
    const result = extractFieldsFromPages(
      [
        page(
          1,
          [
            "Bouwbedrijf De Vries B.V.",
            "Industrieweg 15",
            "5612 AB Eindhoven",
            "E-mail: info@devries-bouw.nl",
            "BTW-identificatienummer NL812345678B01",
            "IBAN NL55RABO0319564893",
            "Factuurnummer: BDV-2026-042",
            "Factuurdatum: 10-04-2026",
            "Vervaldatum: 10-05-2026",
            "Bouwmaterialen 2.500,00",
            "Subtotaal 2.500,00",
            "BTW 21% 525,00",
            "Totaal te betalen 3.025,00",
          ].join("\n"),
        ),
      ],
      "upload.pdf",
    );

    expect(result.vendor).toBe("Bouwbedrijf De Vries B.V.");
    expect(result.address).toContain("Industrieweg 15");
    expect(result.vendorEmail).toBe("info@devries-bouw.nl");
    expect(result.vatNumber).toBe("NL812345678B01");
    expect(result.iban).toBe("NL55RABO0319564893");
    expect(result.invoiceNumber).toBe("BDV-2026-042");
    expect(result.issueDate).toBe("2026-04-10");
    expect(result.dueDate).toBe("2026-05-10");
    expect(result.subtotal).toBe(2500);
    expect(result.tax).toBe(525);
    expect(result.total).toBe(3025);
  });
});

describe("selectVisionPageNumbers", () => {
  it("keeps the first and last pages and routes signal pages", () => {
    expect(
      selectVisionPageNumbers([
        { pageNumber: 1, text: "Acme invoice" },
        { pageNumber: 2, text: "Consulting 10,00" },
        { pageNumber: 3, text: "Line items 20,00" },
        { pageNumber: 4, text: "IBAN NL91 ABNA 0417 1643 00" },
        { pageNumber: 5, text: "Total due 30,00" },
      ]),
    ).toEqual([1, 4, 5]);
  });

  it("does not discard a short invoice", () => {
    expect(
      selectVisionPageNumbers([
        { pageNumber: 1, text: "invoice" },
        { pageNumber: 2, text: "line items" },
      ]),
    ).toEqual([1, 2]);
  });

  it("routes Dutch and English payment labels", () => {
    expect(
      selectVisionPageNumbers([
        { pageNumber: 1, text: "header" },
        { pageNumber: 2, text: "Bankrekening leverancier" },
        { pageNumber: 3, text: "Beneficiary account details" },
        { pageNumber: 4, text: "notes" },
      ]),
    ).toEqual([1, 2, 3, 4]);
  });
});

// ---------------------------------------------------------------------------
// Vendor-name-aware extraction
// ---------------------------------------------------------------------------
describe("vendor-name-aware extraction", () => {
  it("prefers email whose domain matches the vendor name", () => {
    const r = extractFieldsFromPages(
      [
        page(
          1,
          [
            "Acme Nederland B.V.",
            "E-mail: info@acme.nl",
            "Contact: support@partner-mail.com",
            "Totaal 100,00",
          ].join("\n"),
        ),
      ],
      "x.pdf",
    );
    // Should prefer info@acme.nl over support@partner-mail.com
    expect(r.vendorEmail).toBe("info@acme.nl");
  });

  it("prefers email whose prefix matches the vendor name", () => {
    const r = extractFieldsFromPages(
      [
        page(
          1,
          ["Acme Nederland B.V.", "billing@unrelated-domain.com", "Totaal 100,00"].join("\n"),
        ),
      ],
      "x.pdf",
    );
    // Even without domain match, the system should find the email
    expect(r.vendorEmail).toBe("billing@unrelated-domain.com");
  });

  it("filters out noreply and generic emails", () => {
    const r = extractFieldsFromPages(
      [
        page(
          1,
          ["Acme Nederland B.V.", "noreply@acme.nl", "facturatie@acme.nl", "Totaal 100,00"].join(
            "\n",
          ),
        ),
      ],
      "x.pdf",
    );
    // Should prefer facturatie@acme.nl over noreply@acme.nl
    expect(r.vendorEmail).toBe("facturatie@acme.nl");
  });

  it("prefers IBAN near the vendor name when multiple exist", () => {
    const r = extractFieldsFromPages(
      [
        page(
          1,
          [
            "Acme Nederland B.V.",
            "IBAN: NL91ABNA0417164300",
            "",
            "Klant:",
            "PostNL Pakketten B.V.",
            "IBAN: NL89INGB0012345678",
            "Totaal 100,00",
          ].join("\n"),
        ),
      ],
      "x.pdf",
    );
    // Should prefer the IBAN near Acme (the vendor) over PostNL (the customer)
    expect(r.iban).toBe("NL91ABNA0417164300");
  });

  it("vendor name slug matching works for complex names", () => {
    // Test that "Bouwbedrijf Van der Berg B.V." slugifies to "bouwbedrijfvanderberg"
    // and matches email domains like "vandenberg-bouw.nl"
    const r = extractFieldsFromPages(
      [
        page(
          1,
          [
            "Bouwbedrijf Van der Berg B.V.",
            "E-mail: info@vandenberg-bouw.nl",
            "Totaal 500,00",
          ].join("\n"),
        ),
      ],
      "x.pdf",
    );
    expect(r.vendorEmail).toBe("info@vandenberg-bouw.nl");
  });
});

describe("preferAnchoredProfileValue", () => {
  const email = "klantenservice@superdoos.nl";

  it("overrides a customer-side number with the vendor-block read", () => {
    expect(preferAnchoredProfileValue("95691537", "73408441", email)).toBe("73408441");
  });

  it("keeps an already-correct value", () => {
    expect(preferAnchoredProfileValue("73408441", "73408441", email)).toBe("73408441");
  });

  it("fills an empty value from the anchored read", () => {
    expect(preferAnchoredProfileValue(undefined, "73408441", email)).toBe("73408441");
  });

  it("never touches the value without an email anchor", () => {
    expect(preferAnchoredProfileValue("95691537", "73408441", undefined)).toBe("95691537");
    expect(preferAnchoredProfileValue(undefined, "73408441", undefined)).toBeUndefined();
  });

  it("keeps current when the anchored reader found nothing", () => {
    expect(preferAnchoredProfileValue("95691537", undefined, email)).toBe("95691537");
  });
});

describe("extractFieldsFromPages: real invoice KVK/BTW edge cases", () => {
  // From the three attached sample invoices:
  //   Superdoos.nl invoice.pdf  — two KVKs (customer 95691537 + supplier 73408441),
  //                                customer BTW NL005169491B25, supplier BTW NL859520572B01.
  //   Invoice-RAX3IIUH-0002.pdf — US invoice (Anoma), NO KVK, NO BTW.
  //   factuur_2607551285.pdf    — Websend/50+ Mobiel, KVK written with spaces
  //                                ("KVK 27 289 206") → 27289206, BTW NL815982434B01.

  it("extracts the supplier KVK and BTW from the Superdoos invoice (not the customer ones)", () => {
    const r = extractFieldsFromPages(
      [
        page(
          1,
          [
            "Orbi Earplugs",
            "Ravelijnstraat 40",
            "4102 AM Culemborg",
            "Nederland",
            "Ordernummer: 54773",
            "Klantnummer: 91939",
            "Jouw contactpersoon: Jaap van der Heijden",
            "Datum: 20-01-2025",
            "Betalingsconditie: 14 dagen",
            "Web-ordernummer: 000003884",
            "Luuk Koppen",
            "Orbi Earplugs",
            "Ravelijnstraat 40",
            "4102 AM Culemborg",
            "BTW nummer: NL005169491B25",
            "Kvk nummer: 95691537",
            "Nederland",
            "Super-Klant",
            "Subtotaal € 79,95",
            "BTW 21% € 16,79",
            "Totaal € 96,74",
            "Hiervan is 96,74 euro reeds betaald op 20-01-2025",
            "Pagina 1 van 2",
            "Kvk: 73408441",
            "BTW nr: NL8595.20.572.B01",
            "Tel: +31(0)85 077 3684",
            "5107 RJ Dongen",
            "de Slof 10G",
            "Superdoos B.V.",
            "E-mail: klantenservice@superdoos.nl",
            "BIC: RABONL2U",
            "IBAN: NL95 RABO 0336 3818 32",
            "Nederland",
          ].join("\n"),
        ),
      ],
      "superdoos.pdf",
    );
    // Supplier KVK in the footer block must win over the customer block KVK.
    expect(r.businessRegistrationNumber).toBe("73408441");
    // Supplier BTW (footer) must win over the customer BTW (bill-to block).
    expect(r.vatNumber).toBe("NL859520572B01");
    // The invoice is paid — prepaid flag should be set.
    expect(r.prepaid).toBe(true);
    expect(r.prepaidPhrase).toContain("reeds betaald");
    // Order confirmation has no Factuurnummer — Ordernummer is the id, and
    // all four critical heuristic fields must land so the VLM path is skipped.
    expect(r.invoiceNumber).toBe("54773");
    expect(r.issueDate).toBe("2025-01-20");
    expect(r.total).toBe(96.74);
    expect(r.vendor).toBe("Superdoos B.V.");
  });

  it("extracts no KVK and no BTW from the US Anoma invoice", () => {
    const r = extractFieldsFromPages(
      [
        page(
          1,
          [
            "Pagina 1 van 1",
            "Factuur",
            "Factuurnummer RAX3IIUH-0002",
            "Uitgiftedatum 13 juli 2026",
            "Vervaldatum 13 juli 2026",
            "Anomaly",
            "2443 Fillmore Street",
            "#380-6343",
            "San Francisco, California 94115",
            "Verenigde Staten",
            "+1 415-712-4747",
            "help@anoma.ly",
            "Factuur aan",
            "Luuk Chris Koppen",
            "Ravelijnstraat 40",
            "4102 AM Culemborg",
            "Nederland",
            "Luuk.c.koppen@gmail.com",
            "US$ 10,00 vervalt op 13 juli 2026",
            "Beschrijving Aantal Eenheidsprijs Bedrag",
            "OpenCode Go 13 jul 2026–13 aug 2026 1 US$ 10,00 US$ 10,00",
            "Subtotaal US$ 10,00",
            "Totaal US$ 10,00",
            "Te betalen bedrag US$ 10,00",
          ].join("\n"),
        ),
      ],
      "anoma.pdf",
    );
    // US invoice has no Dutch KVK and no EU VAT — both must be absent.
    expect(r.businessRegistrationNumber).toBeUndefined();
    expect(r.vatNumber).toBeUndefined();
    // Recognizable fields should still extract.
    expect(r.vendor).toBe("Anomaly");
    expect(r.vendorEmail).toBe("help@anoma.ly");
    expect(r.invoiceNumber).toBe("RAX3IIUH-0002");
    expect(r.currency).toBe("USD");
    expect(r.total).toBe(10);
  });

  it("normalizes a spaced KVK (KVK 27 289 206) to 27289206", () => {
    const r = extractFieldsFromPages(
      [
        page(
          1,
          [
            "Factuur",
            "Dhr. L.C.K. Koppen",
            "Ravelijnstraat 40",
            "4102AM Culemborg",
            "Factuurdatum: 27-06-2026",
            "Factuurnummer: 2607551285",
            "Ordernummer: 5068527",
            "Abonnement 50+ Mobiel 2 jaar sim only",
            "Ingangsdatum: 27-07-2026",
            "Totaalbedrag: € 2,50 p.m.",
            "€ 0,00",
            "Bezoekadres Nieuwstraat 22 2266AD Leidschendam",
            "Postadres Postbus 155 2260AD Leidschendam",
            "Bedrijfsgegevens",
            "Contact",
            "NL50 ABNA 0403 6121 01",
            "t.n.v. Websend BV",
            "KVK 27 289 206",
            "BTW NL815982434B01",
            "06 - 24 96 66 02",
            "e: info@mobiel.nl",
          ].join("\n"),
        ),
      ],
      "websend.pdf",
    );
    // KVK printed with spaces must normalize to 8 consecutive digits.
    expect(r.businessRegistrationNumber).toBe("27289206");
    expect(r.vatNumber).toBe("NL815982434B01");
    expect(r.iban).toBe("NL50ABNA0403612101");
    expect(r.vendor).toBe("Websend BV");
  });
});

describe("isValidVatFormat (EU table)", () => {
  it("accepts Dutch numbers (10th char must be B)", () => {
    expect(isValidVatFormat("NL123456789B01")).toBe(true);
    expect(isValidVatFormat("NL8595.20.572.B01")).toBe(true);
    expect(isValidVatFormat("NL123456789B1")).toBe(false);
    expect(isValidVatFormat("NL123456789X01")).toBe(false);
  });

  it("accepts neighboring states", () => {
    expect(isValidVatFormat("DE123456789")).toBe(true);
    expect(isValidVatFormat("BE0123456789")).toBe(true);
    expect(isValidVatFormat("BE123456789")).toBe(false);
    expect(isValidVatFormat("FRXX999999999")).toBe(true);
    expect(isValidVatFormat("ATU12345678")).toBe(true);
    expect(isValidVatFormat("DK12345678")).toBe(true);
  });

  it("accepts special forms (GB variants, IE, ES, RO range)", () => {
    expect(isValidVatFormat("GB123456789")).toBe(true);
    expect(isValidVatFormat("GB123456789123")).toBe(true);
    expect(isValidVatFormat("GBGD123")).toBe(true);
    expect(isValidVatFormat("GBHA123")).toBe(true);
    expect(isValidVatFormat("IE9S99999L")).toBe(true);
    expect(isValidVatFormat("ESX9999999X")).toBe(true);
    expect(isValidVatFormat("ES99999999X")).toBe(true);
    expect(isValidVatFormat("ES999999999")).toBe(false);
    expect(isValidVatFormat("RO12")).toBe(true);
    expect(isValidVatFormat("RO1234567890")).toBe(true);
    expect(isValidVatFormat("RO1")).toBe(false);
    expect(isValidVatFormat("EL123456789")).toBe(true);
  });

  it("rejects garbage and unknown prefixes", () => {
    expect(isValidVatFormat("NLDE123456789")).toBe(false);
    expect(isValidVatFormat("12345678")).toBe(false);
    expect(isValidVatFormat("XX123456789")).toBe(false);
    expect(isValidVatFormat("")).toBe(false);
  });
});

describe("extractFieldsFromPages: foreign VAT numbers", () => {
  it("reads a German BTW number without NL-mangling", () => {
    const r = extractFieldsFromPages(
      [
        page(
          1,
          [
            "Muster GmbH",
            "E-mail: info@muster.de",
            "USt-IdNr: DE123456789",
            "Totaal € 100,00",
          ].join("\n"),
        ),
      ],
      "de.pdf",
    );
    expect(r.vatNumber).toBe("DE123456789");
  });

  it("prefers the vendor footer BTW over the customer BTW (Belgian pair)", () => {
    const r = extractFieldsFromPages(
      [
        page(
          1,
          [
            "Klant: Janssen BVBA",
            "BTW: BE0123456789",
            "Fournisseur: Dupont SPRL",
            "E-mail: info@dupont.be",
            "IBAN: BE71096123456789",
            "BTW: BE0987654321",
            "Totaal € 100,00",
          ].join("\n"),
        ),
      ],
      "be.pdf",
    );
    expect(r.vatNumber).toBe("BE0987654321");
  });
});
