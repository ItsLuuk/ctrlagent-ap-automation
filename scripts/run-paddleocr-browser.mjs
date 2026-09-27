import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("console", (message) => console.log(`[browser:${message.type()}] ${message.text()}`));
page.on("pageerror", (error) => console.error("[pageerror]", error.message));
page.on("requestfailed", (request) => console.error(`[requestfailed] ${request.url()} ${request.failure()?.errorText}`));
page.on("response", (response) => { if (response.status() >= 400) console.error(`[http:${response.status()}] ${response.url()}`); });
await page.goto("http://127.0.0.1:5188/research-paddleocr.html", { waitUntil: "domcontentloaded" });
try {
  await page.waitForFunction(() => document.body.dataset.done === "true" || document.body.dataset.done === "done" || document.body.dataset.done === "error", null, { timeout: 180000 });
} catch (error) {
  console.error(await page.locator("#out").textContent());
  throw error;
}
const state = await page.evaluate(() => ({ done: document.body.dataset.done, results: window.researchResult, text: document.querySelector("#out")?.textContent }));
await writeFile("corpus/paddleocr-js-research.json", JSON.stringify(state, null, 2) + "\n", "utf8");
console.log(state.text);
await browser.close();
if (state.done !== "true" && state.done !== "done") process.exit(1);
