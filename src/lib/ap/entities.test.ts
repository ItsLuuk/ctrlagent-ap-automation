import { describe, expect, it } from "bun:test";
import {
  activeEntityOf,
  applyProfile,
  currencyForJurisdiction,
  entityFromProfile,
  entityOfInvoice,
  profileOf,
  taxProfileFor,
} from "./entities";
import { EMPTY_BUSINESS_PROFILE, type BusinessProfile } from "./types";

const profile = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  ...EMPTY_BUSINESS_PROFILE,
  ...over,
});

describe("entityFromProfile", () => {
  it("derives jurisdiction, reporting currency and tax defaults from the identifiers", () => {
    const entity = entityFromProfile(
      profile({
        name: "Foundry Holding BV",
        vatNumber: "NL005169491B25",
        iban: "NL91ABNA0417164300",
      }),
    );
    expect(entity.name).toBe("Foundry Holding BV");
    expect(entity.jurisdiction).toBe("NL");
    expect(entity.baseCurrency).toBe("EUR");
    expect(entity.tax).toEqual({ standardRate: 0.21, reducedRates: [0.09], registered: true });
    expect(entity.chartOfAccounts.length).toBeGreaterThan(0);
    expect(entity.id.startsWith("ent-")).toBe(true);
  });

  it("reads the jurisdiction from the IBAN when there is no VAT number", () => {
    const entity = entityFromProfile(profile({ iban: "DE89370400440532013000" }));
    expect(entity.jurisdiction).toBe("DE");
    expect(entity.baseCurrency).toBe("EUR");
    expect(entity.tax.registered).toBe(false);
  });

  it("stays usable with an empty profile", () => {
    const entity = entityFromProfile(EMPTY_BUSINESS_PROFILE);
    expect(entity.jurisdiction).toBe("");
    expect(entity.baseCurrency).toBe("EUR");
    expect(entity.chartOfAccounts).toContain("6010 · Software & SaaS");
  });
});

describe("profile projection round-trip", () => {
  it("profileOf ∘ entityFromProfile returns the legacy shape", () => {
    const original = profile({
      name: "Atlas BV",
      address: "Keizersgracht 1",
      email: "ap@atlas.example",
      iban: "NL91ABNA0417164300",
      vatNumber: "NL005169491B25",
      businessRegistrationNumber: "34219876",
    });
    expect(profileOf(entityFromProfile(original))).toEqual({
      name: original.name,
      address: original.address,
      email: original.email,
      iban: original.iban,
      vatNumber: original.vatNumber,
      businessRegistrationNumber: original.businessRegistrationNumber ?? "",
    });
  });
});

describe("applyProfile", () => {
  const entity = entityFromProfile(
    profile({ name: "Atlas BV", vatNumber: "NL005169491B25" }),
  );

  it("keeps edited tax rates when the jurisdiction does not move", () => {
    const edited = { ...entity, tax: { ...entity.tax, standardRate: 0.19 } };
    const next = applyProfile(edited, profile({ name: "Atlas Europe BV" }));
    expect(next.name).toBe("Atlas Europe BV");
    expect(next.tax.standardRate).toBe(0.19);
  });

  it("moves jurisdiction, currency and tax defaults when the identifiers move", () => {
    const next = applyProfile(
      entity,
      profile({ name: "Atlas DE GmbH", vatNumber: "DE123456789", iban: "DE89370400440532013000" }),
    );
    expect(next.jurisdiction).toBe("DE");
    expect(next.baseCurrency).toBe("EUR");
    expect(next.tax.standardRate).toBe(0.19);
    expect(next.tax.registered).toBe(true);
  });
});

describe("lookups", () => {
  const first = entityFromProfile(profile({ name: "One" }));
  const second = { ...entityFromProfile(profile({ name: "Two" })), id: "ent-two" };

  it("activeEntityOf prefers the active id and falls back to the first entity", () => {
    expect(activeEntityOf([first, second], "ent-two")?.name).toBe("Two");
    expect(activeEntityOf([first, second], "missing")?.name).toBe("One");
    expect(activeEntityOf([], "anything")).toBeUndefined();
  });

  it("entityOfInvoice resolves ids and falls back for legacy records", () => {
    expect(entityOfInvoice("ent-two", [first, second])?.name).toBe("Two");
    expect(entityOfInvoice(undefined, [first, second])?.name).toBe("One");
    expect(entityOfInvoice("some free text", [first, second])?.name).toBe("One");
  });
});

describe("tax helpers", () => {
  it("currencyForJurisdiction maps known jurisdictions and defaults to EUR", () => {
    expect(currencyForJurisdiction("GB")).toBe("GBP");
    expect(currencyForJurisdiction("gb")).toBe("GBP");
    expect(currencyForJurisdiction("ZZ")).toBe("EUR");
    expect(currencyForJurisdiction("")).toBe("EUR");
  });

  it("taxProfileFor copies the jurisdiction's rates", () => {
    expect(taxProfileFor("NL", true)).toEqual({
      standardRate: 0.21,
      reducedRates: [0.09],
      registered: true,
    });
    expect(taxProfileFor("ZZ", false)).toEqual({
      standardRate: 0,
      reducedRates: [],
      registered: false,
    });
  });
});
