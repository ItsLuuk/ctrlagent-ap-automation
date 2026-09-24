import { describe, expect, it } from "bun:test";
import {
  addDaysIso,
  dueDateFromPaymentTerms,
  endOfMonthIso,
  eomTermDays,
  isValidDutchVatChecksum,
  isValidKvKNumber,
  normalizeDutchVat,
} from "../src/lib/ap/zones";

describe("endOfMonthIso", () => {
  it("returns the last day of each month", () => {
    expect(endOfMonthIso(2026, 4)).toBe("2026-04-30");
    expect(endOfMonthIso(2026, 2)).toBe("2026-02-28");
    expect(endOfMonthIso(2024, 2)).toBe("2024-02-29");
    expect(endOfMonthIso(2026, 12)).toBe("2026-12-31");
  });
});

describe("eomTermDays", () => {
  it("reads '14 dagen einde van de maand'", () => {
    expect(eomTermDays("Betaling 14 dagen einde van de maand")).toBe(14);
  });

  it("reads '30 dagen einde van de maand'", () => {
    expect(eomTermDays("Voorwaarden: 30 dagen einde van de maand")).toBe(30);
  });

  it("reads '30 dagen e.o.m.'", () => {
    expect(eomTermDays("Betalingsconditie 30 dagen e.o.m.")).toBe(30);
  });

  it("reads '14 dagen e.o.m.'", () => {
    expect(eomTermDays("e.o.m. 14 dagen")).toBe(14);
  });

  it("reads 'einde maand + 14 dagen'", () => {
    expect(eomTermDays("Betaling einde maand + 14 dagen")).toBe(14);
  });

  it("reads 'einde maand en 30 dagen'", () => {
    expect(eomTermDays("einde maand en 30 dagen")).toBe(30);
  });

  it("reads 'e.o.m. + 21 dagen'", () => {
    expect(eomTermDays("e.o.m. + 21 dagen")).toBe(21);
  });

  it("returns 14 as default when EOM phrase is present but no day count", () => {
    expect(eomTermDays("Betaling: einde van de maand")).toBe(14);
  });

  it("returns undefined when the phrase is absent", () => {
    expect(eomTermDays("14 dagen na factuurdatum")).toBeUndefined();
    expect(eomTermDays("Net 30")).toBeUndefined();
    expect(eomTermDays("")).toBeUndefined();
  });

  it("returns undefined when the day count is out of range", () => {
    expect(eomTermDays("999 dagen einde van de maand")).toBeUndefined();
  });
});

describe("dueDateFromPaymentTerms with EOM", () => {
  it("computes due date for '14 dagen einde van de maand' on an April invoice", () => {
    const text = "Betaling 14 dagen einde van de maand";
    // Invoice April 12. EOM month = May. End of May = 2026-05-31. +14d = 2026-06-14.
    expect(dueDateFromPaymentTerms(text, "2026-04-12")).toBe("2026-06-14");
  });

  it("computes due date for '30 dagen einde van de maand' on an April invoice", () => {
    expect(dueDateFromPaymentTerms("30 dagen einde van de maand", "2026-04-12")).toBe(
      "2026-06-30",
    );
  });

  it("wraps December invoice to next year", () => {
    expect(dueDateFromPaymentTerms("14 dagen einde van de maand", "2026-12-05")).toBe(
      "2027-02-14",
    );
  });

  it("still handles plain '14 dagen' without EOM", () => {
    expect(dueDateFromPaymentTerms("Betalingsconditie 14 dagen", "2026-04-12")).toBe(
      "2026-04-26",
    );
  });

  it("returns undefined when no issue date is given", () => {
    expect(dueDateFromPaymentTerms("14 dagen einde van de maand", undefined)).toBeUndefined();
  });

  it("returns undefined when the issue date is unparseable", () => {
    expect(dueDateFromPaymentTerms("14 dagen einde van de maand", "not-a-date")).toBeUndefined();
  });
});

describe("addDaysIso", () => {
  it("adds days across month boundaries", () => {
    expect(addDaysIso("2026-05-31", 1)).toBe("2026-06-01");
    expect(addDaysIso("2026-05-31", 30)).toBe("2026-06-30");
  });
});

// ── NL VAT modulus-97 checksum ─────────────────────────────────────────

describe("isValidDutchVatChecksum", () => {
  it("accepts a valid NL VAT number", () => {
    // Any NL + 11 digits where the 11-digit number is divisible by 97.
    // 97 * 1 = 0000000097 → NL000000009B07
    expect(isValidDutchVatChecksum("NL000000009B07")).toBe(true);
    expect(isValidDutchVatChecksum("NL000000000B00")).toBe(true);
  });

  it("rejects a structurally-valid but wrong-checksum VAT", () => {
    // 12345678901 mod 97: 127275040 * 97 = 12345678880, remainder = 21
    // Check digits should be 21, but we supplied 01.
    expect(isValidDutchVatChecksum("NL123456789B01")).toBe(false);
  });

  it("rejects a non-Dutch VAT format", () => {
    expect(isValidDutchVatChecksum("NL1234567890")).toBe(false);
    expect(isValidDutchVatChecksum("DE123456789")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isValidDutchVatChecksum("nl000000009b07")).toBe(true);
  });

  it("handles spaces in the input", () => {
    expect(isValidDutchVatChecksum("NL 000000009 B 07")).toBe(true);
  });
});

describe("isValidKvKNumber", () => {
  it("accepts a valid 8-digit KvK number", () => {
    // d=1111111: sum = 1+2+3+4+5+6+7 = 28, 28 mod 11 = 6 → number 11111116
    expect(isValidKvKNumber("11111116")).toBe(true);
  });

  it("rejects a KvK with wrong check digit", () => {
    expect(isValidKvKNumber("11111115")).toBe(false);
  });

  it("rejects non-8-digit input", () => {
    expect(isValidKvKNumber("1234567")).toBe(false);
    expect(isValidKvKNumber("123456789")).toBe(false);
    expect(isValidKvKNumber("1234AB89")).toBe(false);
  });

  it("strips spaces and leading zeros", () => {
    expect(isValidKvKNumber("00001111116")).toBe(true);
    expect(isValidKvKNumber("11 11 11 16")).toBe(true);
  });
});

describe("normalizeDutchVat", () => {
  it("keeps a valid NL VAT with NL prefix as-is", () => {
    expect(normalizeDutchVat("NL000000009B07")).toBe("NL000000009B07");
  });

  it("adds NL prefix to a bare 11-digit number when checksum passes", () => {
    expect(normalizeDutchVat("00000000907")).toBe("NL000000009B07");
  });

  it("rejects a bare 11-digit number with wrong checksum (returns as-is)", () => {
    expect(normalizeDutchVat("12345678901")).toBe("12345678901");
  });

  it("adds NL prefix to a 9+B+2 number missing NL", () => {
    expect(normalizeDutchVat("000000009B07")).toBe("NL000000009B07");
  });

  it("normalises whitespace and case", () => {
    expect(normalizeDutchVat("nl 000000009 b 07")).toBe("NL000000009B07");
  });
});
