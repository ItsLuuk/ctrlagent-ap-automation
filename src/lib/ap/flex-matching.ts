import type { Invoice } from "./types";

export type FlexMatchSource = "contract" | "receipt" | "rule";

export type FlexRule = {
  id: string;
  name: string;
  vendor?: string | undefined;
  department?: string | undefined;
  minAmount?: number | undefined;
  maxAmount?: number | undefined;
  requiresReceipt?: boolean | undefined;
  /** Whether a match removes the normal no-PO review requirement. */
  canAutoApprove?: boolean | undefined;
  /** Whether a required-but-missing receipt must stop approval. */
  missingReceiptSeverity?: "attention" | "blocking" | undefined;
  active: boolean;
};

export type FlexContract = {
  id: string;
  name: string;
  vendor: string;
  validFrom?: string | undefined;
  validTo?: string | undefined;
  department?: string | undefined;
  maxAmount?: number | undefined;
  requiresReceipt?: boolean | undefined;
  /** Whether a match removes the normal no-PO review requirement. */
  canAutoApprove?: boolean | undefined;
  /** Whether a required-but-missing receipt must stop approval. */
  missingReceiptSeverity?: "attention" | "blocking" | undefined;
  active: boolean;
};

export type FlexReceipt = {
  id: string;
  vendor: string;
  invoiceNumber?: string | undefined;
  total: number;
  receivedAt: string;
};

export type FlexMatchResult = {
  status: "matched" | "exception" | "unmatched";
  source?: FlexMatchSource | undefined;
  evidenceId?: string | undefined;
  evidenceLabel?: string | undefined;
  explanation: string;
  canAutoApprove: boolean;
  blocksApproval: boolean;
};

const sameText = (left: string, right: string): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

const withinAmount = (amount: number, minAmount?: number, maxAmount?: number): boolean =>
  (minAmount === undefined || amount >= minAmount) &&
  (maxAmount === undefined || amount <= maxAmount);

const matchesVendor = (expected: string | undefined, actual: string): boolean =>
  expected === undefined || sameText(expected, actual);

const matchesDepartment = (expected: string | undefined, actual: string): boolean =>
  expected === undefined || sameText(expected, actual);

function receiptMatches(invoice: Invoice, receipt: FlexReceipt): boolean {
  return (
    sameText(receipt.vendor, invoice.vendor) &&
    (receipt.invoiceNumber === undefined ||
      sameText(receipt.invoiceNumber, invoice.invoiceNumber)) &&
    Math.abs(receipt.total - invoice.total) <= 0.02
  );
}

/** Evaluates a no-PO invoice against contracts, receipts, then configured rules. */
export function matchNoPoInvoice(
  invoice: Invoice,
  options: {
    contracts?: FlexContract[] | undefined;
    receipts?: FlexReceipt[] | undefined;
    rules?: FlexRule[] | undefined;
  } = {},
): FlexMatchResult {
  const contract = (options.contracts ?? []).find((candidate) => {
    if (!candidate.active || !sameText(candidate.vendor, invoice.vendor)) return false;
    if (candidate.validFrom && invoice.issueDate < candidate.validFrom) return false;
    if (candidate.validTo && invoice.issueDate > candidate.validTo) return false;
    if (!matchesDepartment(candidate.department, invoice.department)) return false;
    return withinAmount(invoice.total, undefined, candidate.maxAmount);
  });
  if (contract) {
    const receiptRequired = contract.requiresReceipt;
    const receipt = (options.receipts ?? []).find((candidate) =>
      receiptMatches(invoice, candidate),
    );
    if (receiptRequired && !receipt) {
      return {
        status: "exception",
        source: "contract",
        evidenceId: contract.id,
        evidenceLabel: contract.name,
        explanation: `${contract.name} matches, but no receipt evidence covers this invoice.`,
        canAutoApprove: false,
        blocksApproval: contract.missingReceiptSeverity === "blocking",
      };
    }
    return {
      status: "matched",
      source: "contract",
      evidenceId: contract.id,
      evidenceLabel: contract.name,
      explanation: `Matched ${contract.name}.`,
      canAutoApprove: contract.canAutoApprove !== false,
      blocksApproval: false,
    };
  }

  const receipt = (options.receipts ?? []).find((candidate) => receiptMatches(invoice, candidate));
  if (receipt) {
    return {
      status: "matched",
      source: "receipt",
      evidenceId: receipt.id,
      evidenceLabel: `Receipt ${receipt.id}`,
      explanation: "Matched a receipt for this vendor, invoice number, and amount.",
      canAutoApprove: true,
      blocksApproval: false,
    };
  }

  const rule = (options.rules ?? []).find((candidate) => {
    if (!candidate.active) return false;
    if (!matchesVendor(candidate.vendor, invoice.vendor)) return false;
    if (!matchesDepartment(candidate.department, invoice.department)) return false;
    return withinAmount(invoice.total, candidate.minAmount, candidate.maxAmount);
  });
  if (rule) {
    if (rule.requiresReceipt) {
      return {
        status: "exception",
        source: "rule",
        evidenceId: rule.id,
        evidenceLabel: rule.name,
        explanation: `${rule.name} matches, but it requires receipt evidence.`,
        canAutoApprove: false,
        blocksApproval: rule.missingReceiptSeverity === "blocking",
      };
    }
    return {
      status: "matched",
      source: "rule",
      evidenceId: rule.id,
      evidenceLabel: rule.name,
      explanation: `Matched rule ${rule.name}.`,
      canAutoApprove: rule.canAutoApprove !== false,
      blocksApproval: false,
    };
  }

  return {
    status: "unmatched",
    explanation: "No contract, receipt, or flex rule covers this no-PO invoice.",
    canAutoApprove: false,
    blocksApproval: false,
  };
}
