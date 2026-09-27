/**
 * Exception queue (Phase Flow Plan §5.1 rule 3, §6).
 *
 * First-class triage screen, not a hidden filter: sync failures, flagged
 * duplicates, and held invoices land here with retry/resolution actions —
 * and so do invoices that depart from what their vendor normally sends, each
 * with the numbers behind the flag.
 */
import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw, ShieldCheck } from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Shell } from "@/components/ap/shell";
import { EmptyState } from "@/components/ap/primitives";
import { PageHeader } from "@/components/ap/page-header";
import { useAp } from "@/lib/app/store";
import { money, shortDate, type Invoice } from "@/lib/ap/types";
import { attemptSync, latestSyncByInvoice, type SyncEvent } from "@/lib/ap/erp-sync";
import { attentionForInvoice, type InvoiceAttention } from "@/lib/ap/attention";
import {
  scanVendorAnomalies,
  ANOMALY_SEVERITY_ORDER,
  type AnomalySeverity,
} from "@/lib/ap/anomalies";
import { matchNoPoInvoice } from "@/lib/ap/flex-matching";

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

type ExceptionItem = {
  key: string;
  invoice: Invoice;
  /** The attention kind, or the anomaly kind that produced the row. */
  kind: string;
  severity: AnomalySeverity;
  label: string;
  detail: string;
  /** Present only when the row is a retryable ERP sync failure. */
  syncEvent?: SyncEvent | undefined;
};

/** Technical failures first: they are the ones with a button to push. */
const EXCEPTION_RANK: Record<string, number> = { sync_failed: 0, held: 1, no_po: 2 };

const ATTENTION_SEVERITY: Record<InvoiceAttention["kind"], AnomalySeverity> = {
  sync_failed: "high",
  held: "warn",
  no_po: "warn",
};

function ExceptionQueue() {
  const { invoices, history, removed, vendorProfiles, flexRules, flexContracts, flexReceipts } =
    useAp();

  const items = useMemo<ExceptionItem[]>(() => {
    const syncMap = latestSyncByInvoice();
    const out: ExceptionItem[] = [];
    for (const inv of [...invoices, ...history]) {
      const attention = attentionForInvoice(
        inv,
        syncMap[inv.id],
        matchNoPoInvoice(inv, {
          contracts: flexContracts,
          receipts: flexReceipts,
          rules: flexRules,
        }),
      );
      if (attention) {
        out.push({
          key: `${attention.kind}-${inv.id}`,
          invoice: inv,
          kind: attention.kind,
          severity: ATTENTION_SEVERITY[attention.kind],
          label: attention.label,
          detail: attention.detail,
          syncEvent: attention.syncEvent,
        });
      }
    }
    // Anomalies are measured against every record on file — completed and
    // removed invoices still teach the vendor's habits — but only the open
    // ones are worth somebody's time today.
    for (const finding of scanVendorAnomalies(
      invoices,
      [...invoices, ...history, ...removed],
      vendorProfiles,
    )) {
      const invoice = invoices.find((candidate) => candidate.id === finding.invoiceId);
      if (!invoice) continue;
      out.push({
        key: `anomaly-${finding.kind}-${invoice.id}`,
        invoice,
        kind: finding.kind,
        severity: finding.severity,
        label: finding.label,
        detail: finding.detail,
      });
    }
    return out.sort(
      (a, b) =>
        (EXCEPTION_RANK[a.kind] ?? 3) - (EXCEPTION_RANK[b.kind] ?? 3) ||
        ANOMALY_SEVERITY_ORDER[a.severity] - ANOMALY_SEVERITY_ORDER[b.severity],
    );
  }, [invoices, history, removed, vendorProfiles, flexContracts, flexReceipts, flexRules]);

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
    anomalies: items.filter((i) => EXCEPTION_RANK[i.kind] === undefined).length,
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
        subtitle="Failed syncs, held invoices, invoices without a purchase order, and invoices that depart from their vendor's normal pattern."
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
              {counts.anomalies > 0 && (
                <span className="rounded-full bg-sidebar px-4 py-2 font-medium text-white">
                  Vendor pattern ({counts.anomalies})
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
        <div className="mt-5 overflow-hidden rounded-lg bg-card shadow-whisper">
          <div className="divide-y divide-border">
            {items.map((item) => (
              <div key={item.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <AlertTriangle
                  className={`size-4 shrink-0 ${
                    item.severity === "high"
                      ? "text-destructive"
                      : item.severity === "warn"
                        ? "text-warning-foreground"
                        : "text-muted-foreground"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium tracking-tight">
                    {item.invoice.vendor}{" "}
                    <span className="ml-1 font-mono text-xs text-muted-foreground">
                      {item.invoice.invoiceNumber || "—"}
                    </span>
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 align-middle text-xs font-medium text-muted-foreground">
                      {item.label}
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
