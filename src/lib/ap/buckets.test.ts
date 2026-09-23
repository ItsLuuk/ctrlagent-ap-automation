import { describe, expect, test } from "bun:test";
import {
  AWAITING_PERSON,
  BUCKET_BY_STATUS,
  IN_FLIGHT,
  LATER,
  NEEDS_YOU,
  type Bucket,
  type InvoiceStatus,
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

describe("inbox buckets", () => {
  test("NEEDS_YOU aliases AWAITING_PERSON", () => {
    expect(NEEDS_YOU).toEqual(AWAITING_PERSON);
  });

  test("IN_FLIGHT is processing only", () => {
    expect(IN_FLIGHT).toEqual(["processing"]);
  });

  test("LATER is scheduled, rejected, paid, archived", () => {
    expect(LATER).toEqual(["scheduled", "rejected", "paid", "archived"]);
  });

  test("every status maps to exactly one bucket", () => {
    const bucketOf = (s: InvoiceStatus): Bucket => BUCKET_BY_STATUS[s];
    for (const s of ALL_STATUSES) {
      const memberships = [NEEDS_YOU.includes(s), IN_FLIGHT.includes(s), LATER.includes(s)].filter(
        Boolean,
      );
      expect(memberships, `${s} must sit in exactly one bucket`).toHaveLength(1);
      expect(bucketOf(s)).toBeDefined();
    }
  });

  test("BUCKET_BY_STATUS agrees with the three lists", () => {
    for (const s of ALL_STATUSES) {
      if (NEEDS_YOU.includes(s)) expect(BUCKET_BY_STATUS[s]).toBe("needsYou");
      else if (IN_FLIGHT.includes(s)) expect(BUCKET_BY_STATUS[s]).toBe("inFlight");
      else expect(BUCKET_BY_STATUS[s]).toBe("later");
    }
  });
});
