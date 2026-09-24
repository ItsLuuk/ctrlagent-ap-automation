import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, History } from "@/components/icons";
import { PageHeader } from "@/components/ap/page-header";
import { Shell } from "@/components/ap/shell";
import { StatusBadge } from "@/components/ap/status";
import { useAp } from "@/lib/ap/store";
import { money, shortDate } from "@/lib/ap/types";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History — Foundry" },
      {
        name: "description",
        content: "Completed invoices archived from the working queue.",
      },
      { property: "og:title", content: "History — Foundry" },
      {
        property: "og:description",
        content: "Completed invoices archived from the working queue.",
      },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const { history } = useAp();
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
          icon={History}
          title="History"
          subtitle="Completed invoices leave the queue and are archived here."
        />
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs  text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Vendor</th>
              <th className="px-4 py-2.5 font-medium">Invoice</th>
              <th className="px-4 py-2.5 font-medium">Issue date</th>
              <th className="px-4 py-2.5 font-medium">Completed</th>
              <th className="px-4 py-2.5 text-right font-medium">Amount</th>
              <th className="px-4 py-2.5 font-medium">Stage</th>
            </tr>
          </thead>
          <tbody>
            {history.map((inv) => {
              const completedAt =
                [...inv.audit]
                  .reverse()
                  .find((a) =>
                    ["Approved", "Exported", "Synced to ERP", "Historical completion"].some(
                      (action) => a.action.includes(action),
                    ),
                  )?.at ?? inv.createdAt;
              return (
                <tr
                  key={inv.id}
                  className="border-b border-border/70 last:border-0 hover:bg-secondary/50"
                >
                  <td className="px-4 py-4 font-medium tracking-tight">{inv.vendor}</td>
                  <td className="px-4 py-4 font-mono text-xs">{inv.invoiceNumber || "—"}</td>
                  <td className="px-4 py-4 text-xs">{shortDate(inv.issueDate)}</td>
                  <td className="px-4 py-4 text-xs">{shortDate(completedAt)}</td>
                  <td className="px-4 py-4 text-right font-mono">
                    {money(inv.total, inv.currency)}
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge status={inv.status} />
                  </td>
                </tr>
              );
            })}
            {history.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  Nothing has been completed yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
