# Colors

> Foundry design system — every color token, its one job, and the rationing rules. Context: [DESIGN.md](../DESIGN.md). Why tokens were merged: [decisions.md](decisions.md).

## Neutrals (deduplicated — see decisions.md)

| Name | Value | Token | Role |
|------|-------|-------|------|
| Paper White | `#ffffff` | `--color-white` | Light canvas, light card surfaces, button text on fills, maximum-contrast text on dark |
| Silk | `#f5f5f7` | `--color-silk` | Alternate section band, footer, opened navigation layer, primary text on dark, light-surface fills. *Absorbs Frost `#fafafc`, Linen `#faf8f7`* |
| Control Gray | `#e6e6e8` | `--color-control-gray` | Disabled fills, subdued utility surfaces, 1px nav edge |
| Hairline | `#d2d2d7` | `--color-hairline` | 1px dividers, control outlines, low-contrast outlines. *Absorbs Platinum `#cccccc`; dim text on dark is white at 80% opacity, not a gray token* |
| Steel | `#86868b` | `--color-steel` | Muted body text on dark, input outlines, inactive indicators, captions |
| Slate | `#6e6e73` | `--color-slate` | Secondary text and metadata on light |
| Smoke | `#333336` | `--color-smoke` | Elevated dark panels, secondary button fills on dark, nav dividers, frosted-glass base. *Absorbs Graphite `#424245`* |
| Ink | `#1d1d1f` | `--color-ink` | Text on light; elevated card surface and layered surfaces on dark. *Absorbs Carbon `#111111`* |
| True Black | `#000000` | `--color-black` | Dark Stage canvas, footer on dark, maximum-contrast icons |
| Midnight | `#0d0021` | `--color-midnight` | Midnight mode canvas, announcement bar — violet-tinted near-black |
| Midnight Deep | `#05010d` | `--color-midnight-deep` | Cards and tiles floating on Midnight canvas |

## Action & Link

| Name | Value | Token | Role |
|------|-------|-------|------|
| Action Blue | `#0071e3` | `--color-blue` | The single filled CTA color: Buy, Pricing, Try, Get. Focus ring. Hover: `filter: brightness(1.1)` |
| Link Blue | `#0066cc` | `--color-link` | Text links and section links on light surfaces. **Text only, never a button fill** |
| Link Blue (Dark) | `#2997ff` | `--color-link-dark` | Text links and short emphasized phrases on dark and midnight surfaces |

## Foundry Accents (each has exactly one job)

| Name | Value | Token | Role |
|------|-------|-------|------|
| Foundry Orange | `#f56900` | `--color-orange` | **The brand hot accent**: category eyebrow text above feature headlines, "power / advanced features" category indicator, launch-status labels, Molten gradient start, outline accents on tags. Text and outline only — never a fill. *Absorbs `#f06413`, `#ff383c`, `#b64400`* |
| Amber | `#f7be00` | `--color-amber` | **Download/app-install conversion only**, on Midnight or Dark surfaces, black text, paired with a download icon. Molten gradient end. *Absorbs Honey Glow `#feab30`* |
| Vivid Green | `#34c759` | `--color-green` | Category indicator: privacy / security |
| Electric Magenta | `#cb30e0` | `--color-magenta` | Category indicator: collaboration |
| Iris Violet | `#8668ff` | `--color-violet` | Category indicator: alternate product line |
| Reef Teal | `#00a1b3` | `--color-teal` | Category indicator: alternate product line |
| Alert Red | `#d92d20` | `--color-alert` | Functional status only: cancellations, critical delays, left-border status accent. Never decorative, never a category color |

Category colors (green, magenta, violet, teal, orange) appear only as text color, 1–3px left-border accent, or outline on body-level elements at 16–18px scale. Never as backgrounds, button fills, or large surfaces. Red is reserved for functional status.

## Gradients (the complete list)

| Name | Value | Token | Role |
|------|-------|-------|------|
| Molten | `linear-gradient(0deg, #f56900 0%, #f7be00 100%)` | `--gradient-molten` | Foundry logo mark and large display headlines via `background-clip: text`. Never a button, section background, or decoration |
| Prismatic Chip | `linear-gradient(108deg, rgb(0,144,247), rgb(186,98,252) 33%, rgb(242,65,107) 66%, rgb(245,105,0))` | `--gradient-prismatic` | Chip/product-family badge backgrounds only |
| Midnight Glow | `linear-gradient(180deg, rgb(18,0,54) 0%, rgb(37,1,96) 51%, rgb(18,0,54) 100%)` | `--gradient-midnight-glow` | Atmospheric glow behind a phone mockup in Midnight sections. Should read as light from a screen, not as a visible gradient |
| Midnight Wash | `linear-gradient(171deg, rgb(97,97,112) -45%, rgb(18,18,140) 69%)` | `--gradient-midnight-wash` | Subtle surface modulation in Midnight mode |

No other gradients exist. Not on text blocks, content sections, cards, or buttons.

## Related
- How color maps to the three lighting modes: [principles.md](principles.md)
- Ready-to-paste values: [quick-start.md](quick-start.md)
- Usage rules: [rules.md](rules.md)
