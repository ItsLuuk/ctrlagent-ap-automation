import { createFileRoute, Link } from "@tanstack/react-router";
import { ChartNoAxesCombined } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  EmptyState,
  PageHeader,
  Pill,
  Section,
  SectionHeader,
  Stat,
} from "@/components/ap/primitives";
import {
  analyzeSpend,
  type CurrencyTotal,
  type SpendBucket,
  type SpendDimension,
  type SpendPeriod,
} from "@/lib/ap/analytics";
import { useAp } from "@/lib/app/store";
import { Shell } from "@/components/ap/shell";
import { money, shortDate, type Invoice } from "@/lib/ap/types";

export const Route = createFileRoute("/analytics")({ component: AnalyticsPage });

const DIMENSIONS: ReadonlyArray<{ id: SpendDimension; label: string }> = [
  { id: "vendor", label: "Vendor" },
  { id: "category", label: "Category" },
  { id: "department", label: "Department" },
  { id: "entity", label: "Entity" },
  { id: "period", label: "Period" },
];

const COMPLETED_STATUSES: ReadonlySet<Invoice["status"]> = new Set([
  "rejected",
  "archived",
  "paid",
]);

type AnalyticsFilters = {
  from: string;
  to: string;
  currency: string;
  period: SpendPeriod;
};

function formatCurrencyTotals(totals: CurrencyTotal[]): string {
  if (totals.length === 0) return "—";
  return totals.map((total) => money(total.total, total.currency)).join(" · ");
}

function countInvoices(totals: CurrencyTotal[]): number {
  return totals.reduce((count, total) => count + total.count, 0);
}

function countUnassignedGroups(buckets: SpendBucket[]): number {
  return buckets.filter(
    (bucket) => bucket.label.startsWith("Unassigned") || bucket.label === "Uncategorized",
  ).length;
}

function AnalyticsPage() {
  const { invoices, history } = useAp();
  const [filters, setFilters] = useState<AnalyticsFilters>({
    from: "",
    to: "",
    currency: "",
    period: "month",
  });
  const [dimension, setDimension] = useState<SpendDimension>("vendor");
  const [selectedBucketKey, setSelectedBucketKey] = useState("");

  const paidInvoices = useMemo(
    () => history.filter((invoice) => invoice.status === "paid"),
    [history],
  );
  const openInvoices = useMemo(
    () => invoices.filter((invoice) => !COMPLETED_STATUSES.has(invoice.status)),
    [invoices],
  );
  const availableCurrencies = useMemo(
    () =>
      [...new Set([...paidInvoices, ...openInvoices].map((invoice) => invoice.currency || "EUR"))].sort(),
    [paidInvoices, openInvoices],
  );

  const analysis = useMemo(
    () =>
      analyzeSpend(paidInvoices, openInvoices, {
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...(filters.currency ? { currency: filters.currency } : {}),
        period: filters.period,
      }),
    [paidInvoices, openInvoices, filters],
  );

  const buckets = analysis.buckets[dimension];
  const selectedBucket = buckets.find((bucket) => bucket.key === selectedBucketKey);

  function updateFilter<Key extends keyof AnalyticsFilters>(
    key: Key,
    value: AnalyticsFilters[Key],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
    setSelectedBucketKey("");
  }

  function selectDimension(nextDimension: SpendDimension) {
    setDimension(nextDimension);
    setSelectedBucketKey("");
  }

  return (
    <Shell>
      <div className="space-y-6">
      <PageHeader
        title="Spend analytics"
        subtitle="Paid spend, open commitments, and the invoices behind every figure."
        controls={
          <AnalyticsFilterPanel
            filters={filters}
            currencies={availableCurrencies}
            onChange={updateFilter}
          />
        }
      />

      <AnalyticsSummary
        realizedSpend={analysis.realized}
        openPipeline={analysis.openPipeline}
        unassignedGroupCount={countUnassignedGroups(buckets)}
      />

      <Section>
        <SectionHeader
          title="Where the money went"
          hint="Select any bar to inspect the exact invoices."
        />
        <DimensionTabs selected={dimension} onSelect={selectDimension} />
        <SpendBars
          buckets={buckets}
          selectedBucketKey={selectedBucketKey}
          onSelect={setSelectedBucketKey}
        />
      </Section>

      {selectedBucket && (
        <InvoiceDrillDown
          bucket={selectedBucket}
          invoices={[...history, ...invoices]}
          onClear={() => setSelectedBucketKey("")}
        />
      )}
      </div>
    </Shell>
  );
}

type FilterPanelProps = {
  filters: AnalyticsFilters;
  currencies: string[];
  onChange: <Key extends keyof AnalyticsFilters>(
    key: Key,
    value: AnalyticsFilters[Key],
  ) => void;
};

function AnalyticsFilterPanel({ filters, currencies, onChange }: FilterPanelProps) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <FilterField label="From">
        <input
          type="date"
          value={filters.from}
          onChange={(event) => onChange("from", event.target.value)}
          className={FILTER_CONTROL_CLASS}
        />
      </FilterField>
      <FilterField label="To">
        <input
          type="date"
          value={filters.to}
          onChange={(event) => onChange("to", event.target.value)}
          className={FILTER_CONTROL_CLASS}
        />
      </FilterField>
      <FilterField label="Currency">
        <select
          value={filters.currency}
          onChange={(event) => onChange("currency", event.target.value)}
          className={FILTER_CONTROL_CLASS}
        >
          <option value="">All currencies</option>
          {currencies.map((currency) => (
            <option key={currency}>{currency}</option>
          ))}
        </select>
      </FilterField>
      <FilterField label="Period">
        <select
          value={filters.period}
          onChange={(event) => onChange("period", event.target.value as SpendPeriod)}
          className={FILTER_CONTROL_CLASS}
        >
          <option value="month">Month</option>
          <option value="quarter">Quarter</option>
        </select>
      </FilterField>
    </div>
  );
}

const FILTER_CONTROL_CLASS =
  "mt-1 block rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground";

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

type AnalyticsSummaryProps = {
  realizedSpend: CurrencyTotal[];
  openPipeline: CurrencyTotal[];
  unassignedGroupCount: number;
};

function AnalyticsSummary({
  realizedSpend,
  openPipeline,
  unassignedGroupCount,
}: AnalyticsSummaryProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat
        label="Realized spend"
        value={formatCurrencyTotals(realizedSpend)}
        hint={`${countInvoices(realizedSpend)} paid invoices`}
      />
      <Stat
        label="Open pipeline"
        value={formatCurrencyTotals(openPipeline)}
        hint="Not included in realized spend"
      />
      <Stat
        label="Coverage"
        value={unassignedGroupCount}
        hint="Unassigned groups in this view"
      />
    </div>
  );
}

function DimensionTabs({
  selected,
  onSelect,
}: {
  selected: SpendDimension;
  onSelect: (dimension: SpendDimension) => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {DIMENSIONS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            selected === id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

type SpendBarsProps = {
  buckets: SpendBucket[];
  selectedBucketKey: string;
  onSelect: (bucketKey: string) => void;
};

function SpendBars({ buckets, selectedBucketKey, onSelect }: SpendBarsProps) {
  if (buckets.length === 0) {
    return (
      <EmptyState icon={ChartNoAxesCombined} title="No paid spend in this view">
        Widen the dates or clear the currency filter.
      </EmptyState>
    );
  }

  const largestTotal = Math.max(...buckets.map((bucket) => bucket.total));

  return (
    <div className="space-y-2">
      {buckets.slice(0, 12).map((bucket) => (
        <SpendBar
          key={bucket.key}
          bucket={bucket}
          largestTotal={largestTotal}
          isSelected={selectedBucketKey === bucket.key}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

type SpendBarProps = {
  bucket: SpendBucket;
  largestTotal: number;
  isSelected: boolean;
  onSelect: (bucketKey: string) => void;
};

function SpendBar({ bucket, largestTotal, isSelected, onSelect }: SpendBarProps) {
  const barWidth = `${Math.max(3, (bucket.total / largestTotal) * 100)}%`;

  return (
    <button
      type="button"
      onClick={() => onSelect(bucket.key)}
      className={`group grid w-full grid-cols-[minmax(9rem,1fr)_minmax(8rem,2fr)_auto] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-muted ${
        isSelected ? "bg-muted ring-1 ring-primary/30" : ""
      }`}
    >
      <span className="truncate text-sm font-medium">{bucket.label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-primary/75 transition-all group-hover:bg-primary"
          style={{ width: barWidth }}
        />
      </span>
      <span className="min-w-24 text-right text-sm font-semibold tabular-nums">
        {money(bucket.total, bucket.currency)}
        <span className="block text-[11px] font-normal text-muted-foreground">
          {bucket.count} invoice{bucket.count === 1 ? "" : "s"}
        </span>
      </span>
    </button>
  );
}

type InvoiceDrillDownProps = {
  bucket: SpendBucket;
  invoices: Invoice[];
  onClear: () => void;
};

function InvoiceDrillDown({ bucket, invoices, onClear }: InvoiceDrillDownProps) {
  const invoiceIds = new Set(bucket.invoiceIds);
  const matchingInvoices = invoices.filter((invoice) => invoiceIds.has(invoice.id));

  return (
    <Section>
      <SectionHeader
        title={`${bucket.label} · ${bucket.count} invoices`}
        hint={money(bucket.total, bucket.currency)}
        action={
          <button
            type="button"
            onClick={onClear}
            className="text-sm font-medium text-primary hover:underline"
          >
            Clear selection
          </button>
        }
      />
      <div className="divide-y divide-border">
        {matchingInvoices.map((invoice) => (
          <DrillDownInvoice key={invoice.id} invoice={invoice} />
        ))}
      </div>
    </Section>
  );
}

function DrillDownInvoice({ invoice }: { invoice: Invoice }) {
  const codingSummary = [
    invoice.category || "Uncategorized",
    invoice.department || "No department",
  ].join(" · ");

  return (
    <Link
      to="/invoices/$id"
      params={{ id: invoice.id }}
      className="grid grid-cols-[1fr_auto] gap-4 px-1 py-3 transition hover:bg-muted/50"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{invoice.vendor}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {invoice.invoiceNumber} · {codingSummary} · {shortDate(invoice.issueDate)}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Pill>{invoice.currency || "EUR"}</Pill>
        <span className="w-24 text-right text-sm font-semibold tabular-nums">
          {money(invoice.total, invoice.currency)}
        </span>
      </div>
    </Link>
  );
}
