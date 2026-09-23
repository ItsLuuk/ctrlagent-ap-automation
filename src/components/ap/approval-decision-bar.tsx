/**
 * ApprovalDecisionBar — the page's action surface, pinned to the bottom of the
 * viewport so the decision is always in reach while the compare list scrolls
 * (the document pane stays pinned at the top, in the same idiom).
 *
 * The bar asks for nothing until an action needs it. `query` and `reject` are
 * the steps the state machine marks `requiresReason`, so they ask for one in a
 * dialog at the moment they are chosen; `approve` requires none, so it stays a
 * single click and no field sits on screen waiting for a decision nobody has
 * made. A blocked action says so beside the button that stays disabled
 * (accessibility.md §2: a status change is never visual-only) — but the bar
 * never restates the verdict sentence, or the count in it: the strip at the top
 * of the page is where that number is said, once.
 *
 * Every pipeline status gets the same bar, so the page has one place where its
 * next action lives.
 */
import { useRef, useState, type ReactNode } from "react";
import { Check, CircleSlash, ListChecks, PenLine, RotateCcw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { money } from "@/lib/ap/types";

/** The actions on this screen that carry a mandatory reason. */
type ReasonAction = "query" | "reject" | "reopen";

const REASON_DIALOG: Record<
  ReasonAction,
  { title: string; description: string; placeholder: string; confirm: string }
> = {
  query: {
    title: "Send this back with a question",
    description: "It stays in For approval, and your reason goes in the audit trail.",
    placeholder: "What needs checking before this is paid?",
    confirm: "Send query",
  },
  reject: {
    title: "Reject this invoice",
    description: "Its status becomes Rejected, and your reason goes in the audit trail.",
    placeholder: "Why it can't be paid",
    confirm: "Reject invoice",
  },
  reopen: {
    title: "Re-open this invoice",
    description: "Its status returns to For approval, and your reason goes in the audit trail.",
    placeholder: "What changed since it was approved?",
    confirm: "Re-open invoice",
  },
};

export function ApprovalDecisionBar({
  blocked,
  amount,
  currency,
  onApprove,
  onQuery,
  onReject,
  onReopen,
  onReviewNext,
  /** Actions for statuses outside For approval (submit, handoff, reopen). */
  actions,
  /** What the status action does, in one line. */
  hint,
  className,
}: {
  /** True while the verdict has rows that stop the approval. */
  blocked: boolean;
  amount: number;
  currency: string;
  onApprove: () => void;
  onQuery: (reason: string) => void;
  onReject: (reason: string) => void;
  /** Offered on a record frozen at approval — the way back to editable. */
  onReopen?: ((reason: string) => void) | undefined;
  onReviewNext?: (() => void) | undefined;
  actions?: ReactNode | undefined;
  hint?: string | undefined;
  className?: string | undefined;
}) {
  const [asking, setAsking] = useState<ReasonAction | null>(null);
  const reason = blocked ? "This can't move forward until the flagged rows are fixed." : undefined;

  return (
    <>
      <div
        className={cn(
          "sticky bottom-0 z-20 -mx-6 mt-6 border-t border-border bg-card/95 px-6 py-3 backdrop-blur",
          className,
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            {reason ? (
              <p id="approval-blocked-reason" className="text-xs font-medium text-destructive">
                {reason}
              </p>
            ) : null}
            {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {blocked && onReviewNext ? (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={onReviewNext}>
                <ListChecks className="size-3.5" /> Review next issue
              </Button>
            ) : null}
            {actions ?? (
              <>
                <Button
                  className="gap-2"
                  onClick={onApprove}
                  disabled={blocked}
                  // Only while blocked: the reason element is rendered with it, and
                  // an aria-describedby pointing at nothing describes nothing.
                  {...(blocked ? { "aria-describedby": "approval-blocked-reason" } : {})}
                >
                  <Check className="size-4" /> Approve {money(amount, currency)}
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => setAsking("query")}>
                  <PenLine className="size-4" /> Query
                </Button>
                <Button
                  variant="ghost"
                  className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => setAsking("reject")}
                >
                  <CircleSlash className="size-4" /> Reject
                </Button>
              </>
            )}
            {onReopen ? (
              <Button variant="outline" className="gap-2" onClick={() => setAsking("reopen")}>
                <RotateCcw className="size-4" /> Re-open
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <ReasonDialog
        asking={asking}
        onClose={() => setAsking(null)}
        onSubmit={(value) => {
          const action = asking;
          setAsking(null);
          if (action === "query") onQuery(value);
          else if (action === "reject") onReject(value);
          else if (action === "reopen") onReopen?.(value);
        }}
      />
    </>
  );
}

/**
 * The reason a Query or Reject has to carry. It is the only place the page asks
 * for one, and the confirm button says what will happen with it.
 */
function ReasonDialog({
  asking,
  onClose,
  onSubmit,
}: {
  asking: ReasonAction | null;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  // Held across the close animation, so the dialog keeps its title while it
  // animates out instead of rendering an untitled surface.
  const last = useRef<ReasonAction>("query");
  if (asking) last.current = asking;
  const copy = REASON_DIALOG[last.current];
  const ready = reason.trim().length > 0;
  const close = () => {
    setReason("");
    onClose();
  };

  return (
    <Dialog
      open={asking !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="decision-reason">Reason</Label>
          <Textarea
            id="decision-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={copy.placeholder}
            className="min-h-[80px]"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!ready}
            onClick={() => {
              const value = reason.trim();
              // Cleared here: the dialog closes because the parent dropped
              // `asking`, which Radix does not report as an open-change event.
              setReason("");
              onSubmit(value);
            }}
          >
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
