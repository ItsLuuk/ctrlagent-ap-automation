/** Debug: dump the text layer of a PDF so we can see what the extractor sees. */
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "test-invoice.pdf";
const data = new Uint8Array(readFileSync(file));

// Node-safe pdfjs import
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
console.log(`pages: ${doc.numPages}`);
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  let text = "";
  for (const item of content.items) {
    if ("str" in item) {
      text += item.str;
      text += item.hasEOL ? "\n" : " ";
    }
  }
  console.log(`\n===== PAGE ${n} =====`);
  console.log(text);
  page.cleanup();
}
await doc.destroy();
