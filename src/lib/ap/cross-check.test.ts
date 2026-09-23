import { describe, expect, it } from "bun:test";
import {
  AGREEMENT_BOOST,
  DISAGREEMENT_CEILING,
  adjustConfidenceForAgreement,
  applyCrossCheck,
  compareExtractions,
  disagreements,
} from "./cross-check";
import { CONFIDENT_THRESHOLD } from "./mapping";
import { confirmedReads, extractFieldsFromPages } from "./ocr";

describe("compareExtractions", () => {
  it("agrees on values that match for their field type", () => {
    const crossCheck = compareExtractions(
      {
        vendor: "Northwind Services B.V.",
        invoiceNumber: "NW-20481",
        issueDate: "2026-04-12",
        subtotal: 1000,
        total: 1210,
      },
      {
        vendor: "Northwind Services B.V.",
        invoiceNumber: "nw-20481",
        issueDate: "12-04-2026",
        subtotal: 1000,
        total: 1210,
      },
    );

    expect(crossCheck.vendor).toBe("agree");
    expect(crossCheck.invoiceNumber).toBe("agree");
    expect(crossCheck.issueDate).toBe("agree");
    expect(crossCheck.subtotal).toBe("agree");
    expect(crossCheck.total).toBe("agree");
  });

  it("flags a different amount as a disagreement", () => {
    const crossCheck = compareExtractions({ total: 1210 }, { total: 1200 });
    expect(crossCheck.total).toBe("disagree");
  });

  it("flags a different date and vendor as disagreements", () => {
    const crossCheck = compareExtractions(
      { issueDate: "2026-04-12", vendor: "Northwind Services B.V." },
      { issueDate: "2026-05-12", vendor: "Atlas Print" },
    );
    expect(crossCheck.issueDate).toBe("disagree");
    expect(crossCheck.vendor).toBe("disagree");
  });

  it("treats a field only one reader saw as unverified, not a disagreement", () => {
    const crossCheck = compareExtractions({ total: 1210 }, {});
    expect(crossCheck.total).toBe("unverified");
    expect(crossCheck.vendor).toBe("unverified");
  });

  it("uses the amount tolerance rather than exact equality", () => {
    const crossCheck = compareExtractions({ total: 1210 }, { total: 1210.005 });
    expect(crossCheck.total).toBe("agree");
  });
});

describe("adjustConfidenceForAgreement", () => {
  it("boosts an agreed field and caps at 0.99", () => {
    expect(adjustConfidenceForAgreement(0.9, "agree")).toBeCloseTo(0.9 + AGREEMENT_BOOST, 2);
    expect(adjustConfidenceForAgreement(0.99, "agree")).toBe(0.99);
  });

  it("pins a disagreed field below the review threshold", () => {
    const adjusted = adjustConfidenceForAgreement(0.95, "disagree");
    expect(adjusted).toBe(DISAGREEMENT_CEILING);
    expect(adjusted).toBeLessThan(CONFIDENT_THRESHOLD);
  });

  it("never raises the confidence of a disagreed field", () => {
    expect(adjustConfidenceForAgreement(0.4, "disagree")).toBe(0.4);
  });

  it("leaves unverified and missing outcomes untouched", () => {
    expect(adjustConfidenceForAgreement(0.8, "unverified")).toBe(0.8);
    expect(adjustConfidenceForAgreement(0.8, undefined)).toBe(0.8);
  });
});

describe("applyCrossCheck", () => {
  it("adjusts only the fields present in the confidence map", () => {
    const result = applyCrossCheck(
      { vendor: 0.9, total: 0.95 },
      { vendor: "agree", total: "disagree", tax: "unverified" },
    );
    expect(result.vendor).toBeCloseTo(0.93, 2);
    expect(result.total).toBe(DISAGREEMENT_CEILING);
    expect(result.tax).toBeUndefined();
  });

  it("returns the original map when there is no cross-check", () => {
    const confidence = { total: 0.95 };
    expect(applyCrossCheck(confidence, undefined)).toBe(confidence);
  });
});

describe("disagreements", () => {
  it("lists only the disputed fields", () => {
    const listed = disagreements({ vendor: "agree", total: "disagree", tax: "unverified" });
    expect(listed).toEqual(["total"]);
  });

  it("returns nothing without a cross-check", () => {
    expect(disagreements(undefined)).toEqual([]);
  });
});

describe("confirmedReads", () => {
  it("keeps only fields the text reader actually found", () => {
    const fields = extractFieldsFromPages(
      [
        {
          pageNumber: 1,
          text: [
            "Northwind Services B.V.",
            "Factuurnummer: NW-20481",
            "Totaal te betalen 1.210,00",
          ].join("\n"),
          confidence: 0.95,
        },
      ],
      "northwind-20481.pdf",
    );

    const reads = confirmedReads(fields);
    expect(reads.vendor).toBe("Northwind Services B.V.");
    expect(reads.invoiceNumber).toBe("NW-20481");
    expect(reads.total).toBe(1210);
    // No subtotal/tax row on the page — they must not appear as reads.
    expect(reads.subtotal).toBeUndefined();
    expect(reads.tax).toBeUndefined();
  });

  it("excludes the file-name vendor fallback", () => {
    const fields = extractFieldsFromPages(
      [{ pageNumber: 1, text: ["Factuur", "BTW NR 123", "€ 10,00"].join("\n"), confidence: 0.9 }],
      "unreadable-scan.pdf",
    );

    // The extractor still reports some vendor (the file name), but it is a
    // placeholder, so it must not count as an independent read.
    expect(fields.vendor).toBeDefined();
    expect(fields.fieldSources.vendor).toBeUndefined();
    expect(confirmedReads(fields).vendor).toBeUndefined();
  });
});
