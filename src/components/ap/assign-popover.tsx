/**
 * Small presentational pieces of the DraftMapper screen: the field-assignment
 * popover (the two-click correction loop) and the
 * line-items-vs-total cross-check line.
 */
import { Ban, CircleAlert, CircleCheck, Link2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { MAPPING_FIELDS, ZONE_LABEL, type ZoneField } from "@/lib/ap/types";

export function AssignPopover({
  onAssign,
  onCancelSelection,
}: {
  onAssign: (field: ZoneField) => void;
  onCancelSelection: () => void;
}) {
  return (
    <div className="space-y-2 border-t border-border bg-accent/5 px-4 py-3">
      <div className="flex items-start gap-2">
        <Link2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-xs font-medium text-foreground">You selected text</p>
          <p className="text-xs text-muted-foreground">Choose the field this selection contains.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {MAPPING_FIELDS.map((field) => (
          <Button
            key={field}
            size="sm"
            variant="outline"
            className="h-10 px-3 text-xs"
            onClick={() => onAssign(field)}
          >
            {ZONE_LABEL[field]}
          </Button>
        ))}
        <Button size="sm" variant="ghost" className="h-10 px-3 text-xs" onClick={onCancelSelection}>
          <Ban className="size-3" /> Cancel selection
        </Button>
      </div>
    </div>
  );
}

export function CrossCheckLine({
  isConsistent,
  lineItemsSum,
  subtotal,
  tax,
  invoiceTotal,
  currency,
  detail,
}: {
  isConsistent: boolean;
  lineItemsSum: number;
  subtotal: number;
  tax: number;
  invoiceTotal: number;
  currency: string;
  detail?: string | undefined;
}) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "EUR",
    maximumFractionDigits: 2,
  });
  const hasHeaders = subtotal > 0 || tax > 0;
  const rows: Array<{ label: string; value: number; match: boolean }> = hasHeaders
    ? [
        {
          label: "Lines",
          value: lineItemsSum,
          match: Math.abs(lineItemsSum - (subtotal > 0 ? subtotal : invoiceTotal)) <= 0.02,
        },
        { label: "Subtotal", value: subtotal, match: true },
        { label: "Tax", value: tax, match: true },
        {
          label: "Total",
          value: invoiceTotal,
          match: Math.abs(subtotal + tax - invoiceTotal) <= 0.02,
        },
      ]
    : [{ label: "Lines = Total", value: lineItemsSum, match: isConsistent }];
  return (
    <div
      className="rounded-xl p-3 shadow-whisper transition-[border-left-width,border-left-color] duration-200 ease-out-expo"
      style={isConsistent ? undefined : { borderLeft: "3px solid #f56900" }}
      role="status"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          {isConsistent ? (
            <CircleCheck className="size-3.5 text-foreground" />
          ) : (
            <CircleAlert className="size-3.5 text-foundry-orange" />
          )}
          Totals reconciliation
        </p>
        <span className="text-xs font-semibold text-foreground">
          {isConsistent ? "Balanced" : "Needs review"}
        </span>
      </div>
      <dl className="mt-2 divide-y divide-border/50">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between py-1">
            <dt className="text-xs text-muted-foreground">{r.label}</dt>
            <dd className="flex items-center gap-1.5 font-mono text-xs font-medium">
              {formatter.format(r.value)}
              <span
                className={r.match ? "text-foreground" : "text-foundry-orange"}
                aria-label={r.match ? "matches" : "mismatch"}
              >
                {r.match ? <CircleCheck className="size-3" /> : <CircleAlert className="size-3" />}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p
        className={`mt-1.5 text-xs ${isConsistent ? "text-muted-foreground" : "font-medium text-foreground"}`}
      >
        {detail ??
          (isConsistent
            ? `Lines ${formatter.format(lineItemsSum)} reconcile ✓`
            : `Lines ${formatter.format(lineItemsSum)} vs total ${formatter.format(invoiceTotal)} — check missing lines or tax.`)}
      </p>
    </div>
  );
}
