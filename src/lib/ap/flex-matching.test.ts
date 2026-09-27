import { describe, expect, it } from "bun:test";
import {
  matchNoPoInvoice,
  type FlexContract,
  type FlexReceipt,
  type FlexRule,
} from "./flex-matching";
import type { Invoice } from "./types";

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv-1",
    vendor: "Acme Facilities B.V.",
    invoiceNumber: "INV-42",
    issueDate: "2026-09-15",
    dueDate: "2026-10-15",
    currency: "EUR",
    subtotal: 1000,
    tax: 210,
    total: 1210,
    status: "review",
    lineItems: [
      { id: "line-1", description: "Monthly cleaning", quantity: 1, unitPrice: 1000, amount: 1000 },
    ],
    department: "Facilities",
    glAccount: "6200",
    memo: "",
    tags: [],
    confidence: {},
    audit: [],
    createdAt: "2026-09-15T00:00:00Z",
    ...over,
  }) as Invoice;

const contract = (over: Partial<FlexContract> = {}): FlexContract => ({
  id: "contract-1",
  name: "Facilities master agreement",
  vendor: "Acme Facilities B.V.",
  validFrom: "2026-01-01",
  validTo: "2026-12-31",
  department: "Facilities",
  maxAmount: 2000,
  active: true,
  ...over,
});

const receipt: FlexReceipt = {
  id: "receipt-1",
  vendor: "Acme Facilities B.V.",
  invoiceNumber: "INV-42",
  total: 1210,
  receivedAt: "2026-09-15T10:00:00Z",
};

const rule = (over: Partial<FlexRule> = {}): FlexRule => ({
  id: "rule-1",
  name: "Facilities under €1,500",
  vendor: "Acme Facilities B.V.",
  department: "Facilities",
  minAmount: 500,
  maxAmount: 1500,
  active: true,
  ...over,
});

describe("no-PO flex matching", () => {
  it("matches an active contract and makes the invoice approval-eligible", () => {
    const result = matchNoPoInvoice(invoice(), { contracts: [contract()] });

    expect(result).toMatchObject({
      status: "matched",
      source: "contract",
      evidenceId: "contract-1",
      canAutoApprove: true,
      blocksApproval: false,
    });
  });

  it("ignores contracts that are inactive or outside their validity dates", () => {
    expect(matchNoPoInvoice(invoice(), { contracts: [contract({ active: false })] }).status).toBe(
      "unmatched",
    );
    expect(
      matchNoPoInvoice(invoice(), { contracts: [contract({ validTo: "2026-09-14" })] }).status,
    ).toBe("unmatched");
  });

  it("matches receipt evidence by vendor, invoice number, and amount", () => {
    const result = matchNoPoInvoice(invoice(), { receipts: [receipt] });

    expect(result).toMatchObject({
      status: "matched",
      source: "receipt",
      evidenceId: "receipt-1",
      canAutoApprove: true,
    });
  });

  it("matches vendor, department, and amount thresholds", () => {
    expect(matchNoPoInvoice(invoice(), { rules: [rule()] })).toMatchObject({
      status: "matched",
      source: "rule",
      evidenceId: "rule-1",
      canAutoApprove: true,
    });
    expect(matchNoPoInvoice(invoice({ department: "Legal" }), { rules: [rule()] }).status).toBe(
      "unmatched",
    );
    expect(matchNoPoInvoice(invoice({ total: 1500.01 }), { rules: [rule()] }).status).toBe(
      "unmatched",
    );
  });

  it("returns an exception when a matched rule requires receipt evidence", () => {
    const result = matchNoPoInvoice(invoice(), {
      rules: [rule({ requiresReceipt: true, missingReceiptSeverity: "blocking" })],
    });

    expect(result).toMatchObject({
      status: "exception",
      source: "rule",
      canAutoApprove: false,
      blocksApproval: true,
    });
  });

  it("leaves an invoice unmatched when no configured evidence covers it", () => {
    expect(matchNoPoInvoice(invoice(), { rules: [rule({ vendor: "Other vendor" })] })).toEqual({
      status: "unmatched",
      explanation: "No contract, receipt, or flex rule covers this no-PO invoice.",
      canAutoApprove: false,
      blocksApproval: false,
    });
  });
});
