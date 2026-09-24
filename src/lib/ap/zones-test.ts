import { describe, expect, it } from "bun:test";
import {
  addDaysIso,
  dueDateFromPaymentTerms,
  endOfMonthIso,
  eomTermDays,
  findPaymentTermDays,
  parseDateParts,
} from "./zones";

describe("endOfMonthIso", () => {
  it("returns the last day of each month", () => {
    // Month 4 = April → April 30
    expect(endOfMonthIso(2026, 4)).toBe("2026-04-30");
    // Month 2 = February 2026 (non-leap) → Feb 28
    expect(endOfMonthIso(2026, 2)).toBe("2026-02-28");
    // February 2024 (leap) → Feb 29
    expect(endOfMonthIso(2024, 2)).toBe("2024-02-29");
    // December → wraps to next year's January 31
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

  it("returns 14 as the default when the EOM phrase is present but no day count", () => {
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
    // Invoice April 12 2026. EOM month = May (month after April). End of May =
    // 2026-05-31. +14 days = 2026-06-14.
    const text = "Betaling 14 dagen einde van de maand";
    expect(dueDateFromPaymentTerms(text, "2026-04-12")).toBe("2026-06-14");
  });

  it("computes due date for '30 dagen einde van de maand' on an April invoice", () => {
    // Invoice April 12. End of May + 30 days = 2026-05-31 + 30 = 2026-06-30.
    const text = "30 dagen einde van de maand";
    expect(dueDateFromPaymentTerms(text, "2026-04-12")).toBe("2026-06-30");
  });

  it("wraps December invoice to next year", () => {
    // Invoice December 5 2026. EOM month = January 2027. End of Jan + 14 =
    // 2027-01-31 + 14 = 2027-02-14.
    const text = "14 dagen einde van de maand";
    expect(dueDateFromPaymentTerms(text, "2026-12-05")).toBe("2027-02-14");
  });

  it("still handles plain '14 dagen' without EOM", () => {
    const text = "Betalingsconditie 14 dagen";
    expect(dueDateFromPaymentTerms(text, "2026-04-12")).toBe("2026-04-26");
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
