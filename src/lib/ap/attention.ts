import type { SyncEvent } from "./erp-sync";
import type { Invoice } from "./types";

/** A concrete reason an invoice needs the next person's attention. */
export type AttentionKind = "sync_failed" | "held" | "no_po";

export type InvoiceAttention = {
  kind: AttentionKind;
  label: string;
  detail: string;
  /** Present when the attention is a retryable ERP sync failure. */
  syncEvent?: SyncEvent | undefined;
};

export const ATTENTION_LABEL: Record<AttentionKind, string> = {
  sync_failed: "Sync failed",
  held: "Invoice held",
  no_po: "No PO linked",
};

/**
 * Derive the highest-priority attention item for one invoice.
 *
 * This is deliberately row-level rather than queue-level: the inbox and the
 * exception route can share the same facts without making one screen the
 * source of truth for the other. A sync failure wins because retrying it is
 * the most direct action available; held invoices and missing POs remain
 * visible once the technical failure is resolved.
 */
export function attentionForInvoice(
  invoice: Invoice,
  latestSyncEvent?: SyncEvent,
): InvoiceAttention | undefined {
  if (latestSyncEvent?.status === "failed") {
    return {
      kind: "sync_failed",
      label: ATTENTION_LABEL.sync_failed,
      detail:
        latestSyncEvent.error ??
        "The sync failed without a reason — retry it, then report the problem.",
      syncEvent: latestSyncEvent,
    };
  }

  if (invoice.memo.includes("held:")) {
    return {
      kind: "held",
      label: ATTENTION_LABEL.held,
      detail: invoice.memo.split("held:")[1]?.trim() || "Held",
    };
  }

  if (invoice.status === "review" && !invoice.poId && invoice.lineItems.length > 0) {
    return {
      kind: "no_po",
      label: ATTENTION_LABEL.no_po,
      detail: "Approved-for-review invoice has no linked purchase order.",
    };
  }

  return undefined;
}
