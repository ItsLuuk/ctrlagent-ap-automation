import { describe, expect, test } from "bun:test";
import { PREDEFINED_TAGS, TAG_TONES } from "./types";

describe("TAG_TONES", () => {
  test("covers every predefined tag", () => {
    expect(new Set(Object.keys(TAG_TONES))).toEqual(new Set(PREDEFINED_TAGS));
  });

  test("contains no background fills", () => {
    for (const tone of Object.values(TAG_TONES)) {
      expect(tone.border).not.toMatch(/\bbg-/);
      expect(tone.accent).not.toMatch(/\bbg-/);
    }
  });

  test("reserves destructive for Late, Urgent, Duplicate risk", () => {
    expect(TAG_TONES["Late"].border).toContain("destructive");
    expect(TAG_TONES["Urgent"].border).toContain("destructive");
    expect(TAG_TONES["Duplicate risk"].border).toContain("destructive");
    expect(TAG_TONES["First-time vendor"].border).toContain("foundry-orange");
    expect(TAG_TONES["International"].border).toContain("steel");
  });
});
