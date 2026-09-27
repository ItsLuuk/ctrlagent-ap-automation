# Principles & Surface Modes

> Foundry design system — why it looks the way it does, and the lighting modes pages are built from. Context: [DESIGN.md](../DESIGN.md).

## Design Principles

1. **Product first.** Photography, device renders, and live product UI carry the page. Interface chrome stays out of their way and is never boxed over hardware imagery.
2. **Hierarchy guides attention.** Every screen has a deliberate reading order. Visual weight must match decision importance: the most important information is noticed first, and lower-priority support never competes with it.
3. **Flat by default.** Depth comes from surface contrast (white on `#f5f5f7`, `#1d1d1f` on `#000000`), 28px corner radii, and 1px hairlines. Shadows are an opt-in exception for floating UI only.
4. **Color is rationed.** The system is achromatic plus one action blue (`#0071e3`) and one brand orange (`#f56900`). Every other chromatic value is a labeled exception with a single job (category, status, download). Color reinforces hierarchy; it never carries hierarchy alone.
5. **Type is the primary hierarchy tool.** One family — Open Sauce One — creates rank through semantic text roles, size, weight, line height, and spacing. No decorative typefaces, no second sans-serif, and no arbitrary one-off text styles.
6. **Grouping explains structure.** Related content sits close together; unrelated content is separated by surface, spacing, or enclosure. A card is a meaningful group, not decoration.
7. **Alternate surfaces, don't divide them.** Marketing sections separate through background shifts and 80–120px spacing, not repeated rules or boxes. Product UI may use cards and hairlines where grouping improves scanning.
8. **Spend boldness in one place.** Each viewport or product screen has one clear focal point. If several elements compete equally, none of them leads.
9. **Structure is semantic.** Visual order, DOM order, heading level, reading order, focus order, and keyboard order tell the same story. Styling must not make a visual heading inaccessible or misleading.

## Visual Hierarchy Contract

Visual hierarchy organizes a two-dimensional interface so the eye encounters content in the intended order of importance. Foundry builds that order with four levers: **position and scale, contrast, grouping, and semantic typography**. A screen is not finished when these levers look balanced in isolation; they must work together with real content.

### 1. Set the reading order before styling it

For every page, card, row, dialog, and panel, answer in this order:

1. What must be noticed first?
2. What decision or action comes next?
3. What supporting detail explains the decision?
4. What is secondary, dormant, or out of scope?

The resulting order must be visible at a glance and identical to the semantic reading and keyboard order. Do not let position, color, size, or motion imply an order that the underlying structure does not support.

### 2. Use three text ranks, not three arbitrary sizes

Each component should normally use no more than three semantic text ranks. A larger system may have a fuller ramp, but adjacent levels must be visibly distinct rather than numerically close.

| Rank | Role | Treatment | Relationship |
|------|------|-----------|-------------|
| **Primary** | Page title, card title, decision headline | Largest or heaviest type in the component | One per viewport or card |
| **Secondary** | Supporting copy, explanation, status context | Regular body or caption; muted color may reduce emphasis | Directly below its primary text |
| **Tertiary** | Metadata, timestamps, identifiers, fine print | Smallest allowed accessible caption | Attached to the item it describes |

The exact sizes, weights, and line heights come from [typography.md](typography.md). Do not create hierarchy by choosing arbitrary pixel values, shrinking body copy, or making a caption bold to compensate for missing structure.

### 3. Keep supporting text in a vertical stack

**A primary text item and its muted supporting text are one unit. The supporting text always sits directly below the primary text; it never shares the same line beside it.**

```text
✓ Company details              ✗ Company details · Required fields
  Required fields
```

Actions, controls, tags, and counts may sit opposite the text stack. Their right-edge alignment must not turn supporting text into a peer item or create an ambiguous left-to-right reading path. This rule applies equally to page headers, section headers, form labels, entity names, list rows, metrics, and mobile layouts.

Within the stack:

- Use the semantic heading or title role for the primary text.
- Keep the support text in a paragraph-level element directly beneath it.
- Use spacing and a restrained caption role to establish the lower rank.
- Use a divider, border, or background only when the relationship would otherwise be unclear.
- If primary and supporting content have materially different heights, align the actions to the top or bottom deliberately; do not place the support text beside the primary text merely to avoid a taller card.

### 4. Create hierarchy with scale and contrast

- **Scale:** size expresses importance. The most important element in a section should be visibly larger, heavier, or both. Do not shrink supporting information to an illegible size.
- **Weight:** use regular weight for reading and semibold for titles and meaningful emphasis. Bold is exceptional, not a substitute for structure.
- **Color contrast:** primary text uses Ink `#1d1d1f` on light and Silk `#f5f5f7` on dark. Secondary text uses Slate `#6e6e73` on light and Steel `#86868b` on dark. These are emphasis roles, not permission to reduce contrast below accessibility requirements.
- **Chromatic emphasis:** action blue, Foundry Orange, and semantic status colors are reserved for their defined jobs. If several colors have similar saturation and visual weight, the hierarchy collapses.
- **One focal point:** each viewport or card should have one clearly dominant element. Large display type, filled action color, and high-contrast imagery compete with one another, so they do not all lead on the same surface.

### 5. Group before you decorate

Proximity is the first grouping tool; enclosure is the second.

- Keep a title close to the content it introduces.
- Put more space between groups than between elements inside a group.
- Use cards and dividers only when they clarify ownership, selection, or workflow state.
- Keep related fields in one card and separate independent decisions into distinct cards.
- Equal visual treatment implies equal importance. If two cards do not have equal importance, do not give them identical scale, color, and density without a reason.

A card grid must follow the information hierarchy. It is not a substitute for deciding what deserves attention first.

### 6. Make importance machine-readable

- Use heading elements in sequential order; heading size and heading level must agree.
- Use list, table, definition-list, or semantic grouping structures where the content is genuinely a list, dataset, or label/value pair.
- Keep DOM and focus order aligned with the intended reading order.
- Never encode status, priority, or selection by color alone; pair it with text, shape, icon, or position.
- Preserve contrast and hierarchy when text scales through browser or operating-system accessibility settings.

### 7. Validate with real content and a blurred view

Before shipping a screen:

1. Populate it with the longest realistic labels, the largest relevant amounts, missing values, warnings, and multiple currencies.
2. Blur or squint at the screen. The dominant element, next decision, and supporting groups should remain in the intended order.
3. Navigate using only Tab, Shift+Tab, Enter, and arrow keys where supported. The focus order should match the visual hierarchy.
4. Zoom to 200% and test a narrow viewport. Reflow must preserve reading order; supporting text may move below its primary item but must not disappear.
5. Check that grayscale and common color-vision deficiencies do not erase the hierarchy.

Hierarchy is successful when users find the right information in the right order without relying on explanation from the interface itself.

## Product-Specific Hierarchy Rules

For dense accounts-payable and reporting interfaces:

- **The decision comes before its explanation.** Put the amount, status, or required action in the primary text; place policy language and supporting evidence below it.
- **Evidence follows the claim.** A verdict headline is primary; its checks, evidence, and caveats form a vertical supporting stack.
- **Metrics outrank their descriptions.** Use a metric or emphasized number for the value and small body/caption text for context such as “paid invoices” or “not included in realized spend.”
- **Status never outranks the work item.** A badge or state color supports the vendor, invoice, or decision; it does not become the first thing read.
- **Charts preserve their own hierarchy.** Chart title first, selected value second, supporting series or comparison beneath. A metric treatment belongs to the meaningful total or selected point, not to every label and axis tick.
- **Cross-currency values stay separate.** Never merge values into a single hierarchy-producing number when currencies cannot be added.
- **The intended action is explicit.** One primary filled action per decision region; secondary and destructive actions remain visually quieter and are never disguised as content.

## Field and List Surfaces

The rules for repeated label/value rows — the shape most of the review screens are made of. These follow Apple HIG guidance (content over chrome, inset grouped lists, de-emphasized status) applied to dense data entry.

- **Values are content, not form controls.** A value the reader only needs to read is rendered as text: no fill, no border, no box. Chrome appears on hover (a hairline) and while editing (the focus ring). A column of twelve bordered inputs reads as an unfinished form and hides the values that were read correctly.
- **Group, then label from outside.** Repeated rows live in one rounded surface with hairline separators *between* rows. The group's name sits above the surface as a real heading, never as a bordered header strip inside it.
- **No card inside a card.** A group nested in a group is a flat inset fill, not a second surface with its own border.
- **Metadata stays at metadata rank.** Confidence, timestamps and counts are a muted caption, optionally with a single status dot. A filled status pill repeated on every row makes the whole screen one loud texture and destroys the reading order.
- **One action per row, and only when it can act.** A row offers the single thing that row can do, in a tinted capsule, right-aligned. Controls that cannot do anything are removed, not disabled or hidden behind hover.
- **The default state is not labelled.** Repeating “done” on every row is noise. Mark the exception — what still needs work — and leave the rest unsaid.
- **The selected row is marked at the edge.** A 2px rule or a light surface shift, never a recolour of the value itself.
- **Selection never shifts layout.** Marks, badges and chevrons reserve their space; the row does not resize when a state changes.
- **Repeated numbers are monospaced with tabular figures**, so digits line up down the column and a changed digit is visible.
- **Motion is one short fade** (150–200ms, expo-out). No movement, scaling or bouncing on a screen someone reads all day.

## Showing What Needs Action

- **The screen states its own worklist.** One card above the content says how much is outstanding, names the first item in a clause, and offers the single button that goes there. "2 fields need a look" alone makes the reviewer hunt for which two.
- **Each group carries its own count.** A group header shows how many of its rows are outstanding, so whole groups can be skipped and a clear group can be left alone.
- **A flagged row is marked by a tag, not a tint.** Unsettled rows carry one small tag at the right of the name. A background wash on every unfinished row is a colour the eye reads past on every row to reach the values, and after the third row it stops meaning anything. The reason belongs in the tag's tooltip, where it costs nothing to look up.
- **A row's action is chosen by its reason.** An empty value needs typing, an unagreed box needs agreeing, an unlocated value needs searching. A row offers one action, never a menu of them.
- **The decision value carries the size.** The number the decision is made on is larger than the numbers around it; everything else in the group stays one step down. A total that looks like its own tax line is a total nobody trusts.
- **An absence is a settled question, not a warning.** A field a vendor never prints is shown as remembered, at the same rank as any other resolved state, and never returns to the worklist.

## Surface Modes

| Mode | Canvas | Text primary | Text secondary | Link | Use |
|------|--------|--------------|----------------|------|-----|
| **Light Gallery** | `#ffffff`, alt `#f5f5f7` | `#1d1d1f` | `#6e6e73` | `#0066cc` | Default storytelling, editorial, pricing, detail bands |
| **Dark Stage** | `#000000`, cards `#1d1d1f` | `#f5f5f7` | `#86868b` | `#2997ff` | Hero product stages, cinematic feature sections |

Typical page rhythm: **Dark hero → dark feature stages → light detail band**, or **light hero → midnight product showcase → midnight credibility → midnight closer**. Never alternate modes more than once per viewport-height of content.

## Research Basis

The hierarchy contract adapts established guidance to Foundry's product and marketing surfaces. It is a design-system rule set, not a claim that every system uses identical tokens or layouts.

| Source | Contribution to this contract |
|--------|-------------------------------|
| [Nielsen Norman Group — Visual Hierarchy in UX](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/) | Reading order; hierarchy through contrast, scale, proximity, and common regions; squint test |
| [Apple Human Interface Guidelines — Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | Typography as a carrier of information hierarchy, legibility, and scalable text styles |
| [Material Design 3 — Type scale tokens](https://m3.material.io/styles/typography/type-scale-tokens) and [color roles](https://m3.material.io/styles/color/roles) | Semantic type roles and tokenized contrast rather than ad hoc styling |
| [Microsoft Fluent 2 — Typography](https://fluent2.microsoft.design/typography) and [Windows typography](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiments/typography) | Scannable type ramps, semantic roles, sentence case, baseline alignment, and readable minimums |
| [IBM Carbon — Typography](https://carbondesignsystem.com/elements/typography/overview/) | Enterprise type tokens and productive hierarchy for information-dense applications |
| [Atlassian — Applying typography](https://atlassian.design/foundations/typography/applying-typography/) | Semantic text styles, heading structure, visual hierarchy, and metric hierarchy |
| [Uber Base — Typography](https://base.uber.com/6d2425e9f/p/976582-typography) | Modular scale and hierarchy through disciplined type roles |
| [Shopify Polaris](https://polaris.shopify.com/) | Typographic components and hierarchy for dense administrative and commerce interfaces |
| [NN/g — Visual Design in UX Study Guide](https://www.nngroup.com/articles/visual-design-in-ux-study-guide/) | Testing hierarchy with real content, accessibility, and user response rather than taste alone |

Last reviewed: 2026-09-25.

## Related

- Type roles and values: [typography.md](typography.md)
- Color values for each mode: [colors.md](colors.md)
- Spacing, surfaces, and elevation: [spacing-shapes.md](spacing-shapes.md)
- Page layout rules: [rules.md](rules.md)
- Accessibility constraints: [accessibility.md](../accessibility.md)
