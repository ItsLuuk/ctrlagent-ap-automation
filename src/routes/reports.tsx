import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Table2 } from "@/components/icons";
import { PageHeader } from "@/components/ap/page-header";
import { Shell } from "@/components/ap/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAp } from "@/lib/app/store";
import { consolidatedReport, reportHeadline } from "@/lib/ap/consolidated";
import { CURRENCY_OPTIONS, money } from "@/lib/ap/types";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Consolidated report — Foundry" },
      {
        name: "description",
        content: "One total across every entity and currency, converted with your own rates.",
      },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const { invoices, history, entities, fxRates, saveFxRate, activeEntity } = useAp();
  const [reportingCurrency, setReportingCurrency] = useState(activeEntity.baseCurrency);

  const report = useMemo(
    () =>
      consolidatedReport({
        invoices: [...invoices, ...history],
        entities,
        rates: fxRates,
        reportingCurrency,
      }),
    [invoices, history, entities, fxRates, reportingCurrency],
  );

  /** Currencies still missing a rate into the reporting currency, deduplicated. */
  const gaps = [
    ...new Set(report.missingRates.map((missing) => missing.currency)),
  ];

  return (
    <Shell>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Invoice inbox
      </Link>

      <div className="mt-3">
        <PageHeader
          icon={Table2}
          title="Consolidated report"
          subtitle="One total across every entity and currency, converted with the rates you keep on this device."
        />
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <label
            htmlFor="reporting-currency"
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            Reporting currency
          </label>
          <Select value={reportingCurrency} onValueChange={setReportingCurrency}>
            <SelectTrigger id="reporting-currency" className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCY_OPTIONS.map((option) => (
                <SelectItem key={option.code} value={option.code}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">{reportHeadline(report)}</p>
      </div>

      {gaps.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium">Missing exchange rates</p>
          <p className="mt-1 text-xs text-muted-foreground">
            A consolidated total is only printed once every currency can convert — add the rate
            and the totals fill in.
          </p>
          <div className="mt-3 flex flex-wrap gap-4">
            {gaps.map((currency) => (
              <RateInput
                key={currency}
                currency={currency}
                reporting={reportingCurrency}
                onSave={(rate) => saveFxRate(currency, reportingCurrency, rate)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-lg bg-card shadow-whisper">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Entity</th>
              <th className="px-4 py-2.5 font-medium">Jurisdiction</th>
              <th className="px-4 py-2.5 font-medium">Invoices</th>
              <th className="px-4 py-2.5 font-medium">By currency</th>
              <th className="px-4 py-2.5 text-right font-medium">In {reportingCurrency}</th>
            </tr>
          </thead>
          <tbody>
            {report.entities.map((totals) => (
              <tr key={totals.entityId} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-medium">{totals.entityName || "Untitled entity"}</td>
                <td className="px-4 py-3 font-mono text-xs">{totals.jurisdiction || "—"}</td>
                <td className="px-4 py-3">{totals.invoiceCount}</td>
                <td className="px-4 py-3">
                  {totals.buckets.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {totals.buckets.map((bucket) => (
                        <li key={bucket.currency} className="text-xs">
                          {money(bucket.amount, bucket.currency)}
                          {bucket.converted !== undefined ? (
                            <span className="text-muted-foreground">
                              {" "}
                              → {money(bucket.converted, reportingCurrency)}
                            </span>
                          ) : (
                            <span className="text-warning"> · no rate for {bucket.currency}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {totals.invoiceCount === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : totals.total !== undefined ? (
                    money(totals.total, reportingCurrency)
                  ) : (
                    <span className="text-muted-foreground">rate missing</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {report.consolidated !== undefined && (
            <tfoot>
              <tr className="border-t border-border bg-muted/40 text-sm">
                <td className="px-4 py-3 font-semibold" colSpan={4}>
                  Consolidated
                </td>
                <td className="px-4 py-3 text-right font-semibold">
                  {money(report.consolidated, reportingCurrency)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Shell>
  );
}

/** One pair's rate entry: type a value, save, the report converts immediately. */
function RateInput({
  currency,
  reporting,
  onSave,
}: {
  currency: string;
  reporting: string;
  onSave: (rate: number) => void;
}) {
  const [value, setValue] = useState("");
  const rate = Number(value.replace(",", "."));
  const valid = Number.isFinite(rate) && rate > 0;
  return (
    <div className="flex items-end gap-2">
      <div>
        <label
          htmlFor={`rate-${currency}`}
          className="mb-1.5 block text-xs font-medium text-muted-foreground"
        >
          {currency} → {reporting}
        </label>
        <Input
          id={`rate-${currency}`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          inputMode="decimal"
          placeholder="1.08"
          className="h-10 w-28 font-mono"
        />
      </div>
      <Button size="sm" className="h-10" disabled={!valid} onClick={() => onSave(rate)}>
        Save rate
      </Button>
    </div>
  );
}
