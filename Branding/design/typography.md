# Typography

> Foundry design system — one family (Open Sauce One), its weights, the full type scale, and tracking rules. Context: [DESIGN.md](../DESIGN.md).

## Family

| Family | Token | Role | Fallback |
|--------|-------|------|----------|
| Open Sauce One | `--font-sans` | Everything — display, headings, nav, body, buttons, labels, legal | `"Helvetica Neue"`, Helvetica, Arial, system-ui, sans-serif |

### Distribution

Open Sauce One is published by Mark Simonson Studio (marksimonson.com) and is **free, including commercial use**. It is **not on Google Fonts** — download the package from the foundry and **self-host** the WOFF2 files alongside your assets (keep the desktop OTFs for design tools). Check the included license file for embedding terms.

```css
@font-face {
  font-family: "Open Sauce One";
  src: url("/fonts/OpenSauceOne-Regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
/* Repeat for 500, 600, 700 */
```

### Weights

- **400** body, nav, captions, ghost buttons
- **500** in-page anchor nav, nav emphasis
- **600** default for all display and heading type, compact buttons, category eyebrows
- **700** permitted only on hero/section headlines in the expressive app-marketing variant. Never on body text, never on captions. In the strict product-page variant, cap at 600
- **900** exists in the family; unused by this system

## Type Scale

| Role | Weight | Size | Line Height | Letter Spacing | Token |
|------|--------|------|-------------|----------------|-------|
| micro | 400 | 10px | 1.83 | -0.37px | `--text-micro` |
| caption | 400 | 12px | 1.33 | -0.12px | `--text-caption` |
| nav | 400 | 12px | 1.00 | -0.12px | `--text-nav` |
| body-sm | 400 | 14px | 1.29 | -0.224px | `--text-body-sm` |
| body | 400 | 17px | 1.47 | -0.374px | `--text-body` |
| body-lg | 600 | 21px | 1.19 | +0.231px | `--text-body-lg` |
| nav-title | 600 | 19px | 1.21 | +0.228px | `--text-nav-title` |
| heading-xs | 600 | 24px | 1.17 | -0.24px | `--text-heading-xs` |
| subheading | 600 | 28px | 1.14 | +0.196px | `--text-subheading` |
| heading-sm | 600 | 32px | 1.13 | +0.128px | `--text-heading-sm` |
| heading | 600 | 40px | 1.10 | 0 | `--text-heading` |
| display-sm | 600 | 56px | 1.07 | -0.28px | `--text-display-sm` |
| display | 600 | 64px | 1.06 | -0.576px | `--text-display` |
| hero | 600 | 80px | 1.05 (84px in light hero) | -1.2px | `--text-hero` |

## Tracking rules

Large type pulls inward (80px at -1.2px), body sits at about -0.022em (-0.374px), micro text tightens further, and mid-size subheadings (19–32px) loosen slightly positive so short strings don't feel cramped. Never apply positive tracking above 32px. Never track a hero wider than -1.2px at 80px.

**Expressive variant.** App-marketing pages may tighten the 56px display headline to -1.4px tracking at line-height 1.00 and the 32px heading to -0.8px, at weight 700. Use this only on Midnight-mode or app-showcase pages, and don't mix with the standard scale on the same page.

**Notes.** One family only — hierarchy comes from size, weight, and tracking. Open Sauce One runs slightly warmer and rounder than SF Pro; the tracking values above are carried from the original tuning, so check display sizes optically and relax hero tracking toward -0.8 to -1.0px if headlines feel cramped. Set tabular numerals (`font-variant-numeric: tabular-nums`) for prices and specs.

An editorial serif (EB Garamond 700, 24px, line-height 0.90, tracking -0.020em) is available as a rare emphasis accent. It is optional; omit it unless a tagline genuinely needs contrast with the sans.

## Related
- Ready-to-paste CSS/Tailwind tokens: [quick-start.md](quick-start.md)
- Where each type element is used: [components.md](components.md)
