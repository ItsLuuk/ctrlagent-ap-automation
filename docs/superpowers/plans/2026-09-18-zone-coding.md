# Zone Coding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Draft-phase drag-and-drop zone boxes over an invoice image, save them as a per-vendor template, and have future invoices from that vendor get a Tesseract crop-vs-AI sanity check that surfaces amber/green chips.

**Architecture:** Zones are normalized 0..1 rectangles anchored to a document image. Drawing UI lives on image uploads only (a new `ZoneEditor` component swaps in for the `DocPreview`). Templates persist in localStorage (`ap-automation-templates-v1`) via a new store collection. On extraction, `extractInvoiceFromFile` receives the template map, crops each zoned field from the downscaled page image, runs Tesseract `eng+nld` on the crop, compares to the AI value, and attaches `zoneCheck` to the invoice. PDFs render page-1 images at extraction time and consume templates there; they get no drawing surface this phase.

**Tech Stack:** TanStack Start (React, Vite), strict TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`), Tailwind v4 CSS-first tokens, tesseract.js, lucide-react, sonner. Design-spec: `docs/superpowers/specs/2026-09-18-zone-coding-design.md`.

## Global Constraints

- **Not a git repo — no commit steps.** Verification replaces the test/commit cycle.
- Verification gates (run after every task, never claim green without running):
  - `node_modules\.bin\tsc.exe --noEmit` → 0 errors
  - `npm run lint` → no errors (repo has ~45 pre-existing prettier errors; "no new" means the diff introduces none)
  - `npm run build` → PASS
- `exactOptionalPropertyTypes`: never assign `undefined` to an optional property position explicitly; use conditional object spreads (`...(cond ? { k: v } : {})`) or test-then-assign.
- `noUncheckedIndexedAccess`: array/record lookups return `T | undefined` — null-check before use (e.g. `m[3]!` only after the regex matched its group).
- Untouchable (do not edit): `GEMMA_PROMPT`, the zod `gemmaPageSchema`, `parseGemmaPage`, `mergeGemmaPages`, `gemmaToFields`, `KEEP_ALIVE` in `gemma.ts`/prewarm, `MAX_PDF_PAGES`/`TEXT_LAYER_MIN_CHARS`/`RENDER_SCALE` constants, `money`/`uid`/`GL_ACCOUNTS`/`DEPARTMENTS`, and the existing `findAmountIn`/`parseDateValue`/`recognize` internals in `ocr.ts`.
- New code must not introduce comments beyond a one-line `/** */` explaining non-obvious intent; no inline chatter.
- Files are LF, 2-space indent, Prettier default rules. Keep new files Prettier-clean from the start.
- Dates: display `DD-MM-YYYY` (`nl-NL`); canonical storage/AI stays `YYYY-MM-DD`; zone-crop OCR text is parsed day-first.
- Full path root for all imports is `@/` → `src/` (aliased).

---

## File Structure

- `src/lib/ap/types.ts` — modify: add zone types + `zones`/`zoneCheck` on `Invoice`, `ZONE_FIELDS`, `ZONE_LABEL`, flip `shortDate` to `nl-NL`.
- `src/lib/ap/store.tsx` — modify: `templates` collection (`ap-automation-templates-v1`), `upsertTemplate`, reset.
- `src/lib/ap/zones.ts` — create: pure compare/format helpers (no DOM, no side effects).
- `src/lib/ap/zone-check.ts` — create: crop + Tesseract + result builder.
- `src/lib/ap/ocr.ts` — modify: `extractInvoiceFromFile` gains `templates` param and runs the zone check.
- `src/components/ap/upload-dialog.tsx` — modify: pass `templates` through to extraction.
- `src/components/ap/zone-editor.tsx` — create: draggable/resizable overlay + Save zones.
- `src/components/ap/zone-chips.tsx` — create: amber/green chip list from `invoice.zoneCheck`.
- `src/routes/invoices.$id.tsx` — modify: "Code zones" toggle, mount `ZoneEditor`, `ZoneChips`, save handler.

---

### Task 1: Zone types + date presentation

**Files:**
- Modify: `src/lib/ap/types.ts:32-77` (field/Invoice types) and `:99-104` (`shortDate`).

**Interfaces:**
- Consumes: existing `ExtractedField` union (already the 7 zoned fields).
- Produces:
  - `export type ZoneField = ExtractedField;`
  - `export type Zone = { x: number; y: number; w: number; h: number };` (normalized 0..1)
  - `export type ZoneMap = Partial<Record<ZoneField, Zone>>;`
  - `export type VendorTemplate = { fields: ZoneMap; updatedAt: string };`
  - `export type ZoneCheckResult = { field: ZoneField; ai: string; ocr: string; match: boolean };`
  - `export const ZONE_FIELDS: ExtractedField[]` (the 7, in display order).
  - `export const ZONE_LABEL: Record<ExtractedField, string>`.
  - `Invoice` gains optional `zones?: ZoneMap | undefined` and `zoneCheck?: ZoneCheckResult[] | undefined`.
  - `shortDate` now renders `DD-MM-YYYY` via `nl-NL`.

- [ ] **Step 1: Add the zone types**

Insert after the `ExtractedField` type (line 33) and before `OcrPageMethod`:

```ts
export type ZoneField = ExtractedField;

/** Normalized 0..1 rectangle anchored to a document image. */
export type Zone = { x: number; y: number; w: number; h: number };

export type ZoneMap = Partial<Record<ZoneField, Zone>>;

/** Reusable field anchors for one vendor; latest save wins per field. */
export type VendorTemplate = { fields: ZoneMap; updatedAt: string };

export type ZoneCheckResult = { field: ZoneField; ai: string; ocr: string; match: boolean };

/** Fields that carry a draggable anchor in Code-zones mode, in display order. */
export const ZONE_FIELDS: ExtractedField[] = [
  "vendor",
  "invoiceNumber",
  "issueDate",
  "dueDate",
  "subtotal",
  "tax",
  "total",
];

export const ZONE_LABEL: Record<ExtractedField, string> = {
  vendor: "Vendor",
  invoiceNumber: "Invoice no.",
  issueDate: "Issue date",
  dueDate: "Due date",
  subtotal: "Subtotal",
  tax: "Tax",
  total: "Total",
};
```

- [ ] **Step 2: Extend `Invoice`**

Inside the `Invoice` type, after `fieldSources` (line 75), add:

```ts
  /** Anchors the reviewer drew on this invoice's image (saved per-vendor too). */
  zones?: ZoneMap | undefined;
  /** Crop-OCR vs AI comparison from the vendor template, if one matched. */
  zoneCheck?: ZoneCheckResult[] | undefined;
```

- [ ] **Step 3: Flip `shortDate` to Dutch DD-MM-YYYY**

Replace the `shortDate` body (line 103) `return d.toLocaleDateString("en-US", ...)` with:

```ts
  return d.toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
```

- [ ] **Step 4: Verify**

Run:
```bash
node_modules\.bin\tsc.exe --noEmit
npm run lint
npm run build
```
Expected: tsc 0 errors; lint reports only the pre-existing baseline (~45 errors, none in `types.ts`); build PASS.

---

### Task 2: Template storage in the store

**Files:**
- Modify: `src/lib/ap/store.tsx`.

**Interfaces:**
- Consumes: `ZoneMap`, `VendorTemplate` from `./types` (Task 1).
- Produces (all via `useAp()`):
  - `templates: Record<string, VendorTemplate>`
  - `upsertTemplate: (vendor: string, zones: ZoneMap) => void`

- [ ] **Step 1: Add key + state + ctx types**

Change the imports to include the new types:

```ts
import { sampleHistory, sampleInvoices } from "./samples";
import { uid, type Invoice, type InvoiceStatus, type VendorTemplate, type ZoneMap } from "./types";
```

Add the storage key next to line 14:

```ts
const TEMPLATES_STORAGE_KEY = "ap-automation-templates-v1";
```

Add to the `Ctx` type (after `markPaid`, line 28):

```ts
  templates: Record<string, VendorTemplate>;
  upsertTemplate: (vendor: string, zones: ZoneMap) => void;
```

- [ ] **Step 2: Add state + load/persist effects**

Inside `ApProvider`, next to the `history` state (line 37):

```ts
  const [templates, setTemplates] = useState<Record<string, VendorTemplate>>({});
```

Add a load effect (after the invoices load effect, line 58):

```ts
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, VendorTemplate>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) setTemplates(parsed);
      }
    } catch {
      /* ignore corrupted storage */
    }
  }, []);
```

Add a persist effect (after the history persist effect, line 77):

```ts
  useEffect(() => {
    try {
      localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    } catch {
      /* storage full or unavailable */
    }
  }, [templates]);
```

- [ ] **Step 3: Add `upsertTemplate` + wire reset**

After `markPaid` (line 143):

```ts
  const upsertTemplate = useCallback((vendor: string, zones: ZoneMap) => {
    setTemplates((prev) => ({
      ...prev,
      [vendor]: { fields: zones, updatedAt: new Date().toISOString() },
    }));
  }, []);
```

In `resetDemo` (line 148) add `setTemplates({});` after `setHistory(sampleHistory());`.

- [ ] **Step 4: Expose in context value**

Extend the `value` `useMemo` (lines 150-153) — add `templates` and `upsertTemplate` to both the object and the dependency array.

- [ ] **Step 5: Verify**

Run:
```bash
node_modules\.bin\tsc.exe --noEmit
npm run lint
npm run build
```
Expected: tsc 0; no lint errors in `store.tsx`; build PASS.

---

### Task 3: Pure compare/format helpers

**Files:**
- Create: `src/lib/ap/zones.ts`.

**Interfaces:**
- Consumes: `money`, `ZoneField` from `./types`.
- Produces:
  - `export function parseDateParts(raw: string): { day: number; month: number; year: number } | undefined`
  - `export function moneyToNumber(raw: string): number | undefined`
  - `export function compareZoneValue(field: ZoneField, ai: unknown, ocrText: string): boolean`
  - `export function formatZoneAi(field: ZoneField, ai: unknown, currency?: string | undefined): string`

- [ ] **Step 1: Write the module**

Create `src/lib/ap/zones.ts`:

```ts
import { money, type ZoneField } from "./types";

const NL_MONTHS: Record<string, number> = {
  januari: 1,
  februari: 2,
  maart: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  augustus: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mrt: 3,
  apr: 4,
  mei: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  okt: 10,
  nov: 11,
  dec: 12,
};

export type DateParts = { day: number; month: number; year: number };

function validDate(d: DateParts): boolean {
  const dt = new Date(d.year, d.month - 1, d.day);
  return dt.getFullYear() === d.year && dt.getMonth() === d.month - 1 && dt.getDate() === d.day;
}

/**
 * Parses a date read from a zone crop. Tries ISO first, then Dutch day-first
 * numerics and Dutch month names ("4 maart 2026"). Accepts `.`, `/`, `-`.
 */
export function parseDateParts(raw: string): DateParts | undefined {
  const s = raw.trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const d = { day: Number(m[3]), month: Number(m[2]), year: Number(m[1]) };
    return validDate(d) ? d : undefined;
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const year = Number(m[3]!);
    const d = { day: Number(m[1]), month: Number(m[2]), year: year < 100 ? year + 2000 : year };
    return validDate(d) ? d : undefined;
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (m) {
    const month = NL_MONTHS[m[2]!.toLowerCase()];
    if (!month) return undefined;
    const d = { day: Number(m[1]), month, year: Number(m[3]) };
    return validDate(d) ? d : undefined;
  }
  return undefined;
}

/** Dutch-first money like "1.452,00" / "€ 1.234,56"; also plain "1234.5". */
export function moneyToNumber(raw: string): number | undefined {
  const s = raw.replace(/[€$]/g, "").replace(/\s/g, "");
  if (!s) return undefined;
  let n: number;
  if (/,\d{1,2}$/.test(s)) {
    n = Number(s.replace(/\./g, "").replace(",", "."));
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) {
    n = Number(s.replace(/\./g, ""));
  } else {
    n = Number(s.replace(/,/g, ""));
  }
  return Number.isFinite(n) ? n : undefined;
}

function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when the AI value and the Tesseract crop text agree for this field type. */
export function compareZoneValue(field: ZoneField, ai: unknown, ocrText: string): boolean {
  const text = ocrText.trim();
  if (field === "subtotal" || field === "tax" || field === "total") {
    const aiNum = typeof ai === "number" ? ai : Number(ai);
    const ocrNum = moneyToNumber(text);
    if (!Number.isFinite(aiNum) || ocrNum === undefined) return false;
    return Math.abs(aiNum - ocrNum) <= 0.02;
  }
  if (field === "issueDate" || field === "dueDate") {
    if (typeof ai !== "string") return false;
    const iso = parseDateParts(ai);
    const ocr = parseDateParts(text);
    if (!iso || !ocr) return false;
    return iso.day === ocr.day && iso.month === ocr.month && iso.year === ocr.year;
  }
  const a = normalizeText(typeof ai === "string" ? ai : String(ai ?? ""));
  const b = normalizeText(text);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/** Human-readable AI value for a chip: DD-MM-YYYY dates, currency money, raw text. */
export function formatZoneAi(field: ZoneField, ai: unknown, currency = "EUR"): string {
  if (field === "subtotal" || field === "tax" || field === "total") {
    return money(typeof ai === "number" ? ai : Number(ai) || 0, currency);
  }
  if (field === "issueDate" || field === "dueDate") {
    const iso = parseDateParts(typeof ai === "string" ? ai : String(ai ?? ""));
    if (iso) {
      return `${String(iso.day).padStart(2, "0")}-${String(iso.month).padStart(2, "0")}-${iso.year}`;
    }
    return String(ai ?? "");
  }
  return String(ai ?? "");
}
```

- [ ] **Step 2: Verify**

Run:
```bash
node_modules\.bin\tsc.exe --noEmit
npm run lint
npm run build
```
Expected: tsc 0; (prettier is clean on this file); build PASS.

---

### Task 4: Crop + OCR a zone, build results

**Files:**
- Create: `src/lib/ap/zone-check.ts`.

**Interfaces:**
- Consumes: `Zone`, `ZoneCheckResult`, `ZoneMap` from `./types`; `compareZoneValue`, `formatZoneAi` from `./zones` (Task 3).
- Produces:
  - `export async function runZoneCheck(image: Blob, fields: ZoneCheckFields, zones: ZoneMap): Promise<ZoneCheckResult[]>`
  - `export type ZoneCheckFields = { vendor: string; invoiceNumber: string; issueDate: string; dueDate: string; subtotal: number; tax: number; total: number };`

- [ ] **Step 1: Write the module**

Create `src/lib/ap/zone-check.ts`:

```ts
import { type Zone, type ZoneCheckResult, type ZoneField, type ZoneMap } from "./types";
import { compareZoneValue, formatZoneAi } from "./zones";

/** Extra crop margin around each zone, normalized units (2% each side). */
const ZONE_PAD = 0.02;

export type ZoneCheckFields = {
  vendor: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
};

async function readZoneText(image: Blob, zone: Zone): Promise<string | undefined> {
  const bitmap = await createImageBitmap(image);
  try {
    const padX = ZONE_PAD * bitmap.width;
    const padY = ZONE_PAD * bitmap.height;
    const x = Math.max(0, Math.round(zone.x * bitmap.width - padX));
    const y = Math.max(0, Math.round(zone.y * bitmap.height - padY));
    const w = Math.max(1, Math.min(bitmap.width - x, Math.round(zone.w * bitmap.width + 2 * padX)));
    const h = Math.max(1, Math.min(bitmap.height - y, Math.round(zone.h * bitmap.height + 2 * padY)));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    canvas.width = canvas.height = 0;
    if (!blob) return undefined;
    const { default: Tesseract } = await import("tesseract.js");
    const result = await Tesseract.recognize(blob, "eng+nld");
    const text = (result.data.text ?? "").trim().replace(/\s+/g, " ");
    return text || undefined;
  } finally {
    bitmap.close();
  }
}

/**
 * Best-effort sanity pass: for each zoned field present, crop the image at the
 * anchor (+ padding), OCR it with Tesseract, and compare to the AI value.
 * Unmatched fields and failed reads are skipped silently.
 */
export async function runZoneCheck(
  image: Blob,
  fields: ZoneCheckFields,
  zones: ZoneMap,
): Promise<ZoneCheckResult[]> {
  const results: ZoneCheckResult[] = [];
  for (const [field, zone] of Object.entries(zones) as [ZoneField, Zone][]) {
    if (!zone) continue;
    const aiValue = fields[field];
    if (aiValue === "" || aiValue == null) continue;
    const ocrText = await readZoneText(image, zone).catch(() => undefined);
    if (!ocrText) continue;
    results.push({
      field,
      ai: formatZoneAi(field, aiValue, fields.currency),
      ocr: ocrText,
      match: compareZoneValue(field, aiValue, ocrText),
    });
  }
  return results;
}
```

- [ ] **Step 2: Verify**

Run:
```bash
node_modules\.bin\tsc.exe --noEmit
npm run lint
npm run build
```
Expected: tsc 0; build PASS. (`fields[field]` is `string | number`; the `== null` guard covers both.)

---

### Task 5: Wire the zone check into extraction

**Files:**
- Modify: `src/lib/ap/ocr.ts:584-742` (signature + pre-return hook), `src/components/ap/upload-dialog.tsx:16-58`.

**Interfaces:**
- Consumes: `runZoneCheck`, `ZoneCheckFields` from `./zone-check` (Task 4); `VendorTemplate`, `ZoneCheckResult` from `./types`; `downscaleToJpeg` already imported (line 14).
- Produces:
  - `extractInvoiceFromFile(file, onProgress?, onToken?, templates?)` — `templates?: Record<string, VendorTemplate> | undefined` new optional 4th arg.
  - Extracted invoice gains `zoneCheck` when a vendor template matches.

- [ ] **Step 1: Add imports + signature param**

In `ocr.ts`, extend the type import (line 9):

```ts
import { GL_ACCOUNTS, DEPARTMENTS, uid, type ExtractedField, type Invoice, type LineItem, type OcrMethod, type OcrPage, type VendorTemplate, type ZoneCheckResult } from "./types";
```

And the gemma import block (line 12-22) plus a new import for the runner:

```ts
import {
  blobToBase64,
  downscaleToJpeg,
  extractPageWithVision,
  gemmaHealthy,
  gemmaModel,
  gemmaToFields,
  imageExtractModelOrder,
  mergeGemmaPages,
  type GemmaPage,
} from "../ai/gemma";
import { runZoneCheck } from "./zone-check";
```

Change the function signature (line 584-588):

```ts
export async function extractInvoiceFromFile(
  file: File,
  onProgress?: (p: OcrProgress) => void,
  onToken?: (text: string) => void,
  templates?: Record<string, VendorTemplate> | undefined,
): Promise<Invoice> {
```

- [ ] **Step 2: Run the zone check before returning**

After the `auditNote` const (line 699) and before the `return`, insert:

```ts
  let zoneCheck: ZoneCheckResult[] | undefined;
  const template = templates?.[vendor];
  if (template?.fields && Object.keys(template.fields).length > 0) {
    try {
      const source: Blob | undefined = isImage
        ? await downscaleToJpeg(file)
        : pages[0]?.image;
      if (source) {
        const detected = await runZoneCheck(
          source,
          {
            vendor,
            invoiceNumber,
            issueDate: issueDate || now.slice(0, 10),
            dueDate,
            subtotal: resolvedSubtotal,
            tax: resolvedTax,
            total: resolvedTotal,
            currency,
          },
          template.fields,
        );
        if (detected.length) zoneCheck = detected;
      }
    } catch {
      /* zone sanity check is best-effort; never block ingestion */
    }
  }
```

Add to the returned object literal (after `fieldSources: fields.fieldSources,`, line 739):

```ts
    ...(zoneCheck ? { zoneCheck } : {}),
```

- [ ] **Step 3: Pass templates from the upload dialog**

In `upload-dialog.tsx` line 19 change to:

```ts
  const { addInvoice, templates } = useAp();
```

And at the call site (lines 44-57) add `templates` as the 4th argument:

```ts
      const invoice = await extractInvoiceFromFile(
        file,
        (p) => {
          setStage(p.stage);
          setProgress(Math.max(5, Math.round(p.progress * 100)));
          setPageInfo(
            p.totalPages && p.totalPages > 1 && p.page ? `Page ${p.page} of ${p.totalPages}` : "",
          );
        },
        (t) => {
          setStream((s) => s + t);
          streamPaneRef.current?.scrollTo(0, streamPaneRef.current.scrollHeight);
        },
        templates,
      );
```

(For PDFs without a rendered page-1 image — `engine: "ocr"` fallback — `pages[0]?.image` is undefined and the check is skipped silently, as designed.)

- [ ] **Step 4: Verify**

Run:
```bash
node_modules\.bin\tsc.exe --noEmit
npm run lint
npm run build
```
Expected: tsc 0; no lint errors introduced in `ocr.ts` (it carries ~3 pre-existing prettier errors — do not reformat the whole file; your inserted lines must be clean); build PASS.

---

### Task 6: Zone editor overlay

**Files:**
- Create: `src/components/ap/zone-editor.tsx`.

**Interfaces:**
- Consumes: `ZONE_FIELDS`, `ZONE_LABEL`, `Zone`, `ZoneMap`, `Invoice` from `@/lib/ap/types`; `Button` from `@/components/ui/button`; `Save` from `lucide-react`; `toast` from `sonner`.
- Produces:
  - `export function ZoneEditor({ invoice, onSave }: { invoice: Invoice; onSave: (zones: ZoneMap) => void }): JSX.Element`

- [ ] **Step 1: Write the component**

Create `src/components/ap/zone-editor.tsx`:

```tsx
import { useRef, useState, type PointerEvent } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ZONE_FIELDS,
  ZONE_LABEL,
  type ExtractedField,
  type Invoice,
  type Zone,
  type ZoneMap,
} from "@/lib/ap/types";

/** Default anchor when an invoice/wallet has no zones yet (a 3-column grid). */
function seedZones(): ZoneMap {
  const zones: ZoneMap = {};
  ZONE_FIELDS.forEach((field, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    zones[field] = {
      x: 0.02 + col * 0.32,
      y: 0.08 + row * 0.3,
      w: 0.32,
      h: 0.15,
    };
  });
  return zones;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

type DragState = {
  field: ExtractedField;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  scale: number;
};

/**
 * Draggable/resizable overlay over an uploaded invoice image. Coordinates are
 * normalized to the displayed image so they apply at any render size.
 */
export function ZoneEditor({
  invoice,
  onSave,
}: {
  invoice: Invoice;
  onSave: (zones: ZoneMap) => void;
}) {
  const [zones, setZones] = useState<ZoneMap>(() => invoice.zones ?? seedZones());
  const drag = useRef<DragState | null>(null);
  const imgWrapRef = useRef<HTMLDivElement>(null);

  const begin =
    (field: ExtractedField, mode: "move" | "resize") =>
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = imgWrapRef.current?.getBoundingClientRect();
      if (!rect || !rect.width) return;
      drag.current = {
        field,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        scale: 1 / rect.width,
      };
      imgWrapRef.current?.setPointerCapture(e.pointerId);
    };

  const unset = () => {
    drag.current = null;
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) * d.scale;
    const dy = (e.clientY - d.startY) * d.scale;
    setZones((prev) => {
      const cur = prev[d.field] ?? { x: 0, y: 0, w: 0.1, h: 0.1 };
      const next: Zone =
        d.mode === "move"
          ? {
              x: clamp(cur.x + dx, 0, 1 - cur.w),
              y: clamp(cur.y + dy, 0, 1 - cur.h),
              w: cur.w,
              h: cur.h,
            }
          : {
              x: cur.x,
              y: cur.y,
              w: clamp(cur.w + dx, 0.05, 1 - cur.x),
              h: clamp(cur.h + dy, 0.05, 1 - cur.y),
            };
      return { ...prev, [d.field]: next };
    });
  };

  return (
    <div>
      <div
        ref={imgWrapRef}
        className="relative"
        onPointerMove={move}
        onPointerUp={unset}
        onPointerCancel={unset}
      >
        <img
          src={invoice.fileUrl}
          alt={invoice.fileName ?? "Invoice"}
          className="pointer-events-none block max-w-full rounded-lg border border-border shadow-sm"
        />
        {ZONE_FIELDS.map((field) => {
          const z = zones[field];
          if (!z) return null;
          return (
            <div
              key={field}
              onPointerDown={begin(field, "move")}
              className="absolute box-border cursor-move touch-none rounded-sm border-2 border-accent bg-accent/15"
              style={{
                left: `${z.x * 100}%`,
                top: `${z.y * 100}%`,
                width: `${z.w * 100}%`,
                height: `${z.h * 100}%`,
              }}
            >
              <span className="absolute left-1.5 top-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-foreground">
                {ZONE_LABEL[field]}
              </span>
              <div
                onPointerDown={begin(field, "resize")}
                className="absolute -right-1.5 -bottom-1.5 size-3.5 cursor-nwse-resize rounded-sm border border-background bg-accent"
              />
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Drag a box onto each field, resize with the corner handle, then save.
        </p>
        <Button
          size="sm"
          onClick={() => {
            onSave(zones);
            toast.success(`Zones saved for ${invoice.vendor}`);
          }}
        >
          <Save className="size-3.5" /> Save zones
        </Button>
      </div>
    </div>
  );
}
```

Notes: `field` is the field-name string (an `ExtractedField`); `zones[field]` may be `undefined` under `noUncheckedIndexedAccess` so `move` seeds `(0,0,0.1,0.1)` on first use — a nil rect can only arise if a saved zone map omitted that field. `touch-none` keeps pointer gestures on touch devices. The resize handle's `begin` stops propagation so clicking the handle never also starts a move. `pointer-events-none` on the `<img>` keeps pointer capture on the wrapper.

- [ ] **Step 2: Verify**

Run:
```bash
node_modules\.bin\tsc.exe --noEmit
npm run lint
npm run build
```
Expected: tsc 0; no lint errors in the new file; build PASS.

---

### Task 7: Zone chips + detail page wiring

**Files:**
- Create: `src/components/ap/zone-chips.tsx`.
- Modify: `src/routes/invoices.$id.tsx`.

**Interfaces:**
- Consumes: `ZONE_LABEL`, `ZoneCheckResult`, `ZoneMap` from `@/lib/ap/types`; `ZoneEditor` (Task 6); `useAp().upsertTemplate` (Task 2).
- Produces:
  - `export function ZoneChips({ checks }: { checks: ZoneCheckResult[] }): JSX.Element`
  - Detail page: "Code zones" toggle button (image uploads only), `ZoneEditor` swap, save handler.

- [ ] **Step 1: Create the chips component**

Create `src/components/ap/zone-chips.tsx`:

```tsx
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { ZONE_LABEL, type ZoneCheckResult } from "@/lib/ap/types";

/** Amber chips for zone-check mismatches, subtle green confirms for matches. */
export function ZoneChips({ checks }: { checks: ZoneCheckResult[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {checks.map((c) =>
        c.match ? (
          <span
            key={c.field}
            className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-1 text-xs text-success-foreground"
          >
            <CheckCircle2 className="size-3.5" />
            {ZONE_LABEL[c.field]} zone OK
          </span>
        ) : (
          <span
            key={c.field}
            className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs text-warning-foreground"
          >
            <TriangleAlert className="size-3.5" />
            {ZONE_LABEL[c.field]}: AI <span className="font-mono">{c.ai}</span> vs OCR{" "}
            <span className="font-mono">{c.ocr}</span>
          </span>
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire the detail page**

In `src/routes/invoices.$id.tsx`:

Imports — add after line 18 (`DocPreview` import):

```ts
import { ZoneChips } from "@/components/ap/zone-chips";
import { ZoneEditor } from "@/components/ap/zone-editor";
```

Add to the type import (lines 20-27): `type ZoneMap` (already imports `ExtractedField`, `Invoice`).

In `Detail`, change the `useAp` destructure (line 74):

```ts
  const { updateInvoice, setStatus, markPaid, upsertTemplate } = useAp();
```

Add state next to `note` (line 76):

```ts
  const [zoning, setZoning] = useState(false);
```

Add a save handler after `advance` (line 93):

```ts
  const canZone =
    Boolean(invoice.fileUrl) && invoice.fileType?.startsWith("image/") && invoice.status === "draft";

  const saveZones = (z: ZoneMap) => {
    patch({ zones: z });
    upsertTemplate(invoice.vendor, z);
    setZoning(false);
  };
```

Render the toggle in the Document section header (lines 130-138) — inside the header flex row, after the page/file `<p>`:

```tsx
            {canZone && (
              <Button
                variant={zoning ? "default" : "outline"}
                size="sm"
                className="gap-2"
                onClick={() => setZoning((s) => !s)}
              >
                <PenLine className="size-3.5" /> {zoning ? "Cancel zones" : "Code zones"}
              </Button>
            )}
```

Swap the preview when zoning is on (lines 139-141):

```tsx
          <div className="max-h-[820px] overflow-auto">
            {zoning && canZone ? (
              <ZoneEditor invoice={invoice} onSave={saveZones} />
            ) : (
              <DocPreview invoice={invoice} />
            )}
          </div>
```

Render chips after the low-confidence banner (after line 126):

```tsx
      {invoice.zoneCheck && invoice.zoneCheck.length > 0 && (
        <div className="mt-4">
          <ZoneChips checks={invoice.zoneCheck} />
        </div>
      )}
```

- [ ] **Step 3: Verify**

Run:
```bash
node_modules\.bin\tsc.exe --noEmit
npm run lint
npm run build
```
Expected: tsc 0; no new lint errors (the file has no pre-existing prettier errors — keep it clean); build PASS.

---

### Task 8: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Cold gates**

Run, in order, and confirm all three pass:

```bash
node_modules\.bin\tsc.exe --noEmit
npm run lint
npm run build
```

Expected: tsc 0 errors; lint shows only the pre-existing baseline (~45 errors spread across untouched files like `doc-preview.tsx`), zero new; build PASS.

- [ ] **Step 2: Reset local state**

All three dev servers are hot on 8081/8082. Use the in-app **Reset demo data** button once so `ap-automation-templates-v1` starts empty.

- [ ] **Step 3: Manual smoke — template creation**

1. Open the app, upload any image invoice (or use an existing uploaded draft — `invoice.fileType` must start with `image/`).
2. On the detail page (status draft), confirm the **Code zones** button appears in the Document header.
3. Click it: 7 labeled boxes overlay the image. Drag a box; it follows the pointer and clamps at the edges. Drag the corner handle; width/height grow/shrink with a 5% minimum. No page scroll during drag.
4. Move boxes over the real vendor/number/date/total regions and click **Save zones**. Chip toast appears; the overlay exits; the invoice shows the drawn anchors on re-entry to Code zones.
5. Verify localStorage `ap-automation-templates-v1` now contains `{ "<vendor>": { fields: {...}, updatedAt: "..." } }` with 0..1 coords.

- [ ] **Step 4: Manual smoke — sanity check on a second invoice**

1. Upload a second image of the same invoice layout (different file, same vendor).
2. Watch extraction complete; open the new draft. The zone chips row shows a mix of `zone OK` (success-token green) for aligned fields and amber `AI … vs OCR …` chips for any misread.
3. Verify the dates inside amber chips render `DD-MM-YYYY`, and money renders via the `currency` formatter (`€ …`).
4. Re-upload the exact same file: previously-matching fields stay green, confirming crop repetition, not hallucination.

- [ ] **Step 5: Manual smoke — regressions**

- Confirm the list, detail, and history pages now render dates as `DD-MM-YYYY` everywhere `shortDate` is used.
- Confirm **Reset demo data** clears invoices, history, and `ap-automation-templates-v1`.
- Confirm PDF uploads still extract and preview normally (iframe path untouched), and that a PDF whose vendor has a saved template does NOT show the Code zones button but DOES show zone chips (page-1 consume path).
- Confirm a vendor with no template shows no chips and no Code zones regression.