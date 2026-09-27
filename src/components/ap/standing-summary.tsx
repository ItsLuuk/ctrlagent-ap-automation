/**
 * Where you stand — the inbox's answer to the question the accountant opens
 * the app with.
 *
 * It is a card of numbers, not a prompt. Nothing here badges, interrupts or
 * asks to be dismissed, because the pull is what keeps the answer trusted: a
 * number that arrives on its own is pressure, and the same number read on
 * demand is just where the work is. The muted line under the headline carries
 * the count that is actually the reader's — what is waiting on a person, what
 * is late, and what is stuck.
 */
import { AlertTriangle, Check } from "@/components/icons";
import { cn } from "@/lib/utils";
import { countOf } from "@/lib/ap/vocabulary";
import { money } from "@/lib/ap/types";
import type { Standing } from "@/lib/ap/standing";

/**
 * What is owed, in the reviewer's own words, with the count it covers. Two
 * currencies are listed rather than added together, because a sum of euros and
 * dollars is a number nobody can act on.
 */
function headline(standing: Standing): string {
  if (standing.outstanding.count === 0) return "Nothing outstanding";
  const amounts = standing.outstanding.money.map(({ amount, currency }) => money(amount, currency));
  return `${amounts.join(" + ")} across ${countOf(standing.outstanding.count, "invoice")}`;
}

/** The counts that are the reader's own, and nothing that is not. */
function subline(standing: Standing): string {
  const parts: string[] = [];
  if (standing.needsYou > 0) parts.push(`${countOf(standing.needsYou, "invoice")} need you`);
  if (standing.late > 0) parts.push(`${countOf(standing.late, "invoice")} late`);
  const blocked = standing.blocked.reduce((total, block) => total + block.count, 0);
  if (blocked > 0) parts.push(`${countOf(blocked, "issue")} blocked`);
  return parts.length > 0 ? parts.join(" · ") : "Nothing is waiting on you.";
}

export function StandingSummary({ standing }: { standing: Standing }) {
  const clear = standing.needsYou === 0 && standing.blocked.length === 0;
  return (
    <section className="mt-6" aria-labelledby="standing-heading">
      <h2 id="standing-heading" className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
        Where you stand
      </h2>
      <div className="rounded-lg bg-card px-4 py-3 shadow-whisper">
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
              clear ? "bg-success/15" : "bg-secondary",
            )}
          >
            {clear ? (
              <Check aria-hidden className="size-3.5 text-success-foreground" />
            ) : (
              <AlertTriangle aria-hidden className="size-3.5 text-muted-foreground" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-nav-title font-semibold">{headline(standing)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{subline(standing)}</p>
          </div>
        </div>
        {/* What is holding work, and the reason it gives. Chips rather than
            sentences: the reader either has a stuck record to chase, in which
            case the row below says more, or they have not, and then a sentence
            about it is just something to read. */}
        {standing.blocked.length > 0 ? (
          <ul className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border/60 pt-2.5">
            {standing.blocked.map((block) => (
              <li
                key={block.label}
                title={block.detail}
                className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {block.label} · {countOf(block.count, "invoice")}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
