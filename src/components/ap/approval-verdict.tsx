/**
 * ApprovalVerdictStrip — the one sentence the For approval page exists to say.
 *
 * "Does what the document says match what we already hold?" The strip answers it
 * once, in words — one line, and nothing under it: red only when something
 * actually stops the approval, a plain card otherwise, because "nothing blocks
 * approval" is not a warning and painting it amber put good news in the same
 * weight as a problem. The flagged rows live in the compare list below, each one
 * already marked with its own confidence, so the strip carries no counts and no
 * second sentence restating them.
 */
import { AlertTriangle, CheckCircle2, ListChecks } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ApprovalVerdict } from "@/lib/ap/approval";

export function ApprovalVerdictStrip({
  verdict,
  onReviewNext,
  className,
}: {
  verdict: ApprovalVerdict;
  /** Offered when there are attention-only rows to work through. */
  onReviewNext?: (() => void) | undefined;
  className?: string;
}) {
  const blocked = verdict.blocking.length > 0;
  const attention = !blocked && verdict.attention.length > 0;
  const Icon = blocked ? AlertTriangle : attention ? ListChecks : CheckCircle2;

  return (
    <section
      className={cn(
        "mt-5 rounded-lg p-4",
        blocked
          ? "border border-destructive/40 bg-destructive/5"
          : "bg-card shadow-whisper",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <Icon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            blocked
              ? "text-destructive"
              : attention
                ? "text-muted-foreground"
                : "text-success-foreground",
          )}
        />
        <div className="min-w-0">
          <p
            className={cn("text-sm font-medium", blocked ? "text-destructive" : "text-foreground")}
          >
            {verdict.headline}
          </p>
          {attention && onReviewNext ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-2 gap-1.5 shrink-0"
              onClick={onReviewNext}
            >
              <ListChecks className="size-3.5" />
              Review {verdict.attention.length} {verdict.attention.length === 1 ? "row" : "rows"}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
