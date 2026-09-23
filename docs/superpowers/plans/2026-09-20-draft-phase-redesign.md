# Draft Phase Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Draft screen as exception queue + vendor profile rail per `docs/superpowers/specs/2026-09-20-draft-phase-redesign-design.md`.

**Architecture:** Pure queue/profile logic in new lib modules (unit-tested with `bun test`); three new presentational components; `DraftMapper` reassembled into a 3-column layout reusing the existing `useDraftMapping` hook, document pane, and confirm write path (`confirmChoice` → `applyTransition` with `"confirm"`).

**Tech Stack:** React 19, Tailwind v4, TanStack Router/Start, `bun:test`, sonner toasts.

## Global Constraints

- No PO/ERP matching UI on the Draft screen.
- Confirm stays gated: enabled only with an empty queue; persist anchors + profile on confirm only (single write path, no partial persists).
- `npm run build` must pass after every task; new files formatted with `npx prettier --write`.
- Existing write path reused, not replaced: `updateInvoice`, `saveTemplate`/`upsertTemplate`, `applyTransition(id, { transition: "confirm", actor })`, `upsertVendor`.
- Vendor profile = master data only: name, address, IBAN, VAT number, payment terms.

---

### Task 1: Extend VendorMaster + completeness helper

**Files:**
- Modify: `src/lib/ap/vendor-master.ts`
- Test: `src/lib/ap/vendor-master.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `VendorMaster` with optional `address?, iban?, vatNumber?, paymentTerms?`; `PROFILE_FIELDS` tuple; `profileCompleteness(v): { filled: number; total: number }` used by Task 4 and Task 2.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { PROFILE_FIELDS, profileCompleteness, type VendorMaster } from "./vendor-master";

const base: VendorMaster = {
  name: "Acme",
  email: "billing@acme.com",
  updatedAt: new Date(0).toISOString(),
};

describe("profileCompleteness", () => {
  it("counts name plus the four master-data fields", () => {
    expect(PROFILE_FIELDS).toEqual(["name", "address", "iban", "vatNumber", "paymentTerms"]);
    expect(profileCompleteness(base)).toEqual({ filled: 1, total: 5 });
  });

  it("counts filled optional fields", () => {
    expect(
      profileCompleteness({ ...base, address: "Main St 1", iban: "NL00BANK0123456789" }),
    ).toEqual({ filled: 3, total: 5 });
  });

  it("treats blank strings as missing", () => {
    expect(profileCompleteness({ ...base, vatNumber: "   " })).toEqual({ filled: 1, total: 5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/ap/vendor-master.test.ts`
Expected: FAIL with "Cannot find module './vendor-master'" (file does not exist yet) or missing exports.

- [ ] **Step 3: Extend the type, keep old records loadable**

```ts
/**
 * Vendor master records — the editable vendor profile persisted in the AP
 * store. Keyed by vendor name; the record is optional per vendor, falling
 * back to derived defaults (billing@ email, initials logo).
 *
 * address/iban/vatNumber/paymentTerms are optional so records written before
 * the Draft redesign (name/email/logo only) keep loading unchanged.
 */
export type VendorMaster = {
  name: string;
  /** Billing/contact email; falls back to a derived billing@slug.com. */
  email: string;
  /** Optional logo as a data URL (small images only). */
  logoUrl?: string | undefined;
  /** Street + city as a single free-text line. */
  address?: string | undefined;
  /** IBAN for payment. */
  iban?: string | undefined;
  /** VAT identification number. */
  vatNumber?: string | undefined;
  /** Agreed payment terms, e.g. "Net 30". */
  paymentTerms?: string | undefined;
  updatedAt: string;
};

/** Profile fields in card display order; name is always first. */
export const PROFILE_FIELDS = ["name", "address", "iban", "vatNumber", "paymentTerms"] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** Blank strings count as missing so untouched inputs never inflate the meter. */
export function profileCompleteness(v: VendorMaster): { filled: number; total: number } {
  const filled = PROFILE_FIELDS.filter((f) => v[f] !== undefined && v[f].trim() !== "").length;
  return { filled, total: PROFILE_FIELDS.length };
}
```

Apply this by editing the existing `src/lib/ap/vendor-master.ts` (replace whole file; it is 13 lines).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/ap/vendor-master.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run existing vendor-adjacent tests**

Run: `bun test src/lib/ap/`
Expected: PASS (no regressions; type is additive-optional).

---

### Task 2: Queue builder pure logic

**Files:**
- Create: `src/lib/ap/draft-queue.ts`
- Test: `src/lib/ap/draft-queue.test.ts` (create)

**Interfaces:**
- Consumes: `Invoice`, `ExtractedField` from `./types`; `VendorMaster` from `./vendor-master`.
- Produces: `QueueKind`, `QueueItem`, `buildQueue(args)` used by Task 3. `PROFILE_GAP_LABEL: Record<ProfileField, string>` reused by Task 4 for identical labels.

The existing codes this logic keys on (verified in `use-draft-mapping.ts` and
`draft-mapper.tsx`): validation issue codes `missing_currency`, `invalid_currency`,
`missing_coding`, `missing_vendor`, `missing_invoice_number`, `missing_issue_date`,
`invalid_issue_date`, `missing_due_date`, `invalid_due_date`, `missing_total`,
`invalid_total`, `line_total_mismatch`; severity `error` (blocking) vs `warning`;
amber triage via `triageStatuses[field] === "amber"`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { buildQueue } from "./draft-queue";
import type { Invoice } from "./types";

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv-1",
    vendor: "Acme",
    invoiceNumber: "2026-001",
    currency: "EUR",
    department: "Engineering",
    status: "draft",
    audit: [],
    lineItems: [],
    tags: [],
    confidence: {},
    createdAt: new Date(0).toISOString(),
    ...over,
  }) as Invoice;

describe("buildQueue", () => {
  it("orders errors before warnings before amber before profile gaps", () => {
    const items = buildQueue({
      blockingIssues: [{ code: "missing_total", message: "Total is required", severity: "error" }],
      warningIssues: [{ code: "w1", message: "Check tax", severity: "warning" }],
      amberFields: [{ field: "vendor", label: "Vendor" }],
      crossCheckOk: true,
      vendor: { name: "Acme", email: "billing@acme.com", updatedAt: "" },
    });
    expect(items.map((i) => i.kind)).toEqual([
      "blocking",
      "warning",
      "amber",
      "profile-gap",
      "profile-gap",
      "profile-gap",
      "profile-gap",
    ]);
    expect(items[0]?.field).toBe("total");
  });

  it("dedupes amber fields already covered by an issue", () => {
    const items = buildQueue({
      blockingIssues: [{ code: "missing_vendor", message: "Vendor?", severity: "error" }],
      warningIssues: [],
      amberFields: [{ field: "vendor", label: "Vendor" }],
      crossCheckOk: true,
      vendor: {
        name: "Acme",
        email: "b@a.co",
        address: "x",
        iban: "y",
        vatNumber: "z",
        paymentTerms: "Net 30",
        updatedAt: "",
      },
    });
    expect(items.filter((i) => i.field === "vendor")).toHaveLength(1);
  });

  it("adds a conflict item when the cross-check fails", () => {
    const items = buildQueue({
      blockingIssues: [],
      warningIssues: [],
      amberFields: [],
      crossCheckOk: false,
      crossCheckDetail: "Lines sum €100.00 but total is €120.00",
      vendor: {
        name: "Acme",
        email: "b@a.co",
        address: "x",
        iban: "y",
        vatNumber: "z",
        paymentTerms: "Net 30",
        updatedAt: "",
      },
    });
    expect(items.map((i) => i.kind)).toEqual(["blocking"]);
    expect(items[0]?.kind).toBe("blocking");
  });

  it("returns an empty queue when everything verifies", () => {
    expect(
      buildQueue({
        blockingIssues: [],
        warningIssues: [],
        amberFields: [],
        crossCheckOk: true,
        vendor: {
          name: "Acme",
          email: "b@a.co",
          address: "x",
          iban: "y",
          vatNumber: "z",
          paymentTerms: "Net 30",
          updatedAt: "",
        },
      }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/ap/draft-queue.test.ts`
Expected: FAIL with "Cannot find module './draft-queue'".

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ExtractedField } from "./types";
import { PROFILE_FIELDS, type ProfileField, type VendorMaster } from "./vendor-master";

export type QueueKind = "blocking" | "warning" | "amber" | "profile-gap";

export type QueueField = ExtractedField | "currency" | "department";

export type QueueItem = {
  key: string;
  kind: QueueKind;
  /** Invoice field to focus/edit; undefined for profile gaps (focus the profile card). */
  field?: QueueField | undefined;
  /** Profile field for profile-gap items. */
  profileField?: ProfileField | undefined;
  label: string;
  message: string;
};

export const PROFILE_GAP_LABEL: Record<ProfileField, string> = {
  name: "Vendor name",
  address: "Address",
  iban: "IBAN",
  vatNumber: "VAT number",
  paymentTerms: "Payment terms",
};

/** Maps blocking/warning issue codes to the invoice field they concern. */
const FIELD_BY_ISSUE_CODE: Record<string, QueueField> = {
  missing_vendor: "vendor",
  missing_invoice_number: "invoiceNumber",
  missing_issue_date: "issueDate",
  invalid_issue_date: "issueDate",
  missing_due_date: "dueDate",
  invalid_due_date: "dueDate",
  missing_total: "total",
  invalid_total: "total",
  line_total_mismatch: "total",
  missing_currency: "currency",
  invalid_currency: "currency",
  missing_coding: "department",
};

export type ValidationIssueLike = { code: string; message: string; severity: "error" | "warning" };

export function buildQueue(args: {
  blockingIssues: ValidationIssueLike[];
  warningIssues: ValidationIssueLike[];
  amberFields: Array<{ field: ExtractedField; label: string }>;
  crossCheckOk: boolean;
  crossCheckDetail?: string | undefined;
  vendor: VendorMaster;
}): QueueItem[] {
  const items: QueueItem[] = [];
  const covered = new Set<string>();

  const pushIssue = (kind: "blocking" | "warning", issue: ValidationIssueLike) => {
    const field = FIELD_BY_ISSUE_CODE[issue.code];
    if (field) covered.add(`field:${field}`);
    items.push({
      key: `${kind}:${issue.code}`,
      kind,
      field,
      label: field ? field : issue.code,
      message: issue.message,
    });
  };

  for (const issue of args.blockingIssues) pushIssue("blocking", issue);

  if (!args.crossCheckOk && !covered.has("field:total")) {
    items.push({
      key: "blocking:cross-check",
      kind: "blocking",
      field: "total",
      label: "total",
      message: args.crossCheckDetail ?? "Line items do not add up to the total.",
    });
    covered.add("field:total");
  }

  for (const issue of args.warningIssues) pushIssue("warning", issue);

  for (const { field, label } of args.amberFields) {
    if (covered.has(`field:${field}`)) continue;
    covered.add(`field:${field}`);
    items.push({
      key: `amber:${field}`,
      kind: "amber",
      field,
      label,
      message: "Read with low confidence — check against the document.",
    });
  }

  for (const f of PROFILE_FIELDS) {
    const value = args.vendor[f];
    if (value !== undefined && value.trim() !== "") continue;
    items.push({
      key: `profile-gap:${f}`,
      kind: "profile-gap",
      profileField: f,
      label: PROFILE_GAP_LABEL[f],
      message: `${PROFILE_GAP_LABEL[f]} is missing from the vendor profile.`,
    });
  }

  return items;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/ap/draft-queue.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Format**

Run: `npx prettier --write src/lib/ap/draft-queue.ts src/lib/ap/draft-queue.test.ts src/lib/ap/vendor-master.ts src/lib/ap/vendor-master.test.ts`
Expected: files written/unchanged, no errors.

---

### Task 3: ExceptionQueue component

**Files:**
- Create: `src/components/ap/exception-queue.tsx`
- Test: manual + build (no component test harness exists; logic is covered by Task 2).

**Interfaces:**
- Consumes: `QueueItem[]` from `@/lib/ap/draft-queue`; callbacks `onFocusField(field)`, `onShowOnDocument(field)`, `onAccept(field)`; `verifiedCount: number`; `onToggleGreens` internal state only.
- Produces: `<ExceptionQueue ... />` used by Task 6. Props contract:

```ts
{
  items: QueueItem[];
  verifiedCount: number;
  expanded Greens labels: string[]; // labels of auto-verified fields for the collapsed line
  onFocusField: (field: QueueField) => void;
  onShowOnDocument: (field: QueueField) => void;
  onAccept: (field: QueueField) => void;
  onFocusProfileField: (field: ProfileField) => void;
}
```

- [ ] **Step 1: Create the component**

```tsx
import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, FileSearch, OctagonX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProfileField } from "@/lib/ap/vendor-master";
import type { QueueField, QueueItem } from "@/lib/ap/draft-queue";

const KIND_STYLE: Record<QueueItem["kind"], { dot: string; tag: string }> = {
  blocking: { dot: "bg-destructive", tag: "Must fix" },
  warning: { dot: "bg-warning", tag: "Check" },
  amber: { dot: "bg-warning", tag: "Low confidence" },
  "profile-gap": { dot: "bg-info", tag: "Profile" },
};

export function ExceptionQueue({
  items,
  verifiedCount,
  verifiedLabels,
  onFocusField,
  onShowOnDocument,
  onAccept,
  onFocusProfileField,
}: {
  items: QueueItem[];
  verifiedCount: number;
  verifiedLabels: string[];
  onFocusField: (field: QueueField) => void;
  onShowOnDocument: (field: QueueField) => void;
  onAccept: (field: QueueField) => void;
  onFocusProfileField: (field: ProfileField) => void;
}) {
  const [greensOpen, setGreensOpen] = useState(false);
  return (
    <section className="rounded-xl bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Needs your attention
        </p>
        <p className="font-mono text-xs text-muted-foreground">{items.length}</p>
      </div>

      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm font-medium">
          Nothing to fix — review the profile and confirm below.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const style = KIND_STYLE[item.kind];
            const go =
              item.profileField !== undefined
                ? () => onFocusProfileField(item.profileField as ProfileField)
                : item.field !== undefined
                  ? () => onFocusField(item.field as QueueField)
                  : undefined;
            return (
              <li key={item.key} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`size-2 shrink-0 rounded-full ${style.dot}`} />
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</p>
                  <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {style.tag}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.message}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.field !== undefined && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onShowOnDocument(item.field as QueueField)}
                    >
                      <FileSearch className="size-3.5" /> Show on document
                    </Button>
                  )}
                  {item.field !== undefined && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onAccept(item.field as QueueField)}
                    >
                      <Check className="size-3.5" /> Looks right
                    </Button>
                  )}
                  {go !== undefined && (
                    <Button size="sm" variant="ghost" onClick={go}>
                      {item.kind === "blocking" ? (
                        <OctagonX className="size-3.5" />
                      ) : (
                        <AlertTriangle className="size-3.5" />
                      )}
                      Fix
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setGreensOpen((v) => !v)}
        className="flex w-full items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <span>
          {verifiedCount} field{verifiedCount === 1 ? "" : "s"} verified automatically
        </span>
        <ChevronDown className={`size-3.5 transition-transform ${greensOpen ? "rotate-180" : ""}`} />
      </button>
      {greensOpen && verifiedLabels.length > 0 && (
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          {verifiedLabels.join(" · ")}
        </p>
      )}
    </section>
  );
}
```

Kind icons: `OctagonX` exists in lucide-react (verify at build; if missing, swap to `CircleX`).

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build 2>&1 | Select-Object -Last 3`
Expected: nitro success lines. (Component unused yet — TS `noUnusedLocals` does not flag exported components.)

- [ ] **Step 3: Format**

Run: `npx prettier --write src/components/ap/exception-queue.tsx`
Expected: no errors.

---

### Task 4: VendorProfileCard component

**Files:**
- Create: `src/components/ap/vendor-profile-card.tsx`
- Test: manual + build.

**Interfaces:**
- Consumes: `VendorMaster`, `PROFILE_FIELDS`, `profileCompleteness` from `@/lib/ap/vendor-master`; `PROFILE_GAP_LABEL` from `@/lib/ap/draft-queue`.
- Produces: `<VendorProfileCard ... />` used by Task 6:

```ts
{
  vendor: VendorMaster; // draft copy owned by DraftMapper, NOT the store record
  onChange: (field: ProfileField, value: string) => void;
  focusField: ProfileField | null; // set by queue "Fix" so the right input focuses
  onFocusDone: () => void;
}
```

Inputs carry `data-profile-field={field}` so the queue can focus them. Name input
is always rendered first; email shown read-only (not part of the 5-field profile).

- [ ] **Step 1: Create the component**

```tsx
import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import {
  PROFILE_FIELDS,
  profileCompleteness,
  type ProfileField,
  type VendorMaster,
} from "@/lib/ap/vendor-master";
import { PROFILE_GAP_LABEL } from "@/lib/ap/draft-queue";

export function VendorProfileCard({
  vendor,
  onChange,
  focusField,
  onFocusDone,
}: {
  vendor: VendorMaster;
  onChange: (field: ProfileField, value: string) => void;
  focusField: ProfileField | null;
  onFocusDone: () => void;
}) {
  const { filled, total } = profileCompleteness(vendor);
  const refs = useRef<Partial<Record<ProfileField, HTMLInputElement | null>>>({});

  useEffect(() => {
    if (!focusField) return;
    refs.current[focusField]?.focus();
    onFocusDone();
  }, [focusField, onFocusDone]);

  return (
    <section className="rounded-xl bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Vendor profile
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {filled}/{total}
        </p>
      </div>
      <div className="space-y-3 px-4 py-3">
        {PROFILE_FIELDS.map((field) => (
          <label key={field} className="block space-y-1.5">
            <span className="block text-xs font-medium text-muted-foreground">
              {PROFILE_GAP_LABEL[field]}
            </span>
            <Input
              ref={(el) => {
                refs.current[field] = el;
              }}
              data-profile-field={field}
              className="h-10 text-sm"
              value={vendor[field] ?? ""}
              placeholder={field === "name" ? "Vendor name" : `No ${PROFILE_GAP_LABEL[field].toLowerCase()} yet`}
              onChange={(e) => onChange(field, e.target.value)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build 2>&1 | Select-Object -Last 3`
Expected: nitro success lines.

- [ ] **Step 3: Format**

Run: `npx prettier --write src/components/ap/vendor-profile-card.tsx`
Expected: no errors.

---

### Task 5: LearningFeed component

**Files:**
- Create: `src/components/ap/learning-feed.tsx`
- Test: manual + build.

**Interfaces:**
- Consumes: nothing from lib.
- Produces: `<LearningFeed entries health />` used by Task 6:

```ts
export type LearnedEntry = { id: string; text: string };
export type TemplateHealth = "new" | "learning" | "mature";
{
  entries: LearnedEntry[];
  learnedCount: number; // anchors learned x
  fieldTotal: number; // ...of y fields
  corrections: number; // corrections this session
  health: TemplateHealth;
}
```

Feed lists fixes only (accepts omitted — spec §4). Empty state: "Fixes you make
appear here as lessons for next time."

- [ ] **Step 1: Create the component**

```tsx
import { GraduationCap } from "lucide-react";
import type { LearnedEntry, TemplateHealth } from "./learning-feed";

export type { LearnedEntry, TemplateHealth };
```

NOTE: implementer — do NOT write the circular stub above. Write the real file:

```tsx
import { GraduationCap } from "lucide-react";

export type LearnedEntry = { id: string; text: string };

export type TemplateHealth = "new" | "learning" | "mature";

const HEALTH_LABEL: Record<TemplateHealth, string> = {
  new: "No template yet — this draft teaches the first one",
  learning: "Learning — confirmations still sharpen it",
  mature: "Mature — extraction runs on the learned template",
};

export function LearningFeed({
  entries,
  learnedCount,
  fieldTotal,
  corrections,
  health,
}: {
  entries: LearnedEntry[];
  learnedCount: number;
  fieldTotal: number;
  corrections: number;
  health: TemplateHealth;
}) {
  return (
    <section className="rounded-xl bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Learned this session
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {learnedCount}/{fieldTotal} · {corrections} fix{corrections === 1 ? "" : "es"}
        </p>
      </div>
      <p className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
        {HEALTH_LABEL[health]}
      </p>
      {entries.length === 0 ? (
        <p className="px-4 py-4 text-xs text-muted-foreground">
          Fixes you make appear here as lessons for next time.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-2 px-4 py-2.5 text-xs">
              <GraduationCap className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build 2>&1 | Select-Object -Last 3`
Expected: nitro success lines.

- [ ] **Step 3: Format**

Run: `npx prettier --write src/components/ap/learning-feed.tsx`
Expected: no errors.

---

### Task 6: Reassemble DraftMapper into 3 columns

**Files:**
- Modify: `src/components/ap/draft-mapper.tsx`

**Interfaces:**
- Consumes: `buildQueue` (Task 2), `<ExceptionQueue>` (Task 3), `<VendorProfileCard>` (Task 4), `<LearningFeed>` + `LearnedEntry` (Task 5), existing `useDraftMapping` return values, existing `DocumentPane`, `FieldsPane` (kept for the actual editing UI), `ConfirmActions` (trimmed, see below).
- Produces: 3-column draft layout; `profileDraft` state + `feedEntries` state + `profileFocus` state owned here and passed down; Task 7 wires confirm.

Layout target (replace the grid at current line 159 and the right-column stack):

```tsx
<div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)_minmax(0,0.7fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
  <DocumentPane ...existing props unchanged... />
  <div className="space-y-4">
    <ExceptionQueue ... />
    <FieldsPane ...existing props unchanged... />
    <ConfirmActions trimmed ... />
  </div>
  <div className="space-y-4">
    <VendorProfileCard ... />
    <LearningFeed ... />
    <LineItemsEditor ...existing usage unchanged... />
  </div>
</div>
```

Steps (each independently reviewable):

- [ ] **Step 1: Remove the "Improve this vendor" promo block** (current lines 140-157).
  Rationale: learning is automatic now (spec decision 1); opt-in teaching contradicts
  it. Delete the `{!showVendorImprovement && ...}` block; keep `showVendorImprovement`
  state and `vendorImprovementOpen` prop (drift flow still uses them).

- [ ] **Step 2: Add queue/profile/feed state + derivations.** Inside `DraftMapper`,
  after the `mapping` destructure:

```tsx
const { vendors, upsertVendor } = useAp();
const storeProfile = vendors[invoice.vendor];
const [profileDraft, setProfileDraft] = useState<VendorMaster>(() => ({
  name: invoice.vendor,
  email: storeProfile?.email ?? "",
  logoUrl: storeProfile?.logoUrl,
  address: storeProfile?.address,
  iban: storeProfile?.iban,
  vatNumber: storeProfile?.vatNumber,
  paymentTerms: storeProfile?.paymentTerms,
  updatedAt: storeProfile?.updatedAt ?? new Date().toISOString(),
}));
const [feedEntries, setFeedEntries] = useState<LearnedEntry[]>([]);
const [corrections, setCorrections] = useState(0);
const [profileFocus, setProfileFocus] = useState<ProfileField | null>(null);

const queueItems = useMemo(
  () =>
    buildQueue({
      blockingIssues,
      warningIssues: validationIssues.filter((i) => i.severity === "warning"),
      amberFields: triageOrder
        .filter((f) => triageStatuses[f] === "amber")
        .map((f) => ({ field: f, label: ZONE_LABEL[f] })),
      crossCheckOk: crossCheck.ok,
      crossCheckDetail: `Lines sum ${money(crossCheck.sum, invoice.currency)} but total is ${money(invoice.total, invoice.currency)}.`,
      vendor: profileDraft,
    }),
  [blockingIssues, validationIssues, triageOrder, triageStatuses, crossCheck, invoice.currency, invoice.total, profileDraft],
);
```

Required imports to add: `useMemo`, `VendorMaster`/`ProfileField` types, `buildQueue`, `money`,
the three components, `LearnedEntry`. `useAp` already imports `updateInvoice` — extend
the destructure with `vendors, upsertVendor` (`upsertVendor` used in Task 7).

- [ ] **Step 3: Wire fix → learn → feed.** Wrap the field edit callback passed to
  `FieldsPane` (`onEditValue={(field, value) => onEditValue(field, value)}` — find the
  exact current prop) so a real change appends a feed entry and counts a correction:

```tsx
const handleFieldEdit = (field: ExtractedField, value: string) => {
  const before = fields[field];
  mapping.onEditValue(field, value);
  if (before === value) return;
  setCorrections((c) => c + 1);
  const anchor = assignments[field]?.anchor;
  setFeedEntries((prev) => [
    ...prev,
    {
      id: `${field}-${prev.length}`,
      text: anchor
        ? `${ZONE_LABEL[field]} now reads from “${anchor}”.`
        : `${ZONE_LABEL[field]} corrected — anchor saved on confirm.`,
    },
  ]);
};
```

`assignments[field]?.anchor` — verified shape: `AssignmentsByField` values carry
`{ anchor?: string }` (see `FieldRow` prop type `assignment: { anchor?: string | undefined }`).

- [ ] **Step 4: Wire queue callbacks.** `onFocusField` → existing
  `focusFirstBlockingIssue`-style focus: call `mapping.focusField(field)` for
  `ExtractedField`s; for `"currency"`/`"department"` focus `[aria-label="Currency"]` /
  `[aria-label="Department"]` (same selectors `focusFirstBlockingIssue` uses).
  `onShowOnDocument` → `mapping.focusField(field)` (highlights the zone overlay) plus
  scroll the document pane into view via the existing `mapping.setScrollContainer`
  ref pattern. `onAccept` → mark verified without change: call
  `mapping.focusField(field)` then record an explicit verify — implement as
  `mapping.verifyField(field)` ONLY if that method exists; otherwise accept =
  focus + toast "Marked as verified". Check `use-draft-mapping.ts` exports first;
  if no verify method exists, keep accept as focus-only and note it clears the item
  via a local `acceptedKeys: string[]` state passed as an extra filter to
  `buildQueue` (exclude items whose key is accepted). Prefer the local-state
  variant — no hook changes.
- [ ] **Step 5: Trim ConfirmActions to a confirm bar.** Remove its header/status copy
  (already simplified); keep the Confirm button + `focusFirstBlockingIssue` title
  logic. Button disabled unless `queueItems.length === 0`:

```tsx
<Button onClick={onOpenConfirm} disabled={queueItems.length > 0} title={...existing...}>
  <BadgeCheck className="size-4" /> Confirm invoice
</Button>
```

`onOpenConfirm` stays `focusFirstBlockingIssue` when the queue is non-empty
(button disabled anyway) and `mapping.confirmChoice` when empty. Implement:

```tsx
<ConfirmActions
  ...
  queueEmpty={queueItems.length === 0}
  onConfirm={mapping.confirmChoice}
  onOpenConfirm={focusFirstBlockingIssue}
/>
```

and inside `ConfirmActions` render one button: `queueEmpty ? onConfirm : onOpenConfirm`,
disabled when `!queueEmpty`. Keep the `BadgeCheck` success icon row.

- [ ] **Step 6: Build + format**

Run: `npx prettier --write src/components/ap/draft-mapper.tsx`
Run: `npm run build 2>&1 | Select-Object -Last 3`
Expected: nitro success lines.

- [ ] **Step 7: Manual check in dev** (`npm run dev`): open a draft invoice, queue
  lists blocking → amber → profile gaps in order; "Show on document" highlights;
  fixing a value appends a feed entry; profile edits update the x/5 meter; greens
  collapse line shows count.

---

### Task 7: Confirm persists profile + summary toast

**Files:**
- Modify: `src/components/ap/use-draft-mapping.ts` (confirmChoice), `src/components/ap/draft-mapper.tsx` (pass profile + counts in).

**Interfaces:**
- Consumes: `profileDraft: VendorMaster`, `feedEntries.length`, `corrections` from Task 6 state; store `upsertVendor` (exists: `(vendor: VendorMaster) => void`).
- Produces: confirm writes profile to vendor-master and reports anchors + profile in the toast.

- [ ] **Step 1: Thread profile into confirmChoice.** Change `confirmChoice` to accept
  an options object (call-site updated the same commit):

```ts
const confirmChoice = useCallback(
  (opts?: { profile?: VendorMaster | undefined; learnedCount?: number | undefined }) => {
    ...existing blocking guard unchanged...
    ...existing updateInvoice/saveTemplate/confirmTemplateExtraction/applyTransition unchanged...
    if (opts?.profile) {
      upsertVendor({ ...opts.profile, updatedAt: new Date().toISOString() });
    }
    if (!confirmed) { ...existing error toast unchanged... return; }
    const learned = opts?.learnedCount ?? 0;
    toast.success("Invoice confirmed — ready for approval", {
      description: `Profile saved · ${learned} anchor${learned === 1 ? "" : "s"} learned.`,
    });
  },
  [...existing deps..., upsertVendor],
);
```

Add `upsertVendor` to the hook's `useAp()` destructure (currently line 95 area:
`confirmTemplateExtraction, ...` — extend it) and to the `useCallback` dep array.

- [ ] **Step 2: Update the call-site in DraftMapper** (Task 6's confirm button path):
  `mapping.confirmChoice()` → `mapping.confirmChoice({ profile: profileDraft, learnedCount: feedEntries.length })`. Find the other `mapping.confirmChoice()` call inside `focusFirstBlockingIssue` (all-verified path) and pass the same object — it needs `profileDraft`/`feedEntries` in scope (same component, already in scope).

- [ ] **Step 3: Unit-test the profile write path.** There is no hook test harness;
  cover the store half instead — verify `upsertVendor` stores by name (already
  implemented; add a regression test only if `store` is importable in bun:test —
  it imports `.tsx` + CSS? `store.tsx` imports React only, no CSS. If `bun test`
  resolves it, add `src/lib/ap/vendor-master-store.test.ts`... SKIP if imports
  fail: do not force a harness into this task.)

  Concretely: try `bun test src/lib/ap/store.tsx` — expected to fail (`.tsx` with
  JSX under bun:test works, but provider + localStorage needs DOM). Do NOT add a
  store test; verification for this task is build + manual confirm flow (profile
  persists across reload via existing `VENDORS_STORAGE_KEY` persistence).

- [ ] **Step 4: Build + format + manual confirm check**

Run: `npx prettier --write src/components/ap/use-draft-mapping.ts src/components/ap/draft-mapper.tsx`
Run: `npm run build 2>&1 | Select-Object -Last 3`
Expected: nitro success lines. Manual: confirm a draft with a profile gap fixed →
toast reads "Profile saved · N anchors learned"; reload → vendor profile retained.

---

### Task 8: Verification pass

- [ ] **Step 1: Full unit suite**

Run: `bun test src/lib/ap/`
Expected: PASS, including the 2 new test files (7 tests).

- [ ] **Step 2: Full build**

Run: `npm run build 2>&1 | Select-Object -Last 3`
Expected: nitro success lines.

- [ ] **Step 3: Spec coverage walkthrough** (manual, `npm run dev`):
  - [ ] Queue order blocking → warning → amber → profile gaps (§2).
  - [ ] Greens collapsed with count; empty queue shows confirm hint (§2).
  - [ ] Profile card x/5 meter; missing fields queued and clear on edit (§3).
  - [ ] Feed entries per fix only; health label matches template state (§4).
  - [ ] Confirm disabled with non-empty queue; toast summary on confirm (§5).
  - [ ] Unreadable doc → manual-entry queue (upload a broken file or force `failed`).
  - [ ] No PO UI on Draft screen.
