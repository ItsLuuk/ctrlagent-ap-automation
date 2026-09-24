import { describe, expect, it } from "bun:test";
import { parseLineItemDraft } from "./line-item-edit";

describe("parseLineItemDraft", () => {
  it("parses a valid draft and computes amount", () => {
    expect(
      parseLineItemDraft({ description: "Widget", quantity: "2", unitPrice: "10.5" }),
    ).toEqual({ ok: true, description: "Widget", quantity: 2, unitPrice: 10.5, amount: 21 });
  });

  it("trims description and accepts comma decimal separator", () => {
    expect(
      parseLineItemDraft({ description: "  Bolt  ", quantity: "1", unitPrice: "2,5" }),
    ).toEqual({ ok: true, description: "Bolt", quantity: 1, unitPrice: 2.5, amount: 2.5 });
  });

  it("accepts comma decimal separator in quantity", () => {
    expect(
      parseLineItemDraft({ description: "Widget", quantity: "2,5", unitPrice: "4" }),
    ).toEqual({ ok: true, description: "Widget", quantity: 2.5, unitPrice: 4, amount: 10 });
  });

  it("rejects blank description", () => {
    expect(parseLineItemDraft({ description: "   ", quantity: "1", unitPrice: "5" })).toEqual({
      ok: false,
    });
  });

  it("rejects non-numeric quantity and price", () => {
    expect(parseLineItemDraft({ description: "X", quantity: "abc", unitPrice: "5" })).toEqual({
      ok: false,
    });
    expect(parseLineItemDraft({ description: "X", quantity: "1", unitPrice: "abc" })).toEqual({
      ok: false,
    });
  });

  it("rejects empty, zero, and negative quantity", () => {
    expect(parseLineItemDraft({ description: "X", quantity: "", unitPrice: "5" })).toEqual({
      ok: false,
    });
    expect(parseLineItemDraft({ description: "X", quantity: "0", unitPrice: "5" })).toEqual({
      ok: false,
    });
    expect(parseLineItemDraft({ description: "X", quantity: "-2", unitPrice: "5" })).toEqual({
      ok: false,
    });
  });

  it("rejects empty, zero, and negative unit price (amount must be > 0)", () => {
    expect(parseLineItemDraft({ description: "X", quantity: "1", unitPrice: "" })).toEqual({
      ok: false,
    });
    expect(parseLineItemDraft({ description: "X", quantity: "1", unitPrice: "0" })).toEqual({
      ok: false,
    });
    expect(parseLineItemDraft({ description: "X", quantity: "1", unitPrice: "-1" })).toEqual({
      ok: false,
    });
  });

  it("accepts in-progress decimal like '1.'", () => {
    expect(parseLineItemDraft({ description: "X", quantity: "1.", unitPrice: "1" })).toEqual({
      ok: true,
      description: "X",
      quantity: 1,
      unitPrice: 1,
      amount: 1,
    });
  });
});
