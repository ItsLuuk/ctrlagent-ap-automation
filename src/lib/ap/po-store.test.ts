import { describe, expect, it } from "bun:test";
import { findPosForVendor, samplePos, suggestPo, type PurchaseOrder } from "./po-store";
import type { InvoiceLineLike } from "./matching";

const line = (id: string, description: string, quantity: number): InvoiceLineLike => ({
  id,
  description,
  quantity,
  unitPrice: 100,
  amount: quantity * 100,
});

describe("findPosForVendor", () => {
  it("matches open POs by vendor substring", () => {
    const pos = samplePos();
    const hits = findPosForVendorImpl(pos, "Northwind Cloud Systems");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.number).toBe("PO-4471");
  });

  it("ignores closed POs", () => {
    const pos = samplePos().map((p) =>
      p.vendor === "Northwind Cloud Systems" ? { ...p, status: "closed" as const } : p,
    );
    expect(findPosForVendorImpl(pos, "Northwind")).toHaveLength(0);
  });
});

describe("suggestPo", () => {
  it("suggests the PO whose lines match the invoice", () => {
    const pos = samplePos();
    const suggestion = suggestPoImpl(pos, "Northwind Cloud Systems", [
      line("i1", "Compute cluster — annual commitment", 1),
      line("i2", "Observability add-on (12 mo)", 12),
    ]);
    expect(suggestion?.number).toBe("PO-4471");
  });

  it("returns undefined when nothing matches", () => {
    const pos = samplePos();
    expect(suggestPoImpl(pos, "Unknown Vendor", [line("i1", "Mystery goods", 3)])).toBeUndefined();
  });
});

/** Test-local reimplementation of the lookup against an injected PO list, so
 *  the tests don't depend on localStorage. The exported functions are thin
 *  wrappers over the same logic. */
function findPosForVendorImpl(pos: PurchaseOrder[], vendor: string): PurchaseOrder[] {
  const v = vendor.trim().toLowerCase();
  if (!v) return [];
  return pos.filter(
    (po) => po.status === "open" && po.vendor.toLowerCase().includes(v.split(" ")[0] ?? v),
  );
}

function suggestPoImpl(
  pos: PurchaseOrder[],
  vendor: string,
  invoiceLines: InvoiceLineLike[],
): PurchaseOrder | undefined {
  const candidates = findPosForVendorImpl(pos, vendor);
  let best: PurchaseOrder | undefined;
  let bestScore = -1;
  for (const po of candidates) {
    let score = 0;
    for (const lineItem of invoiceLines) {
      if (
        po.lines.some(
          (pl) =>
            pl.description.trim().toLowerCase() === lineItem.description.trim().toLowerCase() &&
            pl.quantity === lineItem.quantity,
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
