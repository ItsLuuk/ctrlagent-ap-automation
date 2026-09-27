/**
 * Purchase-order domain shape.
 *
 * Lives apart from `po-store` on purpose: the store is a localStorage adapter,
 * and every domain rule that reasons about a PO (3-way matching, approval
 * gating, CSV export) would otherwise import a persistence module just for a
 * type. Adapters import this; this imports nothing but the line shapes.
 */
import type { PoLine, ReceiptLine } from "./matching";

export type PurchaseOrder = {
  id: string;
  /** Human PO number shown in the UI, e.g. "PO-4471". */
  number: string;
  vendor: string;
  currency: string;
  issueDate: string;
  lines: PoLine[];
  /** Receipts per PO line — feeds 3-way matching. */
  receipts: ReceiptLine[];
  status: "open" | "closed";
};
