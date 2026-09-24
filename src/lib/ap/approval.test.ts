/**
 * The approval verdict is the For approval page's one answer, so the test that
 * matters most is the invariant: a row blocks approval **only** when the state
 * machine's own approve-scope validation says so. Everything else here covers
 * the comparisons that never block (vendor identity, PO lines, flags).
 */
import { describe, expect, it } from "bun:test";
import {
  approvalHeadline,
  buildApprovalVerdict,
  correctedLabels,
  correctionAction,
  ibanCheckDigitsValid,
  valuesAgree,
} from "./approval";
import { matchInvoiceToPo, type PoLine } from "./matching";
import { validateInvoiceForConfirmation } from "./mapping";
import type { Invoice, LineItem } from "./types";
import type { PurchaseOrder } from "./po-store";
import type { VendorMaster } from "./vendor-master";

const line = (id: string, description: string, quantity: number, unitPrice: number): LineItem => ({
  id,
  description,
  quantity,
  unitPrice,
  amount: quantity * unitPrice,
  glAccount: "6010",
  department: "Engineering",
});

const poLine = (id: string, description: string, quantity: number, unitPrice: number): PoLine => ({
  id,
  description,
  quantity,
  unitPrice,
  amount: quantity * unitPrice,
});

const LINES = [line("l1", "Widgets", 10, 80), line("l2", "Gadgets", 5, 324)]; // 800 + 1620 = 2420

const PO: PurchaseOrder = {
  id: "po-1",
  number: "PO-4471",
  vendor: "Superdoos B.V.",
  currency: "EUR",
  issueDate: "2026-04-01",
  lines: [poLine("pol1", "Widgets", 10, 80), poLine("pol2", "Gadgets", 5, 324)],
  receipts: [],
  status: "open",
};

/** The vendor master record that agrees with the invoice below. */
const VENDOR: VendorMaster = {
  name: "Superdoos B.V.",
  email: "billing@superdoos.com",
  address: "de Slof 10G, Amsterdam",
  iban: "NL95RABO0336381832",
  vatNumber: "NL005169491B25",
  businessRegistrationNumber: "73408441",
  updatedAt: "2026-09-01T00:00:00Z",
};

const baseInvoice: Invoice = {
  id: "inv-approval",
  vendor: "Superdoos BV",
  invoiceNumber: "2026-0231",
  issueDate: "2026-04-12",
  dueDate: "2026-05-12",
  currency: "EUR",
  subtotal: 2000,
  tax: 420,
  total: 2420,
  address: "De Slof 10G, Amsterdam",
  vendorEmail: "billing@superdoos.com",
  iban: "NL95 RABO 0336 3818 32",
  vatNumber: "NL 0051.6949.1B25",
  businessRegistrationNumber: "73408441",
  status: "review",
  poId: "po-1",
  lineItems: LINES,
  glAccount: "6010",
  department: "Engineering",
  memo: "",
  tags: [],
  provenance: { vendor: "read", invoiceNumber: "read", total: "read" },
  audit: [],
  source: "sample",
  createdAt: "2026-09-19T00:00:00Z",
};

const inv = (over: Partial<Invoice> = {}): Invoice => ({ ...baseInvoice, ...over });

/** Mirrors the route: the match runs against the *linked* PO, so no link means no PO. */
const verdictFor = (
  over: Partial<Invoice> = {},
  opts: { record?: VendorMaster | undefined } = {},
) => {
  const invoice = inv(over);
  const po = invoice.poId ? PO : undefined;
  return buildApprovalVerdict({
    invoice,
    vendorRecord: "record" in opts ? opts.record : VENDOR,
    po,
    match:
      invoice.lineItems.length > 0 ? matchInvoiceToPo(invoice.lineItems, po?.lines ?? []) : null,
  });
};

const approveErrors = (invoice: Invoice): string[] =>
  validateInvoiceForConfirmation(invoice, "approve")
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code)
    .sort();

describe("vendor identity comparison", () => {
  it("matches a vendor name written with different punctuation", () => {
    expect(valuesAgree("vendor", "Superdoos BV", "Superdoos B.V.")).toBe(true);
    expect(valuesAgree("iban", "NL95 RABO 0336 3818 32", "NL95RABO0336381832")).toBe(true);
    expect(valuesAgree("vatNumber", "NL 0051.6949.1B25", "NL005169491B25")).toBe(true);
  });

  it("keeps a different IBAN apart", () => {
    expect(valuesAgree("iban", "NL95RABO0336381832", "NL91ABNA0417164300")).toBe(false);
  });

  it("compares addresses by their words, not their order", () => {
    expect(valuesAgree("address", "de Slof 10G, Amsterdam", "Amsterdam — de Slof 10G")).toBe(true);
    expect(valuesAgree("address", "de Slof 10G, Amsterdam", "Keizersgracht 1, Utrecht")).toBe(
      false,
    );
  });

  it("says so once when we hold no vendor record", () => {
    const verdict = verdictFor({}, { record: undefined });
    const vendorRows = verdict.checks.filter((c) => c.group === "vendor");
    expect(vendorRows).toHaveLength(1);
    expect(vendorRows[0]!.id).toBe("vendor:no-record");
    expect(vendorRows[0]!.severity).toBe("attention");
  });

  it("offers the create-record action only on the missing-record row", () => {
    const verdict = verdictFor({}, { record: undefined });
    const noRecord = verdict.checks.find((c) => c.id === "vendor:no-record")!;
    expect(noRecord.action).toBe("create-vendor-record");

    const full = verdictFor();
    expect(full.checks.some((c) => c.action !== undefined)).toBe(false);
  });

  it("flags one side holding nothing the other side shows", () => {
    const verdict = verdictFor({ vendorEmail: undefined });
    const email = verdict.checks.find((c) => c.id === "vendor:vendorEmail")!;
    expect(email.severity).toBe("attention");
    expect(email.heldValue).toBe("billing@superdoos.com");

    const gap = verdictFor({}, { record: { ...VENDOR, iban: undefined } });
    const iban = gap.checks.find((c) => c.id === "vendor:iban")!;
    expect(iban.severity).toBe("attention");
    expect(iban.heldValue).toBe("Not on file");
  });

  it("checks the IBAN's own digits even when our record agrees", () => {
    expect(ibanCheckDigitsValid("NL95RABO0336381832")).toBe(true);
    expect(ibanCheckDigitsValid("NL95RABO0336381831")).toBe(false);
    expect(ibanCheckDigitsValid(undefined)).toBeUndefined();

    const verdict = verdictFor(
      { iban: "NL95RABO0336381831" },
      { record: { ...VENDOR, iban: "NL95RABO0336381831" } },
    );
    const iban = verdict.checks.find((c) => c.id === "vendor:iban")!;
    expect(iban.severity).toBe("attention");
    expect(iban.detail).toContain("check digits");
  });
});

describe("the verdict and the state machine's gate", () => {
  const variants: Partial<Invoice>[] = [
    {},
    { glAccount: "", department: "" },
    { dueDate: "2026-02-30" },
    { invoiceNumber: "" },
    { total: 2400 },
    { lineItems: [line("l1", "Widgets", 10, 80)] },
    { poId: undefined },
  ];

  it("blocks exactly the issues approval refuses on", () => {
    for (const over of variants) {
      const invoice = inv(over);
      const verdict = verdictFor(over);
      // Every blocking row carries one code, and every approve-scope error is
      // carried by exactly one row — the button and the verdict cannot disagree.
      expect(verdict.blocking.map((c) => c.code).sort()).toEqual(approveErrors(invoice));
      expect(verdict.blocking.every((c) => c.code !== undefined)).toBe(true);
      expect(verdict.canApprove).toBe(approveErrors(invoice).length === 0);
    }
  });

  it("has no duplicate row ids", () => {
    const ids = verdictFor().checks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("amounts", () => {
  it("reconciles lines against the total", () => {
    const row = verdictFor().checks.find((c) => c.id === "amounts:reconcile")!;
    expect(row.severity).toBe("ok");
    expect(row.documentValue).toContain("2 lines");
    expect(row.heldValue).toBe("Invoice total €2,420.00");
  });

  it("blocks when the lines cannot reach the total, and names the gap", () => {
    const row = verdictFor({ total: 2500 }).checks.find((c) => c.id === "amounts:reconcile")!;
    expect(row.severity).toBe("blocking");
    expect(row.detail).toContain("€2,420.00");
    expect(row.detail).toContain("€2,500.00");
  });
});

describe("purchase order lines", () => {
  it("marks matched lines ok and carries the PO line beside the document value", () => {
    const rows = verdictFor().checks.filter((c) => c.group === "lines");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.severity === "ok")).toBe(true);
    expect(rows[0]!.heldValue).toBe("10 × €80.00 = €800.00");
  });

  it("puts an exception first and explains it", () => {
    const invoice = inv({ lineItems: [line("l1", "Widgets", 12, 80), LINES[1]!] });
    const verdict = buildApprovalVerdict({
      invoice,
      vendorRecord: VENDOR,
      po: PO,
      match: matchInvoiceToPo(invoice.lineItems, PO.lines),
    });
    const rows = verdict.checks.filter((c) => c.group === "lines");
    expect(rows[0]!.severity).toBe("attention");
    expect(rows[0]!.detail).toContain("Invoice says 12, PO says 10");
  });

  it("says there is nothing to match against without a PO", () => {
    const rows = verdictFor({ poId: undefined }).checks.filter((c) => c.group === "lines");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("lines:no-po");
    expect(rows[0]!.severity).toBe("attention");
  });

  it("states the missing PO once, not again on the commitment row", () => {
    const verdict = verdictFor({ poId: undefined });
    const commitment = verdict.checks.find((c) => c.id === "commitments:po")!;
    expect(commitment.heldValue).toBe("Nothing linked");
    expect(commitment.detail).toBeUndefined();
    const explained = verdict.checks.filter((c) => /only checked against/i.test(c.detail ?? ""));
    expect(explained).toHaveLength(1);
    expect(explained[0]!.id).toBe("lines:no-po");
  });
});

describe("commitments and flags", () => {
  it("summarises the linked PO", () => {
    const row = verdictFor().checks.find((c) => c.id === "commitments:po")!;
    expect(row.severity).toBe("ok");
    // The PO number appears once, not once per summary part.
    expect(row.heldValue).toBe("PO-4471 · 2/2 matched");
    expect(row.documentValue).toBe("—");
  });

  it("turns a duplicate risk into evidence with a plain explanation", () => {
    const rows = verdictFor({ tags: ["Duplicate risk", "Recurring"] }).checks.filter(
      (c) => c.group === "commitments",
    );
    const duplicate = rows.find((r) => r.id === "commitments:flag:Duplicate risk")!;
    const recurring = rows.find((r) => r.id === "commitments:flag:Recurring")!;
    expect(duplicate.severity).toBe("attention");
    expect(duplicate.detail).toContain("billed twice");
    expect(recurring.severity).toBe("ok");
  });
});

describe("coding", () => {
  it("shows what is chosen when it is complete", () => {
    const row = verdictFor().checks.find((c) => c.id === "coding:chosen")!;
    expect(row.severity).toBe("ok");
    expect(row.heldValue).toBe("Engineering · 6010");
  });

  it("blocks and shows one row — no duplicate ok row — when nothing is chosen", () => {
    const verdict = verdictFor({ glAccount: "", department: "" });
    const rows = verdict.checks.filter((c) => c.group === "coding");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("missing_coding");
    expect(rows[0]!.severity).toBe("blocking");
  });
});

describe("rows that carry no second opinion", () => {
  it("leaves a passing header row with nothing on our side", () => {
    const verdict = verdictFor();
    for (const id of ["header:invoiceNumber", "header:issueDate", "header:dueDate"]) {
      const row = verdict.checks.find((c) => c.id === id)!;
      expect(row.severity).toBe("ok");
      // The fake counterpart ("Required before approval") used to sit in the
      // column where a second opinion belongs, on every passing invoice.
      expect(row.heldValue).toBeUndefined();
      // The document's own value stays, because that is what can be corrected.
      expect(row.documentValue).toBeTruthy();
    }
  });

  it("names the requirement when the field is what blocks approval", () => {
    const row = verdictFor({ invoiceNumber: "" }).checks.find(
      (c) => c.id === "header:invoiceNumber",
    )!;
    expect(row.severity).toBe("blocking");
    expect(row.heldValue).toBe("Required before approval");
  });

  it("drops the currency row when the currency is fine", () => {
    expect(verdictFor().checks.some((c) => c.id === "header:currency")).toBe(false);
  });

  it("keeps the currency row when the currency is the problem", () => {
    const row = verdictFor({ currency: "" }).checks.find((c) => c.id === "header:currency")!;
    expect(row.severity).toBe("blocking");
    expect(row.heldValue).toBe("One of the supported currencies");
    expect(row.detail).toBeTruthy();
  });
});

describe("headline", () => {
  it("counts and locates what needs fixing", () => {
    expect(verdictFor().headline).toMatch(/^Everything matches — \d+ checks agree\./);
    expect(verdictFor({ tags: ["Duplicate risk"] }).headline).toBe(
      "Nothing blocks approval. 1 row needs your judgment — duplicate risk.",
    );
    expect(verdictFor({ glAccount: "", department: "", total: 2500 }).headline).toBe(
      "2 issues must be fixed before this can be approved — amounts reconcile and coding.",
    );
  });

  it("keeps a dashed line-item name from reading as punctuation", () => {
    const headline = verdictFor({
      // The lines still add up to the invoice total, but both unit prices
      // differ from the purchase order, so these are rows to look at.
      lineItems: [
        line("l1", "Compute cluster — annual commitment", 10, 85),
        line("l2", "Gadgets", 5, 314),
      ],
    }).headline;
    expect(headline).toContain("compute cluster");
    expect(headline).not.toContain("annual commitment");
  });

  it("falls back to the calm all-clear", () => {
    expect(approvalHeadline({ blocking: [], attention: [], ok: [{} as never, {} as never] })).toBe(
      "Everything matches — 2 checks agree. Nothing needs your judgment.",
    );
  });
});

describe("corrections", () => {
  it("reads the labels a person changed after extraction", () => {
    expect(correctionAction("Total")).toBe("Corrected Total");
    const invoice = inv({
      audit: [
        {
          id: "a1",
          at: "2026-09-20T10:00:00Z",
          actor: "Dana Whitfield",
          action: correctionAction("Total"),
          note: "was €2,420.00 → €2,500.00",
        },
      ],
    });
    expect([...correctedLabels(invoice)]).toEqual(["total"]);

    const verdict = buildApprovalVerdict({
      invoice,
      vendorRecord: VENDOR,
      po: PO,
      match: matchInvoiceToPo(invoice.lineItems, PO.lines),
    });
    expect(verdict.checks.find((c) => c.field === "total")!.corrected).toBe(true);
  });
});
