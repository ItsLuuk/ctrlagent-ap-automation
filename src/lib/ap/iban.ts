/**
 * IBAN — the pure parts: normalization, shape, and the ISO 13616 check-digit
 * test.
 *
 * Shared by the vendor profile card (structured input) and the approval
 * verdict (is the IBAN on this invoice self-consistent at all?), so there is
 * exactly one definition of "well-formed IBAN" in the app.
 */

/** Letters and digits only, uppercased — the canonical form for comparison. */
export const normalizeIban = (raw: string): string => raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/** Country code + 2 check digits + 8..30 BBAN characters. */
export const IBAN_SHAPE = /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/;

export function ibanShapeValid(normalized: string): boolean {
  return IBAN_SHAPE.test(normalized);
}

/** The two-letter country code, or "" when there isn't one yet. */
export function ibanCountry(normalized: string): string {
  return /^[A-Z]{2}/.test(normalized) ? normalized.slice(0, 2) : "";
}

/**
 * True when the two check digits agree with the rest of the IBAN: move the
 * first four characters to the end, turn letters into numbers (A=10), and the
 * whole thing must be ≡ 1 mod 97.
 */
export function ibanChecksumValid(normalized: string): boolean {
  if (!ibanShapeValid(normalized)) return false;
  const rearranged = `${normalized.slice(4)}${normalized.slice(0, 4)}`;
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}
