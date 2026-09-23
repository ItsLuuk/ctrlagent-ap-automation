import { describe, expect, test } from "bun:test";
import { STATUS_TONES } from "@/lib/colors";
import type { InvoiceStatus } from "./types";

const ALL_STATUSES: InvoiceStatus[] = [
  "vendor_profile",
  "draft",
  "review",
  "scheduled",
  "paid",
  "rejected",
  "archived",
  "failed",
  "processing",
];

describe("STATUS_TONES", () => {
  // Named without a count on purpose: the number in the old name ("all 8") was
  // the thing that went stale the moment a status was added.
  test("covers every InvoiceStatus value", () => {
    expect(new Set(Object.keys(STATUS_TONES))).toEqual(new Set(ALL_STATUSES));
  });

  test("contains no bg- fill classes", () => {
    for (const tone of Object.values(STATUS_TONES)) {
      expect(tone.text).not.toMatch(/\bbg-/);
    }
  });

  test("reserves destructive text for rejected/failed only", () => {
    expect(STATUS_TONES["rejected"].text).toContain("destructive");
    expect(STATUS_TONES["failed"].text).toContain("destructive");
    for (const s of ALL_STATUSES) {
      if (s === "rejected" || s === "failed") continue;
      expect(STATUS_TONES[s].text).not.toContain("destructive");
    }
  });

  test("paid is plain foreground ink", () => {
    expect(STATUS_TONES["paid"].text).toBe("text-foreground");
  });
});
