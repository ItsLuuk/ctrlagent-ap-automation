/**
 * Invoice ↔ PO matching engine (Phase Flow Plan §3.5).
 *
 * Pure logic — no store, no UI. Matches invoice lines to PO lines with
 * configurable tolerances and produces per-line match results plus a
 * roll-up used by the Approval decision card:
 *   - matched lines collapse ("8 lines matched ✓")
 *   - exceptions expand with plain-language explanations.
 *
 * Matching supports 2-way (invoice ↔ PO) today; goods receipts extend it to
 * 3-way by passing `receipts` — the engine stays the same, the status just
 * gains receipt-driven exceptions.
 */
import { money } from "./types";

export type PoLine = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type ReceiptLine = {
  poLineId: string;
  /** Quantity actually received at the dock. */
  quantityReceived: number;
  /** When the receipt was recorded; absent on legacy/sample receipts. */
  receivedAt?: string | undefined;
  /** Who recorded the receipt. */
  recordedBy?: string | undefined;
  /** Manual is the first supported source; ERP/mail adapters can add more later. */
  source?: "manual" | "erp" | "mail" | undefined;
};

export type InvoiceLineLike = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type LineMatchStatus =
  "matched" | "qty_mismatch" | "price_mismatch" | "no_po" | "receipt_short";

export type LineMatch = {
  invoiceLineId: string;
  poLineId?: string | undefined;
  status: LineMatchStatus;
  /** Plain-language explanation for exceptions; empty for matched lines. */
  explanation?: string | undefined;
  /** How the line was paired to a PO line (for auditability). */
  matchedBy: "explicit" | "auto";
};

export type MatchMode = "two_way" | "three_way" | "no_po";

export type Tolerances = {
  /** Max relative unit-price deviation, e.g. 0.02 = ±2%. */
  pricePct: number;
  /** Quantity tolerance as absolute units (0 = exact). */
  qtyAbs: number;
};

export const DEFAULT_TOLERANCES: Tolerances = { pricePct: 0.02, qtyAbs: 0 };

export type MatchResult = {
  mode: MatchMode;
  lines: LineMatch[];
  /** Lines that need a human (everything not "matched"). */
  exceptions: LineMatch[];
  matchedCount: number;
};

/** Explicit per-invoice-line PO links (from draft matching context or manual pick). */
export type LineLink = {
  invoiceLineId: string;
  poLineId: string;
};

const priceDeviation = (invoice: number, po: number): number => {
  if (po === 0) return invoice === 0 ? 0 : Number.POSITIVE_INFINITY;
  return Math.abs(invoice - po) / Math.abs(po);
};

/**
 * Picks the best PO line for an invoice line: same quantity first, then
 * closest unit price, then closest description. Deterministic tie-breaks.
 */
export function bestPoLine(line: InvoiceLineLike, poLines: PoLine[]): PoLine | undefined {
  let best: PoLine | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const po of poLines) {
    const qtyDelta = Math.abs(po.quantity - line.quantity);
    const priceDelta = priceDeviation(line.unitPrice, po.unitPrice);
    const descAffinity =
      po.description.trim().toLowerCase() === line.description.trim().toLowerCase() ? 0 : 1;
    const score = descAffinity * 10 + qtyDelta * 2 + priceDelta;
    if (score < bestScore) {
      bestScore = score;
      best = po;
    }
  }
  return best;
}

export function matchInvoiceToPo(
  invoiceLines: InvoiceLineLike[],
  poLines: PoLine[],
  options: {
    tolerances?: Tolerances | undefined;
    receipts?: ReceiptLine[] | undefined;
    links?: LineLink[] | undefined;
  } = {},
): MatchResult {
  const tolerances = options.tolerances ?? DEFAULT_TOLERANCES;
  const receiptsByPoLine = new Map<string, number>();
  for (const receipt of options.receipts ?? []) {
    receiptsByPoLine.set(
      receipt.poLineId,
      (receiptsByPoLine.get(receipt.poLineId) ?? 0) + receipt.quantityReceived,
    );
  }
  const explicitLinks = new Map(
    (options.links ?? []).map((l) => [l.invoiceLineId, l.poLineId] as const),
  );

  if (poLines.length === 0) {
    return {
      mode: "no_po",
      lines: invoiceLines.map((line) => ({
        invoiceLineId: line.id,
        status: "no_po",
        explanation: "No purchase order found for this invoice.",
        matchedBy: "auto" as const,
      })),
      exceptions: invoiceLines.map((line) => ({
        invoiceLineId: line.id,
        status: "no_po" as const,
        explanation: "No purchase order found for this invoice.",
        matchedBy: "auto" as const,
      })),
      matchedCount: 0,
    };
  }

  const lines: LineMatch[] = invoiceLines.map((line) => {
    const explicitId = explicitLinks.get(line.id);
    const po =
      (explicitId && poLines.find((p) => p.id === explicitId)) || bestPoLine(line, poLines);
    const matchedBy: LineMatch["matchedBy"] = explicitId ? "explicit" : "auto";

    if (!po) {
      return {
        invoiceLineId: line.id,
        status: "no_po",
        explanation: "No matching PO line found for this line.",
        matchedBy,
      };
    }

    const qtyDelta = line.quantity - po.quantity;
    if (Math.abs(qtyDelta) > tolerances.qtyAbs) {
      return {
        invoiceLineId: line.id,
        poLineId: po.id,
        status: "qty_mismatch",
        explanation: `Invoice says ${line.quantity}, PO says ${po.quantity} (difference ${qtyDelta > 0 ? "+" : ""}${qtyDelta}).`,
        matchedBy,
      };
    }

    if (priceDeviation(line.unitPrice, po.unitPrice) > tolerances.pricePct) {
      return {
        invoiceLineId: line.id,
        poLineId: po.id,
        status: "price_mismatch",
        explanation: `Invoice unit price ${money(line.unitPrice)} differs from PO ${money(po.unitPrice)} by more than ${(tolerances.pricePct * 100).toFixed(1)}%.`,
        matchedBy,
      };
    }

    if (options.receipts) {
      const received = receiptsByPoLine.get(po.id);
      if (received === undefined) {
        return {
          invoiceLineId: line.id,
          poLineId: po.id,
          status: "receipt_short",
          explanation: "No goods receipt recorded against the PO line.",
          matchedBy,
        };
      }
      if (received + tolerances.qtyAbs < line.quantity) {
        return {
          invoiceLineId: line.id,
          poLineId: po.id,
          status: "receipt_short",
          explanation: `Invoice says ${line.quantity}, warehouse received ${received}.`,
          matchedBy,
        };
      }
    }

    return { invoiceLineId: line.id, poLineId: po.id, status: "matched", matchedBy };
  });

  const exceptions = lines.filter((l) => l.status !== "matched");
  return {
    mode: options.receipts ? "three_way" : "two_way",
    lines,
    exceptions,
    matchedCount: lines.length - exceptions.length,
  };
}

/** Roll-up headline for the approval card, e.g. "PO-4471 · 8/10 matched · 2 exceptions". */
export function matchSummary(result: MatchResult, poNumber?: string | undefined): string {
  const parts: string[] = [];
  if (poNumber) parts.push(poNumber);
  parts.push(`${result.matchedCount}/${result.lines.length} matched`);
  if (result.exceptions.length > 0)
    parts.push(`${result.exceptions.length} exception${result.exceptions.length > 1 ? "s" : ""}`);
  return parts.join(" · ");
}
