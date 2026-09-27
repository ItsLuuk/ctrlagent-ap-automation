import { describe, expect, it } from "bun:test";
import {
  identityChanges,
  PROFILE_FIELDS,
  PROFILE_ZONE_FIELD,
  REQUIRED_PROFILE_FIELDS,
  profileCompleteness,
  profileCorrections,
  profileFieldLabel,
  vendorProfileGapLabel,
  vendorProfileGaps,
  type VendorMaster,
} from "./vendor-master";

const base: VendorMaster = {
  name: "Acme",
  email: "billing@acme.com",
  updatedAt: new Date(0).toISOString(),
};

describe("profileCompleteness", () => {
  it("counts name plus the six master-data fields including department", () => {
    expect(PROFILE_FIELDS).toEqual([
      "name",
      "email",
      "address",
      "iban",
      "vatNumber",
      "businessRegistrationNumber",
      "department",
    ]);
    expect(profileCompleteness(base)).toEqual({ filled: 2, total: 7 });
  });

  it("counts filled optional fields", () => {
    expect(
      profileCompleteness({
        ...base,
        address: "Main St 1",
        iban: "NL00BANK0123456789",
        department: "Operations",
      }),
    ).toEqual({ filled: 5, total: 7 });
  });

  it("treats blank strings as missing", () => {
    expect(profileCompleteness({ ...base, vatNumber: "   " })).toEqual({ filled: 2, total: 7 });
  });
});

describe("vendorProfileGaps", () => {
  it("gates exactly name, business registration, and IBAN", () => {
    expect(REQUIRED_PROFILE_FIELDS).toEqual(["name", "businessRegistrationNumber", "iban"]);
  });

  it("passes a complete profile with a checksum-valid IBAN", () => {
    expect(
      vendorProfileGaps({
        ...base,
        iban: "NL95RABO0336381832",
        businessRegistrationNumber: "34298230",
      }),
    ).toEqual([]);
  });

  it("lists every required field that is blank", () => {
    expect(
      vendorProfileGaps({ ...base, name: "  ", iban: "", businessRegistrationNumber: "" }),
    ).toEqual(["name", "businessRegistrationNumber", "iban"]);
  });

  it("fails an IBAN whose check digits don't add up", () => {
    // NL00BANK… has the right shape but the wrong check digits.
    expect(
      vendorProfileGaps({
        ...base,
        iban: "NL00BANK0123456789",
        businessRegistrationNumber: "34298230",
      }),
    ).toEqual(["iban"]);
  });

  it("does not gate on enrichment fields like VAT or address", () => {
    expect(
      vendorProfileGaps({
        ...base,
        vatNumber: "",
        address: undefined,
        iban: "NL95RABO0336381832",
        businessRegistrationNumber: "34298230",
      }),
    ).toEqual([]);
  });
});

describe("vendorProfileGapLabel", () => {
  it("scopes the registration label to the vendor's country", () => {
    const nl: VendorMaster = { ...base, vatNumber: "NL859520572B01" };
    const de: VendorMaster = { ...base, iban: "DE89370400440532013000" };
    expect(vendorProfileGapLabel("name", nl)).toBe("Vendor name");
    expect(vendorProfileGapLabel("iban", nl)).toBe("IBAN");
    expect(vendorProfileGapLabel("businessRegistrationNumber", nl)).toBe("KVK number");
    expect(vendorProfileGapLabel("businessRegistrationNumber", de)).toBe("Handelsregisternummer");
    // No identifiers yet → the country is unknown → the generic fallback.
    expect(vendorProfileGapLabel("businessRegistrationNumber", base)).toBe(
      "Business registration number",
    );
  });
});

describe("profileFieldLabel", () => {
  it("names every profile field in human terms", () => {
    const nl = { ...base, vatNumber: "NL859520572B01" };
    expect(profileFieldLabel("name", nl)).toBe("Vendor name");
    expect(profileFieldLabel("email", nl)).toBe("Billing email");
    expect(profileFieldLabel("address", nl)).toBe("Address");
    expect(profileFieldLabel("iban", nl)).toBe("IBAN");
    expect(profileFieldLabel("vatNumber", nl)).toBe("VAT number");
    expect(profileFieldLabel("businessRegistrationNumber", nl)).toBe("KVK number");
    expect(profileFieldLabel("department", nl)).toBe("Department");
  });
});

describe("profileCorrections", () => {
  it("diffs only fields the operator actually changed", () => {
    const seed: VendorMaster = { ...base, iban: "NL95RABO0336381832", address: "Dam 1, Amsterdam" };
    const saved: VendorMaster = {
      ...seed,
      iban: "NL21RABO0336381833",
      address: "Keizersgracht 42, Amsterdam",
    };
    expect(profileCorrections(seed, saved)).toEqual([
      { field: "address", from: "Dam 1, Amsterdam", to: "Keizersgracht 42, Amsterdam" },
      { field: "iban", from: "NL95RABO0336381832", to: "NL21RABO0336381833" },
    ]);
  });

  it("reports no correction when the record matches the seed", () => {
    const seed: VendorMaster = { ...base, iban: "NL95RABO0336381832" };
    expect(profileCorrections(seed, { ...seed, updatedAt: "changed" })).toEqual([]);
  });

  it("treats IBAN/VAT case normalisation as unchanged, real edits as changed", () => {
    const seed: VendorMaster = {
      ...base,
      iban: "nl95rabo0336381832",
      vatNumber: "nl859520572b01",
    };
    const saved: VendorMaster = {
      ...seed,
      iban: "NL95RABO0336381832", // save-time upper-casing — not a correction
      vatNumber: "NL859520572B02", // a digit changed — a correction
    };
    const diffs = profileCorrections(seed, saved);
    expect(diffs.map((d) => d.field)).toEqual(["vatNumber"]);
  });

  it("reads empty-to-filled and filled-to-cleared as corrections", () => {
    const seed: VendorMaster = { ...base, address: undefined };
    const saved: VendorMaster = { ...base, address: "Dam 1, Amsterdam" };
    expect(profileCorrections(seed, saved)).toEqual([
      { field: "address", from: "", to: "Dam 1, Amsterdam" },
    ]);
    expect(profileCorrections(saved, seed)).toEqual([
      { field: "address", from: "Dam 1, Amsterdam", to: "" },
    ]);
  });

  it("ignores surrounding whitespace the save would trim away", () => {
    const seed: VendorMaster = { ...base, businessRegistrationNumber: "34298230" };
    const saved: VendorMaster = { ...base, businessRegistrationNumber: "  34298230  " };
    expect(profileCorrections(seed, saved)).toEqual([]);
  });
});

describe("PROFILE_ZONE_FIELD", () => {
  it("maps the six document-backed profile fields to zone fields", () => {
    expect(PROFILE_ZONE_FIELD).toEqual({
      name: "vendor",
      email: "vendorEmail",
      address: "address",
      iban: "iban",
      vatNumber: "vatNumber",
      businessRegistrationNumber: "businessRegistrationNumber",
    });
  });

  it("omits department — it has no position on the document", () => {
    expect(PROFILE_ZONE_FIELD.department).toBeUndefined();
  });

  it("uses only ProfileField keys", () => {
    for (const key of Object.keys(PROFILE_ZONE_FIELD)) {
      expect(PROFILE_FIELDS).toContain(key);
    }
  });
});

describe("identityChanges", () => {
  const onFile: VendorMaster = {
    name: "Acme",
    email: "billing@acme.com",
    address: "Keileweg 1",
    iban: "NL91ABNA0417164300",
    vatNumber: "NL000000000B00",
    businessRegistrationNumber: "87654321",
    updatedAt: new Date(0).toISOString(),
  };

  const kindOf = (
    current: VendorMaster | undefined,
    next: VendorMaster,
    field: string,
  ): string | undefined =>
    identityChanges(current, next).find((change) => change.field === field)?.kind;

  it("leaves department out — it is a choice, not something read off the document", () => {
    const fields = identityChanges(onFile, { ...onFile, department: "Finance" }).map(
      (change) => change.field,
    );
    expect(fields).not.toContain("department");
    expect(fields).toEqual([
      "name",
      "email",
      "address",
      "iban",
      "vatNumber",
      "businessRegistrationNumber",
    ]);
  });

  it("names a value the file has never seen", () => {
    expect(kindOf(undefined, onFile, "iban")).toBe("new");
    expect(kindOf(onFile, onFile, "name")).toBe("unchanged");
  });

  it("calls out a bank detail that would be replaced", () => {
    const next = { ...onFile, iban: "NL02ABNA0417164300" };
    expect(kindOf(onFile, next, "iban")).toBe("changed");
    const change = identityChanges(onFile, next).find((c) => c.field === "iban");
    expect(change?.onFile).toBe("NL91ABNA0417164300");
    expect(change?.next).toBe("NL02ABNA0417164300");
  });

  it("treats a spaced IBAN from the document as the bank detail already on file", () => {
    const fromDocument = { ...onFile, iban: "NL91 ABNA 0417 1643 00" };
    expect(kindOf(onFile, fromDocument, "iban")).toBe("unchanged");
  });

  it("says when confirming would empty a value the file holds", () => {
    expect(kindOf(onFile, { ...onFile, address: "" }, "address")).toBe("cleared");
    // Nothing to lose, nothing to say.
    expect(kindOf(undefined, { ...onFile, address: "" }, "address")).toBe("unchanged");
  });
});
