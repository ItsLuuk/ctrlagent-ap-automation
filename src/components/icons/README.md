# Icon Library — `src/components/icons`

Foundry's icon library wraps [Lucide React](https://lucide.dev) so every glyph in the app shares one brand posture: **monochrome, single-weight (1.5px), round-capped, outline, small**.

```
src/components/icons/
  icon.tsx        — core wrapper, size tokens, type defs, createIcon / createSpinningIcon
  catalog.tsx     — wrapped Lucide glyphs + domain aliases (Invoice, Vendor, …)
  mark.tsx        — FoundryMark + IconWell (Action Blue pill, ghost, subtle variants)
  brand.tsx       — custom Foundry SVGs (FoundryStamp, InvoiceStack, VendorBuilding, …)
  badge.tsx       — BadgeIcon: filled-circle status indicator with tone
  registry.ts     — iconFor(concept) single source of truth for domain concepts
  index.ts        — public barrel
```

## Brand rules

- **One stroke weight.** `ICON_STROKE = 1.5` everywhere. Do not pass a custom `strokeWidth` into a wrapped icon.
- **currentColor only.** Icons are monochrome. The well (IconWell) carries the color, not the glyph. Never recolor an icon's strokes.
- **Optical sizes.** `xs=12 sm=14 md=16 lg=20 xl=24`. `md` for chrome (nav, buttons), `lg` for page titles, `xl` for marketing wells. Use the token, not a raw number, unless a pixel-exact value is justified.
- **Pills are 9999px radius, no shadow.** `IconWell` enforces this. Never pass a className that adds a shadow or a different radius.
- **No fills except Action Blue button fills.** Icons are outline. No Molten fill on glyphs.
- **Color travels with its `-foreground` pair.** A status icon that is the only indicator of state on a light surface is not allowed — pair with a label (accessibility.md §1).

## API

### `createIcon(Source, displayName)` —> `Icon`

Wraps any Lucide icon so it obeys Foundry rules: `currentColor`, 1.5px stroke, round caps, `shrink-0`, `aria-hidden` unless labelled.

```tsx
import { createIcon } from "@/components/icons";
import { Mail } from "lucide-react";
const MailIcon = createIcon(Mail, "Mail");
```

### `createSpinningIcon(Source, displayName)` —> `Icon`

Same as `createIcon` but with `animate-spin` baked in. Used for `Loader2` / `Spinner`.

### `IconWell`

Pill icon container. Three variants:

| Variant  | Fill / stroke                       | Use                                                    |
| -------- | ----------------------------------- | ------------------------------------------------------ |
| `filled` | Action Blue + white glyph (default) | Sidebar mark, brand marks, marketing wells             |
| `ghost`  | hairline ring, transparent, glyph   | Inline icon chips next to labels                       |
| `subtle` | Silk/muted fill, Ink glyph          | Empty-state headers, muted toolbars                    |

Size tokens: `sm` (24px), `md` (32px), `lg` (40px) diameter.

```tsx
import { IconWell, FoundryMark } from "@/components/icons";
<IconWell variant="filled" size="md"><FoundryMark /></IconWell>;
<IconWell variant="ghost" size="sm"><Search /></IconWell>;
```

### `BadgeIcon`

Filled circle carrying one glyph. Used in pipeline step indicators and status badges. Tone is a semantic token — never a raw Tailwind palette class.

| Tone         | Fill / text                                      |
| ------------ | ------------------------------------------------ |
| `accent`     | accent wash + accent-foreground                  |
| `success`    | green + dark green text                          |
| `warning`    | amber + dark amber text                          |
| `destructive`| Alert Red + white                                |
| `info`       | info blue + white                                |
| `muted`      | muted surface + muted-foreground                 |
| `sidebar`    | Ink sidebar + white                              |
| `foreground` | foreground + white (dark surfaces)               |

```tsx
import { BadgeIcon, Check } from "@/components/icons";
<BadgeIcon icon={Check} tone="accent" size="md" ring aria-label="Done" />;
```

### `FoundryMark`

The brand mark — a rounded ledger card with three lines. Monochrome outline. Use in the sidebar and on marketing wells (behind a filled IconWell).

### Custom branded SVGs — `brand.tsx`

| Icon             | Job                                                                    |
| ---------------- | ---------------------------------------------------------------------- |
| `FoundryStamp`   | Approval / sign-off glyph (review screen decision bar, paid history)  |
| `InvoiceStack`   | Two overlapping document cards — "these are records, not one page"    |
| `VendorBuilding` | Vendor house-mark, distinct from the user/avatar treatment             |
| `VerifiedSeal`   | Circular seal with check — trust story, vendor verification badge      |
| `PaymentCheck`   | Landmark pin with check — "payment landed" (paid history, decision bar)|

### Domain registry — `registry.ts`

Single source of truth: which icon stands for which Foundry concept. Import from here when a call site is wired to a concept string.

```tsx
import { domainIcon, iconFor, type DomainIconKey } from "@/components/icons";

// direct lookup
domainIcon.invoice   // equals FileText
domainIcon.vendor    // equals Users
domainIcon.approval  // equals Stamp

// dynamic lookup by concept key
iconFor("invoice")   // Icon
iconFor("vendor")    // Icon
```

Available keys: `invoice`, `vendor`, `template`, `approval`, `payment`, `exception`, `analytics`, `verified`, `warning`.

Pipeline step icons (from `PIPELINE_STEPS` in `status.tsx`): `pipelineIcon.draft`, `.review`, `.scheduled`, `.done`.

### Catalog — wrapped Lucide glyphs

Every wrapped glyph is `createIcon(LucideSource, "PascalName")`. Import from `@/components/icons`. The full list is in `index.ts` — here are the ones worth knowing:

**Navigation / chrome:** `ArrowLeft`, `ArrowRight`, `ArrowUpRight`, `ChevronDown`, `ChevronLeft`, `ChevronRight`, `ChevronUp`, `PanelLeft`, `MoreHorizontal`, `MoreVertical`, `GripVertical`

**Action:** `Plus`, `Send`, `Save`, `Edit3`/`EditIcon`, `Undo2`, `RefreshCw`, `RotateCcw`, `Copy`/`CopyIcon`, `Lock`/`LockIcon`, `Settings`, `Search`, `Filter`/`FilterIcon`, `Tray2`/`TrayIcon`, `MousePointerClick`

**Status / semantic:** `Check`, `CheckCircle2`, `AlertTriangle`/`TriangleAlert`, `CircleAlert`, `CircleCheck`, `CircleSlash`, `Ban`, `Warning`, `ShieldCheck`, `BadgeCheck`, `Verified`

**Document / data:** `FileText`/`Invoice`, `FileUp`, `ClipboardPaste`, `Stamp`, `Layers`/`Template`, `Tag`, `Table2`, `ListChecks`, `CalendarDays`, `History`, `Inbox`

**Domain aliases** (prefer these so screens speak Foundry vocabulary): `Invoice` = `FileText`, `Vendor` = `Users`, `Template` = `Layers`, `Approval` = `Stamp`, `Payment` = `Landmark`, `Exception` = `AlertTriangle`, `Analytics` = `LineChart`, `Verified` = `BadgeCheck`, `Warning` = `AlertTriangle`, `Spinner` = `Loader2`

**Legacy / shadcn compatibility:** `ChevronDownIcon` = `ChevronDown`, `ChevronLeftIcon` = `ChevronLeft`, `ChevronRightIcon` = `ChevronRight`, `TriangleAlert` = `AlertTriangle`

**Domain-shaped Lucide additions** (for routes that need a concrete glyph): `Clock`/`ClockIcon`, `Bell`/`BellIcon`, `MapPin`/`MapPinIcon`, `CreditCard`/`CreditCardIcon`, `Building2`, `Brain`, `Cpu`, `Landmark`, `LineChart`, `ScanLine`, `Users`, `UserSearch`, `GraduationCap`, `Crosshair`, `Circle`, `CircleDollarSign`, `Minus`, `PenLine`, `Pencil`

### `LucideIcon` type

Re-exported as `LucideIcon` for backward compat with call sites that typed a prop as `LucideIcon`. It is an alias for `Icon`.

## Adding a new icon

1. If it is a generic Lucide glyph, add the import + `wrap()` call to `catalog.tsx` and the export to `index.ts`. Give it a domain alias in the `// Domain aliases` section if a screen should speak Foundry vocabulary.
2. If it is a Foundry-specific mark (a brand gesture, not just another Lucide shape), add it to `brand.tsx` following the `FoundryStamp` pattern: outline only, `currentColor`, 1.5px stroke, round caps, `aria-hidden` unless labelled. Export from `index.ts` via the `brand.tsx` line.
3. If it represents a domain concept (invoice, vendor, …), wire it in `registry.ts` `domainIcon`.
4. Update this README's table.

## Do not

- Do not import from `lucide-react` anywhere except `catalog.tsx`. Every consumer should import from `@/components/icons`.
- Do not pass `strokeWidth` other than 1.5 into a wrapped icon.
- Do not recolor an icon's strokes with a prop or a className — color lives on the well/badge, not the glyph.
- Do not add `bg-emerald-500`-style fills to status icons. Use the `tone` prop on `BadgeIcon`, or the semantic classes in `@/lib/colors`.
- Do not use a BadgeIcon as the sole state indicator on a light surface without a label.
