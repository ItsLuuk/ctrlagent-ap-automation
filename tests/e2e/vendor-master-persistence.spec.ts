/**
 * What survives a restart.
 *
 * Why this exists: `ap-automation-vendors-v1` was hydrated from a mount effect
 * declared *after* the effect that persists it, so every boot wrote the initial
 * empty object first and then read that back. Nothing threw and nothing looked
 * wrong — the record was simply gone in every session after the one that made
 * it: upload routing called each vendor new, the identity rows had no record to
 * compare the document against, and the profile meter reset.
 *
 * Two tests, because "it survived" has two halves that fail independently:
 *  1. The write path through the UI — a record made on screen is still there,
 *     and still read, after a real reload. `localStorage` alone would pass on a
 *     store that ignored what it read.
 *  2. Every persisted key at once, from one seed and one restart. Keys are
 *     checked together on purpose: the failure mode is a persist effect writing
 *     an initial empty value over a key whose read has not run yet, and that is
 *     exactly what happens when several lists hydrate in different places. Each
 *     key is also read through the app, so a key that is stored but ignored
 *     still fails.
 *
 * The structural half of the same rule — for every key in the codebase, not
 * just these — is pinned once in `src/lib/ap/persistence-keys.test.ts`, which
 * fails if a key is hydrated from an effect or written before it is read.
 */
import { test, expect, type Page } from "playwright/test";
import { samplePos } from "../../src/lib/ap/samples";
import { sampleHistory, sampleInvoices } from "../../src/lib/ap/samples";
import { EMPTY_BUSINESS_PROFILE, type Invoice, type VendorTemplate } from "../../src/lib/ap/types";
import { openApp, seedStorage, STORAGE } from "./harness";

/** Distinctive enough that the synthesised fallback address cannot be mistaken for it. */
const PROBE_EMAIL = "persistence-probe@example.test";
const PROBE_IBAN = "NL91ABNA0417164300";

const REVIEW_INVOICE = sampleInvoices().find((invoice) => invoice.status === "review");

/** The stored record for the seeded invoice's vendor, or undefined when there is none. */
function storedRecord(page: Page): Promise<{ email?: string } | undefined> {
  return page.evaluate(
    ({ key, vendor }) =>
      (JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, { email?: string }>)[vendor],
    { key: STORAGE.vendors, vendor: REVIEW_INVOICE!.vendor },
  );
}

test("a vendor record written on screen is still there — and still used — after a reload", async ({
  page,
}) => {
  expect(REVIEW_INVOICE, "the sample set needs an invoice in For approval").toBeDefined();

  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await seedStorage(
    page,
    {
      invoices: sampleInvoices(),
      history: sampleHistory(),
      purchaseOrders: samplePos(),
    },
    { marker: "vendor-master-persistence:seeded" },
  );
  await openApp(page, `/invoices/${REVIEW_INVOICE!.id}`);

  // The row offers to fill the gap because the seeded invoice has no record.
  await page.getByRole("button", { name: "Create record" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.locator('[data-profile-field="email"]').fill(PROBE_EMAIL);
  await dialog.locator('[data-profile-field="businessRegistrationNumber"]').fill("34298230");
  // The structured IBAN field only accepts a whole IBAN at once — its country
  // select holds no value until one exists, so filling the segments one by one
  // would build a country-less string that fails its own checksum. Pasting is
  // how a person does this.
  await dialog.locator('[aria-label="IBAN check digits"]').evaluate((element, iban) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", iban);
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
    );
  }, PROBE_IBAN);
  await expect(dialog.getByText(/Valid NL IBAN/i)).toBeVisible();

  await dialog.getByRole("button", { name: "Create record" }).click();
  await expect(page.getByText(`Vendor record created for ${REVIEW_INVOICE!.vendor}`)).toBeVisible();

  // Written: the screen's input reached storage through the store's write path.
  await expect.poll(() => storedRecord(page).then((record) => record?.email)).toBe(PROBE_EMAIL);

  // A real restart of the app, on the same route.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toContainText("Foundry");

  // Survived: reading at boot does not overwrite what it has not read yet.
  await expect.poll(() => storedRecord(page).then((record) => record?.email)).toBe(PROBE_EMAIL);

  // Used: the vendors list shows the record's address rather than the address
  // the app synthesises when a vendor has no record at all.
  await openApp(page, "/vendors");
  await expect(page.getByText(PROBE_EMAIL)).toBeVisible();
  await expect(page.getByText(/billing@northwindcloudsystems\.com/)).toHaveCount(0);

  // And used on the invoice: the identity gap is filled, so the affordance is gone.
  await openApp(page, `/invoices/${REVIEW_INVOICE!.id}`);
  await expect(page.getByRole("button", { name: "Create record" })).toHaveCount(0);

  expect(browserErrors).toEqual([]);
});

const QUEUE_INVOICE = sampleInvoices().find((invoice) => invoice.status === "review")!;
const HISTORY_INVOICE = sampleHistory().find((invoice) => invoice.status === "paid");

/** Distinctive enough that a synthesised fallback cannot be mistaken for it. */
const REMOVED_VENDOR = "Removed Probe B.V.";
const VENDOR_EMAIL = "all-keys-probe@example.test";
const PROFILE_NAME = "All Keys Probe B.V.";
const PO_NUMBER = samplePos().find((po) => po.id === "po-northwind-1")?.number ?? "PO-4471";
const TEMPLATE_VENDOR = "Template Probe B.V.";

/** A record with a name no screen would invent, so its absence is unambiguous. */
const removedProbe = (): Invoice => ({
  ...QUEUE_INVOICE,
  id: "persistence-removed",
  invoiceNumber: "PROBE-REMOVED",
  vendor: REMOVED_VENDOR,
  status: "archived",
  audit: [],
  tags: [],
});

/** A legacy-shaped template: no fingerprint prefix, so the sync effect keeps it. */
const legacyTemplate = (): Record<string, VendorTemplate> => ({
  [TEMPLATE_VENDOR]: {
    vendor_fingerprint: "legacy-persistence-probe",
    vendor_key: TEMPLATE_VENDOR,
    embedding: [0.1, 0.2],
    version: 1,
    fields: {},
    updatedAt: "2026-09-13T00:00:00Z",
  },
});

/** One probe per key, so a failure can name the key that did not come back. */
const SEED = {
  invoices: sampleInvoices(),
  history: sampleHistory(),
  removed: [removedProbe()],
  purchaseOrders: samplePos(),
  vendors: {
    [QUEUE_INVOICE.vendor]: {
      name: QUEUE_INVOICE.vendor,
      email: VENDOR_EMAIL,
      iban: "NL91ABNA0417164300",
      businessRegistrationNumber: "34298230",
      updatedAt: "2026-09-13T00:00:00Z",
    },
  },
  templates: legacyTemplate(),
  businessProfile: { ...EMPTY_BUSINESS_PROFILE, name: PROFILE_NAME, operatorName: "Probe Person" },
};

/** What each key should still be able to prove, read from the key itself. */
const readBack = (page: Page) =>
  page.evaluate((keys) => {
    const read = (name: keyof typeof keys) => localStorage.getItem(keys[name]);
    return {
      queue: read("invoices"),
      history: read("history"),
      removed: read("removed"),
      purchaseOrders: read("purchaseOrders"),
      vendors: read("vendors"),
      templates: read("templates"),
      businessProfile: read("businessProfile"),
    };
  }, STORAGE);

test("every persisted key survives a restart, and the app still reads it", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await seedStorage(page, SEED, { marker: "all-keys-persistence:seeded" });

  // --- Read, before the restart: a key that is stored but never read is a
  // --- key the app is quietly running without.
  await openApp(page, "/");
  await expect(page.getByText(QUEUE_INVOICE.vendor).first()).toBeVisible();

  await openApp(page, "/history");
  await expect(page.getByText(HISTORY_INVOICE!.vendor)).toBeVisible();

  await openApp(page, "/");
  await page.getByRole("button", { name: "Removed" }).click();
  await expect(page.getByText(REMOVED_VENDOR)).toBeVisible();

  await openApp(page, `/invoices/${QUEUE_INVOICE.id}`);
  await expect(page.getByRole("combobox", { name: "Linked purchase order" })).toContainText(
    PO_NUMBER,
  );

  await openApp(page, "/vendors");
  await expect(page.getByText(VENDOR_EMAIL)).toBeVisible();

  await openApp(page, "/settings");
  await expect(page.getByPlaceholder("Acme B.V.")).toHaveValue(PROFILE_NAME);

  // A real restart on the same route.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toContainText("Foundry");

  // --- Survived: every key still holds what it held, and nothing was emptied
  // --- on the way through. Named per key so a failure says which one.
  const after = await readBack(page);
  expect(after.queue, `${STORAGE.invoices} did not survive`).toContain(QUEUE_INVOICE.id);
  expect(after.history, `${STORAGE.history} did not survive`).toContain(HISTORY_INVOICE!.id);
  expect(after.removed, `${STORAGE.removed} did not survive`).toContain("persistence-removed");
  expect(after.purchaseOrders, `${STORAGE.purchaseOrders} did not survive`).toContain(PO_NUMBER);
  expect(after.vendors, `${STORAGE.vendors} did not survive`).toContain(VENDOR_EMAIL);
  expect(after.templates, `${STORAGE.templates} did not survive`).toContain(
    "legacy-persistence-probe",
  );
  expect(after.businessProfile, `${STORAGE.businessProfile} did not survive`).toContain(
    PROFILE_NAME,
  );

  // --- And still used after the restart, not merely stored.
  await openApp(page, "/");
  await expect(page.getByText(QUEUE_INVOICE.vendor).first()).toBeVisible();

  await openApp(page, "/history");
  await expect(page.getByText(HISTORY_INVOICE!.vendor)).toBeVisible();

  await openApp(page, "/");
  await page.getByRole("button", { name: "Removed" }).click();
  await expect(page.getByText(REMOVED_VENDOR)).toBeVisible();

  await openApp(page, `/invoices/${QUEUE_INVOICE.id}`);
  await expect(page.getByRole("combobox", { name: "Linked purchase order" })).toContainText(
    PO_NUMBER,
  );
  // The stored vendor record fills the identity gap, so the offer to create one
  // is gone — the strongest signal that the record is read, not just present.
  await expect(page.getByRole("button", { name: "Create record" })).toHaveCount(0);

  await openApp(page, "/vendors");
  await expect(page.getByText(VENDOR_EMAIL)).toBeVisible();

  await openApp(page, "/settings");
  await expect(page.getByPlaceholder("Acme B.V.")).toHaveValue(PROFILE_NAME);

  expect(browserErrors).toEqual([]);
});
