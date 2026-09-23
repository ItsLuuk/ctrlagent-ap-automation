# Three-Stage Pipeline + History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the invoice pipeline to three stages (Draft, For approval, For payment); paid invoices leave the queue and are archived in a new History tab.

**Architecture:** `types.ts` owns the status model (3-stage `STATUS_ORDER`; `paid` kept only as result marker). `store.tsx` gains a second `history` collection + `markPaid`, persisting under its own key with migration. New `/history` route lists paid invoices read-only. Approving jumps review → scheduled directly; "Mark as paid" calls `markPaid` and navigates to History.

**Tech Stack:** TypeScript, TanStack Start (file routes), React context store, localStorage.

## Global Constraints

- `InvoiceStatus` = `"draft" | "review" | "scheduled" | "rejected" | "paid"` (paid kept as result marker, never a stage).
- `STATUS_ORDER` = `["draft", "review", "scheduled"]` verbatim.
- `STATUS_LABEL`: `draft: "Draft"`, `review: "For approval"`, `scheduled: "For payment"`, `rejected: "Rejected"`, `paid: "Paid"`.
- New store API `markPaid(id: string, actor: string, action: string, note?: string): void`.
- New localStorage key `ap-automation-history-v1`.
- New route path `/history`.
- Approve action text: "Approved — queued for payment". "Mark as paid" navigates to `/history`.
- History is read-only (no edit/reopen/detail links).
- Repo NOT git-initialized — no commits. Verification: `node_modules\.bin\tsc.exe --noEmit` (0 errors), `npm run lint` (no NEW errors; ~45 pre-existing prettier errors), `npm run build`. No test runner.
- Pre-existing prettier errors in `samples.ts` (audit sample entries) must not be introduced/duplicated beyond what's needed; new code must be prettier-clean.

---

### Task 1: Status model in `src/lib/ap/types.ts`

**Files:**
- Modify: `src/lib/ap/types.ts:1-24`

**Interfaces:**
- Produces (consumed by all later tasks): `InvoiceStatus`, `STATUS_ORDER`, `STATUS_LABEL`.

- [ ] **Step 1: Update `InvoiceStatus` and stages**

Replace lines 1-24 with:

```ts
export type InvoiceStatus =
  | "draft"
  | "review"
  | "scheduled"
  | "rejected"
  | "paid";

export const STATUS_ORDER: InvoiceStatus[] = [
  "draft",
  "review",
  "scheduled",
];

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  review: "For approval",
  scheduled: "For payment",
  rejected: "Rejected",
  paid: "Paid",
};
```

- [ ] **Step 2: Verify Task 1**

Run: `node_modules\.bin\tsc.exe --noEmit` — expect errors only in files that still assign `"approved"` (resolved in Tasks 2/5/7). That's acceptable mid-plan; note them.

---

### Task 2: Samples in `src/lib/ap/samples.ts`

**Files:**
- Modify: `src/lib/ap/samples.ts`

**Interfaces:**
- Produces: `sampleHistory(): Invoice[]` — paid archive seed, consumed by Task 3 and Task 6.

- [ ] **Step 1: Reassign the `approved` sample to `scheduled`**

For `inv-helix` (currently `status: "approved"` at line 120), change to `status: "scheduled"`.

- [ ] **Step 2: Extract the paid sample into `sampleHistory`**

Move the `inv-lumen` object (lines 204-256) into a new exported function below `sampleInvoices`:

```ts
export function sampleHistory(): Invoice[] {
  return [
    {
      id: "inv-lumen",
      vendor: "Lumen Hardware Supply",
      invoiceNumber: "LHS-88420",
      issueDate: day(-40),
      dueDate: day(-12),
      currency: "USD",
      subtotal: 12980,
      tax: 1103.3,
      total: 14083.3,
      status: "paid",
      glAccount: "6060 · Hardware & equipment",
      department: "Operations",
      memo: "Laptop refresh batch 3",
      lineItems: [
        {
          id: "li-1",
          description: 'Laptops 14" (10 units)',
          quantity: 10,
          unitPrice: 1180,
          amount: 11800,
          glAccount: "6060 · Hardware & equipment",
          department: "Operations",
        },
        {
          id: "li-2",
          description: "Docking stations",
          quantity: 10,
          unitPrice: 118,
          amount: 1180,
          glAccount: "6060 · Hardware & equipment",
          department: "Operations",
        },
      ],
      confidence: {
        vendor: 0.97,
        invoiceNumber: 0.95,
        issueDate: 0.94,
        dueDate: 0.93,
        subtotal: 0.96,
        tax: 0.9,
        total: 0.98,
      },
      audit: [
        { id: "a1", at: day(-40) + "T08:00:00Z", actor: "OCR engine", action: "Document ingested and parsed" },
        { id: "a2", at: day(-39) + "T09:00:00Z", actor: "Luuk Koppen", action: "Submitted for approval" },
        { id: "a3", at: day(-38) + "T10:00:00Z", actor: "Dana Whitfield", action: "Approved" },
        { id: "a4", at: day(-37) + "T10:30:00Z", actor: "Luuk Koppen", action: "Scheduled for payment" },
        { id: "a5", at: day(-30) + "T12:00:00Z", actor: "Payments", action: "Paid via ACH", note: "Trace 88-40213" },
      ],
      source: "sample",
      createdAt: day(-40),
    },
  ];
}
```

Delete `inv-lumen` from `sampleInvoices()`.

- [ ] **Step 3: Verify Task 2**

Run: `node_modules\.bin\tsc.exe --noEmit` — `inv-helix` `"approved"` resolved; errors surface now only in `index.tsx`, `invoices.$id.tsx` (Tasks 5/7).

---

### Task 3: `history` collection + `markPaid` in `src/lib/ap/store.tsx`

**Files:**
- Modify: `src/lib/ap/store.tsx`

**Interfaces:**
- Consumes: `sampleHistory()` (Task 2).
- Produces (consumed by Tasks 4-7): context gains `history: Invoice[]` and `markPaid(id, actor, action, note?)`.

- [ ] **Step 1: Import + context type**

Change imports (line 10) to include `sampleHistory`:

```ts
import { sampleHistory, sampleInvoices } from "./samples";
```

Add to the `Ctx` type after `setStatus`:

```ts
  history: Invoice[];
  markPaid: (id: string, actor: string, action: string, note?: string) => void;
```

- [ ] **Step 2: State + history key**

Add `const HISTORY_STORAGE_KEY = "ap-automation-history-v1";` beside `STORAGE_KEY`. Add state after `invoices`:

```ts
  const [history, setHistory] = useState<Invoice[]>(() => sampleHistory());
```

- [ ] **Step 3: Migration on load**

In the existing load `useEffect`, after the invoices parse/map block, migrate paid leftovers:

```ts
      setHistory((prev) => {
        const paid = parsed.filter((i) => i.status === "paid");
        return paid.length ? [...paid, ...prev] : prev;
      });
```

Place it inside the `if (raw)` block, after `setInvoices(...)`.

- [ ] **Step 4: Persist history**

```ts
  useEffect(() => {
    try {
      localStorage.setItem(
        HISTORY_STORAGE_KEY,
        JSON.stringify(history),
      );
    } catch {
      /* storage full or unavailable */
    }
  }, [history]);
```

(Because history only contains sample/paid items with no blob `fileUrl`, no field stripping needed.)

- [ ] **Step 5: `markPaid`**

```ts
  const markPaid = useCallback<Ctx["markPaid"]>((id, actor, action, note) => {
    setInvoices((prev) => {
      const moving = prev.find((inv) => inv.id === id);
      if (moving) {
        setHistory((h) => [
          {
            ...moving,
            status: "paid" as Invoice["status"],
            audit: [
              ...moving.audit,
              { id: uid(), at: new Date().toISOString(), actor, action, note },
            ],
          },
          ...h,
        ]);
      }
      return prev.filter((inv) => inv.id !== id);
    });
  }, []);
```

- [ ] **Step 6: Reset + context value**

In `resetDemo`: `setInvoices(sampleInvoices()); setHistory(sampleHistory());`.
Include `history` and `markPaid` in `value` + `useMemo` deps.

- [ ] **Step 7: Verify Task 3**

Run: `node_modules\.bin\tsc.exe --noEmit` — expect only `index.tsx`/`invoices.$id.tsx` errors now (Tasks 5/7).

---

### Task 4: Badge, pipeline, and nav link

**Files:**
- Modify: `src/components/ap/status.tsx`, `src/components/ap/shell.tsx`

**Interfaces:**
- Consumes: `STATUS_ORDER`/`STATUS_LABEL` (Task 1), `history` + route from Task 6.

- [ ] **Step 1: `STATUS_STYLES` in `status.tsx`**

Replace the object (lines 5-12) with:

```ts
const STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: "border-border bg-muted text-muted-foreground",
  review: "border-warning/30 bg-warning/15 text-warning-foreground",
  scheduled: "border-accent/50 bg-accent/30 text-accent-foreground",
  rejected: "border-destructive/30 bg-destructive/10 text-destructive",
  paid: "border-border bg-muted text-muted-foreground",
};
```

(`Pipeline` already maps over `STATUS_ORDER`, so it becomes 3 stages automatically.)

- [ ] **Step 2: History nav link in `shell.tsx`**

Add `History` to the lucide import, and below the Bill inbox link:

```tsx
            <Link
              to="/history"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground [&.active]:bg-secondary [&.active]:text-foreground"
            >
              <History className="size-4" />
              History
            </Link>
```

- [ ] **Step 3: Verify Task 4**

Run: `node_modules\.bin\tsc.exe --noEmit` — the `/history` link fails until Task 6 creates the route; expected mid-plan. `status.tsx` compiles standalone.

---

### Task 5: Inbox stats + filters in `src/routes/index.tsx`

**Files:**
- Modify: `src/routes/index.tsx`

**Interfaces:**
- Consumes: `history` from store (Task 3).

- [ ] **Step 1: Pull history + fix totals**

Change `const { invoices, resetDemo } = useAp();` to `const { invoices, history, resetDemo } = useAp();`.

Replace the `totals` block `paid` line:

```ts
      paid: history.reduce((s, i) => s + i.total, 0),
```

- [ ] **Step 2: Verify Task 5**

Run: `node_modules\.bin\tsc.exe --noEmit` — remaining errors: `/history` missing (Task 6), `invoices.$id.tsx` `"approved"` (Task 7).

---

### Task 6: History route `src/routes/history.tsx`

**Files:**
- Create: `src/routes/history.tsx`

**Interfaces:**
- Consumes: `history`, `StatusBadge`, `money`, `shortDate` from store/types/status.

- [ ] **Step 1: Create the route**

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Shell } from "@/components/ap/shell";
import { StatusBadge } from "@/components/ap/status";
import { useAp } from "@/lib/ap/store";
import { money, shortDate } from "@/lib/ap/types";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Payment history — Ledgerflow AP automation" },
      {
        name: "description",
        content: "Invoices that have been paid, archived from the working queue.",
      },
      { property: "og:title", content: "Payment history — Ledgerflow AP automation" },
      {
        property: "og:description",
        content: "Invoices that have been paid, archived from the working queue.",
      },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const { history } = useAp();
  return (
    <Shell>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Bill inbox
      </Link>

      <div className="mt-3">
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paid invoices leave the queue when they settle and are archived here.
        </p>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Vendor</th>
              <th className="px-4 py-2.5 font-medium">Invoice</th>
              <th className="px-4 py-2.5 font-medium">Issue date</th>
              <th className="px-4 py-2.5 font-medium">Paid</th>
              <th className="px-4 py-2.5 text-right font-medium">Amount</th>
              <th className="px-4 py-2.5 font-medium">Stage</th>
            </tr>
          </thead>
          <tbody>
            {history.map((inv) => {
              const paidAt =
                [...inv.audit].reverse().find((a) => a.action.toLowerCase().includes("paid"))?.at ??
                inv.createdAt;
              return (
                <tr key={inv.id} className="border-b border-border/70 last:border-0 hover:bg-secondary/50">
                  <td className="px-4 py-3 font-medium tracking-tight">{inv.vendor}</td>
                  <td className="px-4 py-3 font-mono text-xs">{inv.invoiceNumber || "—"}</td>
                  <td className="px-4 py-3 text-xs">{shortDate(inv.issueDate)}</td>
                  <td className="px-4 py-3 text-xs">{shortDate(paidAt)}</td>
                  <td className="px-4 py-3 text-right font-mono">{money(inv.total, inv.currency)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={inv.status} />
                  </td>
                </tr>
              );
            })}
            {history.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  Nothing has been paid yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
```

- [ ] **Step 2: Verify Task 6**

Run: `node_modules\.bin\tsc.exe --noEmit` — only `invoices.$id.tsx` `"approved"` errors remain.
Run: `npm run lint` — no NEW errors (sample-history lines were moved verbatim).
Run: `npm run build` — PASS.

---

### Task 7: Actions in `src/routes/invoices.$id.tsx`

**Files:**
- Modify: `src/routes/invoices.$id.tsx`

**Interfaces:**
- Consumes: `markPaid` from store (Task 3).

- [ ] **Step 1: Pull `markPaid`**

Change `const { updateInvoice, setStatus } = useAp();` to also destructure `markPaid`.

- [ ] **Step 2: Adjust `advance` for payment**

`advance` currently navigates to `/` when `status === "paid"`. Change the last two lines:

```tsx
    if (status === "paid") {
      markPaid(
        invoice.id,
        "Payments",
        "Paid via ACH",
        note || "Marked as paid",
      );
      void navigate({ to: "/history" });
    } else {
      setStatus(invoice.id, status, actor, action, note || undefined);
      toast.success(message);
    }
```

Also set `setNote("")` before the branch, once.

- [ ] **Step 3: Fix review buttons**

In the `invoice.status === "review"` block, change "Approve" onClick:

```tsx
                      onClick={() =>
                        advance(
                          "scheduled",
                          "Dana Whitfield",
                          "Approved — queued for payment",
                          "Invoice approved",
                        )
                      }
```

"Request changes" and "Reject" stay as-is.

- [ ] **Step 4: Remove `approved` block, fix `scheduled` block**

Delete the `invoice.status === "approved" && (...)` block (lines 325-334). The `scheduled` block's "Mark as paid" button stays (it calls `advance("paid", ...)` which now routes through Task 7 S2). Update its message text to "Paid via ACH" if desired (default: keep).

- [ ] **Step 5: Reopen block only for `rejected`**

Change the condition on the reopen block from `(invoice.status === "paid" || invoice.status === "rejected")` to `invoice.status === "rejected"`.

- [ ] **Step 6: Verify Task 7**

Run: `node_modules\.bin\tsc.exe --noEmit` — 0 errors.
Run: `npm run lint` — no NEW errors.
Run: `npm run build` — PASS.

- [ ] **Step 7: Manual smoke**

Dev server hot on 8081/8082:
- Inbox filter tabs: All, Draft, For approval, For payment, Rejected (no Approved/Paid).
- `inv-helix` now shows "For payment"; `inv-lumen` gone from queue.
- History tab shows `inv-lumen` with Paid badge + paid date.
- Detail: Approve a review invoice → badge becomes "For payment". "Mark as paid" → leaves queue, navigates to History, appears there.
- "Paid year to date" stat reflects history total.
- Reset demo restores both tabs.

---

## Self-Review

- **Spec coverage:** status model (T1), samples (T2), store history + markPaid + migration + reset (T3), badge/pipeline/nav (T4), inbox stats (T5), `/history` route (T6), actions (T7). Every spec bullet has a task. Paid date derivation in T6 matches "last audit entry" from spec. Non-goals respected (no edit/reopen/detail in History).
- **Placeholder scan:** all code inline; no TBD/TODO. T3 S5 calls `setHistory` inside `setInvoices` updater (nested state + functional update), which is safe and matches React rules (no side-effect on other state is introduced because both are functional and `markPaid` filters deterministically).
- **Type consistency:** `markPaid(id, actor, action, note?)` identical in Ctx (T3), call site (T7). `STATUS_ORDER`/`STATUS_LABEL` values verbatim across T1/T4. `sampleHistory()` exported in T2, imported T3. `history` in context (T3), consumed T5/T6.