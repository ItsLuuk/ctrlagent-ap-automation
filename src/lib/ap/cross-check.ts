/**
 * Cross-source agreement.
 *
 * A vision model and the regex text scan are different engines reading the same
 * page. Disagreements remain visible as explicit cross-check outcomes; no
 * synthetic score is assigned to either reader.
 *
 * Comparison is delegated to `compareZoneValue`, the same field-aware
 * money/date/text agreement used by the zone sanity check, so there is exactly
 * one definition of "these two reads match".
 */
import { ZONE_FIELDS, type CrossCheck, type ExtractedField } from "./types";
import { compareZoneValue } from "./zones";

/** One reader's output: present field values, missing fields simply absent. */
export type FieldReads = Partial<Record<ExtractedField, string | number>>;

function isKnown(value: string | number | undefined): value is string | number {
  if (value === undefined || value === null) return false;
  return typeof value === "number" ? Number.isFinite(value) : value.trim() !== "";
}

/**
 * Compares two independent reads field by field. A field only counts as
 * verified when BOTH readers returned something; a lone read is "unverified",
 * not a disagreement.
 */
export function compareExtractions(primary: FieldReads, secondary: FieldReads): CrossCheck {
  const out: CrossCheck = {};
  for (const field of ZONE_FIELDS) {
    const a = primary[field];
    const b = secondary[field];
    if (!isKnown(a) || !isKnown(b)) {
      out[field] = "unverified";
      continue;
    }
    out[field] = compareZoneValue(field, a, String(b)) ? "agree" : "disagree";
  }
  return out;
}

/** Fields both readers saw but read differently. */
export function disagreements(crossCheck: CrossCheck | undefined): ExtractedField[] {
  if (!crossCheck) return [];
  return ZONE_FIELDS.filter((field) => crossCheck[field] === "disagree");
}
