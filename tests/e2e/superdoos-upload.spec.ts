import { test, expect } from "playwright/test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { clearBrowserStorage, openApp } from "./harness";

const superdoosPdf =
  process.env.SUPERDOOS_PDF ?? resolve(homedir(), "Downloads", "Superdoos.nl invoice.pdf");

test("Superdoos PDF survives upload, processing, persistence, and review navigation", async ({
  page,
}) => {
  // VLM path can legitimately exceed the 120s config default when Ollama is
  // warm (~86s measured) plus page setup; the vendor-link expect below allows
  // 180s, so the test itself must outlive that expect.
  test.setTimeout(240_000);
  test.skip(!existsSync(superdoosPdf), `Superdoos fixture not found at ${superdoosPdf}`);

  const browserErrors: string[] = [];
  const workerUrls: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  // Regression for the Edge 404 screen: every in-app navigation must stay on
  // the hash-routed tauri.html document. A raw path navigation reloads the
  // window outside the SPA and lands on a server 404.
  const pathNavigations: string[] = [];
  page.on("framenavigated", (frame) => {
    const url = frame.url();
    if (frame === page.mainFrame() && url !== "about:blank" && !url.includes("tauri.html")) {
      pathNavigations.push(url);
    }
  });

  // Prove that the browser bundle starts a PDF.js worker, rather than silently
  // falling back to a Node-only or main-thread implementation.
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const urls = (window as Window & { __pdfWorkerUrls?: string[] }).__pdfWorkerUrls ?? [];
    (window as Window & { __pdfWorkerUrls?: string[] }).__pdfWorkerUrls = urls;
    window.Worker = class extends NativeWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        urls.push(String(scriptURL));
        super(scriptURL, options);
      }
    } as typeof Worker;
  });

  await openApp(page);
  await clearBrowserStorage(page);
  await openApp(page);

  // Filter to the visible trigger: first-run and inbox layouts render two
  // triggers (mobile + desktop) and only one is shown at a given viewport.
  const uploadButton = page.locator('button:has-text("Upload invoice"):visible').first();
  await expect(uploadButton).toBeVisible();
  await uploadButton.click();
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(superdoosPdf);

  // The real upload must enter the persistent invoice queue before any slow
  // model work begins. This is the regression for the previously generic toast.
  const invoiceLink = page.getByRole("link", { name: "Superdoos B.V." });
  // The row enters the queue immediately but is named after the file until
  // finalize. First-time vendors take the vision path (~86s measured with a
  // warm local model; longer on first model load), so the final-vendor link
  // legitimately appears late — keep the budget above that, not at it.
  await expect(invoiceLink).toBeVisible({ timeout: 180_000 });
  const invoiceId = await invoiceLink.getAttribute("href");
  expect(invoiceId).toMatch(/#\/invoices\//);

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("ap-file-store", 1);
            request.onupgradeneeded = () => request.result.createObjectStore("files");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          return await new Promise<number>((resolve) => {
            const request = db.transaction("files", "readonly").objectStore("files").count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(0);
          });
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  const storedInvoice = await page.evaluate(() => {
    const raw = localStorage.getItem("ap-automation-invoices-v1");
    const invoices = raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
    return invoices.find((invoice) => invoice.vendor === "Superdoos B.V.");
  });
  expect(storedInvoice).toBeTruthy();
  expect(storedInvoice?.ocrPages).toHaveLength(2);
  expect(["text-layer", "ocr", "mixed"].includes(String(storedInvoice?.ocrMethod))).toBe(true);

  await invoiceLink.click();
  await expect(page).toHaveURL(/#\/invoices\//);

  // A completed upload must open the review surface. If processing is still in
  // flight, the dedicated preparation surface is also a valid route state.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          // Case-insensitive: banners render via CSS text-transform, which
          // Chrome's innerText reflects.
          const text = document.body.innerText.toLowerCase();
          return (
            text.includes("superdoos b.v.") &&
            (text.includes("invoice no.") ||
              text.includes("vendor profile registration") ||
              text.includes("preparing this invoice") ||
              text.includes("this invoice needs attention"))
          );
        }),
      { timeout: 90_000 },
    )
    .toBe(true);

  const stateText = await page.locator("body").innerText();
  expect(stateText).not.toContain("We couldn’t read this document");
  expect(stateText).not.toContain("Kan deze");
  expect(stateText).not.toContain("node:perf_hooks");
  expect(stateText).not.toContain('Module "node:');

  const workerState = await page.evaluate(
    () => (window as Window & { __pdfWorkerUrls?: string[] }).__pdfWorkerUrls ?? [],
  );
  workerUrls.push(...workerState);
  expect(workerUrls.length).toBeGreaterThan(0);
  expect(browserErrors.filter((message) => /node:|pdfjs|worker/i.test(message))).toEqual([]);

  // Exercise the completion toast's Open action: with a path navigation this
  // leaves tauri.html and shows the Edge "page not found" screen.
  const toastOpen = page.locator('[data-sonner-toast] button:has-text("Open")');
  const clickedToast = await toastOpen
    .click({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (clickedToast) {
    await expect(page).toHaveURL(/tauri\.html#\/invoices\//);
  }
  expect(pathNavigations).toEqual([]);
});
