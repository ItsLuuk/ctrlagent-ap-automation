import { describe, expect, test } from "bun:test";
import {
  AWAITING_PERSON,
  PHASE_BY_STATUS,
  PHASE_LABEL,
  PHASE_ORDER,
  PHASE_STATUSES,
  type InvoiceStatus,
  type Phase,
} from "./types";

const ALL_STATUSES: InvoiceStatus[] = [
  "vendor_profile",
  "draft",
  "review",
  "scheduled",
  "rejected",
  "paid",
  "archived",
  "processing",
  "failed",
];

describe("invoice phases", () => {
  test("PHASE_ORDER lists every phase exactly once", () => {
    expect([...PHASE_ORDER].sort()).toEqual([
      "approval",
      "draft",
      "history",
      "payment",
      "profiling",
    ]);
    expect(new Set(PHASE_ORDER).size).toBe(PHASE_ORDER.length);
  });

  test("every phase has a label of its own", () => {
    for (const phase of PHASE_ORDER) {
      expect(PHASE_LABEL[phase]).toBeTruthy();
    }
    const labels = PHASE_ORDER.map((phase) => PHASE_LABEL[phase]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  /**
   * The invariant that keeps money visible: a status with no phase would be a
   * record on no tab at all, which is how an invoice stops being anyone's job.
   */
  test("every status sits in exactly one phase, and none is left out", () => {
    const membershipsOf = (status: InvoiceStatus) =>
      PHASE_ORDER.filter((phase) => PHASE_STATUSES[phase].includes(status));

    for (const status of ALL_STATUSES) {
      expect(membershipsOf(status), `${status} must sit in exactly one phase`).toHaveLength(1);
      expect(PHASE_BY_STATUS[status]).toBeDefined();
    }

    const covered = PHASE_ORDER.flatMap((phase) => PHASE_STATUSES[phase]);
    expect([...covered].sort()).toEqual([...ALL_STATUSES].sort());
  });

  test("PHASE_BY_STATUS agrees with the per-phase status lists", () => {
    for (const phase of PHASE_ORDER) {
      for (const status of PHASE_STATUSES[phase]) {
        expect(PHASE_BY_STATUS[status]).toBe(phase);
      }
    }
  });

  test("the phases match how the work moves", () => {
    expect(PHASE_STATUSES.profiling).toEqual(["vendor_profile"]);
    expect(PHASE_STATUSES.draft).toEqual(["failed", "draft", "rejected", "processing"]);
    // "For payment" is the app's own name for `scheduled` (state-machine.ts).
    expect(PHASE_STATUSES.payment).toEqual(["scheduled"]);
    expect(PHASE_STATUSES.approval).toEqual(["review"]);
    // Settled records are the only ones a phase calls history.
    expect([...PHASE_STATUSES.history].sort()).toEqual(["archived", "paid"]);
  });

  test("a settled record never waits on a person", () => {
    for (const status of AWAITING_PERSON) {
      const phase = PHASE_BY_STATUS[status];
      expect(["profiling", "draft", "approval"]).toContain(phase as Phase);
    }
  });
});
