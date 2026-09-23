import { describe, expect, it } from "bun:test";
import { decideInitialStatus } from "./vendor-routing";

describe("decideInitialStatus", () => {
  it("routes a known vendor straight into Draft", () => {
    expect(
      decideInitialStatus("Acme BV", { "Acme BV": { name: "Acme BV", email: "x@y.z" } }),
    ).toBe("draft");
  });

  it("routes an unknown vendor name to the registration phase", () => {
    expect(decideInitialStatus("Brand New Vendor", {})).toBe("vendor_profile");
  });

  it("treats an empty vendor name as needing registration", () => {
    expect(decideInitialStatus("", { "Acme BV": {} })).toBe("vendor_profile");
  });

  it("treats whitespace-only vendor names as needing registration", () => {
    expect(decideInitialStatus("   ", { "Acme BV": {} })).toBe("vendor_profile");
  });

  it("treats undefined vendor name as needing registration", () => {
    expect(decideInitialStatus(undefined, {})).toBe("vendor_profile");
  });

  it("uses trimmed-name match, so case-only differences route to registration", () => {
    // Lookup is exact match; a real-world "ACME bv" vs "Acme BV" mismatch goes
    // through the registration screen where the user picks one canonical name.
    expect(decideInitialStatus("ACME BV", { "Acme BV": {} })).toBe("vendor_profile");
  });
});