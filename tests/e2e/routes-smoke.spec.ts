/**
 * Route smoke check — every screen, rendered with data, and no screen allowed to
 * reach an error surface.
 *
 * Why this exists: a missing import in the invoice review screen threw on every
 * editable invoice for a whole session without anyone noticing, because nothing
 * ever rendered a route. `tsc` cannot be the gate either — this repo carries
 * hundreds of pre-existing type errors, so a clean typecheck is no signal.
 *
 * The route list comes from `src/routes`, so a new screen is visited as soon as
 * the file exists, and it must declare what it renders (SCREENS) or the
 * declaration test below fails. Every screen runs in both reachable states: with
 * the demo set loaded, and on a first run — where the app now opens.
 */
import { test, expect, type Page } from "playwright/test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sampleHistory, sampleInvoices } from "../../src/lib/ap/samples";
import { samplePos } from "../../src/lib/ap/samples";
import type { Invoice, InvoiceStatus } from "../../src/lib/ap/types";

const ROUTES_DIR = fileURLToPath(new URL("../../src/routes", import.meta.url));

/**
 * What a screen renders when it throws. One screen serves both roots
 * (src/components/ap/route-fallback.tsx): its title, and the sentence under it.
 */
const ERROR_SURFACES = ["This screen didn't load", "Something went wrong"];
/** ...and the route-less screen, which means a link points at nothing. */
const NOT_FOUND = "Page not found";

const STORAGE = {
  invoices: "ap-automation-invoices-v1",
  history: "ap-automation-history-v1",
  purchaseOrders: "ap-automation-purchase-orders-v1",
} as const;

/**
 * Per screen, the copy only that screen renders. Route titles are deliberately
 * not used on their own: the sidebar repeats them, so "Exceptions" would pass
 * even on a body that rendered nothing.
 */
const SCREENS: Record<string, { seeded: string[]; empty: string[] }> = {
  "/": {
    seeded: [
      "Invoice inbox",
      "Work queue",
      "Draft",
      "For approval",
      "For payment",
      "History",
      // The inbox opens on Draft, so the record that has to be on screen is the
      // sample draft. Northwind sits in review, which now has its own tab.
      "Atlas Print & Signage",
    ],
    // The promise has one home, and it is the first run: the header carried it
    // as a subtitle on every visit, which said it twice over the hero that
    // already stated it.
    empty: ["No invoices yet", "Upload invoice", "The system handles the routine"],
  },
  "/exceptions": { seeded: ["Exceptions"], empty: ["Exceptions"] },
  "/history": { seeded: ["Lumen Hardware Supply"], empty: ["Nothing has been completed yet."] },
  "/settings": { seeded: ["Business Profile", "Company details"], empty: ["Business Profile"] },
  "/vendors": { seeded: ["Northwind Cloud Systems"], empty: ["No vendors yet"] },
  "/reports": { seeded: ["Consolidated report"], empty: ["Consolidated report"] },
};

/**
 * The surface each status of the invoice route must show.
 *
 * `paid` and `archived` are absent on purpose: the route resolves ids from the
 * working queue (`invoices.find`), so a record that has left the queue —
 * completed, which lives in the history, or removed, which lives under Removed
 * in the inbox — shows the "isn't in the inbox anymore" state by design. Their
 * surfaces are the tables on `/history` and the inbox's Removed tab, which the
 * seeded walk covers.
 */
const INVOICE_SURFACES: Partial<Record<InvoiceStatus, string[]>> = {
  draft: ["Submit for approval"],
  // One verdict line, no counters: the strip used to stack a second amber
  // banner and four numbers over the same sentence.
  review: ["Query", "Reject", "Nothing blocks approval"],
  scheduled: ["Ready for external handoff"],
  rejected: ["Rejected"],
  vendor_profile: ["Vendor profile registration"],
  failed: ["This invoice needs attention"],
  processing: ["Preparing this invoice"],
};

/** Every route file the app ships. */
function routeFiles(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((file) => file.endsWith(".tsx") && !file.startsWith("_"))
    .sort();
}

/** A route file, as the hash path a user reaches it by. */
const hashPathOf = (file: string) =>
  file === "index.tsx" ? "/" : `/${file.replace(/\.tsx$/, "")}`;

/** Static routes — `/invoices/$id` is walked per status by the tests below. */
function staticRoutes(): string[] {
  return routeFiles()
    .filter((file) => !file.includes("$"))
    .map(hashPathOf);
}

type Coverage = {
  payload: {
    invoices: Invoice[];
    history: Invoice[];
    pos: Record<string, unknown>;
  };
  /** One invoice id per status, with the vendor that must appear on screen. */
  routeFor: Partial<Record<InvoiceStatus, { id: string; vendor: string }>>;
};

/**
 * The dataset the seeded run walks: the real fixtures — the same records the
 * demo opt-in loads — plus one invoice per status the fixtures do not cover.
 * The extras are cloned from a fixture rather than written out by hand, so a
 * new required field on `Invoice` cannot make this file describe a record the
 * app can no longer produce.
 */
function coverage(): Coverage {
  const invoices = sampleInvoices();
  const covered = new Set(invoices.map((invoice) => invoice.status));
  const missing: InvoiceStatus[] = (
    ["vendor_profile", "failed", "processing", "rejected"] as const
  ).filter((status) => !covered.has(status));

  const clones = missing.map((status, index) => {
    const base = invoices[index % invoices.length]!;
    return {
      ...base,
      id: `smoke-${status}`,
      status,
      tags: [],
      ...(status === "processing"
        ? { processing: { stage: "ai reading" as const, progress: 0.5, background: false } }
        : {}),
      ...(status === "failed"
        ? {
            processing: {
              stage: "ai reading" as const,
              progress: 1,
              background: false,
              error: "The document reader stopped before the fields were read.",
              errorStage: "ai reading" as const,
            },
          }
        : {}),
    } satisfies Invoice;
  });

  const all = [...invoices, ...clones];
  const routeFor: Coverage["routeFor"] = {};
  for (const invoice of all) {
    routeFor[invoice.status] ??= { id: invoice.id, vendor: invoice.vendor };
  }

  return {
    payload: {
      invoices: all,
      history: sampleHistory(),
      pos: Object.fromEntries(samplePos().map((po) => [po.id, po])),
    },
    routeFor,
  };
}

/**
 * Seeds storage before the app's own script runs, so every screen is visited
 * cold with data already in place rather than inheriting the previous screen's
 * state. `null` leaves storage empty — the first run.
 */
async function seed(page: Page, payload: Coverage["payload"] | null): Promise<void> {
  await page.addInitScript(
    ({ keys, data }) => {
      localStorage.clear();
      if (!data) return;
      localStorage.setItem(keys.invoices, JSON.stringify(data.invoices));
      localStorage.setItem(keys.history, JSON.stringify(data.history));
      localStorage.setItem(keys.purchaseOrders, JSON.stringify(data.pos));
    },
    { keys: STORAGE, data: payload },
  );
}

/** Opens a hash route cold and returns the rendered text. */
async function visit(page: Page, path: string): Promise<string> {
  const uncaught: string[] = [];
  page.on("pageerror", (error) => uncaught.push(error.message));

  await page.goto(`./tauri.html#${path}`, { waitUntil: "domcontentloaded" });
  // "Foundry" is the shell's brand; an error surface means the shell was
  // replaced. Either way the page has settled and the assertions can speak.
  // A page that does neither is a blank screen — a boot failure, which needs
  // its own message rather than being reported as a missing marker.
  const settled = await page
    .waitForFunction(
      (surfaces) => {
        const text = document.body.innerText;
        return text.includes("Foundry") || surfaces.some((s) => text.includes(s));
      },
      ERROR_SURFACES,
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false);

  const text = await page.locator("body").innerText();
  expect(settled, `${path} rendered nothing at all — the screen never mounted`).toBe(true);
  expect(uncaught, `${path} threw while rendering`).toEqual([]);
  return text;
}

/**
 * Markers are matched case-insensitively on purpose: `innerText` returns text
 * as it is *rendered*, so a heading styled `uppercase` reads "VENDOR PROFILE
 * REGISTRATION" and a case-sensitive check would report a marker missing on a
 * screen that renders it fine.
 */
function assertRendered(path: string, text: string, expected: string[]): void {
  const rendered = text.toLowerCase();
  for (const surface of ERROR_SURFACES) {
    expect(rendered, `${path} hit an error surface — "${surface}"`).not.toContain(
      surface.toLowerCase(),
    );
  }
  expect(rendered, `${path} is not a route — the 404 screen rendered`).not.toContain(
    NOT_FOUND.toLowerCase(),
  );
  for (const marker of expected) {
    expect(rendered, `${path} rendered without "${marker}"`).toContain(marker.toLowerCase());
  }
}

test("every route declares what it renders", () => {
  const undeclared = routeFiles()
    // `/invoices/$id` is walked per status by the invoice tests below.
    .filter((file) => !file.includes("$"))
    .filter((file) => !SCREENS[hashPathOf(file)])
    .map(hashPathOf);
  expect(
    undeclared,
    "a new route needs an entry in SCREENS — an undescribed screen is an unchecked screen",
  ).toEqual([]);
});

for (const mode of ["seeded", "empty"] as const) {
  test.describe(`with ${mode === "seeded" ? "the demo set loaded" : "no data (first run)"}`, () => {
    for (const path of staticRoutes()) {
      test(`${path} renders`, async ({ page }) => {
        await seed(page, mode === "seeded" ? coverage().payload : null);
        const text = await visit(page, path);

        // A route with no entry in SCREENS fails the declaration test, which
        // names every undeclared route at once rather than one per state.
        assertRendered(path, text, SCREENS[path]?.[mode] ?? []);
      });
    }
  });
}

test.describe("every invoice status", () => {
  for (const [status, markers] of Object.entries(INVOICE_SURFACES) as [InvoiceStatus, string[]][]) {
    test(`${status} renders`, async ({ page }) => {
      const { payload, routeFor } = coverage();
      const target = routeFor[status];
      expect(target, `the coverage set has no ${status} invoice`).toBeDefined();

      await seed(page, payload);
      const path = `/invoices/${target!.id}`;
      const text = await visit(page, path);

      // The record itself must be on screen: a fallback such as "isn't in the
      // inbox anymore" would otherwise satisfy a copy-only check.
      assertRendered(path, text, [...markers, target!.vendor]);
    });
  }
});
