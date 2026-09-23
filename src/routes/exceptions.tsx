/**
 * Exception queue (Phase Flow Plan §5.1 rule 3, §6).
 *
 * First-class triage screen, not a hidden filter: sync failures, flagged
 * duplicates, and held invoices land here with retry/resolution actions.
 */
import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw, ShieldCheck } from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Shell } from "@/components/ap/shell";
import { EmptyState } from "@/components/ap/primitives";
import { PageHeader } from "@/components/ap/page-header";
import { useAp } from "@/lib/ap/store";
import { money, shortDate, type Invoice } from "@/lib/ap/types";
import { attemptSync, latestSyncByInvoice, type SyncEvent } from "@/lib/ap/erp-sync";

export const Route = createFileRoute("/exceptions")({
  head: () => ({
    meta: [
      { title: "Exceptions — Foundry" },
      {
        name: "description",
        content:
          "Failed syncs, held invoices, and invoices without a purchase order — each with a next action.",
      },
    ],
  }),
  component: ExceptionQueue,
});

type ExceptionKind = "sync_failed" | "held" | "no_po";

type ExceptionItem = {
  kind: ExceptionKind;
  invoice: Invoice;
  detail: string;
  syncEvent?: SyncEvent | undefined;
};

const KIND_LABEL: Record<ExceptionKind, string> = {
  sync_failed: "Sync failed",
  held: "Invoice held",
  no_po: "No PO linked",
};

function ExceptionQueue() {
  const { invoices, history } = useAp();

  const items = useMemo<ExceptionItem[]>(() => {
    const syncMap = latestSyncByInvoice();
    const out: ExceptionItem[] = [];
    for (const inv of [...invoices, ...history]) {
      const ev = syncMap[inv.id];
      if (ev?.status === "failed") {
        out.push({
          kind: "sync_failed",
          invoice: inv,
          detail:
            ev.error ?? "The sync failed without a reason — retry it, then report the problem.",
          syncEvent: ev,
        });
      } else if (inv.memo.includes("held:")) {
        out.push({
          kind: "held",
          invoice: inv,
          detail: inv.memo.split("held:")[1]?.trim() ?? "Held",
        });
      } else if (inv.status === "review" && !inv.poId && inv.lineItems.length > 0) {
        out.push({
          kind: "no_po",
          invoice: inv,
          detail: "Approved-for-review invoice has no linked purchase order.",
        });
      }
    }
    const kindOrder: Record<ExceptionKind, number> = { sync_failed: 0, held: 1, no_po: 2 };
    return out.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind]);
  }, [invoices, history]);

  const retrySync = (item: ExceptionItem) => {
    const event = attemptSync(item.invoice, item.syncEvent?.kind ?? "bill");
    if (event.status === "synced") {
      toast.success(
        `${item.invoice.vendor}: local sync simulation completed — no ERP record was created`,
      );
    } else {
      toast.error(`${item.invoice.vendor}: ${event.error}`);
    }
  };

  const counts = {
    sync_failed: items.filter((i) => i.kind === "sync_failed").length,
    held: items.filter((i) => i.kind === "held").length,
    no_po: items.filter((i) => i.kind === "no_po").length,
  };

  return (
    <Shell>
      <PageHeader
        icon={AlertTriangle}
        title="Exceptions"
        // The header states what the screen is for; what is in it right now is
        // the list's own business (the kind badges carry the counts). Saying
        // "nothing needs your judgment" here *and* in the empty state below was
        // one sentence twice on the same screen.
        subtitle="Failed syncs, held invoices and invoices without a purchase order — each with its next action."
        actions={
          items.length > 0 && (
            <div className="flex gap-2 text-xs">
              {counts.sync_failed > 0 && (
                <span className="rounded-full bg-destructive px-4 py-2 font-medium text-white">
                  Sync errors ({counts.sync_failed})
                </span>
              )}
              {counts.held > 0 && (
                <span className="rounded-full bg-[oklch(0.48_0.12_70)] px-4 py-2 font-medium text-white">
                  Held ({counts.held})
                </span>
              )}
              {counts.no_po > 0 && (
                <span className="rounded-full bg-sidebar px-4 py-2 font-medium text-white">
                  No PO ({counts.no_po})
                </span>
              )}
            </div>
          )
        }
      />

      {items.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nothing needs your judgment." className="mt-5">
          The pipeline is clean. Failed syncs and held invoices will appear here with a next action.
        </EmptyState>
      ) : (
        <div className="mt-5 overflow-hidden rounded-lg border border-border bg-card">
          <div className="divide-y divide-border">
            {items.map((item) => (
              <div
                key={`${item.kind}-${item.invoice.id}`}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <AlertTriangle
                  className={`size-4 shrink-0 ${item.kind === "sync_failed" ? "text-destructive" : "text-warning-foreground"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium tracking-tight">
                    {item.invoice.vendor}{" "}
                    <span className="ml-1 font-mono text-xs text-muted-foreground">
                      {item.invoice.invoiceNumber || "—"}
                    </span>
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 align-middle text-xs font-medium text-muted-foreground">
                      {KIND_LABEL[item.kind]}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                </div>
                <p className="font-mono text-sm tabular-nums">
                  {money(item.invoice.total, item.invoice.currency)}
                </p>
                <p className="hidden text-xs text-muted-foreground sm:block">
                  {shortDate(item.invoice.dueDate)}
                </p>
                {item.kind === "sync_failed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => retrySync(item)}
                  >
                    <RefreshCw className="size-3.5" /> Retry sync
                  </Button>
                )}
                <Link
                  to="/invoices/$id"
                  params={{ id: item.invoice.id }}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Open
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}
