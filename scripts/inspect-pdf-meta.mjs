import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

function inspect(path) {
  console.log(`\n=== ${path} ===`);
  const bytes = new Uint8Array(readFileSync(path));
  const pdf = await pdfjs.default.getDocument({ data: bytes, disableXfa: true }).promise;
  const meta = await pdf.getMetadata();
  console.log("PRODUCER:", JSON.stringify(meta.info?.Producer ?? null));
  console.log("CREATOR:", JSON.stringify(meta.info?.Creator ?? null));
  console.log("KEYS:", JSON.stringify(Object.keys(meta.info ?? {})));
  for (let n = 1; n <= Math.min(pdf.numPages, 2); n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const words = content.items.filter((i) => i.str).map((i) => i.str);
    console.log(`PAGE ${n} (${words.length} words):`);
    console.log(words.join(" "));
    page.cleanup();
  }
  await pdf.destroy();
}

inspect(join(__dirname, "test-invoice.pdf"));
inspect(join(__dirname, "donut-service/Superdoos.nl invoice.pdf"));
