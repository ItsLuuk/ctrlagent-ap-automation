import { describe, expect, it } from "bun:test";
import { guessLineItemsIn, toNumber } from "./line-item-extraction";
import { SUPEROOS_INVOICE_TEXT } from "./fixtures/__superdoos_test";

describe("guessLineItemsIn", () => {
  it("reads wrapped Product blocks as the actual invoice lines", () => {
    const items = guessLineItemsIn(SUPEROOS_INVOICE_TEXT, 1);

    expect(
      items.map(({ description, quantity, unitPrice, amount }) => ({
        description,
        quantity,
        unitPrice,
        amount,
      })),
    ).toEqual([
      {
        description: "Brievenbusdoosje A6 160x110x27mm - Bruin",
        quantity: 1,
        unitPrice: 19.95,
        amount: 19.95,
      },
      {
        description: "Verzendkosten",
        quantity: 1,
        unitPrice: 60,
        amount: 60,
      },
    ]);
  });

  it("falls back to amount-bearing rows when there is no Product block", () => {
    const items = guessLineItemsIn(
      ["Consulting 2 x 500,00", "Onderhoud 1 x 125,50", "Totaal 1.125,50"].join("\n"),
      2,
    );

    expect(items.map((item) => item.description)).toEqual(["Consulting 2 x", "Onderhoud 1 x"]);
    expect(items[0]).toMatchObject({ quantity: 2, unitPrice: 250, amount: 500, page: 2 });
  });

  it("rejects unit labels, totals, and payment prose", () => {
    const items = guessLineItemsIn(
      [
        "Stuks € 1",
        "Aantal € 2",
        "Subtotaal € 79,95",
        "Hiervan is 96,74 euro reeds betaald op 20-01-2025 door middel",
        "Verzendkosten € 60,00",
      ].join("\n"),
      1,
    );

    expect(items.map((item) => item.description)).toEqual(["Verzendkosten"]);
  });

  it("keeps a long product description inside an explicit Product block", () => {
    const description =
      "A very long product description that should be preserved by the Product block";
    const items = guessLineItemsIn(["Product:", description, "Totaal", "€ 10,00"].join("\n"), 3);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ description, amount: 10, page: 3 });
  });
});

describe("toNumber", () => {
  it("parses Dutch and US currency formats consistently", () => {
    expect(toNumber("€ 1.234,56")).toBe(1234.56);
    expect(toNumber("$1,234.56")).toBe(1234.56);
    expect(toNumber("EUR 19,95")).toBe(19.95);
  });
});
