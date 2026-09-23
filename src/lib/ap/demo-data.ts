/**
 * Demo data — an explicit opt-in, never a first-run default.
 *
 * Foundry used to open on four invented invoices with €19,964 sitting in
 * "Awaiting approval". That makes the operator's first job "work out which of
 * these are real" (they cannot — none of them are), and it puts money that was
 * never owed on a screen whose whole purpose is being a ledger. A first run
 * shows nothing and teaches the one action that fills it in; the demo set is
 * something you ask for.
 *
 * Two rules hold everywhere:
 *  1. Every demo record carries `source: "sample"`, so it can be labelled in
 *     the UI and found again later.
 *  2. Removal only ever touches those records, so clearing the demo can never
 *     take a real capture with it.
 */
import { sampleHistory, sampleInvoices } from "./samples";
import { samplePos, type PurchaseOrder } from "./po-store";
import type { Invoice } from "./types";

/** The whole demo set: the queue, the history and the POs it matches against. */
export function sampleDataPayload(): {
  invoices: Invoice[];
  history: Invoice[];
  purchaseOrders: PurchaseOrder[];
} {
  return {
    invoices: sampleInvoices(),
    history: sampleHistory(),
    purchaseOrders: samplePos(),
  };
}

/** True when a record came from the demo set rather than an upload. */
export function isSampleInvoice(invoice: Invoice): boolean {
  return invoice.source === "sample";
}

/** True when the queue or the history holds demo data. */
export function hasSampleData(invoices: Invoice[], history: Invoice[]): boolean {
  return invoices.some(isSampleInvoice) || history.some(isSampleInvoice);
}

/**
 * The records that survive clearing the demo — every real capture, untouched.
 * Applied to the queue and the history alike, because both can hold demo data.
 */
export function withoutSampleData<T extends Invoice>(records: T[]): T[] {
  return records.filter((record) => !isSampleInvoice(record));
}

/** Appends records that are not already present, by id, keeping existing first. */
export function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const known = new Set(existing.map((record) => record.id));
  return [...existing, ...incoming.filter((record) => !known.has(record.id))];
}
