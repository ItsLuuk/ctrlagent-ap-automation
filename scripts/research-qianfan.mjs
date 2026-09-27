import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const model = "maternion/Qianfan-OCR:4b-q4_K_M";
const allCases = [
  ["Invoice-RAX3IIUH-0002-p1.png", [{ description: "OpenCode Go", amount: 10 }]],
  ["factuur_2607551285-p1.png", [{ description: "50+ Mobiel 2 jaar sim only", amount: 0 }]],
  ["Superdoos.nl invoice-p1.png", [
    { description: "Brievenbusdoosje A6 160x110x27mm Bruin", amount: 19.95 },
    { description: "Verzendkosten", amount: 60 },
  ]],
];
const cases = process.argv[2] ? allCases.filter(([file]) => file.includes(process.argv[2])) : allCases;
const normalize = (value) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const results = [];
for (const [file, expected] of cases) {
  const image = await readFile(path.join(".desktop-builds", "research-pages", file));
  const started = performance.now();
  const response = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: "Convert this invoice page to faithful Markdown. Preserve all text, reading order, and table rows. Do not infer or invent values.",
      images: [image.toString("base64")],
      stream: false,
      options: { temperature: 0, num_ctx: 4096, num_predict: 512 },
    }),
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  const data = await response.json();
  const elapsedMs = Math.round(performance.now() - started);
  const normalized = normalize(data.response);
  const lineItems = expected.map((item) => ({ ...item, matched: normalized.includes(normalize(item.description)) }));
  results.push({ file, elapsedMs, doneReason: data.done_reason, evalCount: data.eval_count, lineItems, response: data.response });
  console.log(`${file}: ${elapsedMs}ms, ${data.eval_count} tokens, line-items ${lineItems.filter((x) => x.matched).length}/${lineItems.length}`);
}
const outputPath = "corpus/qianfan-ocr-research.json";
let previous = [];
try { previous = JSON.parse(await readFile(outputPath, "utf8")).results ?? []; } catch {}
const merged = new Map([...previous, ...results].map((result) => [result.file, result]));
await writeFile(outputPath, JSON.stringify({ runAt: new Date().toISOString(), model, results: [...merged.values()] }, null, 2) + "\n", "utf8");
