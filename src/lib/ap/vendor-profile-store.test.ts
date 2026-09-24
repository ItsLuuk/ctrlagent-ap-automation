/**
 * Unit tests for the vendor profile store.
 *
 * Deterministic: the corpus keeps compounding. Tests cover:
 * - autoLearnProfile: provisional cache from an unreviewed invoice
 * - confirmProfile: corrections → refine (origin "reviewed"), no corrections → promote
 * - confirmProfile: vendor-name corrections update aliases, not zone specs
 * - confirmProfile: not anchorable → keep old spec (zone miss, not OCR misread)
 * - revertProfile: one revert away from a poisoning correction
 * - resolveVendorKey: canonical key derivation
 * - history retention: previous version retained, capped at 20
 */

import { describe, expect, it } from "bun:test";
import {
  autoLearnProfile,
  confirmProfile,
  resolveVendorKey,
  revertProfile,
} from "./vendor-profile-store";
import type { Invoice, VendorProfile, ZoneField } from "./types";

/**
 * Builds a properly-formed invoice that autoLearnProfile can learn from.
 * Must include: learnPayload with vendor block, provenance marked "read",
 * and fields with values.
 */
function stubInvoice(
  vendor: string,
  invoiceNumber: string,
  total: number,
  issueDate = "2026-04-01",
  opts: { withLearnPayload?: boolean; withProvenance?: boolean; corrections?: Partial<Record<ZoneField, string | number>> } = {},
): Invoice {
  const { withLearnPayload = true, withProvenance = true, corrections } = opts;
  const invoice: Invoice = {
    id: "inv-1",
    vendor,
    invoiceNumber,
    issueDate,
    dueDate: "",
    currency: "EUR",
    subtotal: total * 0.79,
    tax: total * 0.21,
    total,
    status: "review",
    lineItems: [],
    glAccount: "",
    department: "",
    memo: "",
    tags: [],
    provenance: {},
    audit: [],
    source: "upload",
    fileHash: "abc123",
    originalExtraction:
      corrections || withProvenance
        ? {
            vendor,
            invoiceNumber,
            total,
            subtotal: total * 0.79,
            tax: total * 0.21,
          }
        : undefined,
  };

  // Provenance: marks which fields came from exact/read sources so the
  // auto-learn hook knows what to teach the template.
  if (withProvenance) {
    (invoice as any).provenance = {
      vendor: "read",
      invoiceNumber: "read",
      total: "read",
      subtotal: "read",
      tax: "read",
    };
  }

  if (withLearnPayload) {
    (invoice as any).learnPayload = {
      pages: [
        {
          pageNumber: 1,
          words: [
            // Anchor labels for vendor, invoiceNumber, total
            { text: "Leverancier", x: 0.05, y: 0.05, w: 0.1, h: 0.02, confidence: 0.95 },
            { text: vendor, x: 0.2, y: 0.05, w: 0.15, h: 0.02, confidence: 0.95 },
            { text: "Factuurnummer", x: 0.05, y: 0.15, w: 0.12, h: 0.02, confidence: 0.95 },
            { text: invoiceNumber, x: 0.25, y: 0.15, w: 0.1, h: 0.02, confidence: 0.95 },
            { text: "Totaal", x: 0.05, y: 0.85, w: 0.08, h: 0.02, confidence: 0.95 },
            { text: String(total).replace(".", ","), x: 0.2, y: 0.85, w: 0.12, h: 0.02, confidence: 0.95 },
            // Extra words to make it look like a real invoice
            { text: "Factuurdatum", x: 0.05, y: 0.1, w: 0.1, h: 0.02, confidence: 0.9 },
            { text: issueDate, x: 0.2, y: 0.1, w: 0.08, h: 0.02, confidence: 0.9 },
            { text: "BTW", x: 0.05, y: 0.75, w: 0.05, h: 0.02, confidence: 0.9 },
            { text: String(total * 0.21).replace(".", ","), x: 0.2, y: 0.75, w: 0.1, h: 0.02, confidence: 0.9 },
          ],
        },
      ],
    };
  }
  return invoice;
}

describe("resolveVendorKey", () => {
  it("derives a canonical key from the vendor name", () => {
    expect(resolveVendorKey(stubInvoice("KPN B.V.", "1", 100))).toBe("kpn b.v.");
    expect(resolveVendorKey(stubInvoice("  KPN  ", "1", 100))).toBe("kpn");
  });
});

describe("autoLearnProfile", () => {
  it("creates a provisional profile with origin \"auto\"", () => {
    const invoice = stubInvoice("Test Vendor", "2026-001", 1210);
    const profile = autoLearnProfile(invoice);
    expect(profile).toBeDefined();
    expect(profile?.origin).toBe("auto");
    expect(profile?.vendor_key).toBe("test vendor");
    expect(profile?.aliases).toContain("Test Vendor");
  });

  it("bumps version on subsequent learns", () => {
    const invoice = stubInvoice("Version Test", "2026-001", 500);
    autoLearnProfile(invoice);
    const profile = autoLearnProfile(invoice);
    expect(profile?.version).toBeGreaterThanOrEqual(2);
  });

  it("retains history (capped at 20)", () => {
    const invoice = stubInvoice("History Test", "2026-001", 300);
    for (let i = 0; i < 25; i++) {
      autoLearnProfile(
        stubInvoice("History Test", `2026-${String(i).padStart(3, "0")}`, 300 + i),
      );
    }
    const profile = autoLearnProfile(
      stubInvoice("History Test", "2026-025", 525),
    );
    expect(profile?.history.length).toBeLessThanOrEqual(20);
    expect(profile?.version).toBeGreaterThanOrEqual(26);
  });
});

describe("confirmProfile", () => {
  it("refines profile from corrections (origin reviewed)", () => {
    const invoice = stubInvoice("Correction Vendor", "2026-001", 1210);
    const autoProfile = autoLearnProfile(invoice);
    expect(autoProfile?.origin).toBe("auto");

    const corrections: Partial<Record<ZoneField, string | number>> = {
      total: 1350,
    };
    const confirmed = confirmProfile(invoice, corrections);
    expect(confirmed?.origin).toBe("reviewed");
    expect(confirmed?.version).toBeGreaterThan(autoProfile!.version);
  });

  it("promotes auto → reviewed when no corrections", () => {
    const invoice = stubInvoice("Promote Vendor", "2026-001", 800);
    const autoProfile = autoLearnProfile(invoice);
    const corrections: Partial<Record<ZoneField, string | number>> = {};
    const confirmed = confirmProfile(invoice, corrections);
    expect(confirmed?.origin).toBe("reviewed");
    expect(confirmed?.version).toBe(autoProfile!.version + 1);
  });

  it("updates identity aliases for vendor-name corrections", () => {
    const invoice = stubInvoice("Old Name", "2026-001", 500);
    const autoProfile = autoLearnProfile(invoice);
    expect(autoProfile?.aliases).toContain("Old Name");

    const corrections: Partial<Record<ZoneField, string | number>> = {
      vendor: "New Name B.V.",
    };
    const confirmed = confirmProfile(invoice, corrections);
    expect(confirmed?.aliases).toContain("New Name B.V.");
    expect(confirmed?.aliases).toContain("Old Name");
  });

  it("retains existing spec when corrected value is not anchorable", () => {
    // A correction to a value that doesn't appear in learnPayload words
    // is an OCR misread — no anchor update helps. The existing spec is kept.
    const invoice = stubInvoice(
      "Unanchorable Vendor",
      "2026-001",
      100,
    );
    const autoProfile = autoLearnProfile(invoice);
    const specBefore = autoProfile?.fields.total;

    const corrections: Partial<Record<ZoneField, string | number>> = {
      total: 99999, // value not in words
    };
    const confirmed = confirmProfile(invoice, corrections);
    // The spec should be retained (not replaced with undefined)
    expect(confirmed?.fields.total)?.toEqual(specBefore ?? {});
  });
});

describe("revertProfile", () => {
  it("reverts to a previous version", () => {
    const invoice = stubInvoice("Revert Vendor", "2026-001", 600);
    autoLearnProfile(invoice);
    const profile = autoLearnProfile(invoice);
    const previousVersion = profile!.version - 1;

    const reverted = revertProfile("revert vendor", previousVersion);
    expect(reverted).toBeDefined();
    expect(reverted?.version).toBe(previousVersion);
  });

  it("returns undefined for a non-existent version", () => {
    const revert = revertProfile("nonexistent vendor", 999);
    expect(revert).toBeUndefined();
  });
});
