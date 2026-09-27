import { describe, expect, it } from "bun:test";
import { DEFAULT_SOD_POLICY, normalizeSodPolicy, SOD_RULE_IDS } from "./sod";
import { availableTransitions, transition, TRANSITION_LABEL, type Actor } from "./state-machine";
import type { Invoice } from "./types";

const actor: Actor = { name: "Sam", roles: ["processor", "approver", "treasury"] };
const invoice = (audit: Invoice["audit"]) =>
  ({ status: "review", audit }) as Pick<Invoice, "status" | "audit">;
const entry = {
  id: "a",
  at: "2026-01-01T00:00:00Z",
  actor: "Sam",
  action: TRANSITION_LABEL.confirm,
};

describe("configurable segregation of duties", () => {
  it("enables every control by default and ignores unknown persisted fields", () => {
    expect(normalizeSodPolicy(undefined)).toEqual(DEFAULT_SOD_POLICY);
    expect(normalizeSodPolicy({ extractor_ne_approver: false, unexpected: true })).toEqual({
      ...DEFAULT_SOD_POLICY,
      extractor_ne_approver: false,
    });
    expect(SOD_RULE_IDS).toHaveLength(3);
  });

  it("blocks by default and permits the same person only when the rule is off", () => {
    const inv = invoice([entry]);
    expect(transition(inv, { transition: "approve", actor }).ok).toBe(false);
    const disabled = { ...DEFAULT_SOD_POLICY, extractor_ne_approver: false };
    expect(transition(inv, { transition: "approve", actor, sodPolicy: disabled }).ok).toBe(true);
    expect(availableTransitions(inv, actor, { sodPolicy: disabled })).toContain("approve");
  });
});
