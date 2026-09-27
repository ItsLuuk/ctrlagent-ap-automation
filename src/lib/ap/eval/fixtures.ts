/**
 * Extraction eval — labeled fixtures.
 *
 * Each fixture pairs the *ground truth* a human would enter with the inputs a
 * given pipeline stage needs:
 *
 *   heuristic — page text (what a digital PDF or OCR produces) →
 *               `extractFieldsFromPages`
 *   vlm       — raw model JSON per page (captured from the local VLM) →
 *               `parseVisionPage` → `mergeVisionPages` → `visionPageToFields`
 *   template  — page words + a learned `AnchorSpec` per field →
 *               `applyTemplateField`
 *
 * Expected values are the true invoice values, never "whatever the code
 * returns" — a fixture that fails is a real extraction miss, not a bug in the
 * fixture. Add cases freely; the report is the source of truth.
 */
import type { AnchorSpec, OcrWord, ZoneField } from "../types";
import type { PageRead } from "../ocr";
import type { FieldValues } from "./score";

export type Fixture =
  | { id: string; source: "heuristic"; fileName: string; pages: PageRead[]; expected: FieldValues }
  | { id: string; source: "vlm"; rawPages: string[]; expected: FieldValues }
  | {
      id: string;
      source: "template";
      words: OcrWord[];
      specs: Partial<Record<ZoneField, AnchorSpec>>;
      expected: FieldValues;
    };

const page = (pageNumber: number, text: string): PageRead => ({ pageNumber, text });

function word(text: string, x: number, y: number, w: number, h = 0.03, confidence = 0.95): OcrWord {
  return { text, x, y, w, h, confidence };
}

type TemplateRow = {
  field: Exclude<ZoneField, "vendor">;
  label: string;
  /** Raw value text as it appears on the page (Dutch day-first dates, etc.). */
  raw: string;
  /** Ground-truth value, already normalized. */
  expected: string | number;
  /** Override the stored anchor (simulates an OCR-mangled learned anchor). */
  anchor?: string;
  valueConfidence?: number;
  /** A stray word inside the value region (OCR drift / adjacent column). */
  decoy?: string;
};

function typeForField(field: ZoneField): AnchorSpec["type"] {
  if (field === "subtotal" || field === "tax" || field === "total") return "decimal";
  if (field === "issueDate" || field === "dueDate") return "date";
  return "string";
}

/**
 * Builds the anchor-relative region the way a real learned template stores it:
 * relative to the anchor word's box. When `decoy` is present the region is
 * widened to swallow it, reproducing an over-wide learned zone.
 */
function templateSpec(
  anchorWord: OcrWord,
  valueWord: OcrWord,
  decoy: OcrWord | undefined,
  type: AnchorSpec["type"],
  anchorOverride: string | undefined,
): AnchorSpec {
  const pad = 0.004;
  const right = decoy ? decoy.x + decoy.w : valueWord.x + valueWord.w;
  const bottom = Math.max(valueWord.y + valueWord.h, decoy ? decoy.y + decoy.h : 0);
  return {
    anchor: anchorOverride ?? anchorWord.text,
    region: {
      x0: (valueWord.x - pad - anchorWord.x) / anchorWord.w,
      y0: (valueWord.y - pad - anchorWord.y) / anchorWord.h,
      x1: (right + pad - anchorWord.x) / anchorWord.w,
      y1: (bottom + pad - anchorWord.y) / anchorWord.h,
    },
    type,
  };
}

function templateFixture(
  id: string,
  rows: TemplateRow[],
  options?: { valueShiftY?: number },
): Fixture {
  const words: OcrWord[] = [];
  const specs: Partial<Record<ZoneField, AnchorSpec>> = {};
  const expected: FieldValues = {};

  rows.forEach((row, index) => {
    const y = 0.18 + index * 0.07;
    const anchorWord = word(row.label, 0.08, y, Math.max(0.06, row.label.length * 0.009));
    // Geometry the template was learned at; the actual word may be drawn
    // elsewhere to simulate layout drift between learning and this invoice.
    const baseValueWord = word(
      row.raw,
      0.55,
      y,
      Math.max(0.06, row.raw.length * 0.012),
      0.03,
      row.valueConfidence ?? 0.95,
    );
    const valueWord = options?.valueShiftY
      ? { ...baseValueWord, y: baseValueWord.y + options.valueShiftY }
      : baseValueWord;
    const decoyWord = row.decoy ? word(row.decoy, 0.86, valueWord.y, 0.06, 0.03, 0.9) : undefined;

    words.push(anchorWord, valueWord);
    if (decoyWord) words.push(decoyWord);
    specs[row.field] = templateSpec(
      anchorWord,
      baseValueWord,
      decoyWord,
      typeForField(row.field),
      row.anchor,
    );
    expected[row.field] = row.expected;
  });

  return { id, source: "template", words, specs, expected };
}

const TEMPLATE_ROWS: TemplateRow[] = [
  {
    field: "invoiceNumber",
    label: "Factuurnummer:",
    raw: "NW-20481",
    expected: "NW-20481",
  },
  {
    field: "issueDate",
    label: "Factuurdatum:",
    raw: "12-04-2026",
    expected: "2026-04-12",
  },
  {
    field: "dueDate",
    label: "Vervaldatum:",
    raw: "12-05-2026",
    expected: "2026-05-12",
  },
  { field: "subtotal", label: "Subtotaal", raw: "1.000,00", expected: 1000 },
  { field: "tax", label: "BTW", raw: "210,00", expected: 210 },
  { field: "total", label: "Totaal", raw: "1.210,00", expected: 1210 },
];

export const FIXTURES: Fixture[] = [
  // ---- Heuristic path: text → extractFieldsFromPages ---------------------
  {
    id: "heuristic/nl-standard",
    source: "heuristic",
    fileName: "northwind-20481.pdf",
    pages: [
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
    expected: {
      vendor: "Northwind Services B.V.",
      invoiceNumber: "NW-20481",
      issueDate: "2026-04-12",
      dueDate: "2026-05-12",
      subtotal: 1000,
      tax: 210,
      total: 1210,
      currency: "EUR",
    },
  },
  {
    id: "heuristic/en-standard",
    source: "heuristic",
    fileName: "acme-5521.pdf",
    pages: [
      page(
        1,
        [
          "Acme Industrial Supply",
          "Invoice number: AIS-5521",
          "Invoice date: 2026-07-01",
          "Due date: 2026-07-31",
          "Steel brackets 1,250.00",
          "Subtotal $1,250.00",
          "Tax $62.50",
          "Total due $1,312.50",
        ].join("\n"),
      ),
    ],
    expected: {
      vendor: "Acme Industrial Supply",
      invoiceNumber: "AIS-5521",
      issueDate: "2026-07-01",
      dueDate: "2026-07-31",
      subtotal: 1250,
      tax: 62.5,
      total: 1312.5,
      currency: "USD",
    },
  },
  {
    id: "heuristic/multipage-labelled",
    source: "heuristic",
    fileName: "contoso-3300.pdf",
    pages: [
      page(1, ["Contoso Logistics GmbH", "Reference PO-8891"].join("\n")),
      page(2, ["Invoice number: CTL-3300", "Total due: € 2.500,00"].join("\n")),
    ],
    expected: {
      vendor: "Contoso Logistics GmbH",
      invoiceNumber: "CTL-3300",
      total: 2500,
      currency: "EUR",
    },
  },
  {
    id: "heuristic/no-tax",
    source: "heuristic",
    fileName: "bakkerij-0007.pdf",
    pages: [
      page(
        1,
        [
          "Bakkerij Jansen",
          "Factuurnummer: BJ-0007",
          "Factuurdatum: 03-03-2026",
          "Vervaldatum: 17-03-2026",
          "Brood 250,00",
          "Totaal te betalen 250,00",
        ].join("\n"),
      ),
    ],
    expected: {
      vendor: "Bakkerij Jansen",
      invoiceNumber: "BJ-0007",
      issueDate: "2026-03-03",
      dueDate: "2026-03-17",
      total: 250,
    },
  },
  {
    id: "heuristic/minimal",
    source: "heuristic",
    fileName: "jansen-x100.pdf",
    pages: [page(1, ["Jansen B.V.", "Factuurnummer: X-100", "Totaal 99,00"].join("\n"))],
    expected: {
      vendor: "Jansen B.V.",
      invoiceNumber: "X-100",
      total: 99,
    },
  },

  // ---- Heuristic path: additional Dutch edge cases ------------------------
  {
    id: "heuristic/nl-dutch-month-date",
    source: "heuristic",
    fileName: "leverancier-april.pdf",
    pages: [
      page(
        1,
        [
          "TechStart B.V.",
          "Factuurnummer: TS-2026-001",
          "Factuurdatum: 12 april 2026",
          "Vervaldatum: 12 mei 2026",
          "Subtotaal 2.000,00",
          "BTW 21% 420,00",
          "Totaal 2.420,00",
        ].join("\n"),
      ),
    ],
    expected: {
      vendor: "TechStart B.V.",
      invoiceNumber: "TS-2026-001",
      issueDate: "2026-04-12",
      dueDate: "2026-05-12",
      subtotal: 2000,
      tax: 420,
      total: 2420,
    },
  },
  {
    id: "heuristic/nl-no-cents-amounts",
    source: "heuristic",
    fileName: "rondleidingen.pdf",
    pages: [
      page(
        1,
        [
          "Rondleidingen Amsterdam B.V.",
          "Factuurnummer: RA-0088",
          "Factuurdatum: 01-03-2026",
          "Stadswandeling 3.500,00",
          "Subtotaal 3.500,00",
          "BTW 21% 735,00",
          "Totaal 4.235,00",
        ].join("\n"),
      ),
    ],
    expected: {
      vendor: "Rondleidingen Amsterdam B.V.",
      invoiceNumber: "RA-0088",
      issueDate: "2026-03-01",
      subtotal: 3500,
      tax: 735,
      total: 4235,
    },
  },
  {
    id: "heuristic/nl-credit-note",
    source: "heuristic",
    fileName: "credit-042.pdf",
    pages: [
      page(
        1,
        [
          "Acme B.V.",
          "Creditfactuur",
          "Factuurnummer: CR-042",
          "Factuurdatum: 15-06-2026",
          "Verrekeningsbedrag €250,00",
          "Totaal €250,00",
        ].join("\n"),
      ),
    ],
    expected: {
      vendor: "Acme B.V.",
      invoiceNumber: "CR-042",
      issueDate: "2026-06-15",
      total: 250,
      currency: "EUR",
    },
  },

  // ---- VLM path: additional Dutch scenarios -------------------------------
  {
    id: "vlm/dutch-invoice-full-profile",
    source: "vlm",
    rawPages: [
      JSON.stringify({
        vendor: "Bouwbedrijf De Vries B.V.",
        address: "Industrieweg 15, 5612 AB Eindhoven",
        vendorEmail: "info@devries-bouw.nl",
        iban: "NL55RABO0319564893",
        vatNumber: "NL812345678B01",
        invoiceNumber: "BDV-2026-042",
        issueDate: "2026-04-10",
        dueDate: "2026-05-10",
        subtotal: 2500,
        tax: 525,
        total: 3025,
        currency: "EUR",
        lineItems: [
          { description: "Houten kozijnen", quantity: 4, unitPrice: 450, amount: 1800 },
          { description: "Schilderwerk", quantity: 20, unitPrice: 35, amount: 700 },
        ],
      }),
    ],
    expected: {
      vendor: "Bouwbedrijf De Vries B.V.",
      address: "Industrieweg 15, 5612 AB Eindhoven",
      vendorEmail: "info@devries-bouw.nl",
      iban: "NL55RABO0319564893",
      vatNumber: "NL812345678B01",
      invoiceNumber: "BDV-2026-042",
      issueDate: "2026-04-10",
      dueDate: "2026-05-10",
      subtotal: 2500,
      tax: 525,
      total: 3025,
      currency: "EUR",
    },
  },
  {
    id: "vlm/dutch-stichting-zero-btw",
    source: "vlm",
    rawPages: [
      JSON.stringify({
        vendor: "Stichting Groen Amsterdam",
        invoiceNumber: "SGA-2026-01",
        issueDate: "2026-06-01",
        subtotal: 500,
        tax: 0,
        total: 500,
        currency: "EUR",
        lineItems: [],
      }),
    ],
    expected: {
      vendor: "Stichting Groen Amsterdam",
      invoiceNumber: "SGA-2026-01",
      issueDate: "2026-06-01",
      subtotal: 500,
      tax: 0,
      total: 500,
      currency: "EUR",
    },
  },
  {
    id: "vlm/dutch-multipage-full",
    source: "vlm",
    rawPages: [
      JSON.stringify({
        vendor: "Conclusion ICT B.V.",
        address: "Oudegracht 123, 3511 PC Utrecht",
        vendorEmail: "facturatie@conclusion.nl",
        iban: "NL91ABNA0417164300",
        vatNumber: "NL812345678B01",
        invoiceNumber: "CIC-2026-0842",
        issueDate: "2026-04-15",
        dueDate: "2026-05-15",
        subtotal: 8645,
        tax: 1815.45,
        total: 10460.45,
        currency: "EUR",
        lineItems: [
          { description: "Software ontwikkeling", quantity: 40, unitPrice: 150, amount: 6000 },
          { description: "Project management", quantity: 16, unitPrice: 150, amount: 2400 },
          { description: "Reiskosten", quantity: 1, unitPrice: 245, amount: 245 },
        ],
      }),
    ],
    expected: {
      vendor: "Conclusion ICT B.V.",
      address: "Oudegracht 123, 3511 PC Utrecht",
      vendorEmail: "facturatie@conclusion.nl",
      iban: "NL91ABNA0417164300",
      vatNumber: "NL812345678B01",
      invoiceNumber: "CIC-2026-0842",
      issueDate: "2026-04-15",
      dueDate: "2026-05-15",
      subtotal: 8645,
      tax: 1815.45,
      total: 10460.45,
      currency: "EUR",
    },
  },

  // ---- VLM path: raw model JSON → visionPageToFields -----------------------
  {
    id: "vlm/clean",
    source: "vlm",
    rawPages: [
      JSON.stringify({
        vendor: "Vertex Facilities Group",
        invoiceNumber: "VF-3025",
        issueDate: "2026-08-24",
        dueDate: "2026-09-23",
        subtotal: 7450,
        tax: 633.25,
        total: 8083.25,
        currency: "EUR",
        lineItems: [{ description: "Facilities retainer", amount: 6200 }],
      }),
    ],
    expected: {
      vendor: "Vertex Facilities Group",
      invoiceNumber: "VF-3025",
      issueDate: "2026-08-24",
      dueDate: "2026-09-23",
      subtotal: 7450,
      tax: 633.25,
      total: 8083.25,
      currency: "EUR",
    },
  },
  {
    id: "vlm/fenced-prose",
    source: "vlm",
    rawPages: [
      [
        "Sure, here is the data:",
        "```json",
        JSON.stringify({
          vendor: "Helix Legal LLP",
          invoiceNumber: "HLX-1188",
          issueDate: "2026-09-01",
          dueDate: "2026-09-30",
          subtotal: 9600,
          tax: 0,
          total: 9600,
          currency: "EUR",
        }),
        "```",
        "Hope that helps!",
      ].join("\n"),
    ],
    expected: {
      vendor: "Helix Legal LLP",
      invoiceNumber: "HLX-1188",
      issueDate: "2026-09-01",
      dueDate: "2026-09-30",
      subtotal: 9600,
      tax: 0,
      total: 9600,
      currency: "EUR",
    },
  },
  {
    id: "vlm/dutch-decimal-strings",
    source: "vlm",
    rawPages: [
      JSON.stringify({
        vendor: "Atlas Print & Signage",
        invoiceNumber: "AP-7741",
        issueDate: "2026-08-16",
        dueDate: "2026-08-31",
        subtotal: "3.250,00",
        tax: "276,25",
        total: "3.526,25",
        currency: "EUR",
      }),
    ],
    expected: {
      vendor: "Atlas Print & Signage",
      invoiceNumber: "AP-7741",
      issueDate: "2026-08-16",
      dueDate: "2026-08-31",
      subtotal: 3250,
      tax: 276.25,
      total: 3526.25,
      currency: "EUR",
    },
  },
  {
    id: "vlm/european-amounts-with-symbols",
    source: "vlm",
    rawPages: [
      JSON.stringify({
        vendor: "Bakkerij Jansen",
        invoiceNumber: "BJ-0007",
        issueDate: "2026-03-03",
        dueDate: "2026-03-17",
        subtotal: "€ 1.000,00",
        tax: "€ 210,00",
        total: "€ 1.210,00",
        currency: "EUR",
      }),
    ],
    expected: {
      vendor: "Bakkerij Jansen",
      invoiceNumber: "BJ-0007",
      issueDate: "2026-03-03",
      dueDate: "2026-03-17",
      subtotal: 1000,
      tax: 210,
      total: 1210,
      currency: "EUR",
    },
  },
  {
    id: "vlm/multipage-merge",
    source: "vlm",
    rawPages: [
      JSON.stringify({ vendor: "Lumen Hardware Supply", invoiceNumber: "LHS-88420" }),
      JSON.stringify({
        issueDate: "2026-08-10",
        dueDate: "2026-09-07",
        subtotal: 12980,
        tax: 1103.3,
        total: 14083.3,
        currency: "EUR",
        lineItems: [{ description: "Laptops", amount: 11800 }],
      }),
    ],
    expected: {
      vendor: "Lumen Hardware Supply",
      invoiceNumber: "LHS-88420",
      issueDate: "2026-08-10",
      dueDate: "2026-09-07",
      subtotal: 12980,
      tax: 1103.3,
      total: 14083.3,
      currency: "EUR",
    },
  },

  // ---- Heuristic path: Dutch-specific edge cases ---------------------------
  {
    id: "heuristic/nl-postbus-address",
    source: "heuristic",
    fileName: "postbus-leverancier.pdf",
    pages: [
      page(
        1,
        [
          "Stichting Groen Amsterdam",
          "Postbus 1234",
          "1012 AB Amsterdam",
          "Factuurnummer: SGA-2026-01",
          "Factuurdatum: 01-06-2026",
          "Totaal 500,00",
        ].join("\n"),
      ),
    ],
    expected: {
      vendor: "Stichting Groen Amsterdam",
      invoiceNumber: "SGA-2026-01",
      issueDate: "2026-06-01",
      total: 500,
    },
  },
  {
    id: "heuristic/nl-postal-code-on-own-line",
    source: "heuristic",
    fileName: "dijkema-bv.pdf",
    pages: [
      page(
        1,
        [
          "Dijkema V.O.F.",
          "Keizersgracht 42",
          "1015 CJ Amsterdam",
          "BTW: NL862345678B01",
          "Factuurnummer: DK-881",
          "Subtotaal 2.400,00",
          "BTW 21% 504,00",
          "Totaal 2.904,00",
        ].join("\n"),
      ),
    ],
    expected: {
      vendor: "Dijkema V.O.F.",
      address: "Keizersgracht 42, 1015 CJ Amsterdam",
      vatNumber: "NL862345678B01",
      invoiceNumber: "DK-881",
      subtotal: 2400,
      tax: 504,
      total: 2904,
    },
  },
  {
    id: "heuristic/nl-eenmanszaak",
    source: "heuristic",
    fileName: "pieters-consultancy.pdf",
    pages: [
      page(
        1,
        [
          "Pieters Consultancy Eenmanszaak",
          "IBAN: NL20INGB0001234567",
          "BTW-identificatienummer: NL001234567B01",
          "Factuurnummer: PC-100",
          "Factuurdatum: 15-01-2026",
          "Vervaldatum: 15-02-2026",
          "Advies 8 uur x €150,00 1.200,00",
          "Subtotaal 1.200,00",
          "BTW 21% 252,00",
          "Totaal te betalen 1.452,00",
        ].join("\n"),
      ),
    ],
    expected: {
      vendor: "Pieters Consultancy Eenmanszaak",
      iban: "NL20INGB0001234567",
      vatNumber: "NL001234567B01",
      invoiceNumber: "PC-100",
      issueDate: "2026-01-15",
      dueDate: "2026-02-15",
      subtotal: 1200,
      tax: 252,
      total: 1452,
      currency: "EUR",
    },
  },
  {
    id: "heuristic/nl-stichting-with-email",
    source: "heuristic",
    fileName: "stichting-warmte.pdf",
    pages: [
      page(
        1,
        [
          "Stichting Warmte Nederland",
          "Warmtestraat 1, 5611 AB Eindhoven",
          "E-mail: info@warmtenederland.nl",
          "BTW nr: NL861234567B01",
          "Factuurnummer: SWN-042",
          "Factuurdatum: 20-03-2026",
          "Totaal incl. btw €1.650,00",
        ].join("\n"),
      ),
    ],
    expected: {
      vendor: "Stichting Warmte Nederland",
      address: "Warmtestraat 1, 5611 AB Eindhoven",
      vendorEmail: "info@warmtenederland.nl",
      vatNumber: "NL861234567B01",
      invoiceNumber: "SWN-042",
      issueDate: "2026-03-20",
      total: 1650,
      currency: "EUR",
    },
  },
  {
    id: "heuristic/nl-date-based-invoice-number",
    source: "heuristic",
    fileName: "leverancier-20260412.pdf",
    pages: [
      page(
        1,
        [
          "Logistiek Noord B.V.",
          "Factuurnummer: 20260412-003",
          "Factuurdatum: 12-04-2026",
          "Totaal 780,00",
        ].join("\n"),
      ),
    ],
    expected: {
      vendor: "Logistiek Noord B.V.",
      invoiceNumber: "20260412-003",
      issueDate: "2026-04-12",
      total: 780,
    },
  },
  {
    id: "heuristic/nl-f-prefix-invoice",
    source: "heuristic",
    fileName: "factuur-f00123.pdf",
    pages: [
      page(
        1,
        [
          "Bouwbedrijf De Vries B.V.",
          "Factuurnummer F00123",
          "Leveringsdatum: 05-05-2026",
          "Totaal 3.500,00",
        ].join("\n"),
      ),
    ],
    expected: {
      vendor: "Bouwbedrijf De Vries B.V.",
      invoiceNumber: "F00123",
      issueDate: "2026-05-05",
      total: 3500,
    },
  },
  {
    id: "heuristic/nl-line-items-with-dutch-units",
    source: "heuristic",
    fileName: "kantoorbenodigdheden.pdf",
    pages: [
      page(
        1,
        [
          "Kantoor Express B.V.",
          "Factuurnummer: KE-300",
          "Papier A4 10 stuks x €12,50 125,00",
          "Toner cartridge 2 x €89,00 178,00",
          "Subtotaal 303,00",
          "BTW 21% 63,63",
          "Totaal 366,63",
        ].join("\n"),
      ),
    ],
    expected: {
      vendor: "Kantoor Express B.V.",
      invoiceNumber: "KE-300",
      subtotal: 303,
      tax: 63.63,
      total: 366.63,
      currency: "EUR",
    },
  },
  {
    id: "heuristic/nl-vof-with-iban",
    source: "heuristic",
    fileName: " partners-advies.pdf",
    pages: [
      page(
        1,
        [
          "Partners Advies V.O.F.",
          "IBAN: NL84RABO0123456789",
          "BTW: NL123456789B01",
          "Factuurnummer: PA-2026-015",
          "Factuurdatum: 01-09-2026",
          "Vervaldatum: 01-10-2026",
          "Advisering 16 uur x €175,00 2.800,00",
          "Subtotaal 2.800,00",
          "BTW 21% 588,00",
          "Totaal te betalen 3.388,00",
        ].join("\n"),
      ),
    ],
    expected: {
      vendor: "Partners Advies V.O.F.",
      iban: "NL84RABO0123456789",
      vatNumber: "NL123456789B01",
      invoiceNumber: "PA-2026-015",
      issueDate: "2026-09-01",
      dueDate: "2026-10-01",
      subtotal: 2800,
      tax: 588,
      total: 3388,
      currency: "EUR",
    },
  },

  // ---- Heuristic path: edge cases — multi-page profile fields ----------
  {
    id: "heuristic/multipage-iban-on-last-page",
    source: "heuristic",
    fileName: "acme-multi-iban.pdf",
    pages: [
      page(1, [
        "Acme Nederland B.V.",
        "Keizersgracht 123",
        "1012 AB Amsterdam",
        "E-mail: info@acme.nl",
        "Factuurnummer: AC-100",
        "Factuurdatum: 12-04-2026",
      ].join("\n")),
      page(2, [
        "Consulting 1.000,00",
        "Training 500,00",
      ].join("\n")),
      page(3, [
        "Currency: EUR",
        "Subtotaal 1.500,00",
        "BTW 21% 315,00",
        "Totaal 1.815,00",
        "",
        "IBAN: NL91ABNA0417164300",
        "BTW: NL812345678B01",
      ].join("\n")),
    ],
    expected: {
      vendor: "Acme Nederland B.V.",
      address: "Keizersgracht 123, 1012 AB Amsterdam",
      vendorEmail: "info@acme.nl",
      iban: "NL91ABNA0417164300",
      vatNumber: "NL812345678B01",
      invoiceNumber: "AC-100",
      issueDate: "2026-04-12",
      subtotal: 1500,
      tax: 315,
      total: 1815,
      currency: "EUR",
    },
  },
  {
    id: "heuristic/multipage-email-on-last-page",
    source: "heuristic",
    fileName: "bouwbedrijf-email.pdf",
    pages: [
      page(1, [
        "Bouwbedrijf Van den Berg B.V.",
        "Industrieweg 28",
        "5612 AB Eindhoven",
        "Factuurnummer: BVB-2026-042",
        "Factuurdatum: 10-04-2026",
        "Vervaldatum: 10-05-2026",
      ].join("\n")),
      page(2, [
        "Bouwmaterialen 2.500,00",
        "Subtotaal 2.500,00",
        "BTW 21% 525,00",
        "Totaal € 3.025,00",
        "",
        "IBAN NL55RABO0319564893",
        "E-mail: facturatie@vandenberg-bouw.nl",
      ].join("\n")),
    ],
    expected: {
      vendor: "Bouwbedrijf Van den Berg B.V.",
      address: "Industrieweg 28, 5612 AB Eindhoven",
      vendorEmail: "facturatie@vandenberg-bouw.nl",
      iban: "NL55RABO0319564893",
      invoiceNumber: "BVB-2026-042",
      issueDate: "2026-04-10",
      dueDate: "2026-05-10",
      subtotal: 2500,
      tax: 525,
      total: 3025,
      currency: "EUR",
    },
  },

  // ---- Heuristic path: edge cases — ambiguous emails ----------------------
  {
    id: "heuristic/ambiguous-email-vendor-vs-customer",
    source: "heuristic",
    fileName: "acme-postnl-email.pdf",
    pages: [
      page(1, [
        "Acme B.V.",
        "E-mail: info@acme.nl",
        "",
        "Klant:",
        "PostNL Pakketten B.V.",
        "E-mail: klantenservice@postnl.nl",
        "",
        "Factuurnummer: AC-200",
        "Factuurdatum: 15-05-2026",
        "Currency: EUR",
        "Totaal 250,00",
      ].join("\n")),
    ],
    expected: {
      vendor: "Acme B.V.",
      vendorEmail: "info@acme.nl",
      invoiceNumber: "AC-200",
      issueDate: "2026-05-15",
      total: 250,
      currency: "EUR",
    },
  },
  {
    id: "heuristic/ambiguous-email-noreply-vs-real",
    source: "heuristic",
    fileName: "exact-noreply.pdf",
    pages: [
      page(1, [
        "Exact Online B.V.",
        "Databankweg 12",
        "3833 AN Leusden",
        "",
        "From: noreply@exact.nl",
        "E-mail: facturatie@exact.nl",
        "",
        "Factuurnummer: EOL-88901",
        "Factuurdatum: 01-03-2026",
        "Currency: EUR",
        "Totaal 1.292,28",
      ].join("\n")),
    ],
    expected: {
      vendor: "Exact Online B.V.",
      address: "Databankweg 12, 3833 AN Leusden",
      vendorEmail: "facturatie@exact.nl",
      invoiceNumber: "EOL-88901",
      issueDate: "2026-03-01",
      total: 1292.28,
      currency: "EUR",
    },
  },
  {
    id: "heuristic/ambiguous-email-domain-mismatch",
    source: "heuristic",
    fileName: "adviesbureau-mismatch.pdf",
    pages: [
      page(1, [
        "Adviesbureau De Jong B.V.",
        "Prinsessegracht 10",
        "2514 AP Den Haag",
        "",
        "E-mail: contact@dejong-advies.nl",
        "Website: www.dejong-advies.nl",
        "",
        "Factuurnummer: DJ-456",
        "Factuurdatum: 20-06-2026",
        "Currency: EUR",
        "Totaal 750,00",
      ].join("\n")),
    ],
    expected: {
      vendor: "Adviesbureau De Jong B.V.",
      address: "Prinsessegracht 10, 2514 AP Den Haag",
      vendorEmail: "contact@dejong-advies.nl",
      invoiceNumber: "DJ-456",
      issueDate: "2026-06-20",
      total: 750,
      currency: "EUR",
    },
  },

  // ---- Heuristic path: edge cases — multiple IBANs ------------------------
  {
    id: "heuristic/multiple-ibans-vendor-vs-customer",
    source: "heuristic",
    fileName: "acme-dual-iban.pdf",
    pages: [
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
        "Factuurdatum: 10-06-2026",
        "Currency: EUR",
        "Totaal 100,00",
      ].join("\n")),
    ],
    expected: {
      vendor: "Acme B.V.",
      iban: "NL91ABNA0417164300",
      invoiceNumber: "AC-300",
      issueDate: "2026-06-10",
      total: 100,
      currency: "EUR",
    },
  },
  {
    id: "heuristic/multiple-ibans-nl-preferred",
    source: "heuristic",
    fileName: "twijgen-nl-preferred.pdf",
    pages: [
      page(1, [
        "Twijgen Transport B.V.",
        "Havenweg 5",
        "1000 AA Amsterdam",
        "",
        "BTW: NL123456789B01",
        "Klant IBAN: DE89370400440532013000",
        "IBAN: NL20INGB0001234567",
        "",
        "Factuurnummer: TT-789",
        "Currency: EUR",
        "Totaal 5.000,00",
      ].join("\n")),
    ],
    expected: {
      vendor: "Twijgen Transport B.V.",
      address: "Havenweg 5, 1000 AA Amsterdam",
      vatNumber: "NL123456789B01",
      iban: "NL20INGB0001234567",
      invoiceNumber: "TT-789",
      total: 5000,
      currency: "EUR",
    },
  },
  {
    id: "heuristic/multiple-ibans-labelled-preferred",
    source: "heuristic",
    fileName: "siemens-labelled-iban.pdf",
    pages: [
      page(1, [
        "Siemens GmbH",
        "Werner-von-Siemens-Str. 1",
        "80333 München",
        "",
        "Bankverbindung / IBAN: DE89370400440532013000",
        "Unser Konto: DE15500105171829969543",
        "",
        "Rechnung Nr: SI-789",
        "Rechnungsdatum: 01-06-2026",
        "Gesamtbetrag € 5.000,00",
      ].join("\n")),
    ],
    expected: {
      vendor: "Siemens GmbH",
      address: "Werner-von-Siemens-Str. 1, 80333 München",
      iban: "DE89370400440532013000",
      invoiceNumber: "SI-789",
      issueDate: "2026-06-01",
      total: 5000,
      currency: "EUR",
    },
  },

  // ---- Heuristic path: edge cases — realistic multi-page profile ----------
  {
    id: "heuristic/realistic-multipage-full-profile",
    source: "heuristic",
    fileName: "conclusion-2026-0842.pdf",
    pages: [
      page(1, [
        "Conclusion ICT B.V.",
        "Oudegracht 123",
        "3511 PC Utrecht",
        "",
        "Factuur",
        "",
        "Factuurnummer: CIC-2026-0842",
        "Factuurdatum: 15-04-2026",
        "Vervaldatum: 15-05-2026",
        "",
        "Klant: Acme Nederland B.V.",
      ].join("\n")),
      page(2, [
        "Omschrijving           Aantal  Bedrag",
        "─────────────────────────────────────",
        "Software ontwikkeling   40 uur  6.000,00",
        "Project management      16 uur  2.400,00",
        "Reiskosten              1        245,00",
      ].join("\n")),
      page(3, [
        "",
        "Subtotaal                     € 8.645,00",
        "BTW 21%                       € 1.815,45",
        "Totaal te betalen            € 10.460,45",
        "",
        "IBAN: NL91ABNA0417164300",
        "BIC: ABNANL2A",
        "BTW: NL812345678B01",
        "E-mail: facturatie@conclusion.nl",
      ].join("\n")),
    ],
    expected: {
      vendor: "Conclusion ICT B.V.",
      address: "Oudegracht 123, 3511 PC Utrecht",
      vendorEmail: "facturatie@conclusion.nl",
      iban: "NL91ABNA0417164300",
      vatNumber: "NL812345678B01",
      invoiceNumber: "CIC-2026-0842",
      issueDate: "2026-04-15",
      dueDate: "2026-05-15",
      subtotal: 8645,
      tax: 1815.45,
      total: 10460.45,
      currency: "EUR",
    },
  },
  {
    id: "heuristic/realistic-stichting-postbus-email",
    source: "heuristic",
    fileName: "stichting-warmte-email.pdf",
    pages: [
      page(1, [
        "Stichting Warmte Nederland",
        "Warmtestraat 1",
        "5611 AB Eindhoven",
        "",
        "E-mail: info@warmtenederland.nl",
        "BTW nr: NL861234567B01",
        "Factuurnummer: SWN-042",
        "Factuurdatum: 20-03-2026",
        "Vervaldatum: 20-04-2026",
        "",
        "Warmteinstallatie 1.200,00",
        "Onderhoud 250,00",
        "Subtotaal 1.450,00",
        "BTW 21% 304,50",
        "Totaal incl. btw €1.754,50",
      ].join("\n")),
    ],
    expected: {
      vendor: "Stichting Warmte Nederland",
      address: "Warmtestraat 1, 5611 AB Eindhoven",
      vendorEmail: "info@warmtenederland.nl",
      vatNumber: "NL861234567B01",
      invoiceNumber: "SWN-042",
      issueDate: "2026-03-20",
      dueDate: "2026-04-20",
      subtotal: 1450,
      tax: 304.5,
      total: 1754.5,
      currency: "EUR",
    },
  },

  // ---- Template path: words + learned anchors → applyTemplateField -------
  templateFixture("template/clean", TEMPLATE_ROWS),
  templateFixture("template/anchor-typo", [
    { ...TEMPLATE_ROWS[0]!, anchor: "Factuurnmer" },
    TEMPLATE_ROWS[1]!,
    { ...TEMPLATE_ROWS[2]!, anchor: "Vervaldaturn" },
    TEMPLATE_ROWS[3]!,
    TEMPLATE_ROWS[4]!,
    TEMPLATE_ROWS[5]!,
  ]),
  templateFixture("template/low-confidence", [
    TEMPLATE_ROWS[0]!,
    TEMPLATE_ROWS[1]!,
    TEMPLATE_ROWS[2]!,
    { ...TEMPLATE_ROWS[3]!, valueConfidence: 0.5 },
    { ...TEMPLATE_ROWS[4]!, valueConfidence: 0.55 },
    TEMPLATE_ROWS[5]!,
  ]),
  templateFixture("template/decoy-in-region", [
    TEMPLATE_ROWS[0]!,
    TEMPLATE_ROWS[1]!,
    TEMPLATE_ROWS[2]!,
    { ...TEMPLATE_ROWS[3]!, decoy: "21%" },
    TEMPLATE_ROWS[4]!,
    TEMPLATE_ROWS[5]!,
  ]),
  templateFixture("template/value-moved", [...TEMPLATE_ROWS], { valueShiftY: 0.05 }),
];
