import { describe, expect, it } from "bun:test";
import { buildQueue } from "./draft-queue";
import type { Invoice } from "./types";

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv-1",
    vendor: "Acme",
    invoiceNumber: "2026-001",
    currency: "EUR",
    department: "Engineering",
    status: "draft",
    audit: [],
    lineItems: [],
    tags: [],
    confidence: {},
    createdAt: new Date(0).toISOString(),
    ...over,
  }) as Invoice;

describe("buildQueue", () => {
  it("orders errors before warnings before amber before profile gaps", () => {
    const items = buildQueue({
      blockingIssues: [{ code: "missing_total", message: "Total is required", severity: "error" }],
      warningIssues: [{ code: "w1", message: "Check tax", severity: "warning" }],
      amberFields: [{ field: "vendor", label: "Vendor" }],
      crossCheckOk: true,
      vendor: {
        name: "Acme",
        email: "billing@acme.com",
        kvkNumber: "12345678",
        // department intentionally omitted so it surfaces as a profile gap —
        // a 4th gap proves the new field is part of PROFILE_FIELDS.
        updatedAt: "",
      },
    });
    expect(items.map((i) => i.kind)).toEqual([
      "blocking",
      "warning",
      "amber",
      "profile-gap",
      "profile-gap",
      "profile-gap",
      "profile-gap",
    ]);
    expect(items[0]?.field).toBe("total");
  });

  it("dedupes amber fields already covered by an issue", () => {
    const items = buildQueue({
      blockingIssues: [{ code: "missing_vendor", message: "Vendor?", severity: "error" }],
      warningIssues: [],
      amberFields: [{ field: "vendor", label: "Vendor" }],
      crossCheckOk: true,
      vendor: {
        name: "Acme",
        email: "b@a.co",
        address: "x",
        iban: "y",
        vatNumber: "z",
        businessRegistrationNumber: "12345678",
        department: "Engineering",
        updatedAt: "",
      },
    });
    expect(items.filter((i) => i.field === "vendor")).toHaveLength(1);
  });

  it("names the missing registration number in the vendor's own country", () => {
    const gapLabelFor = (vendor: Parameters<typeof buildQueue>[0]["vendor"]) => {
      const items = buildQueue({
        blockingIssues: [],
        warningIssues: [],
        amberFields: [],
        crossCheckOk: true,
        vendor,
      });
      return items.find((i) => i.profileField === "businessRegistrationNumber")?.label;
    };
    const filled = { name: "Acme", email: "b@a.co", address: "x", iban: "y", updatedAt: "" };

    // The field is one field; its name follows the identifiers we already hold.
    expect(gapLabelFor({ ...filled, vatNumber: "NL005169491B25" })).toBe("KVK number");
    expect(gapLabelFor({ ...filled, vatNumber: "FR12345678901" })).toBe("SIREN / SIRET");
    expect(gapLabelFor({ ...filled, iban: "DE89370400440532013000" })).toBe(
      "Handelsregisternummer",
    );
    // No country to read: the generic label, never a guess.
    expect(gapLabelFor({ ...filled, vatNumber: "123456789" })).toBe(
      "Business registration number",
    );
  });

  it("adds a conflict item when the cross-check fails", () => {
    const items = buildQueue({
      blockingIssues: [],
      warningIssues: [],
      amberFields: [],
      crossCheckOk: false,
      crossCheckDetail: "Lines sum €100.00 but total is €120.00",
      vendor: {
        name: "Acme",
        email: "b@a.co",
        address: "x",
        iban: "y",
        vatNumber: "z",
        businessRegistrationNumber: "12345678",
        department: "Finance",
        updatedAt: "",
      },
    });
    expect(items.map((i) => i.kind)).toEqual(["blocking"]);
    expect(items[0]?.kind).toBe("blocking");
  });

  it("returns an empty queue when everything verifies", () => {
    expect(
      buildQueue({
        blockingIssues: [],
        warningIssues: [],
        amberFields: [],
        crossCheckOk: true,
        vendor: {
          name: "Acme",
          email: "b@a.co",
          address: "x",
          iban: "y",
          vatNumber: "z",
          kvkNumber: "12345678",
          department: "Sales",
          updatedAt: "",
        },
      }),
    ).toEqual([]);
  });
});
