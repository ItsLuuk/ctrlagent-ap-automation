import { readFileSync } from "node:fs";

// Dynamic imports — the static chain ocr.ts → template-apply.ts → layout-ocr
// is broken (layout-ocr.ts does not exist on disk).
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const { extractFieldsFromPages } = await import("../src/lib/ap/ocr.ts");

async function main() {
  const files = [
    { name: "test-invoice.pdf", path: "test-invoice.pdf" },
    { name: "Superdoos.nl invoice.pdf", path: "donut-service/Superdoos.nl invoice.pdf" },
  ];

  for (const f of files) {
    console.log(`\n========================================`);
    console.log(`FILE: ${f.name}`);
    console.log(`========================================`);
    const bytes = new Uint8Array(readFileSync(f.path));
    const doc = await pdfjs.getDocument({ data: bytes, disableXfa: true }).promise;

    const meta = await doc.getMetadata();
    console.log("PRODUCER:", JSON.stringify(meta.info?.Producer ?? null));
    console.log("CREATOR:", JSON.stringify(meta.info?.Creator ?? null));
    console.log("KEYS:", JSON.stringify(Object.keys(meta.info ?? {})));

    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.filter((item: { str?: string }) => item.str != null);
        const words = items.map((item: { str?: string; transform?: number[] }) => ({
        text: item.str,
        x: item.transform[4] ?? 0,
        y: item.transform[5] ?? 0,
        w: 0,
        h: 0,
        confidence: 1,
      }));
      const text = words.map((w) => w.text).join("").replace(/[ \t]+/g, " ").trim();
      console.log(`\n--- PAGE ${n} (${words.length} words, ${text.length} chars) ---`);
      console.log(text);
      pages.push({ pageNumber: n, text, words });
      page.cleanup();
    }

    const fields = extractFieldsFromPages(pages, f.name);
    console.log("\n--- extractFieldsFromPages RESULT ---");
    console.log(JSON.stringify(fields, null, 2));

    await (doc as any).destroy?.();
  }
}

main().catch(console.error);
