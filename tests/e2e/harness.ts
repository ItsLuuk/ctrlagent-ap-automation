import { expect, type Page } from "playwright/test";

export const STORAGE = {
  invoices: "ap-automation-invoices-v1",
  history: "ap-automation-history-v1",
  removed: "ap-automation-removed-v1",
  purchaseOrders: "ap-automation-purchase-orders-v1",
  vendors: "ap-automation-vendors-v1",
  templates: "ap-automation-templates-v1",
  businessProfile: "ap-automation-business-profile-v1",
} as const;

export type SeedStorage = {
  [Key in keyof typeof STORAGE]?: unknown | undefined;
};

/** Wait for the SPA to mount, accounting for Vite's first-request optimization race. */
export function waitForAppRender(page: Page): Promise<boolean> {
  return page
    .waitForFunction(() => (document.querySelector("#root")?.childElementCount ?? 0) > 0, {
      timeout: 10_000,
    })
    .then(() => true)
    .catch(() => false);
}

/** Open a hash route from a cold document and recover once from a blank first paint. */
export async function openApp(page: Page, path = "/"): Promise<void> {
  await page.goto(`./tauri.html#${path}`, { waitUntil: "domcontentloaded" });
  if (!(await waitForAppRender(page))) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expect(
    waitForAppRender(page),
    `${path} rendered nothing at all — the screen never mounted`,
  ).resolves.toBe(true);
}

/**
 * Seed local storage before the app's own scripts run. Pass a marker when a test
 * reloads and must preserve anything the app writes after the initial seed.
 */
export async function seedStorage(
  page: Page,
  data: SeedStorage | null,
  options: { marker?: string } = {},
): Promise<void> {
  await page.addInitScript(
    ({ keys, values, marker }) => {
      if (marker && sessionStorage.getItem(marker) === "seeded") return;
      localStorage.clear();
      if (marker) sessionStorage.setItem(marker, "seeded");
      if (!values) return;
      for (const [name, value] of Object.entries(values)) {
        if (value === undefined) continue;
        localStorage.setItem(keys[name as keyof typeof keys], JSON.stringify(value));
      }
    },
    { keys: STORAGE, values: data, marker: options.marker ?? null },
  );
}

/** Clear persisted state after the app origin is available (including uploaded files). */
export async function clearBrowserStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("ap-file-store");
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });
}
