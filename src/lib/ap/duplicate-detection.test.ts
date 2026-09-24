/**
 * Unit tests for business-key duplicate detection.
 *
 * Deterministic: the corpus keeps compounding. Tests cover:
 * - Hard key: same resolved vendor + same invoiceNumber, no time window
 * - Soft key: number-less, same vendor, same total, within 7 days
 * - Soft key with different total → not caught
 * - Re-printed PDF (different bytes) → hash misses, business key catches
 * - UBL duplicate (exact key) → caught
 */

import { describe, expect, it } from "bun:test";
import { duplicatePeer, resolveVendorIdentity } from "./duplicate-detection";
import type { Invoice, VendorProfile } from "./types";

function stubInvoice(
  id: string,
  vendor: string,
  invoiceNumber: string,
  total: number,
  issueDate: string,
  currency = "EUR",
): Invoice {
  return {
    id,
    vendor,
    invoiceNumber,
    issueDate,
    dueDate: "",
    currency,
    subtotal: total * 0.79,
    tax: total * 0.21,
    total,
    status: "draft",
    lineItems: [],
    glAccount: "",
    department: "",
    memo: "",
    tags: [],
    confidence: {},
    audit: [],
    source: "upload",
  };
}

const profiles: Record<string, VendorProfile> = {
  "kpn": {
    vendor_key: "kpn",
    aliases: ["KPN", "KPN B.V.", "KPN Telecom"],
    fields: {},
    version: 1,
    origin: "auto",
    updatedAt: "2026-01-01T00:00:00.000Z",
    history: [],
  },
};

describe("resolveVendorIdentity", () => {
  it("resolves aliases to the canonical vendor key", () => {
    const invoice = stubInvoice("inv-1", "KPN B.V.", "2026-001", 100, "2026-04-01");
    expect(resolveVendorIdentity(invoice, profiles)).toBe("kpn");
  });

  it("falls back to the invoice vendor name when no profile matches", () => {
    const invoice = stubInvoice("inv-1", "Unknown Vendor", "2026-001", 100, "2026-04-01");
    expect(resolveVendorIdentity(invoice, profiles)).toBe("unknown vendor");
  });

  it("matches the canonical key directly", () => {
    const invoice = stubInvoice("inv-1", "KPN", "2026-001", 100, "2026-04-01");
    expect(resolveVendorIdentity(invoice, profiles)).toBe("kpn");
  });
});

describe("duplicatePeer — hard key", () => {
  it("catches same vendor + same invoiceNumber regardless of time window", () => {
    // Quarter-end archival upload: issued months later.
    const original = stubInvoice("inv-1", "KPN B.V.", "2026-001", 100, "2026-01-15");
    const duplicate = stubInvoice("inv-2", "KPN", "2026-001", 100, "2026-04-20");
    expect(duplicatePeer(duplicate, [original], profiles)).toBe(original);
  });

  it("does not flag when invoiceNumber differs", () => {
    const original = stubInvoice("inv-1", "KPN", "2026-001", 100, "2026-04-01");
    const different = stubInvoice("inv-2", "KPN", "2026-002", 100, "2026-04-01");
    expect(duplicatePeer(different, [original], profiles)).toBeUndefined();
  });

  it("does not flag when vendor differs", () => {
    const original = stubInvoice("inv-1", "KPN", "2026-001", 100, "2026-04-01");
    const differentVendor = stubInvoice("inv-2", "Acme Corp", "2026-001", 100, "2026-04-01");
    expect(duplicatePeer(differentVendor, [original], profiles)).toBeUndefined();
  });

  it("does not flag when the candidate has no invoiceNumber", () => {
    const original = stubInvoice("inv-1", "KPN", "", 100, "2026-04-01");
    const duplicate = stubInvoice("inv-2", "KPN", "2026-001", 100, "2026-04-01");
    // Hard key requires both to have invoiceNumber.
    expect(duplicatePeer(duplicate, [original], profiles)).toBeUndefined();
  });
});

describe("duplicatePeer — soft key (number-less)", () => {
  it("catches same vendor + same total within 7 days when no invoiceNumber", () => {
    const original = stubInvoice("inv-1", "KPN", "", 100, "2026-04-01");
    const duplicate = stubInvoice("inv-2", "KPN B.V.", "", 100, "2026-04-05");
    expect(duplicatePeer(duplicate, [original], profiles)).toBe(original);
  });

  it("does not flag when total differs significantly", () => {
    const original = stubInvoice("inv-1", "KPN", "", 100, "2026-04-01");
    const different = stubInvoice("inv-2", "KPN", "", 5000, "2026-04-05");
    expect(duplicatePeer(different, [original], profiles)).toBeUndefined();
  });

  it("does not flag when issue dates are more than 7 days apart", () => {
    const original = stubInvoice("inv-1", "KPN", "", 100, "2026-04-01");
    const farAway = stubInvoice("inv-2", "KPN", "", 100, "2026-04-20");
    expect(duplicatePeer(farAway, [original], profiles)).toBeUndefined();
  });

  it("does not flag when currency differs", () => {
    const original = stubInvoice("inv-1", "KPN", "", 100, "2026-04-01", "EUR");
    const usd = stubInvoice("inv-2", "KPN", "", 100, "2026-04-01", "USD");
    expect(duplicatePeer(usd, [original], profiles)).toBeUndefined();
  });
});

describe("duplicatePeer — UBL exact key", () => {
  it("catches UBL duplicate with exact same vendor + invoiceNumber", () => {
    // UBL supplies exact identity (BT-1/BT-2) — the key is exact.
    const original = stubInvoice("inv-1", "Acme Corp", "INV-2026-042", 1210, "2026-04-01");
    const ublDuplicate = stubInvoice("inv-2", "Acme Corp", "INV-2026-042", 1210, "2026-04-01");
    expect(duplicatePeer(ublDuplicate, [original], {})).toBe(original);
  });
});

describe("duplicatePeer — re-printed PDF", () => {
  it("catches re-printed PDF via business key when hash misses", () => {
    // Same logical content, different bytes (print-to-PDF).
    // Hash gate misses (different bytes), but business key catches.
    const original = stubInvoice("inv-1", "KPN", "2026-001", 100, "2026-04-01");
    const reprint = stubInvoice("inv-2", "KPN B.V.", "2026-001", 100, "2026-04-01");
    expect(duplicatePeer(reprint, [original], profiles)).toBe(original);
  });
});
