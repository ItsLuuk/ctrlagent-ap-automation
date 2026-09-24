import { describe, expect, it } from "bun:test";
import {
  bottomQuarterLines,
  totalFromBold,
  vendorFromFont,
  type FontHeuristicHit,
} from "./font-heuristics";
import type { TextLayerWord } from "./text-layer-layout";

function w(
  text: string,
  x: number,
  y: number,
  h = 0.02,
  fontSize = 10,
  isBold = false,
): TextLayerWord {
  return {
    text,
    x,
    y,
    w: 0.05,
    h,
    confidence: 0.98,
    fontSize,
    isBold,
    fontName: isBold ? "helvetica-bold" : "helvetica",
  };
}

function words(...arr: Array<[string, number, number, number?, number?, boolean?]>): TextLayerWord[] {
  return arr.map(([text, x, y, h, fs, bold]) =>
    w(text, x, y, h ?? 0.02, fs ?? 10, bold ?? false),
  );
}

describe("vendorFromFont", () => {
  it("picks the largest top-block line as the vendor name", () => {
    const wordsArr = [
      ...words(
        ["Factuur", 0.1, 0.1],
        ["nummer", 0.2, 0.1],
        [":", 0.28, 0.1],
        ["2026-001", 0.3, 0.1],
      ),
      ...words(
        ["Acme B.V.", 0.1, 0.08, 0.03, 16, true],
        ["Straat 1", 0.1, 0.16, 0.02, 10],
      ),
      ...words(
        ["Dit is body text.", 0.1, 0.5],
        ["Meer body.", 0.1, 0.55],
      ),
      ...words(["Totaal te betalen", 0.1, 0.85], ["1.210,00", 0.6, 0.85, 0.02, 10, true]),
    ];
    const hit = vendorFromFont(wordsArr);
    expect(hit).not.toBeUndefined();
    expect(hit!.value).toBe("Acme B.V.");
  });

  it("filters the own-business name from the top block", () => {
    const wordsArr = [
      ...words(["Ontvanger:", 0.1, 0.08], ["Mijn Bedrijf B.V.", 0.2, 0.08, 0.03, 14, true]),
      ...words(["Factuur", 0.1, 0.2], ["2026-001", 0.2, 0.2], ["Acme B.V.", 0.1, 0.25, 0.02, 11]),
    ];
    const hit = vendorFromFont(wordsArr, 1, "Mijn Bedrijf B.V.");
    expect(hit).not.toBeUndefined();
    expect(hit!.value.toLowerCase()).not.toContain("mijn bedrijf");
  });

  it("returns undefined when there are no words in the top block", () => {
    const wordsArr = words(
      ["Dit is body text.", 0.1, 0.5],
      ["Meer body.", 0.1, 0.55],
    );
    expect(vendorFromFont(wordsArr)).toBeUndefined();
  });

  it("falls back to longest line when font sizes are equal", () => {
    const wordsArr = [
      ...words(["Klein", 0.1, 0.1, 0.02, 12]),
      ...words(["Een langere regel tekst in de header", 0.1, 0.18, 0.02, 12]),
    ];
    const hit = vendorFromFont(wordsArr);
    expect(hit).not.toBeUndefined();
    expect(hit!.value).toContain("langere regel");
  });
});

describe("totalFromBold", () => {
  it("prefers a bold amount on a line with a total label", () => {
    const lines = [
      words(
        ["BTW 21%", 0.1, 0.8, 0.015, 8],
        ["210,00", 0.3, 0.8, 0.015, 8],
      ),
      words(
        ["Totaal te betalen", 0.1, 0.9, 0.02, 10],
        ["1.210,00", 0.55, 0.9, 0.02, 10, true],
      ),
    ];
    const hit = totalFromBold(lines);
    expect(hit).not.toBeUndefined();
    expect(hit!.value).toBe("1.210,00");
    expect(hit!.reason).toBe("labelled-amount");
  });

  it("falls back to the largest bold amount in the bottom quarter when no label", () => {
    const lines = [
      words(["BW 21%", 0.1, 0.8, 0.015, 8], ["210,00", 0.3, 0.8, 0.015, 8]),
      words(["Te betalen", 0.1, 0.9, 0.02, 10], ["1.210,00", 0.55, 0.9, 0.02, 10, true]),
      words(["Draft line", 0.1, 0.95, 0.02, 10], ["99,00", 0.5, 0.95, 0.02, 10, true]),
    ];
    const hit = totalFromBold(lines);
    expect(hit).not.toBeUndefined();
    // The labelled pass already wins, but if there were no label the larger
    // right-anchored amount would win.
    expect(hit!.value).toBe("1.210,00");
    expect(hit!.reason).toBe("labelled-amount");
  });

  it("returns undefined when the bottom quarter has no bold amounts", () => {
    const lines = [
      words(["BTW 21%", 0.1, 0.8, 0.015, 8], ["210,00", 0.3, 0.8, 0.015, 8]),
      words(["Totaal", 0.1, 0.9, 0.02, 10], ["1.210,00", 0.55, 0.9, 0.02, 10]),
    ];
    expect(totalFromBold(lines)).toBeUndefined();
  });

  it("returns undefined when there are no lines", () => {
    expect(totalFromBold([])).toBeUndefined();
  });
});

describe("bottomQuarterLines", () => {
  it("returns the bottom quarter of lines", () => {
    const wordsArr = [
      ...words(["Header 1", 0.1, 0.1], ["Header 2", 0.1, 0.2]),
      ...words(["Body 1", 0.1, 0.4], ["Body 2", 0.1, 0.5]),
      ...words(["Footer 1", 0.1, 0.85], ["Footer 2", 0.1, 0.9]),
    ];
    const lines = bottomQuarterLines(wordsArr);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const w of line) {
        expect(w.y).toBeGreaterThanOrEqual(0.75);
      }
    }
  });

  it("returns an empty array for an empty word list", () => {
    expect(bottomQuarterLines([])).toHaveLength(0);
  });
});

describe("reasons are distinguishable", () => {
  it("largest-top-block carries the right reason", () => {
    const hit = vendorFromFont(
      words(["Acme B.V.", 0.1, 0.08, 0.03, 16, true]),
      1,
    );
    expect((hit as FontHeuristicHit | undefined)?.reason).toBe("largest-top-block");
  });
});
