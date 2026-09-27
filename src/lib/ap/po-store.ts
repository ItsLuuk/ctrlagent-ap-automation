/**
 * Purchase-order store (plan §1.1, §5 "pull early").
 *
 * In-browser stand-in for the ERP vendor-master/PO pull: persists POs in
 * localStorage and offers the same lookup surface the ERP sync layer will
 * implement later (find by vendor, find by id). When real ERP integration
 * lands, only this module's read/write functions change — the matching
 * engine and UI keep their contracts.
 */
import type { InvoiceLineLike, PoLine, ReceiptLine } from "./matching";
import type { PurchaseOrder } from "./purchase-order";

const STORAGE_KEY = "ap-automation-purchase-orders-v1";

function readStore(): Record<string, PurchaseOrder> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PurchaseOrder>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, PurchaseOrder>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage full or unavailable */
  }
}

export function readAllPos(): PurchaseOrder[] {
  return Object.values(readStore());
}

export function getPo(id: string): PurchaseOrder | undefined {
  return readStore()[id];
}

export function putPo(po: PurchaseOrder): void {
  const store = readStore();
  store[po.id] = po;
  writeStore(store);
}

export function clearPos(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Finds open POs for a vendor (case-insensitive contains, like a fuzzy ERP search). */
export function findPosForVendor(vendor: string): PurchaseOrder[] {
  const v = vendor.trim().toLowerCase();
  if (!v) return [];
  return readAllPos().filter(
    (po) => po.status === "open" && po.vendor.toLowerCase().includes(v.split(" ")[0] ?? v),
  );
}

/**
 * Naive auto-suggestion: scores open POs for this vendor by how many lines
 * roughly match the invoice's lines (description affinity + qty). Returns
 * the best PO or undefined — the Draft screen shows it as "Did you mean PO-X?".
 */
export function suggestPo(
  vendor: string,
  invoiceLines: InvoiceLineLike[],
): PurchaseOrder | undefined {
  const candidates = findPosForVendor(vendor);
  if (candidates.length === 0) return undefined;
  let best: PurchaseOrder | undefined;
  let bestScore = -1;
  for (const po of candidates) {
    let score = 0;
    for (const line of invoiceLines) {
      if (
        po.lines.some(
          (pl) =>
            pl.description.trim().toLowerCase() === line.description.trim().toLowerCase() &&
            pl.quantity === line.quantity,
        )
      ) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = po;
    }
  }
  return bestScore > 0 ? best : undefined;
}

/**
 * Writes POs, overwriting any record with the same id. Returns the full set so
 * callers can keep their in-memory state in step with storage in one step.
 *
 * Used by the demo-data opt-in: POs are never seeded behind the user's back,
 * because a purchase order the operator can't find the origin of is worse than
 * no purchase order at all.
 */
export function putPos(pos: PurchaseOrder[]): PurchaseOrder[] {
  const store = readStore();
  for (const po of pos) store[po.id] = po;
  writeStore(store);
  return Object.values(store);
}

/** Deletes POs by id and returns what remains. */
export function deletePos(ids: string[]): PurchaseOrder[] {
  const store = readStore();
  for (const id of ids) delete store[id];
  writeStore(store);
  return Object.values(store);
}
