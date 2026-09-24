/**
 * Vendors page — one profile card per vendor seen in the pipeline: circular
 * logo, name, billing email, invoice count and total spend, linking into the
 * invoice list.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { Users } from "@/components/icons";
import { PageHeader } from "@/components/ap/page-header";
import { Shell } from "@/components/ap/shell";
import { EmptyState } from "@/components/ap/primitives";
import { departmentLogoTone, vendorEmail, initialsOf } from "@/components/ap/vendor-profile";
import { useAp } from "@/lib/ap/store";
import { money } from "@/lib/ap/types";

export const Route = createFileRoute("/vendors")({
  head: () => ({
    meta: [
      { title: "Vendors — Foundry" },
      {
        name: "description",
        content: "Vendors seen in the AP pipeline with spend and invoice counts.",
      },
    ],
  }),
  component: VendorsPage,
});

function VendorsPage() {
  const { invoices, history, vendors: vendorMaster } = useAp();

  const byVendor = new Map<
    string,
    { open: number; openTotal: number; paid: number; paidTotal: number; currency: string }
  >();
  const track = (vendor: string, total: number, currency: string, paid: boolean) => {
    const entry = byVendor.get(vendor) ?? {
      open: 0,
      openTotal: 0,
      paid: 0,
      paidTotal: 0,
      currency,
    };
    if (paid) {
      entry.paid += 1;
      entry.paidTotal += total;
    } else {
      entry.open += 1;
      entry.openTotal += total;
    }
    byVendor.set(vendor, entry);
  };
  invoices.forEach((i) => track(i.vendor, i.total, i.currency, false));
  history.forEach((h) => track(h.vendor, h.total, h.currency, true));
  const vendors = [...byVendor.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <Shell>
      <PageHeader
        icon={Users}
        title="Vendors"
        subtitle="Every vendor the pipeline has seen, with open and paid invoice volume."
      />

      {vendors.length === 0 ? (
        <EmptyState icon={Users} title="No vendors yet" className="mt-5">
          Vendors appear here as soon as an invoice is uploaded or paid.
        </EmptyState>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {vendors.map(([vendor, stats]) => {
            const record = vendorMaster[vendor];
            return (
              <Link
                key={vendor}
                to="/"
                search={{}}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05)] transition-[transform,box-shadow,background-color] hover:-translate-y-0.5 hover:bg-accent/5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
              >
                {record?.logoUrl ? (
                  <img
                    src={record.logoUrl}
                    alt=""
                    aria-hidden
                    className="size-11 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div
                    aria-hidden
                    className={`flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${departmentLogoTone(record?.department, vendor)}`}
                  >
                    {initialsOf(vendor)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{vendor}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {vendorEmail(vendor, record)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-mono">
                    {money(stats.openTotal + stats.paidTotal, stats.currency)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {stats.open} open · {stats.paid} paid
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
