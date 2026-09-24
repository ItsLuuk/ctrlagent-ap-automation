import { test, expect, type Page } from "playwright/test";
import { readFileSync } from "node:fs";
import { openApp, waitForAppRender } from "./harness";

const HEADER =
  "invoice_number,invoice_date,due_date,vendor,vat_number,iban,registration_number,currency,subtotal,vat_amount,total,gl_account,department,po_number,memo";

/** Excel needs the BOM to read the file as UTF-8; spelled out so the byte is
 *  visible in review rather than hiding inside a string literal. */
const BOM = String.fromCharCode(0xfeff);

const ROUTE = {
  iban: "NL91ABNA0417164300",
  vatNumber: "NL005169491B25",
  businessRegistrationNumber: "34298230",
};

/** Regex-safe literal, for asserting a vendor name appears in a toast. */
const literal = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Take the sample-data opt-in, promote `count` scheduled samples to captured
 * invoices, and give the first `routes` of them a payment route in
 * vendor-master. Returns the promoted vendors in promotion order.
 *
 * The sample vendors carry no bank details, and an approved invoice with no
 * payment route is now held out of the handoff file, so any scenario expecting
 * rows has to build the vendor profiles that registration would have created.
 */
async function promoteSamples(
  page: Page,
  opts: { count: number; routes: number },
): Promise<string[]> {
  await page.getByRole("button", { name: "Look around with sample data" }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        ({ count, routes, route }) => {
          const invoicesKey = "ap-automation-invoices-v1";
          const vendorsKey = "ap-automation-vendors-v1";
          const list = JSON.parse(localStorage.getItem(invoicesKey) ?? "[]") as Array<
            Record<string, unknown>
          >;
          const targets = list.filter(
            (row) => row.status === "scheduled" && row.source !== "upload",
          );
          if (targets.length < count) return false;
          const promoted = targets.slice(0, count);
          for (const target of promoted) target.source = "upload";
          localStorage.setItem(invoicesKey, JSON.stringify(list));
          if (routes > 0) {
            const vendors = JSON.parse(localStorage.getItem(vendorsKey) ?? "{}") as Record<
              string,
              unknown
            >;
            for (const target of promoted.slice(0, routes)) {
              vendors[String(target.vendor)] = {
                name: target.vendor,
                email: "billing@example.test",
                ...route,
                updatedAt: "2026-09-13T00:00:00Z",
              };
            }
            localStorage.setItem(vendorsKey, JSON.stringify(vendors));
          }
          return true;
        },
        { count: opts.count, routes: opts.routes, route: ROUTE },
      ),
    )
    .toBe(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(waitForAppRender(page)).resolves.toBe(true);

  return page.evaluate((count) => {
    const list = JSON.parse(localStorage.getItem("ap-automation-invoices-v1") ?? "[]") as Array<{
      status: string;
      source: string;
      vendor: string;
    }>;
    return list
      .filter((row) => row.status === "scheduled" && row.source === "upload")
      .slice(0, count)
      .map((row) => row.vendor);
  }, opts.count);
}

/** The downloaded file's lines, BOM and trailing blank removed. */
const fileLines = (content: string): string[] =>
  content
    .replace(new RegExp(`^${BOM}`), "")
    .split("\r\n")
    .filter((line) => line.length > 0);

test("an approved invoice exports as a bookkeeping CSV carrying the vendor's payment route", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await openApp(page);
  await promoteSamples(page, { count: 1, routes: 1 });

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
  expect(content.startsWith(BOM)).toBe(true);
  const lines = fileLines(content);
  expect(lines[0]).toBe(HEADER);
  // Exactly the one promoted invoice — every other row was still a sample.
  expect(lines).toHaveLength(2);

  // The point of the change: the identifiers live on the vendor profile, and
  // the handoff file carries them into the row the accountant imports.
  const cells = lines[1]!.split(",");
  expect(cells[4]).toBe(ROUTE.vatNumber);
  expect(cells[5]).toBe(ROUTE.iban);
  expect(cells[6]).toBe(ROUTE.businessRegistrationNumber);

  expect(browserErrors).toEqual([]);
});

test("an approved invoice with no payment route never reaches the handoff file", async ({
  page,
}) => {
  await openApp(page);
  const [vendor] = await promoteSamples(page, { count: 1, routes: 0 });
  expect(vendor).not.toBe("");

  const exportButton = page.locator('button:has-text("Export CSV"):visible');
  await expect(exportButton).toBeVisible();

  let downloaded = false;
  page.on("download", () => (downloaded = true));
  await exportButton.click();

  // No file, and the operator is told exactly whose invoice is stuck and why —
  // a silent omission here is an invoice nobody pays.
  await expect(page.getByText(/Nothing exported — 1 invoice has no payment route/)).toBeVisible();
  await expect(page.getByText(new RegExp(literal(vendor)))).toBeVisible();
  await expect(page.getByRole("button", { name: "Open vendors" })).toBeVisible();

  // The tile stops claiming the row is ready while it cannot leave.
  await expect(page.getByText("1 invoice missing a payment route")).toBeVisible();

  await page.waitForTimeout(500);
  expect(downloaded).toBe(false);
});

test("a payable row still ships when a sibling invoice has no payment route", async ({ page }) => {
  await openApp(page);
  const [, stuck] = await promoteSamples(page, { count: 2, routes: 1 });
  expect(stuck).not.toBe("");

  const exportButton = page.locator('button:has-text("Export CSV"):visible');
  await expect(exportButton).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();

  // The partial case is the common one: the row with a route goes out, the one
  // without is named — never dropped without a word.
  await expect(page.getByText(/Exported 1 invoice — 1 invoice left out/)).toBeVisible();
  await expect(page.getByText(new RegExp(literal(stuck)))).toBeVisible();

  const download = await downloadPromise;
  const content = readFileSync((await download.path())!, "utf8");
  const lines = fileLines(content);
  expect(lines[0]).toBe(HEADER);
  // The count the operator was shown is the count of rows in the file.
  expect(lines).toHaveLength(2);
  expect(lines[1]!.split(",")[5]).toBe(ROUTE.iban);
  expect(content).not.toContain(stuck);
});
