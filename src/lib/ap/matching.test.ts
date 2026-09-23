import { describe, expect, it } from "bun:test";
import {
  bestPoLine,
  DEFAULT_TOLERANCES,
  matchInvoiceToPo,
  matchSummary,
  type InvoiceLineLike,
  type PoLine,
} from "./matching";

const poLine = (id: string, description: string, quantity: number, unitPrice: number): PoLine => ({
  id,
  description,
  quantity,
  unitPrice,
  amount: quantity * unitPrice,
});

const invLine = (
  id: string,
  description: string,
  quantity: number,
  unitPrice: number,
): InvoiceLineLike => ({
  id,
  description,
  quantity,
  unitPrice,
  amount: quantity * unitPrice,
});

const PO = [poLine("po1", "Widgets", 10, 80), poLine("po2", "Gadgets", 5, 100)];

describe("two-way matching", () => {
  it("matches identical lines", () => {
    const r = matchInvoiceToPo([invLine("i1", "Widgets", 10, 80)], PO);
    expect(r.mode).toBe("two_way");
    expect(r.lines[0]!.status).toBe("matched");
    expect(r.matchedCount).toBe(1);
    expect(r.exceptions).toHaveLength(0);
  });

  it("flags quantity mismatches with a plain explanation", () => {
    const r = matchInvoiceToPo([invLine("i1", "Widgets", 12, 80)], PO);
    expect(r.lines[0]!.status).toBe("qty_mismatch");
    expect(r.lines[0]!.explanation).toContain("Invoice says 12, PO says 10");
  });

  it("flags price mismatches beyond tolerance", () => {
    const r = matchInvoiceToPo([invLine("i1", "Widgets", 10, 85)], PO);
    expect(r.lines[0]!.status).toBe("price_mismatch");
  });

  it("accepts prices within ±2% tolerance", () => {
    const r = matchInvoiceToPo([invLine("i1", "Widgets", 10, 81.5)], PO);
    expect(r.lines[0]!.status).toBe("matched");
  });

  it("reports no_po mode and per-line status without a PO", () => {
    const r = matchInvoiceToPo([invLine("i1", "Consulting", 1, 500)], []);
    expect(r.mode).toBe("no_po");
    expect(r.lines[0]!.status).toBe("no_po");
    expect(r.matchedCount).toBe(0);
  });

  it("pairs invoice lines to PO lines deterministically", () => {
    const r = matchInvoiceToPo(
      [invLine("i1", "Widgets", 10, 80), invLine("i2", "Gadgets", 5, 100)],
      PO,
    );
    expect(r.lines[0]!.poLineId).toBe("po1");
    expect(r.lines[1]!.poLineId).toBe("po2");
  });

  it("honors explicit links over auto-pairing", () => {
    const r = matchInvoiceToPo([invLine("i1", "Widgets", 10, 80)], PO, {
      links: [{ invoiceLineId: "i1", poLineId: "po2" }],
    });
    expect(r.lines[0]!.poLineId).toBe("po2");
    expect(r.lines[0]!.matchedBy).toBe("explicit");
  });
});

describe("three-way matching", () => {
  it("flags short receipts", () => {
    const r = matchInvoiceToPo([invLine("i1", "Gadgets", 5, 100)], PO, {
      receipts: [{ poLineId: "po2", quantityReceived: 3 }],
    });
    expect(r.mode).toBe("three_way");
    expect(r.lines[0]!.status).toBe("receipt_short");
    expect(r.lines[0]!.explanation).toContain("warehouse received 3");
  });

  it("passes when receipts cover the invoiced quantity", () => {
    const r = matchInvoiceToPo([invLine("i1", "Widgets", 10, 80)], PO, {
      receipts: [{ poLineId: "po1", quantityReceived: 10 }],
    });
    expect(r.lines[0]!.status).toBe("matched");
  });

  it("flags missing receipts entirely", () => {
    const r = matchInvoiceToPo([invLine("i1", "Widgets", 10, 80)], PO, {
      receipts: [],
    });
    expect(r.lines[0]!.status).toBe("receipt_short");
    expect(r.lines[0]!.explanation).toContain("No goods receipt recorded");
  });
});

describe("tolerances", () => {
  it("allows exact-quantity-only when qtyAbs is 0 (default)", () => {
    const r = matchInvoiceToPo([invLine("i1", "Widgets", 10.5, 80)], PO);
    expect(r.lines[0]!.status).toBe("qty_mismatch");
  });

  it("honors a custom qty tolerance", () => {
    const r = matchInvoiceToPo([invLine("i1", "Widgets", 10.5, 80)], PO, {
      tolerances: { ...DEFAULT_TOLERANCES, qtyAbs: 1 },
    });
    expect(r.lines[0]!.status).toBe("matched");
  });
});

describe("bestPoLine", () => {
  it("prefers a description match", () => {
    const po = bestPoLine(invLine("i", "Gadgets", 5, 100), PO);
    expect(po?.id).toBe("po2");
  });

  it("falls back to closest numbers when descriptions differ", () => {
    const po = bestPoLine(invLine("i", "Item A", 5, 100), PO);
    expect(po?.id).toBe("po2");
  });
});

describe("matchSummary", () => {
  it("summarizes matched vs exceptions", () => {
    const r = matchInvoiceToPo(
      [invLine("i1", "Widgets", 10, 80), invLine("i2", "Gadgets", 99, 100)],
      PO,
    );
    const s = matchSummary(r, "PO-4471");
    expect(s).toContain("PO-4471");
    expect(s).toContain("1/2 matched");
    expect(s).toContain("1 exception");
  });

  it("omits the exception clause when fully matched", () => {
    const r = matchInvoiceToPo([invLine("i1", "Widgets", 10, 80)], PO);
    expect(matchSummary(r)).toBe("1/1 matched");
  });
});
