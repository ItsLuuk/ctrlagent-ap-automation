# Spacing, Shapes & Surfaces

> Foundry design system — the spacing scale, layout widths, radii, shadows, surface levels, and elevation rules. Context: [DESIGN.md](../DESIGN.md).

**Base unit:** 4px · **Density:** comfortable (compact 10px gaps allowed inside notification and chip clusters)

## Spacing Scale

`4 · 8 · 10 · 12 · 16 · 20 · 24 · 28 · 32 · 40 · 44 · 48 · 60 · 64 · 76 · 80 · 96 · 104 · 128 · 144 · 160 · 208` px — tokens `--spacing-{n}`.

## Layout

| Property | Value | Token |
|----------|-------|-------|
| Full-bleed stage max-width | 1440px | `--page-max-width` |
| Content column max-width | 1200px | `--content-max-width` |
| Section gap | 90px default (80–120px range) | `--section-gap` |
| Card padding | 28px (20px in compact cards) | `--card-padding` |
| Element gap | 20px between related elements (10px inside compact clusters) | `--element-gap` |

## Border Radius

| Element | Value | Token |
|---------|-------|-------|
| Buttons, pills, nav pills, tags, icon containers, search input | 9999px | `--radius-pill` |
| Large feature cards, media frames, product viewers | 28px | `--radius-card` |
| Floating notification cards, floated local nav | 20px | `--radius-float` |
| Standard small cards, press tiles | 16px | `--radius-card-sm` |
| Text inputs (non-pill) | 12px | `--radius-input` |
| Link hit areas | 10px | `--radius-link` |
| Frosted glass price bar | 36px (or 9999px) | `--radius-glass` |
| Square chip badges and finish swatches | 20% | `--radius-badge-square` |
| Light-section edge-to-edge images | 0px | — |

Use only these values. Minimum radius for any interactive element is 10px; minimum for any container is 12px (hairline press tiles) with 16–28px for cards.

## Shadows and Rings

| Name | Value | Token | Use |
|------|-------|-------|-----|
| Ring (light) | `0 0 0 1px #e6e6e8` | `--shadow-ring` | Nav edge, selected controls on light |
| Ring (strong) | `0 0 0 1px #86868b` | `--shadow-ring-strong` | Outlined controls and inputs |
| Ring (dark) | `0 0 0 1px rgba(255,255,255,0.08)` | `--shadow-ring-dark` | Press/logo tiles on Midnight; hairlines on dark |
| Ambient | `0 0 30px 0 rgba(16,16,16,0.1)` | `--shadow-ambient` | Optional soft glow on feature cards in app-marketing pages. Non-directional |
| Whisper stack | `0 0 0 1px rgba(0,0,0,0.04), 0 1px 1px 0.5px rgba(0,0,0,0.02), 0 3px 3px 1.5px rgba(0,0,0,0.02), 0 6px 6px -3px rgba(0,0,0,0.02), 0 12px 12px -6px rgba(0,0,0,0.02), 0 24px 24px -12px rgba(0,0,0,0.02)` | `--shadow-whisper` | Floating notification cards and floating nav pill only |

Shadows are off by default. They may appear on floating cards over light surfaces, never on Apple-style media cards, pricing capsules, editorial blocks, or anything on Dark Stage.

## Surfaces

| Level | Name | Value | Mode | Purpose |
|-------|------|-------|------|---------|
| 0 | Canvas Light | `#ffffff` | Light | Page background, hero, local nav, feature-card surface |
| 1 | Band | `#f5f5f7` | Light | Alternate full-width section, carousel backdrop, footer, opened nav layer |
| 2 | Control | `#e6e6e8` | Light | Disabled fills and thin utility edge |
| 3 | Canvas Dark | `#000000` | Dark | Hero, feature stages, product photography backdrop |
| 4 | Ink Card | `#1d1d1f` | Dark | Card surfaces on dark, layered surfaces above black, promo bar, footer |
| 5 | Smoke Panel | `#333336` | Dark | Elevated panels, secondary button fills |
| 6 | Glass | `rgba(51,51,54,0.72)` + `backdrop-filter: blur(20px) saturate(1)` | Dark | Floating price/buy bar over photography |
| 7 | Midnight Canvas | `#0d0021` | Midnight | Section canvas, announcement bar |
| 8 | Midnight Card | `#05010d` | Midnight | Tiles and cards floating on Midnight canvas |

## Elevation

Separation is created through, in order of preference: (1) tonal contrast between surfaces, (2) 28px media corners, (3) 1px hairlines or rings, (4) frosted glass for elements that must float over photography. Cast shadows are reserved for floating UI in app-marketing contexts. A product's own shadow comes from photography, not CSS.

## Related
- Mode definitions (light/dark/midnight): [principles.md](principles.md)
- Ready-to-paste tokens: [quick-start.md](quick-start.md)
