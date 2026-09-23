/**
 * Cross-source agreement.
 *
 * A vision model and the regex text scan are different engines reading the same
 * page. When they agree, a field is a near-certainty; when they disagree the
 * value is present but suspect, so we keep it and pin the confidence below the
 * review threshold (see `CONFIDENT_THRESHOLD` in mapping.ts) so the draft screen
 * asks a human to look. Agreement never changes a value — only its confidence.
 *
 * Comparison is delegated to `compareZoneValue`, the same field-aware
 * money/date/text agreement used by the zone sanity check, so there is exactly
 * one definition of "these two reads match".
 */
import { ZONE_FIELDS, type CrossCheck, type CrossCheckOutcome, type ExtractedField } from "./types";
import { compareZoneValue } from "./zones";

/** Confidence added to a field both readers agree on. */
export const AGREEMENT_BOOST = 0.03;
/**
 * Confidence ceiling for a disputed field. Deliberately below
 * `CONFIDENT_THRESHOLD` (0.75) so the field trips the amber/low-confidence path.
 */
export const DISAGREEMENT_CEILING = 0.6;

/** One reader's output: present field values, missing fields simply absent. */
export type FieldReads = Partial<Record<ExtractedField, string | number>>;

function isKnown(value: string | number | undefined): value is string | number {
  if (value === undefined || value === null) return false;
  return typeof value === "number" ? Number.isFinite(value) : value.trim() !== "";
}

function round2(value: number): number {
  return Number(value.toFixed(2));
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

/** Applies the agreement signal to a single field's confidence. */
export function adjustConfidenceForAgreement(
  confidence: number,
  outcome: CrossCheckOutcome | undefined,
): number {
  if (outcome === "agree") return round2(Math.min(0.99, confidence + AGREEMENT_BOOST));
  if (outcome === "disagree") return round2(Math.min(confidence, DISAGREEMENT_CEILING));
  return confidence;
}

/** Applies agreement across a confidence map. Fields absent from the map stay absent. */
export function applyCrossCheck(
  confidence: Partial<Record<ExtractedField, number>>,
  crossCheck: CrossCheck | undefined,
): Partial<Record<ExtractedField, number>> {
  if (!crossCheck) return confidence;
  const out: Partial<Record<ExtractedField, number>> = {};
  for (const field of ZONE_FIELDS) {
    const value = confidence[field];
    if (value === undefined) continue;
    out[field] = adjustConfidenceForAgreement(value, crossCheck[field]);
  }
  return out;
}

/** Fields both readers saw but read differently. */
export function disagreements(crossCheck: CrossCheck | undefined): ExtractedField[] {
  if (!crossCheck) return [];
  return ZONE_FIELDS.filter((field) => crossCheck[field] === "disagree");
}
