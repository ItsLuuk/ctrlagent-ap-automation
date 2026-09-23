# Foundry Design System

> **Main design document.** A quiet showroom with three lighting modes. Product imagery is the visual event; type is the only chrome; one blue acts, one orange brands.
>
> **Scope:** brand, marketing, and product-showcase surfaces (web pages, launches, app marketing). The Foundry *application UI* follows [foundry.md](foundry.md) instead.
>
> **Themes:** light (default) · dark · midnight (mixed light-to-dark transitions)
>
> Derived from an Apple-native product-page language (five reconciled source references — decisions recorded in [design/decisions.md](design/decisions.md)). Colors are deduplicated: one warm brand accent, one amber, one off-white, one light gray, a two-step dark ramp. Type is **Open Sauce One** (Mark Simonson Studio), self-hosted.

## File map

| File | Covers | Search for |
|------|--------|-----------|
| [design/principles.md](design/principles.md) | Design principles, surface modes (light/dark/midnight), page rhythm | "why", "mode", "hero", "rhythm" |
| [design/colors.md](design/colors.md) | Neutrals, action/link blues, accent jobs, gradients, rationing rules | token names, hex values, "gradient", "orange" |
| [design/typography.md](design/typography.md) | Open Sauce One: distribution, @font-face, weights, full type scale, tracking | "font", "weight", "size", "tracking", "hero headline" |
| [design/spacing-shapes.md](design/spacing-shapes.md) | Spacing scale, layout widths, border radius, shadows/rings, surfaces, elevation | "radius", "card 28px", "spacing", "shadow", "surface" |
| [design/components.md](design/components.md) | Nav, buttons, cards, product/media, type elements, inputs | "button", "nav", "hero stage", "notification card", "input" |
| [design/rules.md](design/rules.md) | Do's and don'ts, imagery direction, page layout | "don't", "forbidden", "imagery", "photo", "grid" |
| [design/agent-guide.md](design/agent-guide.md) | Quick color reference, example component prompts | "prompt", "compose a page", "quick reference" |
| [design/decisions.md](design/decisions.md) | Reconciliation decisions, color merge log, similar brands | "why merged", "conflict", "dropped", "similar brands" |
| [design/quick-start.md](design/quick-start.md) | CSS custom properties + Tailwind v4 `@theme` blocks | "css", "paste", "@theme", "custom properties" |
| [accessibility.md](accessibility.md) | **Both surfaces.** Contrast minimums with measured ratios, focus visibility, keyboard, reduced motion, known gaps | "contrast", "a11y", "focus", "keyboard", "reduced motion", "4.5:1" |

## Core rules at a glance

- **Color is rationed:** achromatic + one action blue `#0071e3` + one brand orange `#f56900`. Everything else has a single labeled job.
- **Flat by default:** depth from surface contrast, 28px radii, 1px hairlines. Shadows only on floating UI.
- **Type is the hierarchy:** one family, 600 for display, tracking tightens as size grows.
- **One filled chromatic button per viewport.** Link blues are text-only; Foundry Orange never fills.
- **Sections separate by surface shifts and 80–120px spacing**, never rules or boxes.
- **Contrast is a requirement, not a taste:** 4.5:1 for text under 24px, 3:1 for large text and non-text indicators, in every mode → [accessibility.md](accessibility.md).

Start at [design/principles.md](design/principles.md) for the philosophy, [design/quick-start.md](design/quick-start.md) for the tokens.
