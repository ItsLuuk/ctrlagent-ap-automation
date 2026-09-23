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
import { cn } from "@/lib/utils";
import type { ApprovalVerdict } from "@/lib/ap/approval";

export function ApprovalVerdictStrip({
  verdict,
  className,
}: {
  verdict: ApprovalVerdict;
  className?: string;
}) {
  const blocked = verdict.blocking.length > 0;
  const attention = !blocked && verdict.attention.length > 0;
  const Icon = blocked ? AlertTriangle : attention ? ListChecks : CheckCircle2;

  return (
    <section
      className={cn(
        "mt-5 rounded-lg border p-4",
        blocked ? "border-destructive/40 bg-destructive/5" : "border-border bg-card",
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
        <div>
          <p
            className={cn("text-sm font-medium", blocked ? "text-destructive" : "text-foreground")}
          >
            {verdict.headline}
          </p>
        </div>
      </div>
    </section>
  );
}
