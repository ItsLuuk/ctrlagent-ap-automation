import { describe, expect, it } from "bun:test";
import { gemmaToFields, mergeGemmaPages, parseGemmaPage, toNum } from "./gemma";

describe("toNum", () => {
  it("reads Dutch/EU formatted amounts", () => {
    expect(toNum("3.250,00")).toBe(3250);
    expect(toNum("276,25")).toBe(276.25);
    expect(toNum("3.526,25")).toBe(3526.25);
  });

  it("reads totals with a currency symbol", () => {
    expect(toNum("€ 3.526,25")).toBe(3526.25);
    expect(toNum("$1,250.00")).toBe(1250);
  });

  it("still reads US formatted and plain numbers", () => {
    expect(toNum("3,250.00")).toBe(3250);
    expect(toNum("1452")).toBe(1452);
    expect(toNum("-1.000,50")).toBe(-1000.5);
  });

  it("returns null for numbers and text it cannot read", () => {
    expect(toNum(1234.5)).toBe(1234.5);
    expect(toNum("EUR")).toBeNull();
    expect(toNum("")).toBeNull();
    expect(toNum(undefined)).toBeNull();
    expect(toNum(null)).toBeNull();
  });
});

describe("parseGemmaPage amount coercion", () => {
  it("normalizes European string amounts echoed by the model", () => {
    const page = parseGemmaPage(
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
    );

    expect(page?.subtotal).toBe(3250);
    expect(page?.tax).toBe(276.25);
    expect(page?.total).toBe(3526.25);
  });

  it("leaves plain numeric amounts unchanged", () => {
    const page = parseGemmaPage(JSON.stringify({ subtotal: 3250, tax: 276.25, total: 3526.25 }));
    expect(page?.subtotal).toBe(3250);
    expect(page?.tax).toBe(276.25);
    expect(page?.total).toBe(3526.25);
  });
});

describe("mergeGemmaPages line items", () => {
  it("parses European-formatted line item amounts", () => {
    const merged = mergeGemmaPages([
      parseGemmaPage(
        JSON.stringify({
          vendor: "Atlas Print & Signage",
          lineItems: [
            { description: "Booth panels", quantity: "5", unitPrice: "410,00", amount: "2.050,00" },
          ],
        }),
      ),
    ]);

    expect(merged.lineItems).toHaveLength(1);
    expect(merged.lineItems[0]!.amount).toBe(2050);
    expect(merged.lineItems[0]!.quantity).toBe(5);
    expect(merged.lineItems[0]!.unitPrice).toBe(410);
  });
});

describe("mergeGemmaPages VAT arbitration", () => {
  it("preserves competing page VAT candidates and selects the supplier page", () => {
    const merged = mergeGemmaPages([
      parseGemmaPage(JSON.stringify({ vatNumber: "NL987654321B01" })),
      parseGemmaPage(
        JSON.stringify({
          vatNumber: "NL123456789B01",
          vendorEmail: "billing@acme.example",
          iban: "NL91ABNA0417164300",
        }),
      ),
    ]);

    expect(merged.vatCandidates.map((candidate) => candidate.value)).toEqual([
      "NL987654321B01",
      "NL123456789B01",
    ]);
    expect(merged.vatNumber).toEqual({ value: "NL123456789B01", page: 2 });
  });

  it("keeps the page-local supplier candidate when the customer is on an earlier page", () => {
    const merged = mergeGemmaPages([
      parseGemmaPage(JSON.stringify({ vatNumber: "BE0123456789" })),
      parseGemmaPage(
        JSON.stringify({
          vatNumber: "BE0987654321",
          vendorEmail: "accounts@supplier.be",
        }),
      ),
    ]);

    expect(merged.vatNumber?.value).toBe("BE0987654321");
    expect(merged.vatNumber?.page).toBe(2);
    expect(merged.vatCandidates).toHaveLength(2);
  });

  it("preserves the original first value when there is no supplier page anchor", () => {
    const merged = mergeGemmaPages([
      parseGemmaPage(JSON.stringify({ vatNumber: "DE123456789" })),
      parseGemmaPage(JSON.stringify({ vatNumber: "FRAB123456789" })),
    ]);

    expect(merged.vatCandidates).toHaveLength(2);
    expect(merged.vatNumber?.value).toBe("DE123456789");
  });
});

describe("gemmaToFields", () => {
  it("surfaces the corrected European amounts", () => {
    const fields = gemmaToFields(
      mergeGemmaPages([
        parseGemmaPage(
          JSON.stringify({
            vendor: "Atlas Print & Signage",
            invoiceNumber: "AP-7741",
            subtotal: "3.250,00",
            tax: "276,25",
            total: "3.526,25",
          }),
        ),
      ]),
    );

    expect(fields.subtotal).toBe(3250);
    expect(fields.tax).toBe(276.25);
    expect(fields.total).toBe(3526.25);
  });

  it("computes due date from Dutch payment terms when the VLM returns nothing", () => {
    // The VLM saw "Betalingsconditie: 14 dagen" but the invoice has no
    // explicit uiterste betaaldatum / te betalen voor label, so it returned
    // an empty dueDate. gemmaToFields should fall back to
    // dueDateFromPaymentTerms off the issue date, same as the regex reader.
    const pageText = [
      "Factuurdatum: 20-01-2025",
      "Betalingsconditie: 14 dagen",
      "Totaal: € 96,74",
    ].join("\n");

    const fields = gemmaToFields(
      mergeGemmaPages(
        [
          parseGemmaPage(
            JSON.stringify({
              vendor: "De Vistegroet B.V.",
              invoiceNumber: "BV-2025-014",
              issueDate: "2025-01-20",
              // No due date: the VLM didn't find an explicit label.
              dueDate: undefined,
              total: "96,74",
            }),
          ),
        ],
        pageText,
      ),
    );

    // Issue date 2025-01-20 + 14 dagen = 2025-02-03.
    expect(fields.dueDate).toBe("2025-02-03");
    expect(fields.provenance.dueDate).toBe("derived");
  });

  it("keeps a VLM-read due date and does not overwrite it with the terms fallback", () => {
    const fields = gemmaToFields(
      mergeGemmaPages(
        [
          parseGemmaPage(
            JSON.stringify({
              vendor: "De Vistegroet B.V.",
              invoiceNumber: "BV-2025-014",
              issueDate: "2025-01-20",
              dueDate: "2025-02-14",
              total: "96,74",
            }),
          ),
        ],
        "Betalingsconditie: 14 dagen",
      ),
    );

    // Explicit VLM read wins over the 14-dagen fallback.
    expect(fields.dueDate).toBe("2025-02-14");
    expect(fields.provenance.dueDate).toBe("read");
  });

  it("keeps an empty due date when there are no payment terms and no issue date", () => {
    const fields = gemmaToFields(
      mergeGemmaPages(
        [parseGemmaPage(JSON.stringify({ vendor: "Onbekend", invoiceNumber: "X-001", issueDate: undefined, dueDate: undefined, total: "0,00" }))],
        "",
      ),
    );

    expect(fields.dueDate).toBeUndefined();
    expect(fields.provenance.dueDate).toBe("derived");
    });
});
