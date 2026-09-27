import { describe, expect, it } from "bun:test";
import { attentionForInvoice } from "./attention";
import { standingFor } from "./standing";
import type { Invoice } from "./types";

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv-1",
    vendor: "Acme Corp",
    invoiceNumber: "A-1",
    status: "draft",
    currency: "EUR",
    total: 100,
    dueDate: "2026-10-01",
    memo: "",
    lineItems: [],
    ...over,
  }) as Invoice;

const none = new Map();
const now = new Date("2026-09-25T00:00:00.000Z");

/** The same map the inbox rows read, so the two cannot drift apart. */
const attentionFor = (...invoices: Invoice[]) =>
  new Map(
    invoices.map((item) => [
      item.id,
      attentionForInvoice(item) as NonNullable<ReturnType<typeof attentionForInvoice>>,
    ]),
  );

describe("standingFor", () => {
  it("counts what is still owed", () => {
    const standing = standingFor(
      [invoice({ status: "draft" }), invoice({ id: "inv-2", status: "scheduled", total: 60 })],
      none,
      now,
    );

    expect(standing.outstanding).toEqual({ count: 2, money: [{ currency: "EUR", amount: 160 }] });
  });

  it("leaves out what is paid, turned down or archived", () => {
    const standing = standingFor(
      [
        invoice({ id: "a", status: "paid" }),
        invoice({ id: "b", status: "rejected" }),
        invoice({ id: "c", status: "archived" }),
      ],
      none,
      now,
    );

    expect(standing.outstanding.count).toBe(0);
    expect(standing.needsYou).toBe(0);
  });

  it("keeps two currencies apart instead of adding them up", () => {
    const standing = standingFor(
      [
        invoice({ id: "a", currency: "EUR", total: 100 }),
        invoice({ id: "b", currency: "USD", total: 90 }),
      ],
      none,
      now,
    );

    expect(standing.outstanding.money).toEqual([
      { currency: "EUR", amount: 100 },
      { currency: "USD", amount: 90 },
    ]);
  });

  it("counts the stages only a person can move on", () => {
    const standing = standingFor(
      [
        invoice({ id: "a", status: "vendor_profile" }),
        invoice({ id: "b", status: "draft" }),
        invoice({ id: "c", status: "review" }),
        invoice({ id: "d", status: "scheduled" }),
      ],
      none,
      now,
    );

    expect(standing.needsYou).toBe(3);
  });

  it("counts only what is overdue among what is still owed", () => {
    const standing = standingFor(
      [
        invoice({ id: "a", dueDate: "2026-09-01" }),
        invoice({ id: "b", dueDate: "2026-10-30" }),
        invoice({ id: "c", dueDate: "2026-09-01", status: "paid" }),
      ],
      none,
      now,
    );

    expect(standing.late).toBe(1);
  });

  it("groups what is blocked by reason, with the reason spelled out", () => {
    const held = invoice({ id: "held", memo: "held:Waiting for vendor" });
    const standing = standingFor(
      [held, invoice({ id: "no-po", status: "review" }), invoice({ id: "clean" })],
      attentionFor(held, invoice({ id: "no-po", status: "review" })),
      now,
    );

    expect(standing.blocked).toEqual([
      {
        label: "Invoice held",
        count: 1,
        detail: "Waiting for vendor",
        ids: ["held"],
      },
      {
        label: "No PO linked",
        count: 1,
        detail: "Approved-for-review invoice has no linked purchase order.",
        ids: ["no-po"],
      },
    ]);
  });

  it("puts a retryable failure above the reasons it outranks", () => {
    const standing = standingFor(
      [invoice({ id: "held", memo: "held:Waiting" }), invoice({ id: "broken", status: "review" })],
      new Map([
        ["held", { kind: "held", label: "Invoice held", detail: "Waiting" }],
        [
          "broken",
          { kind: "sync_failed", label: "Sync failed", detail: "ERP rejected the vendor" },
        ],
      ]),
      now,
    );

    expect(standing.blocked.map((block) => block.label)).toEqual(["Sync failed", "Invoice held"]);
  });

  it("reports nothing blocked when nothing is", () => {
    expect(standingFor([invoice()], none, now).blocked).toEqual([]);
  });
});
