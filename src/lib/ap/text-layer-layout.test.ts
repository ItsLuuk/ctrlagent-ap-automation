import { describe, expect, it } from "bun:test";
import {
  clusterWordsToLines,
  fontIsBold,
  fontNameOf,
  fontSizeOf,
  type TextLayerWord,
} from "./text-layer-layout";

/** A4 page height in points at scale 1. */
const A4 = 842;

/** A minimal word with the fields clusterWordsToLines needs. */
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

describe("fontIsBold", () => {
  it("recognises common bold font names", () => {
    expect(fontIsBold("Helvetica-Bold")).toBe(true);
    expect(fontIsBold("Arial Bold")).toBe(true);
    expect(fontIsBold("Times-New-Roman-Semibold")).toBe(true);
    expect(fontIsBold("DejaVuSans-Bold")).toBe(true);
  });

  it("recognises black/heavy weight names", () => {
    expect(fontIsBold("Helvetica-Black")).toBe(true);
    expect(fontIsBold("Arial Black")).toBe(true);
    expect(fontIsBold("RobotoHeavy")).toBe(true);
    expect(fontIsBold("robotoheavyttf")).toBe(true);
  });

  it("does not flag regular/light fonts as bold", () => {
    expect(fontIsBold("Helvetica")).toBe(false);
    expect(fontIsBold("Arial Regular")).toBe(false);
    expect(fontIsBold("Times-Roman")).toBe(false);
    expect(fontIsBold("Light")).toBe(false);
    expect(fontIsBold("")).toBe(false);
  });

  it("returns false for a word with no font name", () => {
    expect(fontIsBold(undefined)).toBe(false);
  });
});

describe("fontSizeOf", () => {
  it("reads the scale factor from transform[3]", () => {
    const item = {
      transform: [0.1, 0, 0, 11, 50, 700],
    } as unknown as TextLayerWord & { transform: number[] };
    expect(fontSizeOf(item)).toBe(11);
  });

  it("falls back to transform[0] when transform[3] is zero", () => {
    const item = {
      transform: [12, 0, 0, 0, 50, 700],
    } as unknown as TextLayerWord & { transform: number[] };
    expect(fontSizeOf(item)).toBe(12);
  });

  it("falls back to item.height when transform is empty", () => {
    const item = {
      height: 10.5,
    } as unknown as TextLayerWord & { transform?: number[]; height?: number };
    expect(fontSizeOf(item)).toBe(10.5);
  });
});

describe("clusterWordsToLines", () => {
  it("clusters a single line of words", () => {
    const words = [
      w("Factuur", 0.1, 0.1),
      w("nummer", 0.2, 0.1),
      w(":", 0.28, 0.1),
      w("2026-001", 0.3, 0.1),
    ];
    const lines = clusterWordsToLines(words, A4);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.map((ww) => ww.text)).toEqual([
      "Factuur",
      "nummer",
      ":",
      "2026-001",
    ]);
  });

  it("splits words into separate lines by y-gap", () => {
    const words = [
      w("Vendor Name", 0.1, 0.1, 0.02, 12),
      w("Straat 1", 0.1, 0.25, 0.02, 10),
      w("Factuurdatum", 0.1, 0.5, 0.02, 10),
      w("01-01-2026", 0.25, 0.5, 0.02, 10),
    ];
    const lines = clusterWordsToLines(words, A4);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.map((w) => w.text).join(" "))).toEqual([
      "Vendor Name",
      "Straat 1",
      "Factuurdatum 01-01-2026",
    ]);
  });

  it("sorts words within a line left-to-right", () => {
    const words = [
      w("Factuur", 0.1, 0.1),
      w(":", 0.2, 0.1),
      w("nummer", 0.25, 0.1),
      w("2026-001", 0.3, 0.1),
    ];
    const lines = clusterWordsToLines(words, A4);
    expect(lines[0]!.map((ww) => ww.text)).toEqual([
      "Factuur",
      ":",
      "nummer",
      "2026-001",
    ]);
  });

  it("returns an empty array for no words", () => {
    expect(clusterWordsToLines([], A4)).toEqual([]);
  });

  it("clusters words with different font sizes using the larger size for tolerance", () => {
    // A small-font line followed by a heading-sized line should split.
    const words = [
      w("BTW 21%", 0.1, 0.4, 0.015, 8),
      w("210,00", 0.25, 0.4, 0.015, 8),
      w("Totaal", 0.1, 0.6, 0.04, 22),
      w("te", 0.2, 0.6, 0.04, 22),
      w("betalen", 0.25, 0.6, 0.04, 22),
    ];
    const lines = clusterWordsToLines(words, A4);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.map((w) => w.text)).toEqual(["BTW 21%", "210,00"]);
    expect(lines[1]!.map((w) => w.text)).toEqual(["Totaal", "te", "betalen"]);
  });
});

describe("fontNameOf", () => {
  it("returns the lowercased font name when present", () => {
    expect(fontNameOf({ fontName: "Helvetica-Bold" })).toBe("helvetica-bold");
  });

  it("returns undefined for a missing font name", () => {
    expect(fontNameOf({})).toBeUndefined();
    expect(fontNameOf({ fontName: "" })).toBeUndefined();
    expect(fontNameOf({ fontName: "   " })).toBeUndefined();
  });
});
