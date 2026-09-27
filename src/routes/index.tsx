import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowUpRight,
  Inbox as InboxIcon,
  Loader2,
  Search,
  Undo2,
} from "@/components/icons";
import { PageHeader } from "@/components/ap/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shell } from "@/components/ap/shell";
import { InfoBanner, Pill, Section } from "@/components/ap/primitives";
import { StatusBadge } from "@/components/ap/status";
import { TagBadge } from "@/components/ap/tag-badge";
import { VendorLogo } from "@/components/ap/vendor-profile";
import { useAp } from "@/lib/app/store";
import {
  PHASE_BY_STATUS,
  PHASE_LABEL,
  PHASE_ORDER,
  PHASE_STATUSES,
  money,
  shortDate,
  type Invoice,
  type Phase,
} from "@/lib/ap/types";
import { TRANSITION_LABEL } from "@/lib/ap/state-machine";
import { operatorActorWithRole } from "@/lib/ap/operator";
import { countOf } from "@/lib/ap/vocabulary";
import { attentionForInvoice } from "@/lib/ap/attention";
import { standingFor } from "@/lib/ap/standing";
import { matchNoPoInvoice } from "@/lib/ap/flex-matching";
import { latestSyncByInvoice } from "@/lib/ap/erp-sync";
import { UploadDialog } from "@/components/ap/upload-dialog";
import { StandingSummary } from "@/components/ap/standing-summary";
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

type Filter = Phase | "removed";

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

/** The name a tab shows. Phases have fixed names; Removed is its own list. */
function filterLabel(filter: Filter): string {
  return filter === "removed" ? "Removed" : PHASE_LABEL[filter];
}

/** The subtitle explains the queue's role, not the currently selected filter. */
const WORK_QUEUE_DESCRIPTION = "Manage all your accounts payable here.";

function Inbox() {
  const {
    invoices,
    history,
    removed,
    restoreInvoice,
    isFirstRun,
    hasSampleData,
    clearSampleData,
    flexRules,
    flexContracts,
    flexReceipts,
    businessProfile,
  } = useAp();
  const [filter, setFilter] = useState<Filter>("draft");
  const [query, setQuery] = useState("");

  /**
   * Every record lands in exactly one phase, so the tab counts always add up to
   * the queue plus the completed list — nothing is counted twice, and nothing
   * counted here is missing from the list it counts.
   */
  const counts = useMemo(() => {
    const map = {
      profiling: 0,
      draft: 0,
      approval: 0,
      payment: 0,
      history: history.length,
      removed: removed.length,
    } as Record<Filter, number>;
    for (const i of invoices) map[PHASE_BY_STATUS[i.status]] += 1;
    return map;
  }, [invoices, history, removed]);

  /**
   * The five phases always render — they are the inbox's structure, not a
   * population-dependent offer. Profiling is first so a first-time vendor has
   * an explicit place to land. Removed stays conditional: it is the way back
   * from a removal, and a tab that could only show an empty list is noise.
   */
  const filters = useMemo(() => [...PHASE_ORDER], []);

  /** The filter in view: a tab that loses its last row hands the view back to
   *  the first that still has one, so a stale selection can't show nothing. */
  const active = (filter !== "removed" && filters.includes(filter)
    ? filter
    : (filters[0] ?? "profiling")) as Filter;

  const attentionByInvoice = useMemo(() => {
    const syncMap = latestSyncByInvoice();
    return new Map(
      invoices.map((invoice) => [
        invoice.id,
        attentionForInvoice(
          invoice,
          syncMap[invoice.id],
          matchNoPoInvoice(invoice, {
            contracts: flexContracts,
            receipts: flexReceipts,
            rules: flexRules,
          }),
        ),
      ]),
    );
  }, [invoices, flexContracts, flexReceipts, flexRules]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchesQuery = (i: (typeof invoices)[number]) =>
      !q ||
      i.vendor.toLowerCase().includes(q) ||
      i.invoiceNumber.toLowerCase().includes(q) ||
      i.department.toLowerCase().includes(q);
    const byRecency = (a: (typeof invoices)[number], b: (typeof invoices)[number]) =>
      new Date(b.issueDate || b.createdAt).getTime() -
      new Date(a.issueDate || a.createdAt).getTime();

    if (active === "removed") {
      return removed.filter(matchesQuery).sort((a, b) => removedAt(b) - removedAt(a));
    }
    if (active === "history") {
      // The completed list plus any settled record still in the queue: a paid or
      // removed invoice must never end up on no tab at all.
      return [...invoices.filter((i) => PHASE_BY_STATUS[i.status] === "history"), ...history]
        .filter(matchesQuery)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    const phaseRows = invoices.filter((i) => PHASE_BY_STATUS[i.status] === active);

    return phaseRows.filter(matchesQuery).sort((a, b) => {
      // The draft tab leads with the costliest wait (a broken read, then a
      // draft, then a rejection to reopen) and trails with `processing`, which
      // the machine still holds. Profiling is its own phase for first-time
      // vendors. Approval and payment are read newest first.
      if (active === "draft") {
        const rank = PHASE_STATUSES.draft;
        return rank.indexOf(a.status) - rank.indexOf(b.status) || byRecency(a, b);
      }
      return byRecency(a, b);
    });
  }, [invoices, history, removed, active, query]);

  const standing = useMemo(
    () => standingFor(invoices, attentionByInvoice),
    [invoices, attentionByInvoice],
  );

  /** Puts a removed record back where it was — the same move the toast offers,
   *  so a removal can be walked back long after the toast has faded. */
  const restore = (id: string, vendor: string) => {
    const result = restoreInvoice(id, operatorActorWithRole("processor", businessProfile));
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
      <PageHeader icon={InboxIcon} title="Invoice inbox" />

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

          {/* The answer to the question the inbox is opened with, before the
              queue: what is left, how much of it is mine, what is stuck. Pulled,
              never pushed — nothing here arrives on its own. */}
          <StandingSummary standing={standing} />

          <Section>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 p-4">
              <div>
                {/* The subtitle explains the queue's role and stays stable while
                    the reader moves between phase tabs. */}
                <p className="text-nav-title font-semibold">
                  {active === "removed"
                    ? "Removed"
                    : active === "history"
                      ? "History"
                      : "Work queue"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{WORK_QUEUE_DESCRIPTION}</p>
              </div>
              {filters.length > 1 ? (
                <div className="flex flex-wrap items-center gap-1">
                  {filters.map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`rounded-md px-4 py-2 text-xs font-medium transition-colors ${
                        active === f
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      }`}
                    >
                      {filterLabel(f)}
                      {counts[f] > 0 ? (
                        <span className="ml-1.5 font-mono opacity-60">{counts[f]}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search vendor, number, team"
                    className="h-9 bg-secondary/50 pl-8 text-sm"
                  />
                </div>
                {/* The narrow shell keeps its own upload trigger, so only show this
                    adjacent copy where the shell's trigger is hidden. */}
                <div className="hidden md:block">
                  <UploadDialog size="sm" />
                </div>
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
                        className={`group border-b border-border/50 last:border-0 transition-colors hover:bg-primary/5 ${
                          attentionByInvoice.get(inv.id) ? "bg-warning/5" : ""
                        }`}
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
                            {attentionByInvoice.get(inv.id) ? (
                              <Pill variant="warning" className="gap-1">
                                <AlertTriangle className="size-3" />
                                {attentionByInvoice.get(inv.id)?.label}
                              </Pill>
                            ) : null}
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
                        ) : active === "draft" ? (
                          <p className="text-sm font-medium">Nothing is waiting to be prepared.</p>
                        ) : active === "approval" ? (
                          <p className="text-sm font-medium">Nothing is waiting for approval.</p>
                        ) : active === "payment" ? (
                          <p className="text-sm font-medium">Nothing is waiting for payment.</p>
                        ) : active === "history" ? (
                          <p className="text-sm font-medium">Nothing has been completed yet.</p>
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
