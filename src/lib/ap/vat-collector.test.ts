import { describe, expect, it } from "bun:test";
import {
  collectVatCandidates,
  findVatNumberIn,
  resolveSupplierVatNumber,
} from "./ocr";
import type { BusinessProfile } from "./types";

const ownProfile: BusinessProfile = {
  name: "Mijn Bedrijf B.V.",
  address: "",
  email: "info@mijnbedrijf.nl",
  iban: "",
  vatNumber: "NL123456789B01",
  businessRegistrationNumber: "",
};

describe("VAT candidate collector", () => {
  it("collects every valid EU candidate with its original position", () => {
    const text = [
      "BTW: NL 123 456 789 B 01",
      "VAT ID: DE 123456789",
      "Invalid phone: 123456789",
    ].join("\n");
    const candidates = collectVatCandidates(text);

    expect(candidates.map((candidate) => candidate.value)).toEqual([
      "NL123456789B01",
      "DE123456789",
    ]);
    expect(candidates[0]!.index).toBeLessThan(candidates[1]!.index);
    expect(candidates.every((candidate) => candidate.labelled)).toBe(true);
  });

  it("rejects a customer-only candidate when no supplier anchor exists", () => {
    const text = ["Bill to: Customer Ltd", "VAT: NL987654321B01"].join("\n");

    expect(collectVatCandidates(text)).toHaveLength(1);
    expect(resolveSupplierVatNumber(collectVatCandidates(text), { text })).toBeUndefined();
    expect(findVatNumberIn(text)).toBeUndefined();
  });

  it("prefers the supplier candidate when the customer VAT appears first", () => {
    const text = [
      "Bill to: Customer Ltd",
      "VAT: NL987654321B01",
      "Supplier: Acme BV",
      "VAT: NL123456789B01",
      "Email: billing@acme.example",
    ].join("\n");
    const candidates = collectVatCandidates(text, {
      vendorEmail: "billing@acme.example",
    });
    const selected = resolveSupplierVatNumber(candidates, {
      text,
      vendorEmail: "billing@acme.example",
    });

    expect(selected?.value).toBe("NL123456789B01");
    expect(selected?.nearVendorEmail).toBe(true);
  });

  it("uses supplier IBAN and registration anchors when email is absent", () => {
    const text = [
      "Factuuradres: Customer Ltd",
      "BTW: NL987654321B01",
      "Leverancier: Acme BV",
      "BTW: NL123456789B01",
      "IBAN: NL91ABNA0417164300",
      "KvK: 12345678",
    ].join("\n");
    const candidates = collectVatCandidates(text, {
      vendorIban: "NL91ABNA0417164300",
      businessRegistrationNumber: "12345678",
    });

    expect(
      resolveSupplierVatNumber(candidates, {
        text,
        vendorIban: "NL91ABNA0417164300",
        businessRegistrationNumber: "12345678",
      })?.value,
    ).toBe("NL123456789B01");
  });

  it("filters the configured own-business VAT but keeps the supplier VAT", () => {
    const text = ["Mijn Bedrijf B.V.", "BTW: NL123456789B01", "BTW: NL987654321B01"].join("\n");
    const candidates = collectVatCandidates(text, { profile: ownProfile });

    expect(candidates.map((candidate) => candidate.value)).toEqual(["NL987654321B01"]);
  });

  it("recovers the supplier VAT on a footer-less invoice with no anchor at all", () => {
    // No footer, no "supplier|leverancier" line, no vendor email/IBAN/KvK in
    // the text: the anchored path has nothing to work with. The label the
    // value sits next to is the only evidence left, and it is enough.
    const text = [
      "Factuur 2026-0042",
      "Klant: Customer Ltd",
      "BTW-nummer: NL123456789B01",
      "Totaal: EUR 1.234,56",
    ].join("\n");

    expect(resolveSupplierVatNumber(collectVatCandidates(text), { text })?.value).toBe(
      "NL123456789B01",
    );
  });

  it("takes a labelled VAT above the bill-to block as the supplier's own", () => {
    // Header VAT first, customer block below it: the number predates the
    // bill-to framing, so it is the issuing party's — not the customer's.
    const text = ["BTW: NL123456789B01", "Bill to: Customer Ltd", "Totaal: EUR 100,00"].join("\n");

    expect(resolveSupplierVatNumber(collectVatCandidates(text), { text })?.value).toBe(
      "NL123456789B01",
    );
  });

  it("stays conservative when no label is close enough to own the number", () => {
    const unlabelled = [
      "Factuur 2026-0042",
      "NL123456789B01",
      "Totaal: EUR 100,00",
    ].join("\n");
    expect(resolveSupplierVatNumber(collectVatCandidates(unlabelled), { text: unlabelled })).toBe(
      undefined,
    );

    // The only label in the text is far above the number: too far to be the
    // label that names it, so ownership is unknowable and the answer stays no.
    const distant = [
      "BTW: onze vermelding staat los van het nummer hieronder",
      "Een lange toelichting over de factuur die het label en het nummer uit elkaar drijft.",
      "NL123456789B01",
    ].join("\n");
    expect(resolveSupplierVatNumber(collectVatCandidates(distant), { text: distant })).toBe(
      undefined,
    );
  });
});
