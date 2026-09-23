import { describe, expect, it } from "bun:test";
import {
  archiveRecord,
  availableTransitions,
  describeTransitionError,
  isFrozen,
  lastDecision,
  patchRefusal,
  restoreRecord,
  RESTORE_ACTION,
  sodState,
  stripPrematureConfirmEntries,
  SYSTEM_ACTOR,
  transition,
  TRANSITION_LABEL,
  type Actor,
} from "./state-machine";
import type { Invoice } from "./types";

const processor: Actor = { name: "Patty Processor", roles: ["processor"] };
const approver: Actor = { name: "Amy Approver", roles: ["approver"] };
const treasury: Actor = { name: "Ted Treasury", roles: ["treasury"] };

const invoice = (status: Invoice["status"], audit: Invoice["audit"] = []): Invoice =>
  ({
    id: "inv-1",
    status,
    audit,
    lineItems: [],
    confidence: {},
  }) as unknown as Invoice;

const auditEntry = (action: string, actor = "someone") => ({
  id: "a",
  at: "2026-01-01T00:00:00Z",
  actor,
  action,
});

describe("transition legality", () => {
  it("confirms a draft into approval", () => {
    const r = transition(invoice("draft"), { transition: "confirm", actor: processor });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.status).toBe("review");
  });

  it("rejects an illegal jump draft -> handoff", () => {
    const r = transition(invoice("draft"), { transition: "release", actor: treasury });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("illegal");
  });

  it("rejects approval by a non-approver", () => {
    const r = transition(invoice("review"), { transition: "approve", actor: processor });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("role");
  });

  it("treats payment-failure as a visible loop back to approval", () => {
    const r = transition(invoice("scheduled"), {
      transition: "payment-failed",
      actor: SYSTEM_ACTOR,
      note: "bank returned R03",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.status).toBe("review");
  });
});

describe("mandatory reasons", () => {
  it("requires a reason to reject", () => {
    const r = transition(invoice("review"), { transition: "reject", actor: approver });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("reason-required");
  });

  it("requires a reason to hold", () => {
    const r = transition(invoice("scheduled"), { transition: "hold", actor: treasury });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("reason-required");
  });

  it("accepts reject with a reason", () => {
    const r = transition(invoice("review"), {
      transition: "reject",
      actor: approver,
      note: "duplicate of A-0230",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.status).toBe("rejected");
  });
});

describe("segregation of duties", () => {
  it("blocks the same actor from approving an invoice they confirmed", () => {
    const dual: Actor = { name: "Dana Dual", roles: ["processor", "approver"] };
    const inv = invoice("review", [auditEntry(TRANSITION_LABEL.confirm, "Dana Dual")]);
    const r = transition(inv, { transition: "approve", actor: dual, note: "ok" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("sod");
  });

  it("allows a different actor to approve", () => {
    const inv = invoice("review", [auditEntry(TRANSITION_LABEL.confirm, "Patty Processor")]);
    const r = transition(inv, { transition: "approve", actor: approver });
    expect(r.ok).toBe(true);
  });

  it("exempts the system actor from SoD (auto-verify path)", () => {
    const inv = invoice("draft", [auditEntry(TRANSITION_LABEL.confirm, "system")]);
    const r = transition(inv, { transition: "confirm", actor: SYSTEM_ACTOR });
    expect(r.ok).toBe(true);
  });

  it("reads who performed each SoD-relevant step from the audit trail", () => {
    const s = sodState({
      audit: [
        auditEntry(TRANSITION_LABEL.confirm, "Patty"),
        auditEntry(TRANSITION_LABEL.approve, "Amy"),
      ],
    });
    expect(s.confirmed).toBe("Patty");
    expect(s.approved).toBe("Amy");
    expect(s.released).toBeUndefined();
  });

  it("lets a sole user with all roles confirm then approve the same invoice", () => {
    const sole: Actor = {
      name: "Sole Finance",
      roles: ["processor", "approver", "treasury"],
    };
    const confirmed = invoice("draft");
    const r1 = transition(confirmed, { transition: "confirm", actor: sole, soleUser: true });
    expect(r1.ok).toBe(true);
    const review = invoice("review", [auditEntry(TRANSITION_LABEL.confirm, "Sole Finance")]);
    const r2 = transition(review, {
      transition: "approve",
      actor: sole,
      note: "ok",
      soleUser: true,
    });
    expect(r2.ok).toBe(true);
  });

  it("still blocks SoD for the same dual-role actor when not sole user", () => {
    const dual: Actor = { name: "Dana Dual", roles: ["processor", "approver"] };
    const inv = invoice("review", [auditEntry(TRANSITION_LABEL.confirm, "Dana Dual")]);
    const r = transition(inv, {
      transition: "approve",
      actor: dual,
      note: "ok",
      soleUser: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("sod");
  });

  it("still enforces role gates for a sole user missing the role", () => {
    const soleProcessor: Actor = { name: "Only Proc", roles: ["processor"] };
    const inv = invoice("review", [auditEntry(TRANSITION_LABEL.confirm, "Someone Else")]);
    const r = transition(inv, {
      transition: "approve",
      actor: soleProcessor,
      note: "x",
      soleUser: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("role");
  });

  it("availableTransitions accepts soleUser option", () => {
    const sole: Actor = {
      name: "Sole Finance",
      roles: ["processor", "approver", "treasury"],
    };
    const inv = invoice("review", [auditEntry(TRANSITION_LABEL.confirm, "Sole Finance")]);
    expect(availableTransitions(inv, sole, { soleUser: true })).toContain("approve");
    expect(availableTransitions(inv, sole)).not.toContain("approve");
  });
});

describe("completed immutability", () => {
  it("forbids any transition on a completed invoice except re-open", () => {
    const inv = invoice("paid", [auditEntry(TRANSITION_LABEL.release, "Ted Treasury")]);
    expect(transition(inv, { transition: "reject", actor: approver }).ok).toBe(false);
    expect(transition(inv, { transition: "release", actor: treasury }).ok).toBe(false);
    const reopen = transition(inv, {
      transition: "re-open",
      actor: approver,
      note: "credit note CN-9",
    });
    expect(reopen.ok).toBe(true);
    if (reopen.ok) expect(reopen.result.status).toBe("review");
  });
});

describe("availableTransitions", () => {
  it("offers only role-legal actions in each phase", () => {
    expect(availableTransitions(invoice("draft"), processor)).toContain("confirm");
    expect(availableTransitions(invoice("draft"), approver)).not.toContain("confirm");
    expect(availableTransitions(invoice("review"), approver)).toContain("approve");
    expect(availableTransitions(invoice("scheduled"), treasury)).toContain("release");
  });
});

describe("stripPrematureConfirmEntries", () => {
  it("drops the premature confirm entry that bricked retries", () => {
    const inv = invoice("draft", [
      {
        ...auditEntry(TRANSITION_LABEL.confirm, "Luuk Koppen"),
        note: "Confirmed template extraction",
      },
    ]);
    // Before repair: SoD reads it as already-confirmed and rejects.
    expect(
      transition(inv, {
        transition: "confirm",
        actor: { name: "Luuk Koppen", roles: ["processor"] },
      }).ok,
    ).toBe(false);
    const repaired = stripPrematureConfirmEntries(inv);
    expect(repaired.audit).toEqual([]);
    expect(
      transition(repaired, {
        transition: "confirm",
        actor: { name: "Luuk Koppen", roles: ["processor"] },
      }).ok,
    ).toBe(true);
  });

  it("keeps real entries (different note or other actions)", () => {
    const inv = invoice("draft", [
      { ...auditEntry(TRANSITION_LABEL.confirm, "Luuk Koppen"), note: "some other note" },
      auditEntry("Saved draft field values", "Luuk Koppen"),
    ]);
    expect(stripPrematureConfirmEntries(inv).audit).toHaveLength(2);
  });
});

describe("describeTransitionError", () => {
  it("explains SoD blocks with actor and recovery", () => {
    const text = describeTransitionError({
      kind: "sod",
      responsibility: "confirmed",
      actor: "Luuk Koppen",
    });
    expect(text).toContain("Luuk Koppen");
    expect(text).toContain("someone else");
  });

  it("explains illegal transitions with status", () => {
    expect(
      describeTransitionError({ kind: "illegal", from: "review", transition: "confirm" }),
    ).toContain("review");
  });
});

describe("vendor profile registration phase", () => {
  it("register-profile is a system-only entry point with empty from list", () => {
    const r = transition(invoice("processing"), {
      transition: "register-profile",
      actor: SYSTEM_ACTOR,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.status).toBe("vendor_profile");
  });

  it("rejects register-profile when not run by the system actor", () => {
    const r = transition(invoice("processing"), {
      transition: "register-profile",
      actor: processor,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("role");
  });

  it("vendor-profile-confirmed moves the invoice into Draft", () => {
    const r = transition(invoice("vendor_profile"), {
      transition: "vendor-profile-confirmed",
      actor: processor,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.status).toBe("draft");
  });

  it("vendor-profile-rejected requires a reason", () => {
    const r = transition(invoice("vendor_profile"), {
      transition: "vendor-profile-rejected",
      actor: processor,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("reason-required");
  });

  it("vendor-profile-rejected with a reason moves to rejected", () => {
    const r = transition(invoice("vendor_profile"), {
      transition: "vendor-profile-rejected",
      actor: processor,
      note: "invoice misidentified — wrong vendor on the letterhead",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.status).toBe("rejected");
  });

  it("archive takes a record out of the queue, from the three processor stages", () => {
    for (const status of ["vendor_profile", "draft", "rejected"] as const) {
      const r = transition(invoice(status), { transition: "archive", actor: processor });
      expect(r.ok, `archive from ${status}`).toBe(true);
      if (r.ok) {
        expect(r.result.status).toBe("archived");
        expect(r.result.auditAction).toBe(TRANSITION_LABEL.archive);
      }
    }
  });

  it("archive is illegal once a record is past the processor's hands", () => {
    for (const status of ["review", "scheduled", "archived"] as const) {
      const r = transition(invoice(status), { transition: "archive", actor: processor });
      expect(r.ok, `archive from ${status}`).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("illegal");
    }
  });

  it("a removal leaves a trail that names the person and the reason", () => {
    const before = invoice("vendor_profile", [auditEntry("Vendor profile registered", "system")]);
    const applied = { status: "archived" as const, auditAction: TRANSITION_LABEL.archive };
    const after = archiveRecord(before, processor, applied, "Same vendor and amount as the other.");

    expect(after.status).toBe("archived");
    expect(after.archivedFrom).toBe("vendor_profile");
    expect(after.audit).toHaveLength(before.audit.length + 1);
    expect(after.audit.at(-1)).toMatchObject({
      action: TRANSITION_LABEL.archive,
      actor: processor.name,
      note: "Same vendor and amount as the other.",
    });
  });

  it("a restore returns to the status it left and spends the pointer", () => {
    const archived = archiveRecord(invoice("draft"), processor, {
      status: "archived",
      auditAction: TRANSITION_LABEL.archive,
    });
    const back = restoreRecord(archived, processor);

    expect(back.status).toBe("draft");
    expect(back.archivedFrom).toBeUndefined();
    expect(back.audit.at(-1)?.action).toBe(RESTORE_ACTION);
  });

  it("reopen-draft returns a rejected invoice to draft, and nothing else", () => {
    const ok = transition(invoice("rejected"), { transition: "reopen-draft", actor: processor });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.result.status).toBe("draft");

    // A removed record comes back through restore, which re-reads the status it
    // left — so no transition may leave `archived` by itself.
    const blocked = transition(invoice("archived"), {
      transition: "reopen-draft",
      actor: processor,
    });
    expect(blocked.ok).toBe(false);
  });

  it("confirm is illegal while the invoice is in vendor_profile", () => {
    // Draft's confirm transition must not bypass the profile step.
    const r = transition(invoice("vendor_profile"), { transition: "confirm", actor: processor });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("illegal");
  });

  it("SoD: actor who set the profile cannot also approve the same invoice", () => {
    const dual: Actor = { name: "Dana Dual", roles: ["processor", "approver"] };
    const inv = invoice("review", [
      auditEntry(TRANSITION_LABEL["vendor-profile-confirmed"], "Dana Dual"),
    ]);
    const r = transition(inv, { transition: "approve", actor: dual });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("sod");
  });

  it("sodState reads the profile-confirmed entry as the confirmer", () => {
    const s = sodState({
      audit: [auditEntry(TRANSITION_LABEL["vendor-profile-confirmed"], "Patty")],
    });
    expect(s.confirmed).toBe("Patty");
  });
});

describe("frozen where a person decided it", () => {
  it("freezes the four decided stages and nothing the machine still moves", () => {
    for (const status of ["scheduled", "paid", "rejected", "archived"] as const) {
      expect(isFrozen({ status }), status).toBe(true);
    }
    for (const status of ["vendor_profile", "draft", "review", "processing", "failed"] as const) {
      expect(isFrozen({ status }), status).toBe(false);
    }
  });

  it("refuses any field patch on a decided record and names re-open as the way", () => {
    for (const status of ["scheduled", "paid", "rejected", "archived"] as const) {
      const refusal = patchRefusal({ status });
      expect(refusal, status).not.toBeNull();
      expect(refusal!.reason, status).toContain("re-open");
    }
    expect(patchRefusal({ status: "review" })).toBeNull();
    expect(patchRefusal({ status: "draft" })).toBeNull();
  });

  it("lets an approver re-open an approved invoice, with a reason", () => {
    const r = transition(invoice("scheduled"), {
      transition: "re-open",
      actor: approver,
      note: "Freight line was added after approval",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.status).toBe("review");
  });

  it("refuses a re-open with no reason, and from an undecided stage", () => {
    const noReason = transition(invoice("scheduled"), { transition: "re-open", actor: approver });
    expect(noReason.ok).toBe(false);

    const tooEarly = transition(invoice("draft"), {
      transition: "re-open",
      actor: approver,
      note: "changed my mind",
    });
    expect(tooEarly.ok).toBe(false);
  });

  it("the approver's role is required to retract an approval", () => {
    const r = transition(invoice("scheduled"), {
      transition: "re-open",
      actor: processor,
      note: "processor cannot un-sign someone else's approval",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("role");
  });
});

describe("the decision a record sits on", () => {
  it("finds a rejection at registration as well as one at approval", () => {
    expect(
      lastDecision(
        invoice("rejected", [
          auditEntry(TRANSITION_LABEL["vendor-profile-rejected"], "Patty Processor"),
        ]),
      )?.actor,
    ).toBe("Patty Processor");

    expect(
      lastDecision(invoice("rejected", [auditEntry(TRANSITION_LABEL.reject, "Amy Approver")]))
        ?.actor,
    ).toBe("Amy Approver");
  });

  it("reads an approval as the decision once the record is approved", () => {
    const inv = invoice("scheduled", [
      auditEntry(TRANSITION_LABEL.confirm, "Patty Processor"),
      auditEntry(TRANSITION_LABEL.approve, "Dana Whitfield"),
    ]);
    expect(lastDecision(inv)?.action).toBe(TRANSITION_LABEL.approve);
  });

  it("quotes the decision in force after a re-open and a second one", () => {
    const inv = invoice("rejected", [
      auditEntry(TRANSITION_LABEL.reject, "Amy Approver"),
      auditEntry(TRANSITION_LABEL["reopen-draft"], "Patty Processor"),
      auditEntry(TRANSITION_LABEL.reject, "Dana Whitfield"),
    ]);
    expect(lastDecision(inv)?.actor).toBe("Dana Whitfield");
  });

  it("is undefined on a record that was never decided", () => {
    expect(lastDecision(invoice("draft", [auditEntry(TRANSITION_LABEL.confirm)]))).toBeUndefined();
  });
});
