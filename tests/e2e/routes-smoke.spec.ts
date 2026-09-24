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
import { samplePos } from "../../src/lib/ap/po-store";
import { openApp, seedStorage, STORAGE } from "./harness";
import {
  EMPTY_BUSINESS_PROFILE,
  type BusinessProfile,
  type Invoice,
  type InvoiceStatus,
} from "../../src/lib/ap/types";
import type { VendorMaster } from "../../src/lib/ap/vendor-master";

const ROUTES_DIR = fileURLToPath(new URL("../../src/routes", import.meta.url));

/**
 * What a screen renders when it throws. One screen serves both roots
 * (src/components/ap/route-fallback.tsx): its title, and the sentence under it.
 */
const ERROR_SURFACES = ["This screen didn't load", "Something went wrong"];
/** ...and the route-less screen, which means a link points at nothing. */
const NOT_FOUND = "Page not found";

/** The person whose name every signature in the walk must carry. */
const OPERATOR_NAME = "Sam de Vries";

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
      "Needs you",
      "In flight",
      "Later",
      "Northwind Cloud Systems",
    ],
    // The promise has one home, and it is the first run: the header carried it
    // as a subtitle on every visit, which said it twice over the hero that
    // already stated it.
    empty: ["No invoices yet", "Upload invoice", "without sending invoice data to the cloud."],
  },
  "/exceptions": { seeded: ["Exceptions"], empty: ["Exceptions"] },
  "/history": { seeded: ["Lumen Hardware Supply"], empty: ["Nothing has been completed yet."] },
  "/settings": { seeded: ["Business Profile", "Company details"], empty: ["Business Profile"] },
  "/vendors": { seeded: ["Northwind Cloud Systems"], empty: ["No vendors yet"] },
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
  // Two surfaces answer to `draft`, and this marker is the *legacy* one. The
  // fixtures are `source: "sample"`, so a seeded draft renders the record
  // detail; a captured draft (`source: "upload"`) renders the DraftMapper
  // instead, with "Confirm invoice" in place of "Submit for approval". Only the
  // legacy surface is walked here — the captured one is walked end to end,
  // through to handoff, further down.
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
    /** Vendor master, for the walk that needs a registered profile. */
    vendors?: Record<string, VendorMaster>;
    /** The operator's own profile, for the walk that checks who signs. */
    profile?: BusinessProfile;
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
              stage: "preprocessing" as const,
              progress: 1,
              background: false,
              error: "The document reader stopped before the fields were read.",
              errorStage: "preprocessing" as const,
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

/** Opens a hash route cold and returns the rendered text. */
async function visit(page: Page, path: string): Promise<string> {
  const uncaught: string[] = [];
  page.on("pageerror", (error) => uncaught.push(error.message));

  await openApp(page, path);
  const text = await page.locator("body").innerText();
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
        const payload = mode === "seeded" ? coverage().payload : null;
        await seedStorage(
          page,
          payload
            ? {
                invoices: payload.invoices,
                history: payload.history,
                purchaseOrders: payload.pos,
                vendors: payload.vendors,
                businessProfile: payload.profile,
              }
            : null,
        );
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

      await seedStorage(page, {
        invoices: payload.invoices,
        history: payload.history,
        purchaseOrders: payload.pos,
        vendors: payload.vendors,
        businessProfile: payload.profile,
      });
      const path = `/invoices/${target!.id}`;
      const text = await visit(page, path);

      // The record itself must be on screen: a fallback such as "isn't in the
      // inbox anymore" would otherwise satisfy a copy-only check.
      assertRendered(path, text, [...markers, target!.vendor]);
    });
  }
});

/** The stored status of one invoice — the store is the truth, not the button. */
async function statusOf(page: Page, id: string): Promise<string> {
  return page.evaluate((invoiceId) => {
    const list = JSON.parse(localStorage.getItem("ap-automation-invoices-v1") ?? "[]") as Array<{
      id: string;
      status: string;
    }>;
    return list.find((row) => row.id === invoiceId)?.status ?? "missing";
  }, id);
}

/** One invoice's audit trail, oldest first: what happened, and who signed it. */
async function auditTrail(
  page: Page,
  id: string,
): Promise<Array<{ action: string; actor: string }>> {
  return page.evaluate((invoiceId) => {
    const list = JSON.parse(localStorage.getItem("ap-automation-invoices-v1") ?? "[]") as Array<{
      id: string;
      audit?: Array<{ action: string; actor: string }>;
    }>;
    return list.find((row) => row.id === invoiceId)?.audit ?? [];
  }, id);
}

/**
 * A captured invoice at the point the operator opens the DraftMapper: the
 * extractor read every zone field off the document, and the vendor profile is
 * already registered — what the registration screen leaves behind.
 *
 * Cloned from a fixture rather than written out by hand, so a new required field
 * on `Invoice` cannot make this describe a record the app can no longer produce.
 * The numbers are load-bearing, not decoration: "Confirm invoice" only appears
 * once every zone field is green, and `fieldStatus` reads a zero as amber, so a
 * VAT-free fixture can never be a confirmable draft. Lines sum to the subtotal
 * and subtotal + tax = total, which is the cross-check the approve gate wants.
 */
function capturedDraft(): { invoice: Invoice; vendor: VendorMaster } {
  const base = sampleInvoices().find((invoice) => invoice.status === "scheduled")!;
  const vendor: VendorMaster = {
    name: "Northwind Cloud Systems",
    email: "billing@northwindcloudsystems.example",
    iban: "NL91ABNA0417164300",
    vatNumber: "NL005169491B25",
    businessRegistrationNumber: "34298230",
    department: "Engineering",
    updatedAt: "2026-09-13T00:00:00Z",
  };
  const invoice: Invoice = {
    ...base,
    id: "smoke-captured-draft",
    vendor: vendor.name,
    invoiceNumber: "NCS-9001",
    status: "draft",
    source: "upload",
    currency: "EUR",
    subtotal: 1000,
    tax: 210,
    total: 1210,
    glAccount: "6010 · Software & SaaS",
    department: "Engineering",
    memo: "",
    tags: [],
    iban: vendor.iban,
    vatNumber: vendor.vatNumber,
    lineItems: [
      {
        id: "li-captured",
        description: "Platform subscription — September",
        quantity: 1,
        unitPrice: 1000,
        amount: 1000,
        glAccount: "6010 · Software & SaaS",
        department: "Engineering",
      },
    ],
    provenance: {
      vendor: "read",
      invoiceNumber: "read",
      issueDate: "read",
      dueDate: "read",
      subtotal: "read",
      tax: "read",
      total: "read",
    },
    processing: undefined,
    audit: [],
  };
  return { invoice, vendor };
}

test.describe("the captured draft screen", () => {
  test("walks a captured invoice from draft through handoff", async ({ page }) => {
    const { invoice, vendor } = capturedDraft();
    const { payload } = coverage();
    await seedStorage(page, {
      invoices: [...payload.invoices, invoice],
      history: payload.history,
      purchaseOrders: payload.pos,
      vendors: { [vendor.name]: vendor },
      businessProfile: { ...EMPTY_BUSINESS_PROFILE, operatorName: OPERATOR_NAME },
    });

    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));

    const path = `/invoices/${invoice.id}`;
    const draft = await visit(page, path);

    // The captured draft renders the mapper, not the legacy record detail.
    // "Submit for approval" belongs to the other surface's only confirm action,
    // so its absence is what proves this walk is not quietly re-testing that one.
    assertRendered(path, draft, ["Confirm invoice", invoice.vendor]);
    expect(draft, "the legacy draft surface rendered instead of the mapper").not.toContain(
      "Submit for approval",
    );

    // The line-item row keeps one amount input and a real quantity input. The
    // amount is derived from qty × unit price, so editing quantity must update
    // that one field rather than leave a second copy beside it.
    const quantity = page.getByLabel("Quantity").first();
    const amount = page.getByLabel("Amount").first();
    await expect(page.getByLabel("Quantity")).toHaveCount(1);
    await expect(page.getByLabel("Amount")).toHaveCount(1);
    await expect(quantity).toBeEditable();
    await expect(amount).toHaveValue("€1,000.00");
    await quantity.fill("2");
    await expect(amount).toHaveValue("€2,000.00");
    await quantity.fill("1");
    await expect(amount).toHaveValue("€1,000.00");
    await page.waitForTimeout(800);

    await page.getByRole("button", { name: "Confirm invoice" }).click();
    await expect.poll(() => statusOf(page, invoice.id)).toBe("review");
    assertRendered(path, await page.locator("body").innerText(), [
      "Query",
      "Reject",
      "Nothing blocks approval",
    ]);

    await page.getByRole("button", { name: /^Approve/ }).click();
    await expect.poll(() => statusOf(page, invoice.id)).toBe("scheduled");
    assertRendered(path, await page.locator("body").innerText(), ["Ready for external handoff"]);

    await page.getByRole("button", { name: "Mark ready for external handoff" }).click();
    await expect(page.getByText(/handoff marker is recorded/)).toBeVisible();

    // The audit trail is the receipt for the whole walk. "Saved draft field
    // values" may sit between the steps, so this checks the entries that matter
    // and that the handoff marker is the last thing written — not an exact
    // sequence, which would break on any new audit entry.
    const trail = await auditTrail(page, invoice.id);
    const actions = trail.map((entry) => entry.action);
    expect(actions).toContain("Confirmed draft");
    expect(actions).toContain("Approved");
    expect(actions.at(-1)).toBe("Marked ready for external handoff");

    // And every signature on the record is the person running the install. The
    // app used to invent a processor, an approver and a "Payments" box to fill
    // the role gates, so this is the assertion that stops it going back.
    const signers = trail.map((entry) => entry.actor);
    expect(signers.length).toBeGreaterThan(0);
    expect(new Set(signers)).toEqual(new Set([OPERATOR_NAME]));

    expect(uncaught, "the walk threw while rendering").toEqual([]);
  });
});
