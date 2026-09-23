# Invoice Tags Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle invoice tags to the brand-conform `Badge` language (bare-text strip, 3px left border, danger-only icons, Recurring hidden).

**Architecture:** Data (`TAG_TONES` map in `types.ts`) drives a restyled `TagBadge`; two missing lucide glyphs are added through the existing icon catalog pattern. No logic, predicate, or stored-data changes.

**Tech Stack:** React + Tailwind v4 Foundry tokens, lucide-react, bun test.

## Global Constraints

- Colors are Foundry tokens from `src/styles.css` — never raw Tailwind palette classes (`bg-emerald-500` is a bug).
- Words are always foreground ink; hue lives only in the 3px border + optional icon.
- Type is Open Sauce One; tag text normal case, never uppercase.
- No `text-[10px]` outside chips; tags are `text-xs`.
- Web SSR build (`bun run build`) and desktop build (`bun run build:tauri`) must stay green.
- Full spec: `docs/superpowers/specs/2026-09-22-invoice-tags-design.md`.

---

### Task 1: Add AlarmClock + CopyX glyphs to the icon catalog

**Files:**
- Modify: `src/components/icons/catalog.tsx:1-70` (import block) and icon exports near line 101-102
- Modify: `src/components/icons/index.ts:20-30` (barrel list)
- Test: none (re-export check via Task 4 typecheck)

**Interfaces:**
- Consumes: `wrap()` + `LucideIcon as LucideSource` pattern already in `catalog.tsx`
- Produces: `AlarmClock`, `CopyX` named exports from `@/components/icons` for Task 3

- [ ] **Step 1: Add the lucide imports**

In `src/components/icons/catalog.tsx`, add to the existing `lucide-react` import list (alphabetical: `AlarmClock` first, `CopyX` after `Copy`):

```tsx
import {
  AlarmClock as LucideAlarmClock,
  // ... existing entries unchanged ...
  Copy as LucideCopy,
  CopyX as LucideCopyX,
  // ... rest unchanged ...
} from "lucide-react";
```

- [ ] **Step 2: Add the wrapped exports**

In `src/components/icons/catalog.tsx`, next to the existing wrapped exports:

```tsx
export const AlarmClock = wrap(LucideAlarmClock, "AlarmClock");
```

(placed alphabetically before `AlertTriangle`), and:

```tsx
export const CopyX = wrap(LucideCopyX, "CopyX");
```

(placed directly after `export const Copy = wrap(LucideCopy, "Copy");`).

- [ ] **Step 3: Re-export from the barrel**

In `src/components/icons/index.ts`, add `AlarmClock,` before `AlertTriangle` (or wherever the alphabetical list starts) and `CopyX,` after `Copy,`.

- [ ] **Step 4: Verify the glyphs resolve**

Run: `bun -e "import('./src/components/icons/index.ts').then(m => console.log(typeof m.AlarmClock, typeof m.CopyX))"` from `C:\Users\Luukc\Documents\AP Automation`
Expected: `function function` (wrapped components; both verified present in installed lucide-react already)

---

### Task 2: Replace TAG_COLORS fills with TAG_TONES

**Files:**
- Modify: `src/lib/ap/types.ts:350-359` (delete `TAG_COLORS`, add `TAG_TONES`)
- Test: `src/lib/ap/tag-tones.test.ts` (new; run with `bun test`)

**Interfaces:**
- Consumes: `InvoiceTag` (same file), `PREDEFINED_TAGS` (same file)
- Produces: `TAG_TONES: Record<InvoiceTag, { border: string; accent: string }>` for Task 3

- [ ] **Step 1: Write the failing test**

Create `src/lib/ap/tag-tones.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { PREDEFINED_TAGS, TAG_TONES } from "./types";

describe("TAG_TONES", () => {
  test("covers every predefined tag", () => {
    expect(new Set(Object.keys(TAG_TONES))).toEqual(new Set(PREDEFINED_TAGS));
  });

  test("contains no background fills", () => {
    for (const tone of Object.values(TAG_TONES)) {
      expect(tone.border).not.toMatch(/\bbg-/);
      expect(tone.accent).not.toMatch(/\bbg-/);
    }
  });

  test("reserves destructive for Late, Urgent, Duplicate risk", () => {
    expect(TAG_TONES["Late"].border).toContain("destructive");
    expect(TAG_TONES["Urgent"].border).toContain("destructive");
    expect(TAG_TONES["Duplicate risk"].border).toContain("destructive");
    expect(TAG_TONES["First-time vendor"].border).toContain("foundry-orange");
    expect(TAG_TONES["International"].border).toContain("steel");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/ap/tag-tones.test.ts` from `C:\Users\Luukc\Documents\AP Automation`
Expected: FAIL with `TAG_TONES` undefined / not exported

- [ ] **Step 3: Write minimal implementation**

In `src/lib/ap/types.ts`, replace the `TAG_COLORS` block with:

```ts
export const TAG_TONES: Record<InvoiceTag, { border: string; accent: string }> = {
  Urgent: { border: "border-destructive", accent: "text-destructive" },
  Late: { border: "border-destructive", accent: "text-destructive" },
  "First-time vendor": { border: "border-foundry-orange", accent: "text-foundry-orange" },
  "High value": { border: "border-foundry-orange", accent: "text-foundry-orange" },
  "Needs receipt": { border: "border-foundry-orange", accent: "text-foundry-orange" },
  "Duplicate risk": { border: "border-destructive", accent: "text-destructive" },
  International: { border: "border-steel", accent: "text-muted-foreground" },
  Recurring: { border: "border-border", accent: "text-muted-foreground" },
};
```

(`border` colors the 3px left border; `accent` colors the optional icon. Words always render in foreground ink. `Recurring` keeps a total map entry but is never rendered — see Task 3.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/ap/tag-tones.test.ts` from `C:\Users\Luukc\Documents\AP Automation`
Expected: 3 pass, 0 fail

---

### Task 3: Restyle TagBadge to the Badge language

**Files:**
- Modify: `src/components/ap/tag-badge.tsx` (full rewrite, same props)
- Test: `bunx tsc --noEmit` + `bunx eslint src/components/ap/tag-badge.tsx src/lib/ap/types.ts`

**Interfaces:**
- Consumes: `TAG_TONES` from Task 2; `AlarmClock, Clock, CopyX` from Task 1; `cn` from `@/lib/utils`
- Produces: unchanged component signature `TagBadge({ tag, onRemove })`, `null` for `"Recurring"`

- [ ] **Step 1: Write the new component**

Replace `src/components/ap/tag-badge.tsx` contents with:

```tsx
import { AlarmClock, Clock, CopyX, X } from "@/components/icons";
import { TAG_TONES } from "@/lib/ap/types";
import { cn } from "@/lib/utils";

const TAG_ICONS: Partial<Record<string, typeof Clock>> = {
  Late: Clock,
  Urgent: AlarmClock,
  "Duplicate risk": CopyX,
};

export function TagBadge({
  tag,
  onRemove,
}: {
  tag: string;
  onRemove?: () => void;
}) {
  if (tag === "Recurring") return null;
  const tone = TAG_TONES[tag] ?? {
    border: "border-border",
    accent: "text-muted-foreground",
  };
  const Icon = TAG_ICONS[tag];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border-l-[3px] py-0.5 pl-2 pr-1 text-xs font-medium text-foreground",
        tone.border,
      )}
    >
      {Icon && <Icon className={cn("size-3", tone.accent)} aria-hidden />}
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
        >
          <X className="size-2.5" />
        </button>
      )}
    </span>
  );
}
```

Notes: geometry mirrors `Badge` in `src/components/ap/primitives.tsx:331`. Words stay `text-foreground`; icon takes `tone.accent`. Remove-button hover uses `bg-muted` (was `bg-white/20`, which assumed a fill).

- [ ] **Step 2: Typecheck and lint**

Run: `bunx tsc --noEmit` from `C:\Users\Luukc\Documents\AP Automation`
Expected: no errors in `tag-badge.tsx`, `types.ts`, `catalog.tsx`, `index.ts` (pre-existing errors in `brand.tsx`, `mark.tsx`, `gemma.ts`, `__root.tsx` are out of scope and unchanged)

Run: `bunx eslint src/components/ap/tag-badge.tsx src/lib/ap/types.ts src/components/icons/catalog.tsx src/components/icons/index.ts src/lib/ap/tag-tones.test.ts`
Expected: 0 errors (fast-refresh warning on non-component exports is acceptable if it appears)

---

### Task 4: Verify all three modes and both builds

**Files:**
- None (verification only)

- [ ] **Step 1: Confirm no stale TAG_COLORS consumers**

Run: `rg -n "TAG_COLORS" src` from `C:\Users\Luukc\Documents\AP Automation`
Expected: no output

- [ ] **Step 2: Web build stays green**

Run: `bun run build` from `C:\Users\Luukc\Documents\AP Automation`
Expected: `✓ built`, nitro finishes without errors

- [ ] **Step 3: Desktop build stays green**

Run: `bun run build:tauri` from `C:\Users\Luukc\Documents\AP Automation`
Expected: `✓ built`, `dist-tauri/index.html` emitted with relative asset paths

- [ ] **Step 4: Visual check in all three modes**

Open the inbox (web preview or Tauri dev) with demo data covering Late, Urgent, First-time vendor, High value, Duplicate risk, International, Recurring. In Light, Dark Stage, and Midnight (Settings switch): danger tags show red border + icon, attention tags orange border without icon, International faintest, Recurring renders nothing, words remain readable foreground ink in every mode.
