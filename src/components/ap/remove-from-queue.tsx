/**
 * RemoveFromQueue — the one place a record can be taken out of the queue.
 *
 * Rendered by the shared `ReviewHeader`, so it sits in the same spot on every
 * invoice surface, and gated by the state machine rather than by a status list
 * written here: the control exists exactly where the `archive` rule allows it
 * (Vendor profile, Draft, Rejected). It never appears beside an approval, where
 * a slip would cost a record someone already signed off.
 *
 * Nothing is destroyed. The record keeps its audit trail under Removed in the
 * inbox, and the toast carries the way straight back — which is why this needs
 * no confirmation dialog.
 */
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { Ban } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { duplicatePeer } from "@/lib/ap/auto-tags";
import { availableTransitions, type Actor } from "@/lib/ap/state-machine";
import { useAp } from "@/lib/ap/store";
import { shortDate, type Invoice } from "@/lib/ap/types";

/** Demo processor persona — the only role the `archive` rule admits. */
const ACTOR: Actor = { name: "Luuk Koppen", roles: ["processor"] };

/** How to name the twin a duplicate was caught against. */
function nameOf(peer: Invoice): string {
  return peer.invoiceNumber
    ? `invoice no. ${peer.invoiceNumber}`
    : `the invoice from ${shortDate(peer.issueDate)}`;
}

export function RemoveFromQueue({ invoice }: { invoice: Invoice }) {
  const { invoices, removeInvoice, restoreInvoice } = useAp();
  const navigate = useNavigate();
  if (!availableTransitions(invoice, ACTOR).includes("archive")) return null;

  // The label follows the tag the app already put on the row, so the action sits
  // where the flag is instead of appearing on a record nothing warned about. The
  // twin comes from the same rule the tag uses, so the trail says which pair.
  const flagged = invoice.tags.includes("Duplicate risk");
  const peer = duplicatePeer(invoice, invoices);
  const note = peer ? `Same vendor and amount as ${nameOf(peer)}.` : undefined;

  const remove = () => {
    const result = removeInvoice(invoice.id, ACTOR, note);
    if (!result.accepted) {
      toast.error(result.reason ?? "Couldn't remove this record.", {
        description: "Nothing changed — the invoice is exactly as you left it.",
      });
      return;
    }
    toast.success(flagged ? "Removed the duplicate" : "Removed from the queue", {
      description: peer
        ? `Same vendor and amount as ${nameOf(peer)} — it keeps its audit trail under Removed.`
        : `${invoice.vendor} keeps its audit trail under Removed.`,
      action: { label: "Undo", onClick: () => restoreInvoice(invoice.id, ACTOR) },
    });
    navigate({ to: "/" });
  };

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={remove}>
      <Ban className="size-3.5" />
      {flagged ? "Remove duplicate" : "Remove"}
    </Button>
  );
}
