# Principles & Surface Modes

> Foundry design system — why it looks the way it does, and the three lighting modes pages are built from. Context: [DESIGN.md](../DESIGN.md).

## Design Principles

1. **Product first.** Photography, device renders, and live product UI carry the page. Interface chrome stays out of their way and is never boxed over hardware imagery.
2. **Flat by default.** Depth comes from surface contrast (white on `#f5f5f7`, `#1d1d1f` on `#000000`), 28px corner radii, and 1px hairlines. Shadows are an opt-in exception for floating UI only.
3. **Color is rationed.** The system is achromatic plus one action blue (`#0071e3`) and one brand orange (`#f56900`). Every other chromatic value is a labeled exception with a single job (category, status, download).
4. **Type is the hierarchy.** One family — Open Sauce One — with weight contrast, negative tracking at large sizes, and generous negative space. No decorative typefaces, no second sans-serif.
5. **Alternate surfaces, don't divide them.** Sections separate through background shifts and 80–120px spacing, not rules or boxes.
6. **Spend boldness in one place.** One hero product, one CTA, one memorable brand gesture per page.

## Surface Modes

| Mode | Canvas | Text primary | Text secondary | Link | Use |
|------|--------|--------------|----------------|------|-----|
| **Light Gallery** | `#ffffff`, alt `#f5f5f7` | `#1d1d1f` | `#6e6e73` | `#0066cc` | Default storytelling, editorial, pricing, detail bands |
| **Dark Stage** | `#000000`, cards `#1d1d1f` | `#f5f5f7` | `#86868b` | `#2997ff` | Hero product stages, cinematic feature sections |
| **Midnight** | `#0d0021`, cards `#05010d` | `#ffffff` | `#cccccc` | `#2997ff` | App-marketing dark sections, notification/phone showcases |

Typical page rhythm: **Dark hero → dark feature stages → light detail band**, or **light hero → midnight product showcase → midnight credibility → midnight closer**. Never alternate modes more than once per viewport-height of content.

## Related
- Color values for each mode: [colors.md](colors.md)
- Surfaces & elevation levels: [spacing-shapes.md](spacing-shapes.md)
- Page layout rules: [rules.md](rules.md)
