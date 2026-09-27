/**
 * ReviewHeader — the shared page header for the invoice review surfaces.
 *
 * Renders the back link, vendor title, and the DynamicIsland status capsule.
 * Callers may pass `queueItems` to surface attention items in the island.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, FoundryMark } from "@/components/icons";
import { DynamicIsland } from "./dynamic-island";
import { RemoveFromQueue } from "./remove-from-queue";
import { money, shortDate, type Invoice } from "@/lib/ap/types";
import type { QueueItem } from "@/lib/ap/draft-queue";

export function ReviewHeader({
  invoice,
  queueItems,
  onFocusField,
  onAcceptField,
  aside,
  removeAction,
  actingAs,
}: {
  invoice: Invoice;
  queueItems?: QueueItem[];
  onFocusField?: (field: string) => void;
  onAcceptField?: (field: string) => void;
  aside?: ReactNode;
  /**
   * The removal control, when the screen wants to place it somewhere other
   * than this cluster. Omit it and the shared one renders here, which is where
   * every surface but Draft keeps it; pass `null` when the screen places the
   * control itself.
   */
  removeAction?: ReactNode | null;
  /** Whose signature the current screen's actions will carry. */
  actingAs?: string | undefined;
}) {
  return (
    <>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Invoice inbox
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            {actingAs ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/50 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                <FoundryMark className="size-3" />
                Acting as {actingAs}
              </span>
            ) : null}
            <h1 className="text-subheading font-semibold">{invoice.vendor}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{invoice.invoiceNumber || "no number"}</span> · due{" "}
            {shortDate(invoice.dueDate)} · {money(invoice.total, invoice.currency)}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          {aside}
          {/* Renders only where the state machine allows a removal. */}
          {removeAction === undefined ? <RemoveFromQueue invoice={invoice} /> : removeAction}
          <DynamicIsland
            invoice={invoice}
            queueItems={queueItems}
            onFocusField={onFocusField}
            onAcceptField={onAcceptField}
          />
        </div>
      </div>
    </>
  );
}
