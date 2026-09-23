# Branding Docs

> All brand and design documentation lives in this folder. Two systems, one voice — read the scope lines below before applying anything.

## Which file governs what

| File | Governs | When to open |
|------|---------|--------------|
| [DESIGN.md](DESIGN.md) | **Foundry design system** — brand, marketing, product-showcase surfaces. Hub that routes into `design/*.md` topic files. | Building web pages, launches, marketing material |
| [foundry.md](foundry.md) | **Foundry app UI** — the in-product design system, including the card/widget taxonomy and the KPI spec (§5). Tokens live in `src/styles.css`. | Building or changing screens inside the app |
| [brand-voice.md](brand-voice.md) | Brand foundation, positioning, voice & tone, vocabulary, imagery direction, plus before/after rules for toasts, empty states and error banners | Writing copy, naming, messaging |
| [accessibility.md](accessibility.md) | **Both surfaces.** Contrast minimums (measured), focus visibility, keyboard, reduced motion, known gaps | Building any UI, reviewing a component |
| [archive/rework-plan.md](archive/rework-plan.md) | ⛔ Archived Volt-era rework plan — history only | Do not plan from it |

## Foundry topic files (`design/`)

| File | Covers |
|------|--------|
| [design/principles.md](design/principles.md) | Design principles, surface modes (light/dark/midnight) |
| [design/colors.md](design/colors.md) | All color tokens, accent jobs, gradients |
| [design/typography.md](design/typography.md) | Open Sauce One: distribution, weights, type scale, tracking |
| [design/spacing-shapes.md](design/spacing-shapes.md) | Spacing, layout widths, radii, shadows, surfaces, elevation |
| [design/components.md](design/components.md) | Nav, buttons, cards, product/media, type elements, inputs |
| [design/rules.md](design/rules.md) | Do's and don'ts, imagery, page layout |
| [design/agent-guide.md](design/agent-guide.md) | Quick color reference, example component prompts |
| [design/decisions.md](design/decisions.md) | Reconciliation decisions, color merge log |
| [design/quick-start.md](design/quick-start.md) | CSS custom properties + Tailwind v4 `@theme` |

## Search hints

| Question | Open |
|----------|------|
| What radius for cards/buttons? | [design/spacing-shapes.md](design/spacing-shapes.md) (marketing) · [foundry.md](foundry.md) §5 (app) |
| Does this card need a border? | [foundry.md](foundry.md) §5 "When a card needs a hairline" |
| How should a KPI/metric tile look? | [foundry.md](foundry.md) §5 "The KPI widget" |
| Can I use weight 700 here? | [design/typography.md](design/typography.md) |
| Is this color allowed as a fill? | [design/colors.md](design/colors.md) + [design/rules.md](design/rules.md) |
| How do I build a hero section? | [design/agent-guide.md](design/agent-guide.md) |
| Why was `#ff383c` removed? | [design/decisions.md](design/decisions.md) |
| What's the app's primary token? | [foundry.md](foundry.md), then `src/styles.css` |
| How should UI copy sound? | [brand-voice.md](brand-voice.md) |
| What do we say when a screen is empty? | [brand-voice.md](brand-voice.md) §"Rules for empty states" |
| Is this word allowed in copy? | [brand-voice.md](brand-voice.md) §4, enforced by `src/lib/ap/vocabulary.ts` |
| Is this color/white-on-color combination legible? | [accessibility.md](accessibility.md) §1 |
| Should this element have a visible focus ring? | [accessibility.md](accessibility.md) §2 |
| Where must `prefers-reduced-motion` be handled? | [accessibility.md](accessibility.md) §4 |
| How do we word an error or failure banner? | [brand-voice.md](brand-voice.md) §"Rules for error banners" |

## Note on the Foundry decision

**Foundry wins everywhere, including in the app.** An earlier draft kept two
separate systems (Volt/Forest app tokens vs Foundry brand tokens) — that split
is superseded. The app implements the Foundry system ([foundry.md](foundry.md),
tokens in `src/styles.css`): Action Blue CTAs, pill buttons, Silk surfaces,
Open Sauce One, tabular numerals. [foundry.md](foundry.md) §Personality and
[brand-voice.md](brand-voice.md) share one voice; if they ever conflict, the
underlying value wins.
