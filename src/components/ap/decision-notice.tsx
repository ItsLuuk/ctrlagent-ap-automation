/**
 * DecisionNotice — what a decided invoice says where the approval verdict was.
 *
 * The approval strip answers "does what the document says match what we already
 * hold, and may we approve it?" — a question a decided record has already been
 * asked and answered. It cannot be approved again, so a verdict about approving
 * it is noise at best and a lie at worst: "nothing blocks approval" on a record
 * someone threw out, or "1 issue must be fixed before this can be approved" on
 * one that was approved last week. This states the decision that was actually
 * made — who made it, when, and the reason they gave — read from the trail entry
 * rather than restated from a copy.
 *
 * It carries no action. Each decided status keeps its own next step in the
 * decision bar (rejected re-opens as a draft, approved waits for the handoff),
 * and the notice repeats none of it, so the page still says each thing once.
 */
import { CheckCircle2, CircleSlash } from "@/components/icons";
import { cn } from "@/lib/utils";
import { lastDecision } from "@/lib/ap/state-machine";
import { shortDateTime, type Invoice } from "@/lib/ap/types";

export function DecisionNotice({
  invoice,
  className,
}: {
  invoice: Invoice;
  className?: string | undefined;
}) {
  const decision = lastDecision(invoice);
  // Tone follows the status, not the entry: a record seeded as approved (the
  // sample set) may carry no approval in its trail, and reading that as a
  // rejection would paint the wrong decision in red.
  const approved = invoice.status !== "rejected";
  const label = approved ? "Approved" : "Rejected";
  const Icon = approved ? CheckCircle2 : CircleSlash;
  const detail = decision
    ? [
        shortDateTime(decision.at),
        decision.note || (approved ? "" : "No reason was recorded with it."),
      ]
        .filter(Boolean)
        .join(" — ")
    : "No decision is recorded in this record's trail.";

  return (
    <section
      className={cn(
        "mt-5 rounded-lg p-4",
        approved
          ? "bg-card shadow-whisper"
          : "border border-destructive/40 bg-destructive/5",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <Icon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            approved ? "text-success-foreground" : "text-destructive",
          )}
        />
        <div>
          <p
            className={cn("text-sm font-medium", approved ? "text-foreground" : "text-destructive")}
          >
            {decision ? `${label} by ${decision.actor}` : label}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
    </section>
  );
}
