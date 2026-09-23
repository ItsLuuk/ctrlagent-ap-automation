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
    // Computed due dates get the not-found floor: conf(false, _) caps at 0.5.
    expect(fields.confidence.dueDate).toBe(0.5);
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
    // conf(true, 0.95) = 0.92 * 0.95 = 0.874 → 0.87.
    expect(fields.confidence.dueDate).toBe(0.87);
  });

  it("keeps an empty due date when there are no payment terms and no issue date", () => {
    const fields = gemmaToFields(
      mergeGemmaPages(
        [parseGemmaPage(JSON.stringify({ vendor: "Onbekend", invoiceNumber: "X-001", issueDate: undefined, dueDate: undefined, total: "0,00" }))],
        "",
      ),
    );

    expect(fields.dueDate).toBeUndefined();
    expect(fields.confidence.dueDate).toBeLessThan(0.55);
    });
});
