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
  learnFieldFromValue,
  readAllProfiles,
  resolveVendorKey,
  revertProfile,
} from "./vendor-profile-store";
import { validateInvoiceForConfirmation } from "./mapping";
import type { Invoice, OcrWord, VendorProfile, ZoneField } from "./types";

function stubInvoice(
  vendor: string,
  invoiceNumber: string,
  total: number,
  issueDate = "2026-04-01",
  withLearnPayload = false,
): Invoice {
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
    confidence: {},
    provenance: {
      vendor: "read",
      invoiceNumber: "read",
      issueDate: "read",
      dueDate: "read",
      subtotal: "read",
      tax: "read",
      total: "read",
    },
    audit: [],
    source: "upload",
    fileHash: "abc123",
    originalExtraction: {
      vendor,
      invoiceNumber,
      total,
      subtotal: total * 0.79,
      tax: total * 0.21,
    },
  };
  if (withLearnPayload) {
    (invoice as any).learnPayload = {
      pages: [
        {
          pageNumber: 1,
          words: [
            { text: vendor, x: 0.05, y: 0.05, w: 0.2, h: 0.02, confidence: 0.95 },
            { text: "Factuur", x: 0.1, y: 0.1, w: 0.1, h: 0.02, confidence: 0.95 },
            { text: "2026-001", x: 0.6, y: 0.1, w: 0.15, h: 0.02, confidence: 0.95 },
            {
              text: "Totaal",
              x: 0.1,
              y: 0.8,
              w: 0.08,
              h: 0.02,
              confidence: 0.95,
            },
            {
              text: String(total).replace(".", ","),
              x: 0.3,
              y: 0.8,
              w: 0.1,
              h: 0.02,
              confidence: 0.95,
            },
          ],
        },
      ],
    };
  }
  return invoice;
}

function readProfile(vendorKey: string): VendorProfile | undefined {
  // The store uses localStorage — we can't read it directly in tests.
  // Instead, autoLearnProfile writes to it; we re-read by triggering
  // another autoLearnProfile on the same key and inspecting the result.
  // This is a property of the module, not ideal, but it works for unit tests.
  return undefined; // Placeholder — tests use the returned profile
}

describe("resolveVendorKey", () => {
  it("derives a canonical key from the vendor name", () => {
    expect(resolveVendorKey(stubInvoice("KPN B.V.", "1", 100))).toBe("kpn b.v.");
    expect(resolveVendorKey(stubInvoice("  KPN  ", "1", 100))).toBe("kpn");
  });
});

describe("autoLearnProfile", () => {
  it("creates a provisional profile with origin \"auto\"", () => {
    const invoice = stubInvoice("Test Vendor", "2026-001", 1210, "2026-04-01", true);
    const profile = autoLearnProfile(invoice);
    expect(profile).toBeDefined();
    expect(profile?.origin).toBe("auto");
    expect(profile?.vendor_key).toBe("test vendor");
    expect(profile?.aliases).toContain("Test Vendor");
  });

  it("bumps version on subsequent learns", () => {
    const invoice = stubInvoice("Version Test", "2026-001", 500, "2026-04-01", true);
    autoLearnProfile(invoice);
    const profile = autoLearnProfile(invoice);
    expect(profile?.version).toBeGreaterThanOrEqual(2);
  });

  it("retains history (capped at 20)", () => {
    const invoice = stubInvoice("History Test", "2026-001", 300, "2026-04-01");
    for (let i = 0; i < 25; i++) {
      autoLearnProfile(
        stubInvoice("History Test", `2026-${String(i).padStart(3, "0")}`, 300 + i, "2026-04-01", true),
      );
    }
    const profile = autoLearnProfile(
      stubInvoice("History Test", "2026-025", 525, "2026-04-01", true),
    );
    expect(profile?.history.length).toBeLessThanOrEqual(20);
    expect(profile?.version).toBeGreaterThanOrEqual(26);
  });
});

describe("confirmProfile", () => {
  it("refines profile from corrections (origin reviewed)", () => {
    const invoice = stubInvoice("Correction Vendor", "2026-001", 1210, "2026-04-01", true);
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
    const invoice = stubInvoice("Promote Vendor", "2026-001", 800, "2026-04-01", true);
    const autoProfile = autoLearnProfile(invoice);
    const corrections: Partial<Record<ZoneField, string | number>> = {};
    const confirmed = confirmProfile(invoice, corrections);
    expect(confirmed?.origin).toBe("reviewed");
    expect(confirmed?.version).toBe(autoProfile!.version + 1);
  });

  it("updates identity aliases for vendor-name corrections", () => {
    const invoice = stubInvoice("Old Name", "2026-001", 500, "2026-04-01");
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
      "2026-04-01",
      true,
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
    const invoice = stubInvoice("Revert Vendor", "2026-001", 600, "2026-04-01", true);
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

describe("learnFieldFromValue", () => {
  const word = (text: string, x: number, y: number, w = 0.1, h = 0.02): OcrWord => ({
    text,
    x,
    y,
    w,
    h,
    confidence: 0.95,
  });

  const invoiceWith = (words: OcrWord[]): Invoice => {
    const invoice = stubInvoice("Typed Vendor", "2026-0142", 1210, "2026-04-01");
    (invoice as Invoice & { learnPayload: unknown }).learnPayload = {
      pages: [{ pageNumber: 1, words }],
    };
    return invoice;
  };

  const headerPage = (): OcrWord[] => [
    word("Factuurnummer:", 0.1, 0.1, 0.14),
    word("2026-0142", 0.28, 0.1, 0.1),
    word("Totaal", 0.1, 0.8, 0.07),
    word("1.210,00", 0.28, 0.8, 0.1),
  ];

  it("remembers the place of a value it found once", () => {
    const invoice = invoiceWith(headerPage());
    const outcome = learnFieldFromValue(invoice, "invoiceNumber", "2026-0142");
    expect(outcome.status).toBe("learned");
    const profile = readAllProfiles()[resolveVendorKey(invoice)];
    expect(profile?.fields.invoiceNumber?.anchor).toBe("Factuurnummer:");
    expect(profile?.fields.invoiceNumber?.learnedBy).toBe("typed");
  });

  it("finds an amount printed in Dutch format from the stored number", () => {
    const invoice = invoiceWith(headerPage());
    expect(learnFieldFromValue(invoice, "total", 1210).status).toBe("learned");
    const profile = readAllProfiles()[resolveVendorKey(invoice)];
    expect(profile?.fields.total?.type).toBe("decimal");
  });

  it("asks which place when the value is printed twice", () => {
    const invoice = invoiceWith([
      ...headerPage(),
      word("Referentie", 0.1, 0.3, 0.09),
      word("2026-0142", 0.28, 0.3, 0.1),
    ]);
    const outcome = learnFieldFromValue(invoice, "invoiceNumber", "2026-0142");
    expect(outcome.status).toBe("ambiguous");
    if (outcome.status !== "ambiguous") throw new Error("expected candidates");
    expect(outcome.options).toHaveLength(2);
  });

  it("learns the place the person picked", () => {
    const invoice = invoiceWith([
      ...headerPage(),
      word("Referentie", 0.1, 0.3, 0.09),
      word("2026-0142", 0.28, 0.3, 0.1),
    ]);
    const outcome = learnFieldFromValue(invoice, "invoiceNumber", "2026-0142");
    if (outcome.status !== "ambiguous") throw new Error("expected candidates");
    const picked = outcome.options[1]!;
    expect(learnFieldFromValue(invoice, "invoiceNumber", "2026-0142", picked).status).toBe("learned");
  });

  it("remembers a field the page does not print, and stops asking for it", () => {
    const invoice = invoiceWith(headerPage());
    const outcome = learnFieldFromValue(invoice, "dueDate", "2026-05-01");
    expect(outcome.status).toBe("absent");
    const profile = readAllProfiles()[resolveVendorKey(invoice)];
    expect(profile?.absentFields).toEqual(["dueDate"]);
    // And the absence is what stops the blocking question on the next invoice.
    const codes = validateInvoiceForConfirmation(invoice, "confirm", ["dueDate"]).map((i) => i.code);
    expect(codes).not.toContain("missing_due_date");
    expect(validateInvoiceForConfirmation(invoice).map((i) => i.code)).toContain("missing_due_date");
  });

  it("forgets the absence when the field is found later", () => {
    const invoice = invoiceWith(headerPage());
    learnFieldFromValue(invoice, "dueDate", "2026-05-01");
    const withDueDate = invoiceWith([
      ...headerPage(),
      word("Vervaldatum:", 0.1, 0.2, 0.11),
      word("01-05-2026", 0.28, 0.2, 0.1),
    ]);
    learnFieldFromValue(withDueDate, "dueDate", "2026-05-01");
    const profile = readAllProfiles()[resolveVendorKey(withDueDate)];
    expect(profile?.absentFields ?? []).not.toContain("dueDate");
    expect(profile?.fields.dueDate?.anchor).toBe("Vervaldatum:");
  });

  it("learns nothing when the page has no text to search", () => {
    const invoice = stubInvoice("Typed Vendor", "2026-0142", 1210);
    expect(learnFieldFromValue(invoice, "invoiceNumber", "2026-0142").status).toBe("no-words");
  });
});
