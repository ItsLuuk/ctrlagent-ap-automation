/**
 * Consolidated reporting — one honest number across entities and currencies.
 *
 * Every invoice is grouped into its entity, bucketed by its own currency, and
 * each bucket is converted to the reporting currency through the operator's
 * rate table. A bucket with no rate is shown as such and *suppresses* the
 * totals that depend on it: a consolidated figure built on a missing rate
 * would be a guess wearing a sum's clothing.
 *
 * Pure domain: no browser or persistence APIs.
 */
import type { BusinessEntity } from "./entities";
import { entityOfInvoice } from "./entities";
import type { FxRate } from "./fx";
import { rateFor } from "./fx";
import { money, type Invoice } from "./types";

/** One entity's totals: a bucket per source currency, then the entity line. */
export type EntityTotals = {
  entityId: string;
  entityName: string;
  jurisdiction: string;
  baseCurrency: string;
  buckets: {
    currency: string;
    /** Sum of invoice totals in that currency. */
    amount: number;
    /** Conversion into the reporting currency, when a rate exists. */
    rate?: number | undefined;
    converted?: number | undefined;
  }[];
  /** Sum in the reporting currency — only when every bucket converted. */
  total?: number | undefined;
  /** Currencies of this entity with no rate, blocking `total`. */
  missingRates: string[];
  invoiceCount: number;
};

export type ConsolidatedReport = {
  reportingCurrency: string;
  entities: EntityTotals[];
  /** Grand total in the reporting currency — only when nothing is missing. */
  consolidated?: number | undefined;
  /** Every (entity, currency) pair with no rate, in report order. */
  missingRates: { entityId: string; entityName: string; currency: string }[];
  invoiceCount: number;
};

export function consolidatedReport(input: {
  invoices: readonly Invoice[];
  entities: readonly BusinessEntity[];
  rates: readonly FxRate[];
  reportingCurrency: string;
}): ConsolidatedReport {
  const { invoices, entities, rates, reportingCurrency } = input;

  const bucketsByEntity = new Map<
    string,
    { currencies: Map<string, number>; count: number }
  >();
  for (const invoice of invoices) {
    if (!Number.isFinite(invoice.total)) continue;
    // `invoice.entity` carries the entity id (legacy free text falls back).
    const entity = entityOfInvoice(invoice.entity, entities);
    if (!entity) continue;
    const entry =
      bucketsByEntity.get(entity.id) ?? { currencies: new Map<string, number>(), count: 0 };
    const currency = invoice.currency || reportingCurrency;
    entry.currencies.set(currency, (entry.currencies.get(currency) ?? 0) + invoice.total);
    entry.count += 1;
    bucketsByEntity.set(entity.id, entry);
  }

  const report: ConsolidatedReport = {
    reportingCurrency,
    entities: [],
    missingRates: [],
    invoiceCount: invoices.filter((invoice) => Number.isFinite(invoice.total)).length,
  };

  for (const entity of entities) {
    const entry = bucketsByEntity.get(entity.id);
    const totals: EntityTotals = {
      entityId: entity.id,
      entityName: entity.name,
      jurisdiction: entity.jurisdiction,
      baseCurrency: entity.baseCurrency,
      buckets: [],
      missingRates: [],
      invoiceCount: entry?.count ?? 0,
    };
    if (entry) {
      for (const [currency, amount] of [...entry.currencies].sort(([a], [b]) => a.localeCompare(b))) {
        const rate = rateFor(rates, currency, reportingCurrency);
        if (rate === undefined) {
          totals.buckets.push({ currency, amount });
          totals.missingRates.push(currency);
          report.missingRates.push({
            entityId: entity.id,
            entityName: entity.name,
            currency,
          });
        } else {
          totals.buckets.push({ currency, amount, rate, converted: amount * rate });
        }
      }
      if (totals.missingRates.length === 0) {
        totals.total = totals.buckets.reduce((sum, bucket) => sum + (bucket.converted ?? 0), 0);
      }
    }
    report.entities.push(totals);
  }

  if (
    report.entities.every(
      (totals) => totals.invoiceCount === 0 || totals.total !== undefined,
    )
  ) {
    report.consolidated = report.entities.reduce((sum, totals) => sum + (totals.total ?? 0), 0);
  }
  return report;
}

/** One-line summary for a head sentence; names what is missing, if anything. */
export function reportHeadline(report: ConsolidatedReport): string {
  const scope = `${report.invoiceCount} ${report.invoiceCount === 1 ? "invoice" : "invoices"} across ${report.entities.length} ${report.entities.length === 1 ? "entity" : "entities"}`;
  if (report.consolidated !== undefined) {
    return `${scope} — ${money(report.consolidated, report.reportingCurrency)} consolidated.`;
  }
  const missing = report.missingRates
    .map((entry) => `${entry.currency} → ${entry.entityName}`)
    .join(", ");
  return `${scope} — no consolidated total yet: missing rates for ${missing}.`;
}
