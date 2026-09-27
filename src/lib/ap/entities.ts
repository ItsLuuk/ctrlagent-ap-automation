/**
 * Business entities — the first-class owner of "whose books is this".
 *
 * The app used to hold exactly one `BusinessProfile` singleton. Multi-entity
 * support makes the entity the unit everything else hangs off: the chart of
 * accounts, the tax jurisdiction, the base (reporting) currency, and the
 * reverse-charge side of every cross-border test. The legacy profile survives
 * as a *projection* of the active entity (`profileOf` / `applyProfile`), so the
 * extraction filter and the settings form keep one shape while the store keeps
 * one truth: the entity list.
 *
 * Pure domain: no browser or persistence APIs.
 */
import { registrationCountry } from "./business-registration";
import { JURISDICTION_TAX } from "./tax";
import { GL_ACCOUNTS, uid, type BusinessProfile } from "./types";

/** An account in an entity's chart: "6010 · Software & SaaS". */
export type GlAccount = string;

/** How one entity is taxed in its own jurisdiction. Rates are fractions. */
export type EntityTaxProfile = {
  standardRate: number;
  reducedRates: number[];
  /** Registered for tax in `jurisdiction` — enables reverse-charge treatment. */
  registered: boolean;
};

export type BusinessEntity = {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 — the jurisdiction whose rules apply ("NL"). */
  jurisdiction: string;
  /** The currency this entity reports and consolidates in. */
  baseCurrency: string;
  address: string;
  email: string;
  iban: string;
  vatNumber: string;
  businessRegistrationNumber: string;
  /** This entity's chart — not the global default, not another entity's. */
  chartOfAccounts: GlAccount[];
  tax: EntityTaxProfile;
  createdAt: string;
};

/** The chart every new entity starts from (the historic global list). */
export const DEFAULT_CHART_OF_ACCOUNTS: readonly GlAccount[] = GL_ACCOUNTS;

/** Tax defaults for a jurisdiction; unknown jurisdictions charge nothing we can judge. */
export function taxProfileFor(
  jurisdiction: string,
  registered: boolean,
): EntityTaxProfile {
  const rule = JURISDICTION_TAX[jurisdiction.toUpperCase()];
  return {
    standardRate: rule?.standardRate ?? 0,
    reducedRates: rule ? [...rule.reducedRates] : [],
    registered,
  };
}

/** The reporting currency implied by a jurisdiction (EUR when unknown here). */
export function currencyForJurisdiction(jurisdiction: string): string {
  return JURISDICTION_TAX[jurisdiction.toUpperCase()]?.currency ?? "EUR";
}

/**
 * The one-time migration: the legacy singleton profile becomes the first
 * entity. Country comes from the VAT number or IBAN; the chart starts from
 * the default; the tax profile from the jurisdiction table.
 */
export function entityFromProfile(profile: BusinessProfile): BusinessEntity {
  const jurisdiction = registrationCountry(profile.vatNumber, profile.iban) ?? "";
  return {
    id: `ent-${uid()}`,
    name: profile.name,
    jurisdiction,
    baseCurrency: currencyForJurisdiction(jurisdiction),
    address: profile.address,
    email: profile.email,
    iban: profile.iban,
    vatNumber: profile.vatNumber,
    businessRegistrationNumber: profile.businessRegistrationNumber ?? "",
    chartOfAccounts: [...DEFAULT_CHART_OF_ACCOUNTS],
    tax: taxProfileFor(jurisdiction, Boolean(profile.vatNumber.trim())),
    createdAt: new Date().toISOString(),
  };
}

/** The legacy profile shape, projected from an entity — extraction's view. */
export function profileOf(entity: BusinessEntity): BusinessProfile {
  return {
    name: entity.name,
    address: entity.address,
    email: entity.email,
    iban: entity.iban,
    vatNumber: entity.vatNumber,
    businessRegistrationNumber: entity.businessRegistrationNumber,
  };
}

/**
 * A profile edit lands on the entity. Jurisdiction follows the identifiers
 * (VAT prefix, then IBAN) exactly as the migration reads it; when the
 * jurisdiction moves, the tax defaults move with it — edited rates survive a
 * no-op jurisdiction change.
 */
export function applyProfile(entity: BusinessEntity, profile: BusinessProfile): BusinessEntity {
  const jurisdiction = registrationCountry(profile.vatNumber, profile.iban) ?? entity.jurisdiction;
  const moved = jurisdiction !== entity.jurisdiction;
  return {
    ...entity,
    name: profile.name,
    address: profile.address,
    email: profile.email,
    iban: profile.iban,
    vatNumber: profile.vatNumber,
    businessRegistrationNumber: profile.businessRegistrationNumber ?? "",
    jurisdiction,
    baseCurrency: moved ? currencyForJurisdiction(jurisdiction) : entity.baseCurrency,
    tax: moved
      ? taxProfileFor(jurisdiction, Boolean(profile.vatNumber.trim()) || entity.tax.registered)
      : { ...entity.tax, registered: Boolean(profile.vatNumber.trim()) || entity.tax.registered },
  };
}

/** The entity an operation runs under: the active one, else the first. */
export function activeEntityOf(
  entities: readonly BusinessEntity[],
  activeId: string,
): BusinessEntity | undefined {
  return entities.find((entity) => entity.id === activeId) ?? entities[0];
}

/** The entity an invoice belongs to; legacy invoices fall back to the first. */
export function entityOfInvoice(
  invoiceEntityId: string | undefined,
  entities: readonly BusinessEntity[],
): BusinessEntity | undefined {
  return entities.find((entity) => entity.id === invoiceEntityId) ?? entities[0];
}

/**
 * What a coding select offers: the entity's own chart (the default one when
 * the chart is empty), plus the invoice's current value when a chart edit
 * retired it — an in-use account must stay selectable, never rewritten.
 */
export function codingOptionsFor(entity: BusinessEntity, current: string): string[] {
  const chart =
    entity.chartOfAccounts.length > 0 ? entity.chartOfAccounts : [...DEFAULT_CHART_OF_ACCOUNTS];
  return current && !chart.includes(current) ? [current, ...chart] : chart;
}
