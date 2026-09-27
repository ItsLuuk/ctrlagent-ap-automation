/**
 * RemoveFromQueue — the one place a record can be taken out of the queue.
 *
 * Rendered by the shared `ReviewHeader`, so it sits in the same spot on every
 * invoice surface, and gated by the state machine rather than by a status list
 * written here: the control exists exactly where the `archive` rule allows it
 * (Vendor profile, Draft, Rejected). It never appears beside an approval, where
 * a slip would cost a record someone already signed off. Draft places it beside
 * the document tools instead, by passing it in as the header's `removeAction`.
 *
 * It is the one red control in the app. Taking a record out of the queue is
 * the only action here that is not reversed by a keystroke, and it should not
 * sit in the same visual register as drawing a box or confirming a field.
 *
 * It asks first. Nothing is destroyed — the record keeps its audit trail under
 * Removed and can be put back — but the reviewer is about to stop looking at an
 * invoice, and a step that confirms they meant it costs one press and saves the
 * one where they did not. The dialog says what is recoverable rather than
 * borrowing the fear language of a permanent delete, because that is the
 * truth: the difference is that this one is avoidable, not that it is mild.
 */
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { Ban } from "@/components/icons";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { duplicatePeer } from "@/lib/ap/duplicate-detection";
import { availableTransitions } from "@/lib/ap/state-machine";
import { operatorActorWithRole } from "@/lib/ap/operator";
import { useAp } from "@/lib/app/store";
import { shortDate, type Invoice } from "@/lib/ap/types";

/** How to name the twin a duplicate was caught against. */
function nameOf(peer: Invoice): string {
  return peer.invoiceNumber
    ? `invoice no. ${peer.invoiceNumber}`
    : `the invoice from ${shortDate(peer.issueDate)}`;
}

export function RemoveFromQueue({ invoice }: { invoice: Invoice }) {
  const { invoices, history, removed, removeInvoice, restoreInvoice, vendorProfiles, businessProfile, sodPolicy } = useAp();
  const navigate = useNavigate();
  const actor = operatorActorWithRole("processor", businessProfile);
  if (!availableTransitions(invoice, actor, { sodPolicy }).includes("archive")) return null;

  // The label follows the tag the app already put on the row, so the action sits
  // where the flag is instead of appearing on a record nothing warned about. The
  // twin comes from the same rule the tag uses, so the trail says which pair.
  const flagged = invoice.tags.includes("Duplicate risk");
  const peer = duplicatePeer(invoice, [...invoices, ...history, ...removed], vendorProfiles);
  const note = peer ? `Same vendor and amount as ${nameOf(peer)}.` : undefined;

  const remove = () => {
    const result = removeInvoice(invoice.id, actor, note);
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
      action: { label: "Undo", onClick: () => restoreInvoice(invoice.id, actor) },
    });
    navigate({ to: "/" });
  };

  const label = flagged ? "Remove duplicate" : "Remove";
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" className="gap-1.5">
          <Ban className="size-3.5" />
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {flagged ? "Remove this duplicate?" : "Remove this invoice?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {/* Which record, then what survives it. The second sentence is the
                one that matters: a reviewer deciding whether to press the button
                needs to know this is reversible, not that it is serious. */}
            {invoice.invoiceNumber || shortDate(invoice.issueDate)} · {invoice.vendor} leaves the
            queue{note ? `. ${note}` : ""}. It keeps its audit trail under Removed, and you can
            put it back from there.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction className={buttonVariants({ variant: "destructive" })} onClick={remove}>
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
