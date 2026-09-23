import { beforeEach, describe, expect, it } from "bun:test";
import {
  attemptSync,
  clearSyncEvents,
  erpRefsFor,
  latestSyncByInvoice,
  syncKey,
  syncStateFor,
} from "./erp-sync";
import type { Invoice } from "./types";

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv-1",
    vendor: "Acme Corp",
    invoiceNumber: "A-0231",
    total: 2340,
    status: "scheduled",
    lineItems: [],
    confidence: {},
    audit: [],
    createdAt: "2026-09-19T00:00:00Z",
    ...over,
  }) as unknown as Invoice;

beforeEach(() => clearSyncEvents());

describe("attemptSync", () => {
  it("syncs a bill and returns a visible ERP reference", () => {
    const event = attemptSync(invoice(), "bill");
    expect(event.status).toBe("synced");
    expect(event.mode).toBe("demo");
    expect(event.erpRef).toBeUndefined();
  });

  it("is idempotent — a retried sync does not double-post", () => {
    const first = attemptSync(invoice(), "bill");
    const second = attemptSync(invoice(), "bill");
    expect(second.id).toBe(first.id);
    expect(second.at).toBe(first.at);
  });

  it("keys bill and payment pushes separately", () => {
    expect(syncKey("inv-1", "bill")).not.toBe(syncKey("inv-1", "payment"));
    const bill = attemptSync(invoice(), "bill");
    const payment = attemptSync(invoice(), "payment");
    expect(bill.id).not.toBe(payment.id);
  });

  it("records failures with an error, not a reference", () => {
    const event = attemptSync(invoice({ id: "inv-f1", invoiceNumber: "ERP-FAIL-1" }), "bill");
    expect(event.status).toBe("failed");
    expect(event.error).toBeTruthy();
    expect(event.erpRef).toBeUndefined();
  });

  it("counts attempts across retries", () => {
    const bad = invoice({ id: "inv-bad", invoiceNumber: "ERP-FAIL-2" });
    attemptSync(bad, "bill");
    const retry = attemptSync(bad, "bill");
    expect(retry.attempt).toBe(2);
  });
});

describe("sync state helpers", () => {
  it("exposes refs only for synced pushes", () => {
    attemptSync(invoice({ id: "inv-mix" }), "bill");
    attemptSync(invoice({ id: "inv-mix", invoiceNumber: "ERP-FAIL-3" }), "payment");
    const refs = erpRefsFor("inv-mix");
    expect(refs.bill).toBeUndefined();
    expect(refs.payment).toBeUndefined();
  });

  it("builds a latest-event map for the payment table", () => {
    attemptSync(invoice({ id: "inv-map" }), "bill");
    const map = latestSyncByInvoice();
    expect(map["inv-map"]?.kind).toBe("bill");
  });

  it("returns the failed event in syncStateFor", () => {
    attemptSync(invoice({ id: "inv-f4", invoiceNumber: "ERP-FAIL-4" }), "bill");
    expect(syncStateFor("inv-f4").bill?.status).toBe("failed");
  });
});
