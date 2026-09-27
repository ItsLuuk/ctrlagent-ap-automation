import { describe, expect, it } from "bun:test";
import { FIELD_SHAPE, runChars, runForShape, shapeFit, shapeNote } from "./field-shape";
import type { OcrWord } from "./types";

function word(text: string): OcrWord {
  return { text, x: 0, y: 0, w: 0.05, h: 0.02, confidence: 0.98 };
}

const run = (...texts: string[]): OcrWord[] => texts.map(word);

describe("field shape", () => {
  it("describes every mapped field", () => {
    for (const [field, shape] of Object.entries(FIELD_SHAPE)) {
      expect(shape.maxChars, field).toBeGreaterThan(shape.minChars);
      expect(shape.maxWords, field).toBeGreaterThan(0);
    }
  });

  it("keeps a first word however long, so an over-long value is not lost", () => {
    // A 40-character IBAN: wider than we expect, still one printed value.
    const long = "NL91ABNA0417164300EXTRA00";
    const cut = runForShape("iban", run(long));
    expect(cut).toHaveLength(1);
    expect(cut[0]?.text).toBe(long);
  });

  it("stops a run before it swallows the words after the value", () => {
    const line = run("€", "121,00", "Betalingscondities", "30", "dagen");
    const cut = runForShape("total", line);
    expect(cut.map((w) => w.text)).toEqual(["€", "121,00"]);
  });

  it("reads a multi-word date whole but still stops there", () => {
    const cut = runForShape("issueDate", run("13", "juli", "2026", "Factuurnummer", "RAX-9"));
    expect(cut.map((w) => w.text)).toEqual(["13", "juli", "2026"]);
  });

  it("does not let a date run reach the label printed after it", () => {
    // Three words and 26 characters: both caps say stop, whatever comes next.
    const cut = runForShape("dueDate", run("13", "juli", "2026", "Vervaldatum"));
    expect(cut.map((w) => w.text)).toEqual(["13", "juli", "2026"]);
  });

  it("lets a long field keep more of the line than a short one", () => {
    const line = run("Ravelijnstraat", "40,", "4102", "AM", "Culemborg", "Nederland");
    expect(runForShape("address", line).length).toBeGreaterThan(
      runForShape("businessRegistrationNumber", line).length,
    );
  });

  it("scores a run that fits as a full fit and one that does not as less", () => {
    expect(shapeFit("total", run("€ 121,00"))).toBe(1);
    expect(shapeFit("businessRegistrationNumber", run("87654321"))).toBe(1);
    // A total is not usually 36 characters wide.
    expect(
      shapeFit("total", run("121,00", "incl", "btw", "en", "verzendkosten", "voor", "2026")),
    ).toBeLessThan(0.3);
    // Twice the cap is not a fit at all.
    expect(shapeFit("total", run("1".repeat(41)))).toBe(0);
    // A two-character value is far too narrow for an IBAN.
    expect(shapeFit("iban", run("12"))).toBeLessThan(0.5);
  });

  it("never returns a fit above one, however short the value", () => {
    expect(shapeFit("vendor", run("A"))).toBeLessThanOrEqual(1);
    expect(shapeFit("total", run("1"))).toBeGreaterThanOrEqual(0);
  });

  it("says nothing when the width is exactly what was expected", () => {
    expect(shapeNote("total", run("€ 121,00"))).toBe("");
    expect(shapeNote("businessRegistrationNumber", run("12345678"))).toBe("");
  });

  it("states the width it measured, so the reviewer can judge it themselves", () => {
    const note = shapeNote("total", run("121,00", "Betalingscondities", "30", "dagen"));
    expect(note).toContain("4 words");
    expect(note).toContain("20");
    expect(runChars(run("121,00", "30"))).toBe(8);
  });
});
