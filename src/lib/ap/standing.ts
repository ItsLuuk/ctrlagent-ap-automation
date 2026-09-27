/**
 * Where the accountant stands, answered in one place.
 *
 * The inbox is where uncertainty is highest: what is left, how much of it is
 * mine, and what is stuck. That question is answered here as information to
 * pull, deliberately not as something that arrives — no badge, no notification,
 * no red dot. The deadline already supplies the anxiety; a screen that
 * interrupts would only add to it, and the pull is what makes the answer
 * trusted rather than nagging.
 *
 * Every number is derived from the same lists the tabs and the rows use, so
 * the summary cannot quietly disagree with the queue underneath it.
 */
import { isLate } from "./auto-tags";
import { ATTENTION_LABEL, type InvoiceAttention } from "./attention";
import { AWAITING_PERSON, PHASE_STATUSES, type Invoice } from "./types";

/**
 * Statuses that still owe money or still owe a decision, in phase order.
 *
 * `rejected` sits on a tab until someone reopens or removes it, but nothing is
 * owed for it, so it stays out of a figure that is read as money on the way out
 * the door.
 */
const OUTSTANDING: Invoice["status"][] = [
  ...PHASE_STATUSES.profiling,
  ...PHASE_STATUSES.draft.filter((status) => status !== "rejected"),
  ...PHASE_STATUSES.approval,
  ...PHASE_STATUSES.payment,
];

export type StandingMoney = { currency: string; amount: number };

export type StandingBlock = {
  /** The reason, as the row wearing it already spells it. */
  label: string;
  count: number;
  /** One real reason, from one record that carries it. */
  detail: string;
  /** The records stuck on this reason. */
  ids: string[];
};

export type Standing = {
  /** What is still owed, and what it comes to, per currency. */
  outstanding: { count: number; money: StandingMoney[] };
  /** Records only a person can move on. */
  needsYou: number;
  /** Of those, how many are already past their due date. */
  late: number;
  /** What is stuck, grouped by reason, worst first. */
  blocked: StandingBlock[];
};

/** Kinds in the order attention already ranks them: retryable first. */
const BLOCK_ORDER = ["sync_failed", "held", "no_po"] as const;

/**
 * The standing summary for the whole queue.
 *
 * `attention` is the same per-invoice map the rows render, passed in rather
 * than recomputed, so a record cannot be "blocked" here and unblocked in the
 * row beside it.
 */
export function standingFor(
  invoices: readonly Invoice[],
  attention: ReadonlyMap<string, InvoiceAttention | undefined>,
  now: Date = new Date(),
): Standing {
  const open = invoices.filter((invoice) => OUTSTANDING.includes(invoice.status));

  // Money is grouped by currency rather than added up: a EUR total and a USD
  // total summed together is a number nobody can act on.
  const byCurrency = new Map<string, number>();
  for (const invoice of open) {
    const currency = invoice.currency || "EUR";
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + (invoice.total ?? 0));
  }

  const grouped = new Map<string, { detail: string; ids: string[] }>();
  for (const invoice of invoices) {
    const item = attention.get(invoice.id);
    if (!item) continue;
    const entry = grouped.get(item.label) ?? { detail: item.detail, ids: [] };
    entry.ids.push(invoice.id);
    grouped.set(item.label, entry);
  }

  return {
    outstanding: {
      count: open.length,
      money: [...byCurrency.entries()]
        .map(([currency, amount]) => ({ currency, amount }))
        .sort((a, b) => b.amount - a.amount),
    },
    needsYou: invoices.filter((invoice) => AWAITING_PERSON.includes(invoice.status)).length,
    late: open.filter((invoice) => isLate(invoice, now)).length,
    blocked: BLOCK_ORDER.flatMap((kind) => {
      const entry = grouped.get(ATTENTION_LABEL[kind]);
      if (!entry) return [];
      return [
        {
          label: ATTENTION_LABEL[kind],
          count: entry.ids.length,
          detail: entry.detail,
          ids: entry.ids,
        },
      ];
    }),
  };
}
