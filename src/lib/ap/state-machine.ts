/**
 * Invoice lifecycle state machine (Phase Flow Plan §1).
 *
 * One module owns every legal status transition, the actor/action pair that
 * may perform it, and the segregation-of-duties guard. UI and store code must
 * never set `Invoice.status` directly — always go through `transition()`.
 *
 * Rules encoded here (per the plan):
 *  - Each transition has exactly one actor role and one action.
 *  - No silent editing after Draft: changes in Approval/Payment loop back
 *    through a visible transition (query / failed-payment).
 *  - Audit entries are mandatory: a transition without an audit record is a
 *    programming error and throws.
 *  - SoD: the same actor cannot confirm, approve, and release one invoice.
 *  - Paid invoices are immutable; corrections re-open as a linked transition
 *    that keeps the original record intact.
 */
import { uid, type AuditEntry, type Invoice, type InvoiceStatus } from "./types";

/** Roles from the plan §0 table. A user may hold several; SoD is enforced per invoice. */
export type ActorRole = "processor" | "approver" | "treasury" | "system";

export type Actor = {
  /** Who is acting. The one operator on an install signs with their own name
   *  (see ./operator); the machine signs as "system". */
  name: string;
  roles: ActorRole[];
};

export const SYSTEM_ACTOR: Actor = { name: "system", roles: ["system"] };

/** Typed transition ids — the only way the status may change. */
export type TransitionId =
  | "register-profile" // system-only: invoice detected as a first-time vendor on upload -> vendor_profile
  | "route-known-vendor" // system-only: vendor already in vendor-master on upload -> draft
  | "vendor-profile-confirmed" // vendor_profile -> draft (processor; writes vendor-master)
  | "vendor-profile-rejected" // vendor_profile -> rejected (processor, reason required)
  | "confirm" // draft -> for_approval (processor or auto-verify system)
  | "reject" // draft|for_approval -> rejected (processor/approver, reason required)
  | "query" // for_approval -> for_approval (comment, stays flagged)
  | "approve" // for_approval -> scheduled/for_payment
  | "schedule" // scheduled -> scheduled (metadata only, same status)
  | "hold" // scheduled -> scheduled with reason
  | "release" // scheduled -> scheduled (handoff marker only)
  | "payment-failed" // scheduled -> for_approval (visible loop-back)
  | "re-open" // paid -> for_approval (credit note / correction; keeps child link)
  | "reopen-draft" // rejected -> draft (a rejection that was wrong, put back to fix)
  | "archive"; // vendor_profile|draft|rejected -> archived (out of the queue)

export const TRANSITION_LABEL: Record<TransitionId, string> = {
  "register-profile": "Vendor profile registered",
  "route-known-vendor": "Vendor matched vendor-master",
  "vendor-profile-confirmed": "Vendor profile saved",
  "vendor-profile-rejected": "Vendor profile rejected",
  confirm: "Confirmed draft",
  reject: "Rejected",
  query: "Queried",
  approve: "Approved",
  schedule: "Scheduled",
  hold: "Held",
  release: "Marked ready for external handoff",
  "payment-failed": "Payment failed — returned to approval",
  "re-open": "Re-opened (credit note / correction)",
  "reopen-draft": "Reopened as draft",
  archive: "Removed from the queue",
};

/**
 * The audit action a Restore writes. Restore is a store-level move rather than
 * a transition — where a record returns to is the status it held when it was
 * removed, which a single `to` cannot express — so the string lives here, next
 * to the labels it sits beside in the trail.
 */
export const RESTORE_ACTION = "Restored to the queue";

/** `scheduled` is the app's existing status for "For payment". */
export const STATUS_BY_PHASE = {
  vendor_profile: "vendor_profile",
  draft: "draft",
  approval: "review",
  payment: "scheduled",
  paid: "paid",
  rejected: "rejected",
} as const satisfies Record<string, InvoiceStatus>;

type TransitionSpec = {
  from: InvoiceStatus[];
  to: InvoiceStatus;
  /** Roles allowed to perform this transition. */
  roles: ActorRole[];
  /** Whether a non-empty reason/note is mandatory. */
  requiresReason: boolean;
};

export const TRANSITIONS: Record<TransitionId, TransitionSpec> = {
  "register-profile": {
    from: [],
    to: "vendor_profile",
    roles: ["system"],
    requiresReason: false,
  },
  /**
   * The other capture-time entry point: the extractor recognised a vendor that
   * is already in vendor-master, so the invoice goes straight to Draft. Both
   * capture outcomes are system decisions made before a person sees the
   * record, which is why they are two entry points and not one rule with a
   * conditional destination — a single `register-profile` call for both dragged
   * every known vendor's invoice back into registration while its own audit
   * note claimed it had entered Draft.
   */
  "route-known-vendor": {
    from: [],
    to: "draft",
    roles: ["system"],
    requiresReason: false,
  },
  "vendor-profile-confirmed": {
    from: ["vendor_profile"],
    to: "draft",
    roles: ["processor", "system"],
    requiresReason: false,
  },
  "vendor-profile-rejected": {
    from: ["vendor_profile"],
    to: "rejected",
    roles: ["processor"],
    requiresReason: true,
  },
  confirm: { from: ["draft"], to: "review", roles: ["processor", "system"], requiresReason: false },
  reject: {
    from: ["draft", "review"],
    to: "rejected",
    roles: ["processor", "approver"],
    requiresReason: true,
  },
  query: { from: ["review"], to: "review", roles: ["approver"], requiresReason: true },
  approve: { from: ["review"], to: "scheduled", roles: ["approver"], requiresReason: false },
  schedule: { from: ["scheduled"], to: "scheduled", roles: ["treasury"], requiresReason: false },
  hold: { from: ["scheduled"], to: "scheduled", roles: ["treasury"], requiresReason: true },
  release: { from: ["scheduled"], to: "scheduled", roles: ["treasury"], requiresReason: false },
  "payment-failed": {
    from: ["scheduled"],
    to: "review",
    roles: ["treasury", "system"],
    requiresReason: true,
  },
  /**
   * The way back off an approval. From `scheduled` as well as `paid`: a signed
   * record may be re-opened only by an approver, and only with a reason — that
   * is what keeps an edit from diverging from the signature silently.
   */
  "re-open": {
    from: ["paid", "scheduled"],
    to: "review",
    roles: ["approver"],
    requiresReason: true,
  },
  "reopen-draft": { from: ["rejected"], to: "draft", roles: ["processor"], requiresReason: false },
  /**
   * Removal. The record leaves the working queue but nothing is destroyed: the
   * audit trail is part of the record, and the store keeps removed records
   * readable (and restorable). The stages that may be removed are this list and
   * nothing else — the UI asks the machine, it does not decide for itself.
   */
  archive: {
    from: ["vendor_profile", "draft", "rejected"],
    to: "archived",
    roles: ["processor"],
    requiresReason: false,
  },
};

/**
 * Frozen where a person decided it. Once a record carries a ruling — approved
 * (`scheduled`), settled (`paid`), rejected, or removed — its fields are the
 * fields that ruling stands on, so no patch may change them behind the trail:
 * an approval is a signature over a number, and a signature over a number that
 * no longer exists is not a signature.
 *
 * The store refuses every patch on a frozen record (one rule, one place), and
 * the screens ask this rather than keeping their own status lists. The way back
 * is an event, not a patch: Re-open, Reopen as draft, or Restore — each writes
 * who and why, so the trail never silently diverges from what was decided.
 */
export function isFrozen(invoice: Pick<Invoice, "status">): boolean {
  return invoice.status === "scheduled" || invoice.status === "paid"
    ? true
    : invoice.status === "rejected" || invoice.status === "archived";
}

/** Human-readable label for the freeze state a screen can show beside disabled controls. */
export function freezeLabel(invoice: Pick<Invoice, "status">): string {
  if (invoice.status === "scheduled") return "Approved — the fields the signature stands on are locked; use Re-open below to change them.";
  if (invoice.status === "paid") return "Paid — the record is settled; re-open it to correct anything.";
  if (invoice.status === "rejected") return "Rejected — the record is closed until someone reopens it as a draft.";
  if (invoice.status === "archived") return "Removed from the queue — the record is out of reach until it is restored.";
  return "";
}

/**
 * The store's one field-patch gate. Non-null means the patch must not land;
 * the reason names Re-open, so every write path that hits a frozen record
 * fails the same way and points at the same door — not just `updateInvoice`.
 */
export function patchRefusal(
  invoice: Pick<Invoice, "status">,
): { accepted: false; reason: string } | null {
  if (!isFrozen(invoice)) return null;
  return {
    accepted: false,
    reason: "Frozen where it was decided — re-open the record before changing it.",
  };
}

/**
 * Segregation of duties: one actor may not hold more than one of these
 * responsibilities for the same invoice (plan §4.5). The system actor is
 * exempt (auto-verify, payment-failure callbacks).
 *
 * Profile registration and profile confirmation both mark the actor as
 * `confirmed`: identity capture and field confirmation are the same
 * responsibility. A person who set the vendor identity cannot also approve
 * the payment of the same invoice.
 */
const SOD_RESPONSIBILITIES: Partial<Record<TransitionId, SodKey>> = {
  "vendor-profile-confirmed": "confirmed",
  confirm: "confirmed",
  approve: "approved",
  release: "released",
};

type SodKey = "confirmed" | "approved" | "released";

/** Extracts which actor performed each SoD-relevant step from the audit trail. */
export function sodState(invoice: Pick<Invoice, "audit">): Partial<Record<SodKey, string>> {
  const state: Partial<Record<SodKey, string>> = {};
  for (const entry of invoice.audit) {
    if (entry.action === TRANSITION_LABEL.confirm) state.confirmed = entry.actor;
    if (entry.action === TRANSITION_LABEL["vendor-profile-confirmed"])
      state.confirmed = entry.actor;
    if (entry.action === TRANSITION_LABEL.approve) state.approved = entry.actor;
    if (entry.action === TRANSITION_LABEL.release) state.released = entry.actor;
  }
  return state;
}

export type TransitionError =
  | { kind: "illegal"; from: InvoiceStatus; transition: TransitionId }
  | { kind: "role"; roles: ActorRole[]; transition: TransitionId }
  | { kind: "reason-required"; transition: TransitionId }
  | { kind: "sod"; responsibility: string; actor: string }
  | { kind: "immutable"; from: InvoiceStatus; transition: TransitionId };

export type TransitionInput = {
  transition: TransitionId;
  actor: Actor;
  note?: string | undefined;
  /**
   * Org has exactly one member: skip name-based SoD (role gates still apply).
   * `| undefined` is what lets callers forward an optional value
   * (`soleUser: opts?.soleUser`) — with exactOptionalPropertyTypes a bare
   * `?: boolean` rejects an explicitly-undefined argument.
   */
  soleUser?: boolean | undefined;
};

export type TransitionResult = {
  status: InvoiceStatus;
  auditAction: string;
  note?: string | undefined;
};

/**
 * Pure transition check + apply. Returns the new status and the audit action
 * string, or a typed error. Does not mutate anything — callers (store, tests)
 * own persistence.
 */
export function transition(
  invoice: Pick<Invoice, "status" | "audit">,
  input: TransitionInput,
): { ok: true; result: TransitionResult } | { ok: false; error: TransitionError } {
  const spec = TRANSITIONS[input.transition];

  if (invoice.status === "paid" && input.transition !== "re-open") {
    return {
      ok: false,
      error: { kind: "immutable", from: invoice.status, transition: input.transition },
    };
  }

  // An empty `from` list means this transition is an entry point — used for
  // system-only initializations like `register-profile` that write the first
  // status. No current status to compare against.
  if (spec.from.length > 0 && !spec.from.includes(invoice.status)) {
    return {
      ok: false,
      error: { kind: "illegal", from: invoice.status, transition: input.transition },
    };
  }

  if (!input.actor.roles.some((r) => spec.roles.includes(r))) {
    return {
      ok: false,
      error: { kind: "role", roles: spec.roles, transition: input.transition },
    };
  }

  if (spec.requiresReason && !(input.note ?? "").trim()) {
    return { ok: false, error: { kind: "reason-required", transition: input.transition } };
  }

  const responsibility = SOD_RESPONSIBILITIES[input.transition];
  if (responsibility && !input.actor.roles.includes("system") && !input.soleUser) {
    const done = sodState(invoice);
    // Plan §4.5: extractor ≠ approver ≠ releaser — each SoD responsibility
    // must be held by a different person. Block when this actor already
    // performed *any* of the other SoD-relevant steps on this invoice.
    const conflict = (Object.keys(done) as SodKey[])
      .filter((k) => k !== responsibility)
      .some((k) => done[k] === input.actor.name);
    if (done[responsibility] === input.actor.name || conflict) {
      return {
        ok: false,
        error: {
          kind: "sod",
          responsibility: String(responsibility),
          actor: input.actor.name,
        },
      };
    }
  }

  return {
    ok: true,
    result: {
      status: spec.to,
      auditAction: TRANSITION_LABEL[input.transition],
      note: input.note,
    },
  };
}

/**
 * The decision that ended the approval question — who made it, when, and the
 * reason they gave — read out of the trail, not from a copy kept elsewhere.
 *
 * The *last* one wins: a record re-opened and decided again is decided by the
 * newer call, and the screen that states the decision has to state the one in
 * force. Rejections can arrive from two transitions (at registration and at
 * approval) and an approval from one, so all three count.
 */
const DECISION_ACTIONS = [
  TRANSITION_LABEL.approve,
  TRANSITION_LABEL.reject,
  TRANSITION_LABEL["vendor-profile-rejected"],
];

export function lastDecision(invoice: Pick<Invoice, "audit">): AuditEntry | undefined {
  return [...invoice.audit].reverse().find((entry) => DECISION_ACTIONS.includes(entry.action));
}

/**
 * Whether a handoff marker stands for the decision in force.
 *
 * Only markers written *after* that decision count. A record re-opened and
 * approved again has none, even though an older entry in its history still says
 * one was recorded — and quoting that entry is worse than cosmetic: the screen
 * then reports a handoff that never happened and offers no way to mark the real
 * one, so the last step of the flow becomes unreachable.
 */
export function handoffMarkerInForce(invoice: Pick<Invoice, "audit">): boolean {
  const decision = lastDecision(invoice);
  const after = decision ? invoice.audit.lastIndexOf(decision) + 1 : 0;
  return invoice.audit
    .slice(after)
    .some((entry) => entry.action === TRANSITION_LABEL.release);
}

/**
 * Applies an accepted removal to a record: the machine's new status and audit
 * action, plus the status it came from so it can go back. Pure, like
 * `transition` — the store owns persistence and the queue move, and the tests
 * can pin the shape of the trail a removal leaves behind.
 */
export function archiveRecord(
  invoice: Invoice,
  actor: Actor,
  applied: Pick<TransitionResult, "status" | "auditAction">,
  note?: string | undefined,
): Invoice {
  return {
    ...invoice,
    status: applied.status,
    archivedFrom: invoice.status,
    audit: [
      ...invoice.audit,
      {
        id: uid(),
        at: new Date().toISOString(),
        actor: actor.name,
        action: applied.auditAction,
        note,
      },
    ],
  };
}

/**
 * The inverse: back to the status the record held when it was removed, with the
 * entry that says someone put it back. The pointer is dropped as it is spent —
 * `archivedFrom` only means anything while a record is out of the queue.
 */
export function restoreRecord(invoice: Invoice, actor: Actor): Invoice {
  const { archivedFrom, ...rest } = invoice;
  return {
    ...rest,
    status: archivedFrom ?? "draft",
    audit: [
      ...invoice.audit,
      { id: uid(), at: new Date().toISOString(), actor: actor.name, action: RESTORE_ACTION },
    ],
  };
}

/**
 * Repairs audit trails poisoned by a premature "Confirmed draft" entry: the
 * Draft screen used to log that action via a plain field update *before* the
 * confirm transition ran, so SoD then read it as "already confirmed" and
 * rejected every attempt (including retries) with no visible cause.
 * Entries matching that exact signature on a still-draft invoice claim a
 * confirm that never happened — the real entry is written by the transition
 * itself — so they are safe to drop.
 */
export function stripPrematureConfirmEntries<T extends Pick<Invoice, "audit">>(invoice: T): T {
  const cleaned = invoice.audit.filter(
    (e) => !(e.action === TRANSITION_LABEL.confirm && e.note === "Confirmed template extraction"),
  );
  return cleaned.length === invoice.audit.length ? invoice : { ...invoice, audit: cleaned };
}

/** Result of a store-level transition attempt: accepted, or why not. */
export type TransitionOutcome = { accepted: boolean; reason?: string | undefined };

/** Human cause + recovery for a rejected transition (brand voice: no dead ends). */
export function describeTransitionError(error: TransitionError): string {
  switch (error.kind) {
    case "illegal":
      return `Can't ${TRANSITION_LABEL[error.transition].toLowerCase()} from status "${error.from}" — reload the invoice and try again.`;
    case "role":
      return `Your role can't take this step — it needs ${error.roles.join(" or ")}.`;
    case "reason-required":
      return `Add a reason first — it's required for this step.`;
    case "sod":
      return `${error.actor} already holds "${error.responsibility}" on this invoice — have someone else take this step.`;
    case "immutable":
      return `This invoice is already paid — re-open it first to change anything.`;
  }
}

/** Convenience for UI code: which transitions are legal right now? */
export function availableTransitions(
  invoice: Pick<Invoice, "status" | "audit">,
  actor: Actor,
  opts?: { soleUser?: boolean },
): TransitionId[] {
  return (Object.keys(TRANSITIONS) as TransitionId[]).filter(
    (id) => transition(invoice, { transition: id, actor, soleUser: opts?.soleUser }).ok,
  );
}
