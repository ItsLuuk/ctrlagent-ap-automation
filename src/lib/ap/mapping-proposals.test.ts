import { describe, expect, it } from "bun:test";
import { proposeFieldMappings } from "./mapping-proposals";
import type { Invoice, OcrWord } from "./types";

function word(text: string, x: number, y: number, w = 0.08, h = 0.02): OcrWord {
  return { text, x, y, w, h, confidence: 0.98 };
}

const invoice: Invoice = {
  id: "invoice-1",
  vendor: "Acme B.V.",
  invoiceNumber: "INV-042",
  issueDate: "2026-04-12",
  dueDate: "2026-05-12",
  currency: "EUR",
  subtotal: 100,
  tax: 21,
  total: 121,
  address: "Demo straat 1, Amsterdam",
  vendorEmail: "billing@acme.test",
  iban: "NL12TEST0123456789",
  vatNumber: "NL123456789B01",
  businessRegistrationNumber: "12345678",
  status: "draft",
  lineItems: [],
  glAccount: "",
  department: "",
  memo: "",
  tags: [],
  audit: [],
  source: "upload",
  createdAt: "2026-04-12T00:00:00.000Z",
};

describe("proposeFieldMappings", () => {
  it("preselects labelled values that agree with the extraction", () => {
    const proposals = proposeFieldMappings(invoice, [
      word("Factuurnummer", 0.08, 0.1, 0.14),
      word("INV-042", 0.25, 0.1, 0.08),
      word("Factuurdatum", 0.08, 0.16, 0.12),
      word("12-04-2026", 0.24, 0.16, 0.1),
      word("Totaal", 0.65, 0.82, 0.08),
      word("€ 121,00", 0.76, 0.82, 0.1),
    ]);

    expect(proposals.invoiceNumber?.source).toBe("label");
    expect(proposals.invoiceNumber?.zone.x).toBeCloseTo(0.25);
    expect(proposals.issueDate?.confidence).toBeGreaterThanOrEqual(0.8);
    expect(proposals.total?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("preselects unique identity values even without a label", () => {
    const proposals = proposeFieldMappings(invoice, [
      word("billing@acme.test", 0.1, 0.3, 0.15),
      word("NL123456789B01", 0.1, 0.4, 0.15),
      word("12345678", 0.1, 0.45, 0.1),
    ]);

    expect(proposals.vendorEmail?.source).toBe("identity");
    expect(proposals.vatNumber?.source).toBe("identity");
    expect(proposals.businessRegistrationNumber?.source).toBe("identity");
  });

  it("leaves an ambiguous value unmapped", () => {
    const proposals = proposeFieldMappings(invoice, [
      word("Acme B.V.", 0.1, 0.1),
      word("Acme B.V.", 0.1, 0.8),
    ]);
    expect(proposals.vendor).toBeUndefined();
  });

  it("stops a total at its own width instead of the rest of the line", () => {
    // The line as a printer lays it out: the value, then the payment terms.
    const proposals = proposeFieldMappings(invoice, [
      word("Totaal", 0.6, 0.82, 0.08),
      word("€", 0.7, 0.82, 0.03),
      word("121,00", 0.74, 0.82, 0.08),
      word("Betalingscondities", 0.1, 0.86, 0.16),
      word("30", 0.28, 0.86, 0.04),
      word("dagen", 0.33, 0.86, 0.06),
    ]);

    const total = proposals.total;
    expect(total?.source).toBe("label");
    // The box ends at the value, not at the far edge of the line, and the
    // trimmed run is exactly the size a total should be — so there is nothing
    // for the reviewer to be warned about on this one.
    expect(total?.zone.x + total!.zone.w).toBeLessThanOrEqual(0.83);
    expect(total?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("anchors on the label word, not on a symbol printed after it", () => {
    const proposals = proposeFieldMappings(invoice, [
      word("Totaal", 0.6, 0.82, 0.08),
      word("€", 0.7, 0.82, 0.03),
      word("121,00", 0.74, 0.82, 0.08),
    ]);
    // "€" occurs on every money line, so anchoring on it names nothing.
    expect(proposals.total?.anchor).toBe("Totaal");
  });

  it("keeps a wide field wide when the same line holds its neighbours", () => {
    const proposals = proposeFieldMappings(invoice, [
      word("IBAN", 0.6, 0.5, 0.05),
      word("NL12TEST0123456789", 0.66, 0.5, 0.18),
      word("KVK", 0.6, 0.55, 0.04),
      word("12345678", 0.66, 0.55, 0.08),
    ]);
    // Both are found by their exact value, which outranks the label path.
    expect(proposals.iban?.source).toBe("identity");
    expect(proposals.businessRegistrationNumber?.source).toBe("identity");
    expect(proposals.iban!.zone.w).toBeLessThan(0.2);
  });

  it("always preserves an existing confirmed zone", () => {
    const zone = { x: 0.11, y: 0.22, w: 0.2, h: 0.03 };
    const proposals = proposeFieldMappings(
      { ...invoice, zones: { invoiceNumber: zone } },
      [word("Factuurnummer", 0.1, 0.1), word("DIFFERENT", 0.3, 0.1)],
    );
    expect(proposals.invoiceNumber).toMatchObject({ zone, source: "saved", confidence: 1 });
  });
});
