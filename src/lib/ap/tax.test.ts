import { describe, expect, it } from "bun:test";
import { taxFindings, validateVatNumber } from "./tax";
import { EMPTY_BUSINESS_PROFILE, type BusinessProfile, type Invoice } from "./types";

const baseInvoice: Invoice = {
  id: "inv-tax",
  vendor: "Superdoos BV",
  invoiceNumber: "2026-0231",
  issueDate: "2026-04-12",
  dueDate: "2026-05-12",
  currency: "EUR",
  subtotal: 2000,
  tax: 420,
  total: 2420,
  address: "De Slof 10G, Amsterdam",
  vendorEmail: "billing@superdoos.com",
  iban: "NL95RABO0336381832",
  vatNumber: "NL005169491B25",
  businessRegistrationNumber: "73408441",
  status: "review",
  lineItems: [],
  glAccount: "6010",
  department: "Engineering",
  memo: "",
  tags: [],
  audit: [],
  source: "sample",
  createdAt: "2026-09-19T00:00:00Z",
};

const inv = (over: Partial<Invoice> = {}): Invoice => ({ ...baseInvoice, ...over });
const prof = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  ...EMPTY_BUSINESS_PROFILE,
  ...over,
});
const codes = (invoice: Invoice, profile?: BusinessProfile, jurisdiction?: string) =>
  taxFindings(invoice, profile, jurisdiction).map(
    (finding) => `${finding.id}:${finding.severity}`,
  );

describe("validateVatNumber", () => {
  it("accepts structurally valid EU numbers in compact and spaced form", () => {
    expect(validateVatNumber("NL005169491B25")).toEqual({ ok: true, country: "NL" });
    expect(validateVatNumber("NL 0051.6949.1B25")).toEqual({ ok: true, country: "NL" });
    expect(validateVatNumber("nl005169491b25")).toEqual({ ok: true, country: "NL" });
    expect(validateVatNumber("BE0123456789")).toEqual({ ok: true, country: "BE" });
    expect(validateVatNumber("DE123456789")).toEqual({ ok: true, country: "DE" });
    expect(validateVatNumber("GB123456789")).toEqual({ ok: true, country: "GB" });
    expect(validateVatNumber("EL123456789")).toEqual({ ok: true, country: "EL" });
  });

  it("rejects EU numbers whose shape is wrong for their country", () => {
    expect(validateVatNumber("NL123")).toEqual({
      ok: false,
      country: "NL",
      reason: "format",
    });
    expect(validateVatNumber("BE1234567890")).toEqual({
      ok: false,
      country: "BE",
      reason: "format",
    });
  });

  it("flags unknown prefixes and missing country codes", () => {
    expect(validateVatNumber("ZZ123456789")).toEqual({
      ok: false,
      country: "ZZ",
      reason: "unknown_country",
    });
    expect(validateVatNumber("123456789")).toEqual({ ok: false, reason: "no_country_prefix" });
    expect(validateVatNumber("")).toEqual({ ok: false, reason: "no_country_prefix" });
  });

  it("checks the non-EU GST formats", () => {
    expect(validateVatNumber("CHE119457271")).toEqual({ ok: true, country: "CH" });
    expect(validateVatNumber("CHE-119.457.271 MWST")).toEqual({ ok: true, country: "CH" });
    expect(validateVatNumber("NO999999999MVA")).toEqual({ ok: true, country: "NO" });
    expect(validateVatNumber("AU12345678901")).toEqual({ ok: true, country: "AU" });
    expect(validateVatNumber("NZ123456789")).toEqual({ ok: true, country: "NZ" });
    expect(validateVatNumber("CHE123")).toEqual({ ok: false, country: "CH", reason: "format" });
    expect(validateVatNumber("AU123")).toEqual({ ok: false, country: "AU", reason: "format" });
  });
});

describe("taxFindings", () => {
  it("stays silent on a well-formed invoice", () => {
    expect(codes(inv())).toEqual([]);
  });

  it("flags a supplier VAT number that doesn't match its country's format", () => {
    const findings = taxFindings(inv({ vatNumber: "NL123" }));
    expect(findings.map((f) => f.id)).toEqual(["tax:supplier-vat"]);
    expect(findings[0]!.severity).toBe("attention");
    expect(findings[0]!.field).toBe("vatNumber");
    expect(findings[0]!.detail).toContain("NL VAT structure");
  });

  it("flags our own profile's VAT number without blaming the document", () => {
    const findings = taxFindings(inv(), prof({ vatNumber: "NL123" }));
    const own = findings.find((f) => f.id === "tax:our-vat");
    expect(own?.severity).toBe("attention");
    expect(own?.documentValue).toBe("—");
    expect(own?.heldValue).toBe("NL123");
  });

  it("catches subtotal + tax that doesn't reach the total", () => {
    const findings = taxFindings(inv({ total: 2500 }));
    const math = findings.find((f) => f.id === "tax:math");
    expect(math?.severity).toBe("attention");
    expect(math?.field).toBe("tax");
    expect(math?.detail).toContain("outside the subtotal");
  });

  it("catches negative tax and tax larger than the total", () => {
    expect(codes(inv({ tax: -100, total: 1900 }))).toContain("tax:math:attention");
    const findings = taxFindings(inv({ tax: -100, total: 1900 }));
    expect(findings.find((f) => f.id === "tax:math")?.detail).toContain("negative");

    const exceeds = taxFindings(inv({ subtotal: -500, tax: 3000, total: 2420 }));
    expect(exceeds.find((f) => f.id === "tax:math")?.detail).toContain("larger than the total");
  });

  it("flags an implied rate above any standard VAT rate", () => {
    const findings = taxFindings(inv({ tax: 700, total: 2700 }));
    const rate = findings.find((f) => f.id === "tax:rate");
    expect(rate?.severity).toBe("attention");
    expect(rate?.documentValue).toBe("35.0%");
    // The ordinary 21% Dutch rate raises nothing.
    expect(codes(inv())).not.toContain("tax:rate:attention");
  });

  it("flags tax charged on an intra-EU B2B invoice", () => {
    const findings = taxFindings(inv(), prof({ vatNumber: "DE123456789" }));
    const reverse = findings.find((f) => f.id === "tax:reverse-charge");
    expect(reverse?.severity).toBe("attention");
    expect(reverse?.detail).toContain("reverse-charged");
    expect(reverse?.detail).toContain("NL supplier, DE buyer");
  });

  it("confirms reverse charge when the intra-EU invoice carries no tax", () => {
    const findings = taxFindings(inv({ tax: 0, total: 2000 }), prof({ vatNumber: "DE123456789" }));
    const reverse = findings.find((f) => f.id === "tax:reverse-charge");
    expect(reverse?.severity).toBe("ok");
  });

  it("asks for missing VAT IDs when the invoice is cross-border anyway", () => {
    const findings = taxFindings(
      inv({ vatNumber: "", tax: 0, total: 2000 }),
      prof({ iban: "DE89370400440532013000" }),
    );
    const ids = findings.find((f) => f.id === "tax:reverse-charge-ids");
    expect(ids?.severity).toBe("attention");
    expect(ids?.detail).toContain("missing");
    // Tax stays 0 here, so the charge is never flagged — only the IDs row
    // (attention) plus the ok confirmation of the zero-rated supply.
    expect(codes(inv({ vatNumber: "", tax: 0, total: 2000 }), prof({ iban: "DE89370400440532013000" }))).not.toContain(
      "tax:reverse-charge:attention",
    );
  });

  it("judges the rate against the buying entity's jurisdiction", () => {
    // 23% exceeds the NL standard rate of 21%.
    const findings = taxFindings(inv({ tax: 460, total: 2460 }), undefined, "NL");
    const rate = findings.find((f) => f.id === "tax:rate");
    expect(rate?.severity).toBe("attention");
    expect(rate?.detail).toContain("NL standard rate of 21.0%");

    // A mixed basket implying 19.4% sits below the ceiling: no finding.
    expect(codes(inv({ tax: 388, total: 2388 }), undefined, "NL")).not.toContain(
      "tax:rate:attention",
    );

    // A VAT-less jurisdiction falls back to the generic plausibility cap:
    // 35% clears it, 23% does not.
    expect(codes(inv({ tax: 700, total: 2700 }), undefined, "US")).toContain(
      "tax:rate:attention",
    );
    expect(codes(inv({ tax: 700, total: 2700 }), undefined, undefined)).toContain(
      "tax:rate:attention",
    );
    expect(codes(inv({ tax: 460, total: 2460 }), undefined, "US")).not.toContain(
      "tax:rate:attention",
    );
    // Known jurisdiction under its ceiling: silent.
    expect(codes(inv({ tax: 420, total: 2420 }), undefined, "NL")).toEqual([]);
  });

  it("keeps the flag unambiguous: same-country and UK trade are not intra-EU", () => {
    expect(codes(inv(), prof({ vatNumber: "NL005169491B25" }))).not.toContain(
      "tax:reverse-charge:attention",
    );
    expect(codes(inv({ vatNumber: "GB123456789" }), prof({ vatNumber: "NL005169491B25" }))).toEqual(
      [],
    );
    // No profile at all: no buyer side, no cross-border claim.
    expect(codes(inv())).not.toContain("tax:reverse-charge:attention");
  });
});
