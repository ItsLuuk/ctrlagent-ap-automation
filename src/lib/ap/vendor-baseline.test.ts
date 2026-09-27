import { describe, expect, it } from "bun:test";
import {
  buildVendorBaseline,
  buildVendorBaselines,
  daysBetween,
  formatInvoiceNumber,
  isRoundAmount,
  median,
  medianAbsoluteDeviation,
  parseInvoiceNumber,
} from "./vendor-baseline";
import type { Invoice, VendorProfile } from "./types";

let seq = 0;
function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  seq += 1;
  return {
    id: `inv-${seq}`,
    vendor: "Acme B.V.",
    invoiceNumber: `2026-${String(1000 + seq)}`,
    issueDate: "2026-01-15",
    dueDate: "2026-02-14",
    currency: "EUR",
    subtotal: 1000,
    tax: 210,
    total: 1210,
    status: "draft",
    lineItems: [],
    glAccount: "6020",
    department: "Finance",
    memo: "",
    tags: [],
    audit: [],
    source: "upload",
    createdAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("robust statistics", () => {
  it("takes the middle value, averaging the pair in between", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("measures spread from the median, not the mean", () => {
    // The mean is dragged to 55 by one huge total; the MAD is not.
    expect(medianAbsoluteDeviation([10, 10, 10, 200], 10)).toBe(0);
  });

  it("counts whole days between dates and refuses unparseable ones", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
    expect(Number.isNaN(daysBetween("not-a-date", "2026-01-31"))).toBe(true);
  });
});

describe("invoice numbers as a series", () => {
  it("splits a prefixed number into prefix and position", () => {
    expect(parseInvoiceNumber("2026-0142")).toMatchObject({
      prefix: "2026-",
      value: 142,
      width: 4,
    });
    expect(parseInvoiceNumber("INV 88")).toMatchObject({ prefix: "INV ", value: 88, width: 2 });
  });

  it("keeps a short counter series, which is a real series", () => {
    expect(parseInvoiceNumber("rect-01")).toMatchObject({ prefix: "rect-", value: 1, width: 2 });
  });

  it("refuses numbers that carry no countable series", () => {
    expect(parseInvoiceNumber("2026")).toBeUndefined();
    expect(parseInvoiceNumber("P1")).toBeUndefined();
    expect(parseInvoiceNumber("   ")).toBeUndefined();
  });

  it("renders a position back the way the vendor writes it", () => {
    const template = parseInvoiceNumber("2026-0142")!;
    expect(formatInvoiceNumber(template, 143)).toBe("2026-0143");
  });
});

describe("round amounts", () => {
  it("recognises whole hundreds and nothing else", () => {
    expect(isRoundAmount(1200)).toBe(true);
    expect(isRoundAmount(1200.5)).toBe(false);
    expect(isRoundAmount(49.99)).toBe(false);
    expect(isRoundAmount(0)).toBe(false);
  });
});

describe("buildVendorBaseline", () => {
  const monthly = [
    makeInvoice({
      invoiceNumber: "2026-0101",
      issueDate: "2026-01-15",
      dueDate: "2026-02-14",
      total: 1000,
    }),
    makeInvoice({
      invoiceNumber: "2026-0102",
      issueDate: "2026-02-15",
      dueDate: "2026-03-17",
      total: 1010,
    }),
    makeInvoice({
      invoiceNumber: "2026-0103",
      issueDate: "2026-03-15",
      dueDate: "2026-04-14",
      total: 990,
    }),
    makeInvoice({
      invoiceNumber: "2026-0104",
      issueDate: "2026-04-15",
      dueDate: "2026-05-15",
      total: 1200,
    }),
  ];

  it("learns the amount, cadence and terms from a vendor's invoices", () => {
    const baseline = buildVendorBaseline("acme b.v.", monthly)!;

    expect(baseline.sampleSize).toBe(4);
    expect(baseline.medianTotal).toBe(1005);
    expect(baseline.minTotal).toBe(990);
    expect(baseline.maxTotal).toBe(1200);
    expect(baseline.medianIntervalDays).toBe(31);
    expect(baseline.medianTermDays).toBe(30);
    expect(baseline.lastIssueDate).toBe("2026-04-15");
    expect(baseline.lastNumber).toMatchObject({ prefix: "2026-", value: 104 });
    expect(baseline.roundShare).toBe(0.5);
  });

  it("counts how often this vendor charges the same total", () => {
    const baseline = buildVendorBaseline("acme b.v.", [
      makeInvoice({ total: 500 }),
      makeInvoice({ total: 500 }),
      makeInvoice({ total: 500 }),
      makeInvoice({ total: 640 }),
    ])!;

    expect(baseline.repeatedAmountCount).toBe(3);
  });

  it("returns nothing rather than a baseline over no invoices", () => {
    expect(buildVendorBaseline("acme b.v.", [])).toBeUndefined();
  });
});

describe("buildVendorBaselines", () => {
  it("gives aliases one history, using the same identity the duplicate check uses", () => {
    const profiles: Record<string, VendorProfile> = {
      kpn: {
        vendor_key: "kpn",
        aliases: ["KPN B.V."],
        fields: {},
        version: 1,
        origin: "confirmed",
        updatedAt: "2026-01-01T00:00:00.000Z",
        history: [],
      },
    };
    const corpus = [
      makeInvoice({ vendor: "KPN", total: 40 }),
      makeInvoice({ vendor: "KPN B.V.", total: 40 }),
      makeInvoice({ vendor: "Acme B.V.", total: 900 }),
    ];

    const baselines = buildVendorBaselines(corpus, profiles);

    expect(baselines.get("kpn")?.sampleSize).toBe(2);
    expect(baselines.get("acme b.v.")?.sampleSize).toBe(1);
  });
});
