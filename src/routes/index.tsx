import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Download,
  Inbox as InboxIcon,
  Loader2,
  Search,
  Undo2,
} from "@/components/icons";
import { PageHeader } from "@/components/ap/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shell } from "@/components/ap/shell";
import { InfoBanner, Pill, Section, Stat } from "@/components/ap/primitives";
import { StatusBadge } from "@/components/ap/status";
import { TagBadge } from "@/components/ap/tag-badge";
import { VendorLogo } from "@/components/ap/vendor-profile";
import { useAp } from "@/lib/ap/store";
import {
  AWAITING_PERSON,
  BUCKET_BY_STATUS,
  IN_FLIGHT,
  LATER,
  money,
  shortDate,
  type Bucket,
  type Invoice,
  type InvoiceStatus,
} from "@/lib/ap/types";
import { TRANSITION_LABEL, type Actor } from "@/lib/ap/state-machine";
import { moneyLine, totalsByCurrency } from "@/lib/ap/analytics";
import { isLate } from "@/lib/ap/auto-tags";
import {
  approvedForHandoff,
  bookkeepingCsv,
  downloadCsv,
  exportableForHandoff,
  invoicesMissingPaymentRoute,
} from "@/lib/ap/csv-export";
import { countOf } from "@/lib/ap/vocabulary";
import { UploadDialog } from "@/components/ap/upload-dialog";
import { FirstRun } from "@/components/ap/first-run";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Invoice inbox — Foundry" },
      {
        name: "description",
        content:
          "Capture invoices locally, confirm the data, approve the record, and prepare it for external handoff.",
      },
      { property: "og:title", content: "Invoice inbox — Foundry" },
      {
        property: "og:description",
        content:
          "Capture invoices locally, confirm the data, approve the record, and prepare it for external handoff.",
      },
    ],
  }),
  component: Inbox,
});

type Filter = Bucket | "history" | "removed";

/** Money as one line per currency: the band never adds euros to dollars, and
 *  never labels a euro total with a dollar sign. */
const sumOf = (invoices: Invoice[]) => moneyLine(totalsByCurrency(invoices));

/** When a record left the queue: the entry the removal itself wrote. */
function removalEntry(invoice: Invoice) {
  return [...invoice.audit].reverse().find((e) => e.action === TRANSITION_LABEL.archive);
}

function removedAt(invoice: Invoice): number {
  return new Date(removalEntry(invoice)?.at ?? invoice.createdAt).getTime();
}

/**
 * Why and by whom a record left the queue. The Removed list exists so a removal
 * can be walked back, and the note the removal wrote is the part that makes the
 * decision reviewable — a row of amounts with no reason would be a worse version
 * of the problem the flag already had.
 */
function removalLine(invoice: Invoice): string {
  const entry = removalEntry(invoice);
  const why = entry?.note?.replace(/\.$/, "");
  return why ? `${why} · ${entry?.actor}` : `Removed by ${entry?.actor ?? "unknown"}`;
}

/** The name a tab shows. Buckets have fixed names; history/removed are their own lists. */
function filterLabel(filter: Filter): string {
  if (filter === "needsYou") return "Needs you";
  if (filter === "inFlight") return "In flight";
  if (filter === "later") return "Later";
  if (filter === "history") return "History";
  if (filter === "removed") return "Removed";
  return filter;
}

function Inbox() {
  const {
    invoices,
    history,
    removed,
    purchaseOrders,
    vendors,
    operator,
    restoreInvoice,
    isFirstRun,
    hasSampleData,
    clearSampleData,
  } = useAp();
  const [filter, setFilter] = useState<Filter>("needsYou");
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const counts = useMemo(() => {
    const map = {
      needsYou: 0,
      inFlight: 0,
      later: 0,
      history: history.length,
      removed: removed.length,
    } as Record<Filter, number>;
    for (const i of invoices) map[BUCKET_BY_STATUS[i.status]] += 1;
    return map;
  }, [invoices, history, removed]);

  /**
   * The three buckets always render — they are the inbox's structure, not a
   * population-dependent offer. History and Removed stay conditional: a tab
   * that could only show an empty list is noise.
   */
  const filters = useMemo(() => {
    const tabs: Filter[] = ["needsYou", "inFlight", "later"];
    if (counts.history > 0) tabs.push("history");
    if (counts.removed > 0) tabs.push("removed");
    return tabs;
  }, [counts]);

  /** The filter in view: a tab that loses its last row hands the view back to
   *  the first that still has one, so a stale selection can't show nothing. */
  const active = filters.includes(filter) ? filter : (filters[0] ?? "needsYou");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchesQuery = (i: (typeof invoices)[number]) =>
      !q ||
      i.vendor.toLowerCase().includes(q) ||
      i.invoiceNumber.toLowerCase().includes(q) ||
      i.department.toLowerCase().includes(q);
    if (active === "history") {
      return history
        .filter(matchesQuery)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    if (active === "removed") {
      return removed.filter(matchesQuery).sort((a, b) => removedAt(b) - removedAt(a));
    }
    // Needs you leads with the costliest wait (failed, then approval, then the
    // two draft stages). In flight sorts newest first — the spinner rows are the
    // youngest. Later ranks scheduled → rejected → paid → archived, then newest.
    const needsYouOrder: Partial<Record<InvoiceStatus, number>> = {
      failed: 0,
      review: 1,
      vendor_profile: 2,
      draft: 3,
    };
    const laterOrder: Partial<Record<InvoiceStatus, number>> = {
      scheduled: 0,
      rejected: 1,
      paid: 2,
      archived: 3,
    };
    const byRecency = (a: (typeof invoices)[number], b: (typeof invoices)[number]) =>
      new Date(b.issueDate || b.createdAt).getTime() -
      new Date(a.issueDate || a.createdAt).getTime();

    const bucketRows = invoices.filter((i) => {
      const bucket = BUCKET_BY_STATUS[i.status];
      return (
        (active === "needsYou" && bucket === "needsYou") ||
        (active === "inFlight" && bucket === "inFlight") ||
        (active === "later" && bucket === "later")
      );
    });

    return bucketRows.filter(matchesQuery).sort((a, b) => {
      if (active === "needsYou")
        return (needsYouOrder[a.status] ?? 99) - (needsYouOrder[b.status] ?? 99);
      if (active === "later") return (laterOrder[a.status] ?? 99) - (laterOrder[b.status] ?? 99);
      return byRecency(a, b); // inFlight
    });
  }, [invoices, history, removed, active, query]);

  const totals = useMemo(
    () => ({
      open: invoices.filter((i) => i.status !== "rejected"),
      // Of the money still on the table, what is already late — the one figure
      // the band was missing. Same `isLate` the row tags wear, so the tile and
      // the tag cannot disagree about what late means.
      overdue: invoices.filter((i) => isLate(i)),
      approved: invoices.filter((i) => i.status === "scheduled"),
      completed: history,
      // The manual gate, in full: every stage the machine cannot move itself.
      needsYou: invoices.filter((i) => AWAITING_PERSON.includes(i.status)).length,
      inFlight: invoices.filter((i) => IN_FLIGHT.includes(i.status)).length,
      later: invoices.filter((i) => LATER.includes(i.status)).length,
    }),
    [invoices, history],
  );

  /** Approved and captured — the set the handoff is measured by. */
  const approved = useMemo(() => approvedForHandoff(invoices), [invoices]);
  /** The same set, minus anything with no IBAN to pay: exactly the file's rows. */
  const exportable = useMemo(() => exportableForHandoff(invoices, vendors), [invoices, vendors]);
  /** Approved rows held back for want of a payment route. Never dropped quietly. */
  const missingRoute = useMemo(
    () => invoicesMissingPaymentRoute(invoices, vendors),
    [invoices, vendors],
  );

  /** One file out, nothing sent: the handoff is the file itself. An approved
   *  invoice with no IBAN on the document or the vendor profile stays out of it
   *  — the toast names the vendor and opens the one field that fixes it, because
   *  a row that quietly misses the file is an invoice nobody pays. */
  const exportHandoff = () => {
    if (approved.length === 0) return;
    const blocked = missingRoute.map((invoice) => `${invoice.vendor} (${invoice.invoiceNumber})`);
    const many = blocked.length !== 1;
    const openVendors = { label: "Open vendors", onClick: () => navigate({ to: "/vendors" }) };
    if (exportable.length === 0) {
      toast.error(
        `Nothing exported — ${countOf(blocked.length, "invoice")} ${many ? "have" : "has"} no payment route`,
        {
          description: `${blocked.join(", ")} — add the vendor's IBAN, then export again. No file was written; Foundry sent nothing.`,
          action: openVendors,
        },
      );
      return;
    }
    downloadCsv(
      `foundry-approved-invoices-${new Date().toISOString().slice(0, 10)}.csv`,
      bookkeepingCsv(invoices, purchaseOrders, vendors),
    );
    if (blocked.length > 0) {
      toast.error(
        `Exported ${countOf(exportable.length, "invoice")} — ${countOf(blocked.length, "invoice")} left out`,
        {
          description: `${blocked.join(", ")} ${many ? "have" : "has"} no IBAN on the invoice or the vendor profile, so ${many ? "they" : "it"} did not reach the file.`,
          action: openVendors,
        },
      );
      return;
    }
    toast.success(`Exported ${countOf(exportable.length, "invoice")} for handoff`, {
      description: "A CSV for your bookkeeping import — Foundry sent nothing.",
    });
  };

  /** Puts a removed record back where it was — the same move the toast offers,
   *  so a removal can be walked back long after the toast has faded. */
  const restore = (id: string, vendor: string) => {
    const result = restoreInvoice(id, operator);
    if (!result.accepted) {
      toast.error(result.reason ?? "Couldn't put that record back.", {
        description: "Nothing changed — Removed still holds it.",
      });
      return;
    }
    toast.success(`${vendor} is back in the queue`);
  };

  return (
    <Shell>
      <PageHeader
        icon={InboxIcon}
        title="Invoice inbox"
        actions={
          // On the first run the empty state owns the one action there is;
          // two upload buttons on one screen is one too many.
          isFirstRun ? null : (
            <div className="hidden md:block">
              <UploadDialog />
            </div>
          )
        }
      />

      {isFirstRun ? (
        <div className="mt-6">
          <FirstRun />
        </div>
      ) : (
        <>
          {hasSampleData && (
            <InfoBanner className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p>
                  These are sample records, not invoices you captured — the amounts are demo values.
                </p>
                <Button variant="outline" size="sm" onClick={clearSampleData}>
                  Remove sample data
                </Button>
              </div>
            </InfoBanner>
          )}

          <div
            className={`mt-6 grid grid-cols-2 gap-3 sm:gap-4 ${
              totals.overdue.length > 0 ? "lg:grid-cols-5" : "lg:grid-cols-4"
            }`}
          >
            <Stat
              label="Open payables"
              value={sumOf(totals.open)}
              hint={countOf(totals.open.length, "invoice")}
            />
            {/* Only when something is late: "not late" is the absence of a
                problem, and a tile reading "—" is not news anyone acts on. */}
            {totals.overdue.length > 0 ? (
              <Stat
                label="Overdue"
                value={sumOf(totals.overdue)}
                hint={`${countOf(totals.overdue.length, "invoice")} past the due date`}
              />
            ) : null}
            <Stat
              label="Needs your judgment"
              value={String(totals.needsYou)}
              hint="waiting on you, not the system"
              accent
            />
            <Stat
              label="Approved"
              value={sumOf(totals.approved)}
              // "Ready for handoff" is a claim; when a row cannot leave yet, the
              // tile has to stop making it.
              hint={
                missingRoute.length > 0
                  ? `${countOf(missingRoute.length, "invoice")} missing a payment route`
                  : "ready for external handoff"
              }
              action={
                approved.length > 0 ? (
                  <Button variant="outline" size="sm" className="w-full" onClick={exportHandoff}>
                    <Download className="size-3.5" />
                    Export CSV
                  </Button>
                ) : undefined
              }
            />
            <Stat
              label="Completed"
              value={sumOf(totals.completed)}
              hint="in history"
              className={totals.overdue.length > 0 ? "col-span-2 lg:col-span-1" : undefined}
            />
          </div>

          <Section className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 p-4">
              <div>
                {/* The heading names the list in view. When only Removed holds
                    rows the tab strip is hidden (one tab offers no choice), so
                    "Work queue" was the only label a reader had — over records
                    that are not in the queue at all. */}
                <p className="text-xl font-semibold tracking-tight">
                  {active === "removed"
                    ? "Removed"
                    : active === "history"
                      ? "History"
                      : "Work queue"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {active === "removed"
                    ? `${countOf(removed.length, "invoice")} ${removed.length === 1 ? "waits" : "wait"} here — put any back with Restore.`
                    : active === "history"
                      ? "Completed invoices are archived here."
                      : active === "inFlight"
                        ? `${countOf(totals.inFlight, "invoice")} ${totals.inFlight === 1 ? "is" : "are"} processing.`
                        : active === "later"
                          ? `${countOf(totals.later, "invoice")} waiting for handoff or done.`
                          : totals.needsYou > 0
                            ? `${countOf(totals.needsYou, "invoice")} ${totals.needsYou === 1 ? "needs" : "need"} your judgment.`
                            : "Nothing needs your judgment right now."}
                </p>
              </div>
              {filters.length > 1 ? (
                <div className="flex w-full max-w-full snap-x items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-lg bg-secondary/75 p-1 sm:w-auto sm:overflow-visible">
                  {filters.map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`shrink-0 snap-start whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-[background-color,color,box-shadow,transform] duration-200 ease-out-expo active:scale-[0.98] ${
                        active === f
                          ? "bg-card text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                          : "text-muted-foreground hover:bg-card/55 hover:text-foreground"
                      }`}
                    >
                      {filterLabel(f)}
                      {counts[f] > 0 ? (
                        <span className="ml-1.5 rounded-full bg-background/70 px-1.5 py-0.5 font-mono text-[10px] opacity-65">
                          {counts[f]}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="relative ml-auto w-full sm:w-64">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search vendor, number, team"
                  className="h-9 rounded-full bg-muted pl-8 text-sm hover:bg-accent-soft"
                />
              </div>
            </div>

            {/* The card clips (overflow-hidden), so without this scroller the
                last columns — Stage and every action — are cut off below the
                card's width instead of reachable: Restore existed but was
                off-screen at window widths a phone or side panel uses. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-border/50 text-left text-xs font-medium tracking-tight text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Vendor</th>
                    <th className="px-4 py-3 font-medium">Invoice</th>
                    <th className="px-4 py-3 font-medium">Team</th>
                    <th className="px-4 py-3 font-medium">Due</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Tags</th>
                    <th className="px-4 py-3 font-medium">Stage</th>
                    <th className="sticky right-0 z-10 bg-card px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((inv) =>
                    inv.status === "processing" || inv.status === "failed" ? (
                      <tr
                        key={inv.id}
                        className="border-b border-border/70 last:border-0 bg-secondary/20"
                      >
                        <td className="px-4 py-4">
                          <Link
                            to="/invoices/$id"
                            params={{ id: inv.id }}
                            aria-label={`Open ${inv.fileName ?? "invoice"}`}
                            className="block rounded-sm hover:underline"
                          >
                            <p className="text-sm font-medium tracking-tight">
                              {inv.status === "failed"
                                ? "Invoice needs attention"
                                : "Preparing invoice"}
                            </p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {inv.fileName ?? "invoice"}
                            </p>
                          </Link>
                        </td>
                        <td className="px-4 py-4 font-mono text-xs text-muted-foreground">—</td>
                        <td className="px-4 py-4 text-xs text-muted-foreground">—</td>
                        <td className="px-4 py-4 text-xs text-muted-foreground">—</td>
                        <td className="px-4 py-4 text-right font-mono text-muted-foreground">—</td>
                        <td className="px-4 py-4">
                          <span className="text-xs text-muted-foreground">—</span>
                        </td>
                        <td className="px-4 py-4">
                          {inv.status === "failed" ? (
                            <StatusBadge status="failed" />
                          ) : (
                            <Link
                              to="/invoices/$id"
                              params={{ id: inv.id }}
                              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                            >
                              <Loader2 className="size-3 animate-spin" />
                              Preparing
                            </Link>
                          )}
                        </td>
                        <td className="sticky right-0 z-10 bg-card px-4 py-4 text-right">
                          <Link
                            to="/invoices/$id"
                            params={{ id: inv.id }}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {inv.status === "failed" ? "View details" : "Preparing"}{" "}
                            <ArrowUpRight className="size-3" />
                          </Link>
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={inv.id}
                        className="group border-b border-border/50 last:border-0 transition-colors hover:bg-primary/5"
                      >
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2.5">
                            <VendorLogo vendor={inv.vendor} className="size-10 text-xs" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                {/* A removed record has no detail screen left to
                              open — its trail is the row itself, so the name is
                              plain text rather than a link into a dead end. */}
                                {active === "removed" ? (
                                  <span className="font-medium tracking-tight">{inv.vendor}</span>
                                ) : (
                                  <Link
                                    to="/invoices/$id"
                                    params={{ id: inv.id }}
                                    className="font-medium tracking-tight hover:underline"
                                  >
                                    {inv.vendor}
                                  </Link>
                                )}
                                {/* Demo records are labelled where they sit: a row of
                              sample data must never read as a payable. */}
                                {inv.source === "sample" && <Pill variant="outline">Sample</Pill>}
                              </div>
                              <p className="truncate text-xs text-muted-foreground">
                                {active === "removed" ? removalLine(inv) : inv.memo || "No memo"}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 font-mono text-xs">{inv.invoiceNumber || "—"}</td>
                        <td className="px-4 py-4 text-xs text-muted-foreground">
                          {inv.department}
                        </td>
                        <td className="px-4 py-4 text-xs">{shortDate(inv.dueDate)}</td>
                        <td className="px-4 py-4 text-right font-mono">
                          {money(inv.total, inv.currency)}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-1">
                            {inv.tags.length > 0 ? (
                              inv.tags.map((t) => <TagBadge key={t} tag={t} />)
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge status={inv.status} />
                        </td>
                        <td className="sticky right-0 z-10 bg-card px-4 py-4 text-right group-hover:bg-primary/5">
                          {active === "removed" ? (
                            <button
                              type="button"
                              onClick={() => restore(inv.id, inv.vendor)}
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              <Undo2 className="size-3" /> Restore
                            </button>
                          ) : active === "history" ? (
                            <Link
                              to="/history"
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              Archive <ArrowUpRight className="size-3" />
                            </Link>
                          ) : (
                            <Link
                              to="/invoices/$id"
                              params={{ id: inv.id }}
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              Open <ArrowUpRight className="size-3" />
                            </Link>
                          )}
                        </td>
                      </tr>
                    ),
                  )}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center">
                        {/* A search that matched nothing and an empty bucket are
                            different facts — only the first gets the search copy;
                            an empty queue on the default tab is the calm all-clear. */}
                        {query.trim() ? (
                          <>
                            <p className="text-sm font-medium">No record matches your search.</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Clear the search to see the whole list.
                            </p>
                          </>
                        ) : active === "needsYou" ? (
                          <p className="text-sm font-medium">
                            Nothing needs your judgment right now.
                          </p>
                        ) : active === "inFlight" ? (
                          <p className="text-sm font-medium">Nothing is processing right now.</p>
                        ) : active === "later" ? (
                          <p className="text-sm font-medium">Nothing is waiting for later.</p>
                        ) : (
                          <p className="text-sm font-medium">No record matches your search.</p>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </Shell>
  );
}

/** Shimmer placeholder for in-flight invoice rows. */
function SkeletonLine({ className }: { className?: string }) {
  return (
    <span className={`inline-block h-3 animate-pulse rounded-md bg-muted ${className ?? "w-24"}`} />
  );
}
