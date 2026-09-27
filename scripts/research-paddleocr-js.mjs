import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "../.desktop-builds/paddleocr-js/node_modules/@napi-rs/canvas/index.js";
import { PaddleOCR } from "../.desktop-builds/paddleocr-js/node_modules/@paddleocr/paddleocr-js/dist/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pageDir = path.join(root, ".desktop-builds", "research-pages");
const files = (await readdir(pageDir)).filter((name) => name.endsWith(".png")).sort();

function normalize(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function expectedFor(name) {
  if (name.startsWith("Invoice-RAX3IIUH")) {
    return [{ description: "OpenCode Go", amount: 10 }];
  }
  if (name.startsWith("factuur_2607551285")) {
    return [{ description: "50+ Mobiel 2 jaar sim only", amount: 0 }];
  }
  return [
    { description: "Brievenbusdoosje A6 160x110x27mm Bruin", amount: 19.95 },
    { description: "Verzendkosten", amount: 60 },
  ];
}

const ocr = await PaddleOCR.create({
  lang: "en",
  ocrVersion: "PP-OCRv5",
  ortOptions: { backend: "wasm", numThreads: 4 },
});
const cases = [];
for (const file of files) {
  const image = await loadImage(path.join(pageDir, file));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const started = performance.now();
  const [result] = await ocr.predict(context.getImageData(0, 0, image.width, image.height));
  const elapsedMs = performance.now() - started;
  const text = result.items.map((item) => item.text).join("\n");
  const normalized = normalize(text);
  const lineItems = expectedFor(file).map((item) => ({
    ...item,
    matched: normalized.includes(normalize(item.description)),
  }));
  cases.push({
    file,
    elapsedMs: Math.round(elapsedMs),
    metrics: result.metrics,
    runtime: result.runtime,
    recognized: result.items.length,
    text,
    lineItems,
  });
  console.log(`${file}: ${Math.round(elapsedMs)}ms, ${result.items.length} lines, line-items ${lineItems.filter((x) => x.matched).length}/${lineItems.length}`);
}

await writeFile(
  path.join(root, "corpus", "paddleocr-js-research.json"),
  JSON.stringify({ runAt: new Date().toISOString(), cases }, null, 2) + "\n",
  "utf8",
);
await writeFile(path.join(root, ".desktop-builds", "paddleocr-js-research-output.json"), JSON.stringify({ cases }, null, 2), "utf8");
