/**
 * Characterization tests for the pure mapping core. These lock in the
 * behavior the DraftMapper and the template pipeline depend on *before* the
 * clean-code refactor reshapes the module.
 */
import { describe, expect, it } from "bun:test";
import {
  buildAnchorSpec,
  describeMapping,
  fieldStatus,
  lineItemsSum,
  moneyToNumber,
  orderedFields,
  parseDateParts,
  parseLineItemRows,
  proposeAnchor,
  resizeZone,
  specToZone,
  suggestZone,
  totalsCrossCheck,
  validateInvoiceForConfirmation,
  isValidIsoDate,
  unionBox,
  wordAtPoint,
  wordsInRect,
  type FieldStatus,
  fieldStatus as triageStatus,
} from "./mapping";
import type { Invoice, LineItem, OcrWord, Zone, ZoneField } from "./types";

const word = (text: string, x: number, y: number, w = 0.08, h = 0.02): OcrWord => ({
  text,
  x,
  y,
  w,
  h,
  confidence: 0.95,
});

const zone = (x: number, y: number, w: number, h: number): Zone => ({ x, y, w, h });

const baseInvoice: Invoice = {
  id: "inv-test",
  vendor: "Acme Corp",
  invoiceNumber: "A-0231",
  issueDate: "2026-04-12",
  dueDate: "2026-05-12",
  currency: "EUR",
  subtotal: 2000,
  tax: 420,
  total: 2420,
  status: "draft",
  lineItems: [],
  glAccount: "6010",
  department: "Engineering",
  memo: "",
  tags: [],
  confidence: { vendor: 0.95, invoiceNumber: 0.5 },
  provenance: { vendor: "read", invoiceNumber: "derived" },
  audit: [],
  source: "sample",
  createdAt: "2026-09-19T00:00:00Z",
};

describe("unionBox", () => {
  it("merges word boxes into their bounding rectangle", () => {
    const merged = unionBox([word("hello", 0.1, 0.2), word("world", 0.2, 0.2)]);
    expect(merged.x).toBeCloseTo(0.1);
    expect(merged.y).toBeCloseTo(0.2);
    expect(merged.w).toBeGreaterThan(0.15);
    expect(merged.h).toBeCloseTo(0.02);
  });

  it("padds the merged box when asked", () => {
    const padded = unionBox([word("a", 0.5, 0.5)], 0.01);
    expect(padded.x).toBeCloseTo(0.49);
  });

  it("returns an empty box for no words", () => {
    expect(unionBox([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("resizeZone", () => {
  it("resizes a selected edge and clamps it to the document", () => {
    expect(resizeZone(zone(0.2, 0.3, 0.25, 0.1), "e", 0.2, 0)).toEqual(
      zone(0.2, 0.3, 0.45, 0.1),
    );
    expect(resizeZone(zone(0.8, 0.3, 0.15, 0.1), "e", 0.2, 0)).toEqual(
      zone(0.8, 0.3, 0.2, 0.1),
    );
  });

  it("moves two edges from a corner and preserves a usable minimum", () => {
    expect(resizeZone(zone(0.4, 0.4, 0.2, 0.1), "nw", -0.1, -0.05)).toEqual(
      zone(0.3, 0.35, 0.3, 0.15),
    );
    expect(resizeZone(zone(0.4, 0.4, 0.2, 0.1), "se", 0.5, 0.5)).toEqual(
      zone(0.4, 0.4, 0.6, 0.6),
    );
  });

  it("moves every edge and corner in the requested direction", () => {
    const initialZone = zone(0.3, 0.4, 0.2, 0.1);

    expect(resizeZone(initialZone, "n", 0, -0.1)).toEqual(
      zone(0.3, 0.3, 0.2, 0.2),
    );
    expect(resizeZone(initialZone, "s", 0, 0.1)).toEqual(
      zone(0.3, 0.4, 0.2, 0.2),
    );
    expect(resizeZone(initialZone, "w", -0.1, 0)).toEqual(
      zone(0.2, 0.4, 0.3, 0.1),
    );
    expect(resizeZone(initialZone, "e", 0.1, 0)).toEqual(
      zone(0.3, 0.4, 0.3, 0.1),
    );
    expect(resizeZone(initialZone, "nw", -0.1, -0.1)).toEqual(
      zone(0.2, 0.3, 0.3, 0.2),
    );
    expect(resizeZone(initialZone, "ne", 0.1, -0.1)).toEqual(
      zone(0.3, 0.3, 0.3, 0.2),
    );
    expect(resizeZone(initialZone, "sw", -0.1, 0.1)).toEqual(
      zone(0.2, 0.4, 0.3, 0.2),
    );
    expect(resizeZone(initialZone, "se", 0.1, 0.1)).toEqual(
      zone(0.3, 0.4, 0.3, 0.2),
    );
  });
});

describe("wordsInRect", () => {
  it("keeps only words whose centers fall inside the rectangle", () => {
    const words = [word("in", 0.1, 0.1), word("out", 0.9, 0.9)];
    const inside = wordsInRect(words, zone(0, 0, 0.5, 0.5));
    expect(inside).toHaveLength(1);
    expect(inside[0]!.text).toBe("in");
  });
});

describe("wordAtPoint", () => {
  it("finds the word at the clicked point", () => {
    const words = [word("alpha", 0.1, 0.1), word("beta", 0.5, 0.5)];
    const hit = wordAtPoint(words, 0.52, 0.51);
    expect(hit?.text).toBe("beta");
  });

  it("returns undefined when clicking empty space far from any word", () => {
    const words = [word("alpha", 0.05, 0.05)];
    expect(wordAtPoint(words, 0.95, 0.95)).toBeUndefined();
  });
});

describe("proposeAnchor", () => {
  it("prefers a label word to the left of the value region", () => {
    const words = [word("Total", 0.6, 0.8), word("2420,00", 0.75, 0.8), word("Random", 0.1, 0.1)];
    const anchor = proposeAnchor(words, zone(0.75, 0.8, 0.1, 0.02));
    expect(anchor).toBe("Total");
  });

  it("skips numbers and stopwords as anchor candidates", () => {
    const words = [word("2026", 0.6, 0.8), word("420", 0.75, 0.8)];
    expect(proposeAnchor(words, zone(0.75, 0.8, 0.1, 0.02))).toBeUndefined();
  });
});

describe("buildAnchorSpec + specToZone round trip", () => {
  it("expresses the region relative to the anchor and re-inflates it", () => {
    const words = [word("Total", 0.6, 0.8, 0.1, 0.02), word("2420,00", 0.75, 0.8)];
    const valueZone = zone(0.75, 0.8, 0.1, 0.02);
    const spec = buildAnchorSpec(words, "total", valueZone, "Total");
    expect(spec.anchor).toBe("Total");
    expect(spec.type).toBe("decimal");

    const reInflated = specToZone(spec, words);
    expect(reInflated.x).toBeCloseTo(valueZone.x, 1);
    expect(reInflated.y).toBeCloseTo(valueZone.y, 1);
    expect(reInflated.w).toBeGreaterThan(0);
  });

  it("falls back to page-absolute coordinates without an anchor", () => {
    const spec = buildAnchorSpec([], "total", zone(0.1, 0.1, 0.2, 0.05), undefined);
    expect(spec.anchor).toBe("");
    expect(spec.region.x0).toBeCloseTo(0.1);
  });
});

describe("suggestZone", () => {
  it("locates the invoice's value on the page", () => {
    const invoice = {
      ...baseInvoice,
      learnPayload: {
        pages: [
          {
            pageNumber: 1,
            words: [word("Factuurnummer", 0.6, 0.1), word("A-0231", 0.75, 0.1)],
          },
        ],
      },
    };
    const suggested = suggestZone(invoice, "invoiceNumber");
    expect(suggested).toBeDefined();
    expect(suggested!.x).toBeGreaterThan(0.6);
    expect(suggested!.x).toBeLessThan(0.8);
  });

  it("returns undefined without cached words", () => {
    expect(suggestZone(baseInvoice, "invoiceNumber")).toBeUndefined();
  });
});

describe("fieldStatus triage", () => {
  const statuses: Record<ZoneField, FieldStatus> = {} as never;

  it("flags derived provenance as amber", () => {
    expect(triageStatus(baseInvoice, "invoiceNumber")).toBe("amber");
  });

  it("flags a failed sanity check as amber even for a direct read", () => {
    const invoice = { ...baseInvoice, provenance: { vendor: "read" as const } };
    expect(fieldStatus(invoice, "vendor", { zoneCheckMatch: false })).toBe("amber");
  });

  it("flags empty values as amber", () => {
    const empty = { ...baseInvoice, provenance: {}, invoiceNumber: "" };
    expect(fieldStatus(empty, "invoiceNumber")).toBe("amber");
  });

  it("counts solid values as green", () => {
    expect(triageStatus(baseInvoice, "vendor")).toBe("green");
  });

  void statuses;
});

describe("validateInvoiceForConfirmation", () => {
  it("requires the minimum invoice identity and total", () => {
    const issues = validateInvoiceForConfirmation({
      ...baseInvoice,
      vendor: "",
      invoiceNumber: "",
      total: 0,
    });
    expect(issues.map((issue) => issue.code)).toEqual([
      "missing_vendor",
      "missing_invoice_number",
      "missing_total",
    ]);
  });

  it("blocks a line-item total mismatch", () => {
    const issues = validateInvoiceForConfirmation({
      ...baseInvoice,
      total: 100,
      lineItems: [
        {
          id: "line-1",
          description: "Widget",
          quantity: 1,
          unitPrice: 120,
          amount: 120,
          glAccount: "6010",
          department: "Engineering",
        },
      ],
    });
    expect(issues.map((issue) => issue.code)).toContain("line_total_mismatch");
  });

  it("allows a complete invoice without line items", () => {
    expect(validateInvoiceForConfirmation(baseInvoice)).toEqual([]);
  });

  it("requires a supported ISO currency", () => {
    expect(
      validateInvoiceForConfirmation({ ...baseInvoice, currency: "US dollar" }).map(
        (issue) => issue.code,
      ),
    ).toContain("invalid_currency");
  });

  it("rejects malformed calendar dates", () => {
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("12-04-2026")).toBe(false);
    expect(isValidIsoDate("2026-04-12")).toBe(true);
    expect(
      validateInvoiceForConfirmation({ ...baseInvoice, dueDate: "2026-02-30" }).map(
        (issue) => issue.code,
      ),
    ).toContain("invalid_due_date");
  });
});

describe("totalsCrossCheck", () => {
  const lineItem = (amount: number): LineItem => ({
    id: "li",
    description: "x",
    quantity: 1,
    unitPrice: amount,
    amount,
    glAccount: "",
    department: "",
  });

  it("passes when line items sum to the total", () => {
    const invoice = { ...baseInvoice, lineItems: [lineItem(2420)] };
    const check = totalsCrossCheck(invoice);
    expect(check.ok).toBe(true);
    expect(check.sum).toBe(2420);
  });

  it("flags a mismatch beyond 2 cents", () => {
    const invoice = { ...baseInvoice, lineItems: [lineItem(2357.5)] };
    expect(totalsCrossCheck(invoice).ok).toBe(false);
  });

  it("passes trivially with no line items", () => {
    expect(totalsCrossCheck(baseInvoice).ok).toBe(true);
  });

  it("rounds the sum to cents", () => {
    expect(lineItemsSum([lineItem(0.1), lineItem(0.2)])).toBe(0.3);
  });

  it("passes when lines match the subtotal and subtotal + tax equals the total (superdoos)", () => {
    const invoice = {
      ...baseInvoice,
      subtotal: 79.95,
      tax: 16.79,
      total: 96.74,
      lineItems: [lineItem(50), lineItem(29.95)],
    };
    const check = totalsCrossCheck(invoice);
    expect(check.sum).toBe(79.95);
    expect(check.mode).toBe("subtotal");
    expect(check.ok).toBe(true);
    expect(
      validateInvoiceForConfirmation(invoice).map((i) => i.code),
    ).not.toContain("line_total_mismatch");
  });

  it("flags lines that match neither subtotal nor total", () => {
    const invoice = {
      ...baseInvoice,
      subtotal: 79.95,
      tax: 16.79,
      total: 96.74,
      lineItems: [lineItem(70)],
    };
    expect(totalsCrossCheck(invoice).ok).toBe(false);
  });

  it("flags a broken subtotal + tax tie even when lines match the subtotal", () => {
    const invoice = {
      ...baseInvoice,
      subtotal: 79.95,
      tax: 10,
      total: 96.74,
      lineItems: [lineItem(79.95)],
    };
    const check = totalsCrossCheck(invoice);
    expect(check.linesOk).toBe(true);
    expect(check.totalsOk).toBe(false);
    expect(check.ok).toBe(false);
  });

  it("warns (not errors) on lines mismatch at confirm scope", () => {
    const invoice = {
      ...baseInvoice,
      subtotal: 79.95,
      tax: 16.79,
      total: 96.74,
      lineItems: [lineItem(70)],
    };
    const issues = validateInvoiceForConfirmation(invoice, "confirm");
    const mismatch = issues.find((i) => i.code === "line_total_mismatch");
    expect(mismatch?.severity).toBe("warning");
  });

  it("errors on lines mismatch at approve scope", () => {
    const invoice = {
      ...baseInvoice,
      subtotal: 79.95,
      tax: 16.79,
      total: 96.74,
      lineItems: [lineItem(70)],
    };
    const issues = validateInvoiceForConfirmation(invoice, "approve");
    const mismatch = issues.find((i) => i.code === "line_total_mismatch");
    expect(mismatch?.severity).toBe("error");
  });
});

describe("describeMapping", () => {
  it("mentions the anchor and quadrant for anchored specs", () => {
    const spec = { anchor: "Factuurnummer", region: { x0: 0, y0: 0, x1: 1, y1: 1 } };
    const line = describeMapping("invoiceNumber", spec, zone(0.8, 0.1, 0.1, 0.02));
    expect(line).toContain("Factuurnummer");
    expect(line).toContain("top-right");
  });

  it("describes position-only specs without an anchor", () => {
    const spec = { anchor: "", region: { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.15 } };
    const line = describeMapping("total", spec, undefined);
    expect(line).toContain("saved position");
    expect(line).not.toContain("near");
  });
});

describe("orderedFields", () => {
  it("sorts amber fields before green ones", () => {
    const statuses = {
      vendor: "green",
      invoiceNumber: "amber",
      issueDate: "green",
      dueDate: "green",
      subtotal: "green",
      tax: "green",
      total: "green",
    } as Record<ZoneField, FieldStatus>;
    const order = orderedFields(baseInvoice, statuses);
    expect(order[0]).toBe("invoiceNumber");
    expect(order).toContain("vendor");
  });
});

describe("shared parsers (zones.ts, re-exported via mapping)", () => {
  it("parses Dutch money", () => {
    expect(moneyToNumber("1.234,56")).toBe(1234.56);
    expect(moneyToNumber("€ 2.420,00")).toBe(2420);
  });

  it("parses Dutch 3-decimal unit prices (€ 0,120, € 19,950)", () => {
    // 3-decimal comma = cents when a euro marker is present (existing behaviour).
    expect(moneyToNumber("€ 0,120")).toBe(0.12);
    expect(moneyToNumber("€ 19,950")).toBe(19.95);
    // Bare 3-decimal comma without euro marker: small leading group (1-2 digits)
    // and no '.' thousands groups → treat as cents (the fix).
    expect(moneyToNumber("0,120")).toBe(0.12);
    expect(moneyToNumber("19,950")).toBe(19.95);
    // A bare "123,456" with a 3-digit leading group is still English thousands
    // (123456) — not 123.456 — because the lead is too long to be a unit price.
    expect(moneyToNumber("123,456")).toBe(123456);
    // Euro marker still forces conversion even for a 3-digit lead.
    expect(moneyToNumber("€ 123,456")).toBe(123.456);
  });

  it("parses day-first dates", () => {
    expect(parseDateParts("12-04-2026")).toEqual({ day: 12, month: 4, year: 2026 });
    expect(parseDateParts("2026-04-12")).toEqual({ day: 12, month: 4, year: 2026 });
  });

  it("rejects non-money text", () => {
    expect(moneyToNumber("no amount here")).toBeUndefined();
  });
});

describe("parseLineItemRows", () => {
  const spec = {
    region: { x0: 0, y0: 0, x1: 1, y1: 1 },
    columns: [
      {
        anchor: "Description",
        field: "description" as const,
        band: { x0: 0, y0: 0, x1: 0.5, y1: 1 },
      },
      { anchor: "Amount", field: "amount" as const, band: { x0: 0.5, y0: 0, x1: 1, y1: 1 } },
    ],
    excludeTotalRows: true,
  };

  it("extracts description + amount pairs", () => {
    const words = [
      word("Consulting", 0.05, 0.4),
      word("1000,00", 0.7, 0.4),
      word("Subtotal", 0.05, 0.9),
      word("1000,00", 0.7, 0.9),
    ];
    const rows = parseLineItemRows(words, spec);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe("Consulting");
    expect(rows[0]!.amount).toBe(1000);
  });

  it("drops subtotal/tax/total rows when asked", () => {
    const words = [
      word("Widget", 0.05, 0.4),
      word("50,00", 0.7, 0.4),
      word("Totaal", 0.05, 0.9),
      word("50,00", 0.7, 0.9),
    ];
    expect(parseLineItemRows(words, spec)).toHaveLength(1);
  });
});
