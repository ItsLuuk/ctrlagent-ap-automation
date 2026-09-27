import { describe, expect, it } from "bun:test";
import { attentionForInvoice } from "./attention";
import type { SyncEvent } from "./erp-sync";
import type { Invoice } from "./types";

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv-1",
    vendor: "Acme Corp",
    invoiceNumber: "A-1",
    status: "review",
    lineItems: [{ id: "line-1" }],
    memo: "",
    ...over,
  }) as Invoice;

const failedSync: SyncEvent = {
  id: "sync-1",
  invoiceId: "inv-1",
  kind: "bill",
  status: "failed",
  error: "ERP rejected the vendor",
  at: "2026-09-01T00:00:00.000Z",
  attempt: 1,
};

describe("attentionForInvoice", () => {
  it("prioritizes a failed sync over other attention items", () => {
    expect(
      attentionForInvoice(
        invoice({ memo: "held:Waiting for vendor", poId: undefined }),
        failedSync,
      ),
    ).toEqual({
      kind: "sync_failed",
      label: "Sync failed",
      detail: "ERP rejected the vendor",
      syncEvent: failedSync,
    });
  });

  it("derives the held reason from the invoice memo", () => {
    expect(attentionForInvoice(invoice({ memo: "held:Waiting for vendor" }))).toEqual({
      kind: "held",
      label: "Invoice held",
      detail: "Waiting for vendor",
    });
  });

  it("flags a review invoice with lines but no purchase order", () => {
    expect(attentionForInvoice(invoice())).toEqual({
      kind: "no_po",
      label: "No PO linked",
      detail: "Approved-for-review invoice has no linked purchase order.",
    });
  });

  it("returns no attention for an ordinary linked review invoice", () => {
    expect(attentionForInvoice(invoice({ poId: "po-1" }))).toBeUndefined();
  });

  it("removes no-PO attention when an eligible flex policy covers the invoice", () => {
    expect(
      attentionForInvoice(invoice(), undefined, {
        status: "matched",
        source: "contract",
        evidenceId: "contract-1",
        evidenceLabel: "Facilities agreement",
        explanation: "Matched Facilities agreement.",
        canAutoApprove: true,
        blocksApproval: false,
      }),
    ).toBeUndefined();
  });
});
