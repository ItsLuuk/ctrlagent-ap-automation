/**
 * Guards for the demo-data opt-in.
 *
 * The rule these lock down is the one that costs money when it breaks: demo
 * records are labelled, and clearing them never removes a real capture.
 */
import { describe, expect, it } from "bun:test";
import {
  hasSampleData,
  isSampleInvoice,
  mergeById,
  sampleDataPayload,
  withoutSampleData,
} from "./demo-data";
import type { Invoice } from "./types";

/** A captured invoice, as the upload path writes it. */
const captured = (id: string): Invoice => ({ id, source: "upload" }) as Invoice;

describe("demo data", () => {
  it("marks every demo record so it can be labelled and found again", () => {
    const payload = sampleDataPayload();
    expect(payload.invoices.length).toBeGreaterThan(0);
    expect(payload.history.length).toBeGreaterThan(0);
    expect(payload.purchaseOrders.length).toBeGreaterThan(0);
    for (const invoice of [...payload.invoices, ...payload.history]) {
      expect(isSampleInvoice(invoice)).toBe(true);
    }
    expect(hasSampleData(payload.invoices, payload.history)).toBe(true);
  });

  it("removing the demo keeps every captured invoice", () => {
    const payload = sampleDataPayload();
    const queue = [captured("inv-1"), ...payload.invoices];
    const history = [captured("inv-2"), ...payload.history];

    expect(withoutSampleData(queue)).toEqual([captured("inv-1")]);
    expect(withoutSampleData(history)).toEqual([captured("inv-2")]);
    expect(hasSampleData(withoutSampleData(queue), withoutSampleData(history))).toBe(false);
  });

  it("loading the demo twice does not duplicate a record", () => {
    const first = sampleDataPayload();
    const merged = mergeById(first.invoices, sampleDataPayload().invoices);
    expect(merged).toHaveLength(first.invoices.length);
  });

  it("keeps a capture ahead of a demo record that shares its id", () => {
    const mine: Invoice = { ...captured("inv-northwind"), memo: "mine" };
    const merged = mergeById([mine], sampleDataPayload().invoices);
    expect(merged.filter((invoice) => invoice.id === "inv-northwind")).toHaveLength(1);
    expect(merged[0]?.memo).toBe("mine");
  });
});
