# Components

> Foundry design system — nav, buttons, cards, product/media, type elements, and inputs. Context: [DESIGN.md](../DESIGN.md). Tokens they use: [colors.md](colors.md), [typography.md](typography.md), [spacing-shapes.md](spacing-shapes.md).

## Navigation

**Global Nav (light or dark).** 44px-tall full-width bar. Foundry mark left, 12px/400 Open Sauce One links (rgba(0,0,0,0.8) on light; white at 80% opacity on dark — full white feels aggressive), search and bag icons right. Controls unboxed. On dark, may go semi-transparent on scroll with backdrop blur. Opened state on light: `#f5f5f7` with a 1px `#e6e6e8` edge and blur(20px).

**Promo / Announcement Bar.** Slim strip above nav. Dark: `#1d1d1f` or `#0d0021` (Midnight); light: `#ffffff`. 12–14px/400 text with an inline text link (`#2997ff` on dark, `#0066cc` on light). About 52px combined with nav; about 8px vertical padding for Midnight. No radius. Optional close button right.

**Floating Nav Pill.** Alternative to the full-width bar for app-marketing pages: a single 9999px-radius pill floating on the page, white or near-white with the whisper shadow and a 1px border, 8px vertical / 12–16px horizontal padding. Logo mark left, 15px/500 menu items, ghost "Get the app" button right.

**Product Local Nav.** White bar under the global nav carrying the product name (Display 19px/600, +0.228px tracking) and compact right-aligned pills. When floated over the page use a 20px container radius with a `#d2d2d7` hairline.

**Section Anchor Nav.** Horizontal list of 17px/500 labels, 25px line height, -0.374px tracking, `#1d1d1f`. Transparent background, 28px vertical padding, no card or underline treatment.

## Buttons

All buttons are 9999px pills. Only one filled chromatic button per viewport.

**Primary CTA (Action Blue).** Fill `#0071e3`, text `#ffffff`, no border. Standard size: 17px/400, padding 11px 22px, tracking -0.374px. Compact size (inside product bars and floating pricing callouts): 12px/400, 16px line height, -0.12px tracking. App-marketing size: 15–16px/600, padding 8–12px 20–24px. Hover: brightness 1.1. Used for Buy, Pricing, Learn More (filled), Try for free.

**Outlined Pill.** Transparent fill, `#1d1d1f` text (or `#ffffff` on dark), 1px `#86868b` outline, 12px/400 compact. No colored fill.

**Ghost Pill.** Transparent, no visible border, text `#ffffff` at 80% on dark, 11px 22px padding, 17px/400. Used for "Watch the video" and feature-explorer controls. On light, a ghost variant with a 1px border matching text at 50% opacity is allowed.

**Amber Download.** Fill `#f7be00`, text `#000000`, 12px 24px padding, 15px/600, with a download icon. Only for app-download conversion, only on Midnight or Dark surfaces. Never placed beside the Action Blue button in the same viewport; on a page with a download goal, it replaces blue.

**Dark Ghost.** Transparent or `#05010d`, white text, 1px white-at-low-opacity border, 12px 24px padding, 15px/500 with an optional phone icon. Quiet companion to Amber Download.

**Text Link.** `#0066cc` on light, `#2997ff` on dark, 17px/400, no underline by default, optional trailing arrow glyph that is part of the link. Tracking matches body.

**Ghost Price Label.** Borderless text button, `#ffffff` on dark, 14px/400, 10px 20px padding, sitting beside the filled CTA. Visually quieter than the CTA.

**Frosted Glass Floating Bar.** `rgba(51,51,54,0.72)` fill, `#ffffff` at 80% text, 36px radius, 11px 22px padding, `backdrop-filter: blur(20px) saturate(1)`. Holds price plus the Action Blue pill; anchored at hero bottom-right over photography. Light-mode equivalent: a `#ffffff` 28px-radius capsule with 14px/600 `#1d1d1f` pricing text, no shadow.

## Icons

> Monochrome, single-weight, outlined, small — SF Symbols posture. Every icon in the app comes from `src/components/icons`, never a raw `lucide-react` import. Spec: `foundry.md §4` (page header icon size), `rules.md` (9999px icon containers, no shadow), `accessibility.md §1` (3:1 contrast floor, no icon-is-the-only-signal on light).

### Posture

- **Outline only.** Icons are strokes, never filled. Color is `currentColor` — the well or badge carries the color, never the glyph. Do not recolor an icon's strokes with a prop or a className.
- **One stroke weight.** `ICON_STROKE = 1.5` everywhere. Do not pass a custom `strokeWidth`.
- **Round caps, round joins.** `stroke-linecap="round"` `stroke-linejoin="round"` — baked into `createIcon`.
- **Small.** App chrome uses `lg` (20px) for page headers and `md` (16px) for inline chrome. Marketing wells use 24–32px. See the size table below.
- **No shadow on icon containers.** `IconWell` enforces `shadow-none`. Elevation comes from surface contrast, not shadows on icons.
- **Color rationed.** Icons do not get chromatic fills. The only filled icon-adjacent surface is the Action Blue `IconWell` variant, and even there the glyph stays `currentColor` (white).

### Sizes

| Token | px  | Use                                                    | Source              |
|-------|-----|--------------------------------------------------------|---------------------|
| `xs`  | 12  | Inline inside a 10–11px chip label                     | `icon.tsx ICON_SIZE`|
| `sm`  | 14  | Tight inline chrome (skeleton rows, dense table cells)| `icon.tsx ICON_SIZE`|
| `md`  | 16  | Button icons, nav items, list-row chips, status badges| `foundry.md §4`     |
| `lg`  | 20  | Page header icon (`PageHeader`), section icons         | `foundry.md §4`     |
| `xl`  | 24  | Marketing wells inside a pill, empty-state headers     | `foundry.md §4`     |

Pixels above are the SVG `viewBox="0 0 24 24"` → rendered size. Prefer the token; use a raw number only when pixel-exact alignment with a non-token layout is justified.

### Containers

#### `IconWell` — pill icon container

9999px radius pill. Three variants:

| Variant  | Fill / glyph                                           | Use                                                     | Example                        |
| -------- | ----------------------------------------------------- | ------------------------------------------------------- | ------------------------------ |
| `filled` | Action Blue + white glyph (default)                    | Sidebar mark, brand mark, marketing well                | `<IconWell><FoundryMark /></IconWell>` |
| `ghost`  | hairline ring, transparent fill, currentColor glyph   | Inline icon chip next to a label, no background         | search input icon, nav icon    |
| `subtle` | Silk/muted fill, Ink glyph                            | Empty-state header, muted toolbar                       | empty-state icon above copy    |

Size tokens: `sm` (24px diam), `md` (32px), `lg` (40px). Never pass a className that adds a shadow or changes the radius.

```tsx
import { IconWell, FoundryMark, Search } from "@/components/icons";

// sidebar brand mark
<IconWell variant="filled" size="md"><FoundryMark /></IconWell>

// inline search icon, ghost
<IconWell variant="ghost" size="sm"><Search /></IconWell>

// empty-state header, subtle
<IconWell variant="subtle" size="lg"><Inbox /></IconWell>
```

#### `BadgeIcon` — filled circle status indicator

A `rounded-full` circle carrying one glyph. Used for pipeline step indicators and status badges. **Tone is a semantic token, never a raw Tailwind palette class** (no `bg-emerald-500`). On light, a `BadgeIcon` that is the only indicator of state is not allowed — pair with a label (`accessibility.md §1`).

| Tone         | Fill / text                                    | Use                                        |
| ------------ | ---------------------------------------------- | ------------------------------------------ |
| `accent`     | accent wash + accent-foreground                | active step, brand accent indicator        |
| `success`    | green + dark-green text                        | done step, verified                        |
| `warning`    | amber + dark-amber text                        | attention step, low confidence             |
| `destructive`| Alert Red + white                              | rejected step, failed                      |
| `info`       | info blue + white                              | informational marker                       |
| `muted`      | muted surface + muted-foreground               | decorative / dormant step                  |
| `sidebar`    | Ink sidebar + white                            | dark chrome step indicator                 |
| `foreground` | foreground + white                             | dark surface step indicator                |

Optional `ring` adds a 4px inset tone-matched ring (the active-step ring from the pipeline). Glyph size is half the circle diameter (so a 16px badge gets an 8px glyph).

```tsx
import { BadgeIcon, Check, Stamp } from "@/components/icons";

// done step, with active ring
<BadgeIcon icon={Check} tone="success" size="md" ring aria-label="Done" />

// rejected step
<BadgeIcon icon={Stamp} tone="destructive" size="md" aria-label="Rejected" />
```

### Domain registry — `registry.ts`

Single source of truth: which icon stands for which Foundry concept. When a call site is wired to a concept string (a route manifest, a dynamic empty state), import from here rather than hardcoding a glyph.

```tsx
import { domainIcon, iconFor, type DomainIconKey } from "@/components/icons";

domainIcon.invoice    // FileText
domainIcon.vendor     // Users
domainIcon.template   // Layers
domainIcon.approval   // Stamp
domainIcon.payment    // Landmark
domainIcon.exception   // AlertTriangle
domainIcon.analytics  // LineChart
domainIcon.verified   // BadgeCheck
domainIcon.warning    // AlertTriangle

iconFor("invoice")    // Icon — dynamic lookup
iconFor("vendor")
```

Pipeline step icons (from `PIPELINE_STEPS` in `status.tsx`): `pipelineIcon.draft`, `.review`, `.scheduled`, `.done`.

### Catalog — wrapped Lucide glyphs

Every wrapped glyph is `createIcon(LucideSource, "PascalName")`. Import from `@/components/icons`.

**Navigation / chrome:** `ArrowLeft`, `ArrowRight`, `ArrowUpRight`, `ChevronDown`, `ChevronLeft`, `ChevronRight`, `ChevronUp`, `PanelLeft`, `MoreHorizontal`, `MoreVertical`, `GripVertical`

**Action:** `Plus`, `Send`, `Save`, `Edit3` / `EditIcon`, `Undo2`, `RefreshCw`, `RotateCcw`, `Copy` / `CopyIcon`, `Lock` / `LockIcon`, `Settings`, `Search`, `Filter` / `FilterIcon`, `Tray2` / `TrayIcon`, `MousePointerClick`

**Status / semantic:** `Check`, `CheckCircle2`, `AlertTriangle` / `TriangleAlert`, `CircleAlert`, `CircleCheck`, `CircleSlash`, `Ban`, `Warning`, `ShieldCheck`, `BadgeCheck`, `Verified`

**Document / data:** `FileText` / `Invoice`, `FileUp`, `ClipboardPaste`, `Stamp`, `Layers` / `Template`, `Tag`, `Table2`, `ListChecks`, `CalendarDays`, `History`, `Inbox`

**Domain aliases** (prefer these so screens speak Foundry vocabulary): `Invoice` = `FileText`, `Vendor` = `Users`, `Template` = `Layers`, `Approval` = `Stamp`, `Payment` = `Landmark`, `Exception` = `AlertTriangle`, `Analytics` = `LineChart`, `Verified` = `BadgeCheck`, `Warning` = `AlertTriangle`, `Spinner` = `Loader2`

**Legacy / shadcn compat:** `ChevronDownIcon` = `ChevronDown`, `ChevronLeftIcon` = `ChevronLeft`, `ChevronRightIcon` = `ChevronRight`, `TriangleAlert` = `AlertTriangle`

**Domain-shaped Lucide additions:** `Clock` / `ClockIcon`, `Bell` / `BellIcon`, `MapPin` / `MapPinIcon`, `CreditCard` / `CreditCardIcon`, `Building2`, `Brain`, `Cpu`, `Landmark`, `LineChart`, `ScanLine`, `Users`, `UserSearch`, `GraduationCap`, `Crosshair`, `Circle`, `CircleDollarSign`, `Minus`, `PenLine`, `Pencil`

**Type alias:** `LucideIcon` is re-exported as a backward-compatible alias for `Icon`.

### Custom Foundry SVGs — `brand.tsx`

Custom marks that are Foundry-specific, not just another Lucide shape. Outline only, `currentColor`, 1.5px stroke.

| Icon             | Job                                                                                  | Where                                                      |
| ---------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `FoundryMark`    | Brand mark — rounded ledger card, three lines. Sidebar + marketing well.             | `Shell` left slot, marketing wells behind `IconWell`.       |
| `FoundryStamp`   | Approval / sign-off glyph — rounded rect stamp body with an inner check.             | review-screen decision bar, paid-history tombstone          |
| `InvoiceStack`   | Two overlapping document cards — "these are records, not one page."                 | when a screen wants to distinguish a list of invoices       |
| `VendorBuilding` | Vendor house-mark — building silhouette, distinct from the user/avatar treatment.    | vendor list rows, vendor profile header                     |
| `VerifiedSeal`   | Circular seal with inner check — trust / verified story.                            | vendor-profile verification badge, marketing trust wells    |
| `PaymentCheck`   | Landmark pin with a check — "payment landed."                                       | paid-history rows, decision-bar "approved" story            |

### Rules (do / don't)

**Do**
- Import from `@/components/icons`. No direct `lucide-react` imports outside `catalog.tsx`.
- Use the size token that matches the placement (`md` chrome, `lg` page header, `xl` well).
- Put color on the well/badge, not the glyph. `currentColor` everywhere.
- Give icon-only buttons an `aria-label` (`accessibility.md §1`).
- Use `domainIcon` / `iconFor` when the call site is wired to a concept string.

**Don't**
- Don't import from `lucide-react` anywhere except `catalog.tsx`.
- Don't pass `strokeWidth` other than 1.5 into a wrapped icon.
- Don't recolor an icon's strokes with a prop or className.
- Don't fill an icon glyph. No Molten on glyphs (Molten is reserved for the logo icon + hero gradient text per `components.md §Brand Mark`).
- Don't use raw Tailwind palette classes for status icon fills (`bg-emerald-500` is a bug — use `BadgeIcon` tone or `colorClasses` from `@/lib/colors`).
- Don't let a lone icon carry state meaning on a light surface without a label.
- Don't add a shadow to an icon well — `IconWell` sets `shadow-none`.

### Related

- Contrast floor and the measured ratio table: `accessibility.md`
- Page-header icon size and header pattern: `foundry.md §4`, `foundry.md §5` (the two `PageHeader` implementations that should be merged)
- 9999px container radius, no shadow: `rules.md`, `spacing-shapes.md`

## Cards & Containers

**Feature Media Card.** 28px radius, no border, no shadow, 28px padding. Light: `#ffffff` on a `#f5f5f7` band. Dark: `#000000` or `#1d1d1f` on black. Feature statement in Display 24px or 40px/600. Media may crop past the card edge. On dark, a full-bleed photograph (black-and-white lifestyle) with 3-line max white overlay text in the upper-left quadrant is the standard pattern.

**Feature Card (ambient).** App-marketing variant: `#ffffff` or `#f5f5f7`, 16–20px radius, 20–30px padding, optional ambient shadow. Headline 22–24px/600, body 16px/400 in `#6e6e73`, 16px between them.

**Floating Notification Card (signature app-marketing component).** `#ffffff`, 20px radius, 16px padding, whisper shadow. Contains a 24–32px icon or avatar, a bold 15px/600 `#000` headline, and 13px/400 metadata in Slate `#6e6e73`. Position around a phone mockup at -3° to +3° rotations so the arrangement feels scattered, not gridded. An optional 3px left border in `#0071e3`, `#d92d20`, or `#f7be00` indicates status.

**Press / Logo Tile.** Midnight Deep `#05010d`, 1px `rgba(255,255,255,0.08)` border, 12–16px radius, 40–60px vertical padding. Logos in white at about 60% opacity, no brand color. 4-column grid with 10–16px gaps. Flat, no shadow.

**Dark Card Surface / Light Card Surface.** The same 28px-radius container in either mode. Text color flips to `#1d1d1f` on light cards. Radius never changes with theme.

**Carousel Playback Control.** Translucent track `rgba(210,210,215,0.64)`, 36px radius, glyphs `rgba(0,0,0,0.56)`. Slide dots and pause grouped into one small pill; no other visible chrome.

## Product & Media

**Brand Mark.** The Foundry wordmark set in Open Sauce One 600 or 700. Solid Ink on light, solid White on dark; the Molten gradient is reserved for hero moments and the logo icon. Never outline, never recolor, never place on photography without a scrim.

**Hero Stage — Centered (Light).** Full-bleed `#ffffff` stage. Centered product name in Display 21px/600, then the hero statement at 80px/600, 84px line height, -1.2px tracking, then the device render directly beneath with no containing card. A floating pricing capsule sits near the lower render.

**Hero Stage — Left-aligned (Dark).** Full-bleed `#000000`, 1440px max-width. Product image at 50–60% of viewport height, rendered at extreme scale with no card chrome. Headline bottom-left at 80px/600 (700 permitted for the expressive stage) in `#f5f5f7`, eyebrow at 17px/400–600 above it (optionally preceded by the Foundry mark), price text and CTA cluster below.

**Hero Stage — App Showcase (Light to Midnight).** White hero with centered headline stack, centered subtext, award badges, and a large phone-in-hand mockup flanked by scattered notification cards; the page then drops into Midnight with the Midnight Glow behind the device.

**Editorial Feature Block.** Small Display kicker in `#1d1d1f`, large left-aligned display statement, then 17px/400 body at about 21px line height with -0.374px tracking. Oversized hardware image enters from the opposite side. On light sections, two-column image and text, image edge-to-edge with 0px radius.

**Device Mockup Container.** Laptop, phone, tablet shown in overlapping arrangements to imply ecosystem. No drop shadow on frames. Screenshots without device frames get 16–24px radius.

**Chip Badge (Prismatic).** About 200px square, 20% radius, Prismatic gradient background, white logo and chip name overlay.

**Finish Swatch.** About 40px circle or 20%-radius square, filled with the finish color, no border by default. A product selector, not decoration.

**Award Badge Pair.** Two 40px-tall pills side by side: white with black text and small Foundry mark, and solid blue with white text. Supporting evidence, not primary content.

## Type Elements

**Molten Headline.** Signature move: display-size text (54–80px, weight 700) filled with the Molten gradient via `-webkit-background-clip: text`, centered, on `#f5f5f7`, with 120px vertical padding. Occasional accent only; never body copy or buttons.

**Section Header.** Left-aligned Display 40px/600 (56–80px on dark stages) in `#1d1d1f` or `#f5f5f7`, optional right-aligned text link opposite it. Generous space above and below; no subtitle or eyebrow on dark stage headlines.

**Category Eyebrow.** Plain text in Foundry Orange `#f56900`, 17px/600, -0.19px tracking, no background, no border, above a feature headline.

**Launch Status Label.** Foundry Orange `#f56900`, 12px/600, 16px line height, -0.12px tracking. Bare text; no pill. (Formerly Ember; folded into the single brand orange.)

**Inline Feature Link.** Horizontal row: 32px circular icon (outlined arrow or compass) in `#1d1d1f` on a white circle, then a two-line 17px/600 label. Tertiary drill-in below body copy in light sections.

## Inputs

**Search Input (Global).** Pill radius. Light: `#ffffff` fill, `#1d1d1f` text, 1px `#86868b` outline. Dark: `#000000` fill, `#f5f5f7` text, `#86868b` placeholder and border. 24px left padding and 42–45px right padding for the icon gutter. Collapsed by default in nav, expanding on demand. Text at 13–14px.

**Section Divider.** None. Use background shifts between the surface levels and 80–120px spacing. The transition is the divider.

## Related

- Do's and don'ts: [rules.md](rules.md)
- Ready-made prompts for composing these: [agent-guide.md](agent-guide.md)
