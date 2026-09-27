import { test, expect } from "playwright/test";
import { readFileSync } from "node:fs";

const HEADER =
  "invoice_number,invoice_date,due_date,vendor,vat_number,iban,currency,subtotal,vat_amount,total,gl_account,department,po_number,memo";

test("an approved invoice exports as a bookkeeping CSV", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("./tauri.html#/", { waitUntil: "domcontentloaded" });
  // Same cold-start recovery as the Superdoos spec: the first request of a
  // dev-server session can be swallowed while Vite re-optimizes.
  const rendered = () =>
    page
      .waitForFunction(() => (document.querySelector("#root")?.childElementCount ?? 0) > 0, {
        timeout: 10_000,
      })
      .then(() => true)
      .catch(() => false);
  if (!(await rendered())) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expect(rendered()).resolves.toBe(true);

  // Sample data is an explicit opt-in on first run, and the export must refuse
  // demo amounts. Take the opt-in, then promote exactly one scheduled sample
  // to a captured invoice — the file should hold that row and nothing else.
  await page.getByRole("button", { name: "Look around with sample data" }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const key = "ap-automation-invoices-v1";
        const list = JSON.parse(localStorage.getItem(key) ?? "[]") as Array<
          Record<string, unknown>
        >;
        const target = list.find((row) => row.status === "scheduled" && row.source !== "upload");
        if (!target) return false;
        target.source = "upload";
        localStorage.setItem(key, JSON.stringify(list));
        return true;
      }),
    )
    .toBe(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(rendered()).resolves.toBe(true);

  const exportButton = page.locator('button:has-text("Export CSV"):visible');
  await expect(exportButton).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();

  // The toast is the time-sensitive assertion; the file checks follow.
  await expect(page.getByText(/Exported 1 invoices? for handoff/)).toBeVisible();

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^foundry-approved-invoices-\d{4}-\d{2}-\d{2}\.csv$/,
  );

  const content = readFileSync((await download.path())!, "utf8");
  expect(content.startsWith("\uFEFF")).toBe(true);
  const lines = content
    .replace(/^\uFEFF/, "")
    .split("\r\n")
    .filter((line) => line.length > 0);
  expect(lines[0]).toBe(HEADER);
  // Exactly the one promoted invoice — every other row was still a sample.
  expect(lines).toHaveLength(2);

  expect(browserErrors).toEqual([]);
});
