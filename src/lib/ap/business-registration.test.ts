/**
 * Guards for the country-scoped business-registration label.
 *
 * The field is one generic string; only its label changes with the supplier's
 * country. These tests pin the derivation (VAT prefix first, bank country as a
 * stand-in) and the fallback, because a wrong label on a finance field is worse
 * than no label: "KVK number" tells a French editor to look for the wrong thing.
 */
import { describe, expect, it } from "bun:test";
import {
  BUSINESS_REGISTRATION_LABEL_FALLBACK,
  businessRegistrationLabel,
  registrationCountry,
} from "./business-registration";

describe("businessRegistrationLabel", () => {
  it("names the field the local way", () => {
    expect(businessRegistrationLabel("NL")).toBe("KVK number");
    expect(businessRegistrationLabel("nl")).toBe("KVK number");
    expect(businessRegistrationLabel("FR")).toBe("SIREN / SIRET");
    expect(businessRegistrationLabel("DE")).toBe("Handelsregisternummer");
  });

  it("falls back to the country-neutral name", () => {
    expect(businessRegistrationLabel(undefined)).toBe(BUSINESS_REGISTRATION_LABEL_FALLBACK);
    expect(businessRegistrationLabel("")).toBe(BUSINESS_REGISTRATION_LABEL_FALLBACK);
    expect(businessRegistrationLabel("US")).toBe(BUSINESS_REGISTRATION_LABEL_FALLBACK);
  });
});

describe("registrationCountry", () => {
  it("reads the VAT prefix — the registration country", () => {
    expect(registrationCountry("NL123456789B01", undefined)).toBe("NL");
    expect(registrationCountry("de123456789", undefined)).toBe("DE");
    expect(registrationCountry("FR 12 345678901", undefined)).toBe("FR");
  });

  it("falls back to the bank's country when the VAT number says nothing", () => {
    expect(registrationCountry(undefined, "NL91ABNA0417164300")).toBe("NL");
    expect(registrationCountry(undefined, "FR14 2004 1010 0505 0001 3M02 606")).toBe("FR");
    // Un-prefixed identifiers (a US EIN) must not invent a country from digits.
    expect(registrationCountry("12-3456789", undefined)).toBeUndefined();
    expect(registrationCountry(undefined, "00123456789")).toBeUndefined();
  });

  it("prefers the VAT number over the bank country", () => {
    expect(registrationCountry("BE0123456789", "NL91ABNA0417164300")).toBe("BE");
  });

  it("returns nothing when there is nothing to read", () => {
    expect(registrationCountry(undefined, undefined)).toBeUndefined();
    expect(registrationCountry("", "")).toBeUndefined();
  });

  it("ends in the generic label when the country is unknown", () => {
    expect(businessRegistrationLabel(registrationCountry("12-3456789", undefined))).toBe(
      BUSINESS_REGISTRATION_LABEL_FALLBACK,
    );
  });
});
