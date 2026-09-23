# Rules, Imagery & Layout

> Foundry design system — the do's and don'ts, photography guidance, and page layout. Context: [DESIGN.md](../DESIGN.md).

## Do

- Use `#ffffff` as the default story canvas and `#f5f5f7` for alternating bands, the opened nav layer, and the footer; use `#000000` for cinematic product stages.
- Use `#0071e3` with white text and a pill radius for the single primary action per viewport.
- Use `#0066cc` for text links on light and `#2997ff` for text links on dark; do not turn every nav item blue.
- Set display statements in Open Sauce One 600 (56–80px) with the tracking from the type scale; 80px hero at -1.2px, weight 700 reserved for expressive stages.
- Set body copy at 17px/400 with 1.47 line height and -0.374px tracking as the universal paragraph spec.
- Apply 28px radius to feature cards and contained media; keep them shadowless.
- Use 9999px radius for every button, tag, nav pill, and icon container.
- Give secondary text `#6e6e73` on light and `#86868b` on dark; give paragraph text `#f5f5f7` on dark. Reserve pure `#ffffff` text for headlines and buttons.
- Keep nav text on dark at 80% opacity (white-based, not a gray token).
- Use frosted glass (`rgba(51,51,54,0.72)` + blur(20px)) for any UI floating over photography.
- Space major sections by 80–120px (90px default) and related elements by 20px.
- Tag categories with colored eyebrow text or small left-border accents; use color at body scale only.
- Rotate floating notification cards -3° to +3° around product mockups.
- Use Amber Download only for app-install conversion, on dark, with a download icon.
- Use tabular numerals for prices and specs.
- Check every text-on-surface pair against [accessibility.md](../accessibility.md): 4.5:1 below 24px, 3:1 for large text and non-text indicators, in each mode.

## Don't

- Don't use gradients anywhere except the four listed. No gradient text blocks, section backgrounds, buttons, or decorative fills.
- Don't put shadows on feature cards, editorial blocks, pricing capsules, or anything on Dark Stage.
- Don't use a second filled chromatic button in the same viewport. The green, magenta, violet, and teal colors are labels, not buttons — and Foundry Orange is never a fill either.
- Don't fill a button with `#0066cc` or `#2997ff`; they are link text only.
- Don't use `#0071e3` as a large hero background or a universal filled color.
- Don't use font-weight 700 on body copy, captions, or in the strict product-page variant.
- Don't set headings below 28px in the display roles for section headings; smaller headings belong to card titles at 19–24px only.
- Don't use radii outside the defined set. No 4px or 8px cards; no square corners on cards or buttons.
- Don't use colored status pills for launch labels; use bare Foundry Orange text.
- Don't add visible border lines between sections; use surface shifts and spacing.
- Don't place dense boxed panels over product renders; keep clear space around hardware.
- Don't use decorative typefaces, tracked-out uppercase labels, or a second sans-serif. One family: Open Sauce One.
- Don't use Alert Red decoratively; it signals cancellations and critical delays only.
- Don't set category or brand hues as small text on white — green (2.22), amber (1.70), orange (3.04), teal (3.11), violet (3.86) and magenta (4.17) all fail below large size. Keep them at eyebrow/display scale on light, or use them on Dark Stage and Midnight where each one passes.
- Don't use identical card grids as a default layout. Prefer single-subject compositions and two-column image-plus-text. A 3-column card layout is acceptable only for a feature set of equal-weight items on a dark stage.
- Don't crowd sections even in compact density; keep at least 64px between them.

## Imagery

Photography and device renders dominate. Hardware is isolated on pure white, warm neutral, or pure black, often cropped at oversized scale so the fold, thin profile, or metallic edge becomes the composition. Dark stages use dramatic studio side-lighting that reveals metal edges; lifestyle photography on dark stages is high-contrast black-and-white so it never competes with color product shots. Hands appear where physical scale needs demonstration. Images are either edge-free on a white or black canvas, contained in 28px-radius cards, or edge-to-edge in light detail bands.

App-marketing pages show real product UI: device mockups with colorful in-app content against the monochrome page, and floating notification cards rendered (not photographed) around the device. Press logos are monochrome muted gray or white-at-60%.

No illustration, no stock photography, no abstract graphics, no lifestyle staging of unrelated scenes. Icons are monochrome, single-weight, outlined, small (SF Symbols style).

## Layout

A compact global nav sits above (or is replaced by a floating pill over) an optional product-local nav. Pages open with a centered hero (light) or a left-aligned headline over a floating product (dark), then proceed through alternating surface bands. Content is predominantly single-column and centered on a 1200px column for app-marketing, or left-aligned within a 1440px container for product stages. Feature carousels advance horizontally with large 28px cards. Editorial sections pair left-aligned text with oversized imagery entering from the right or below. No sidebars, no visible grid lines. The page is spacious, image-led, and one subject per viewport.

## Related
- Components these rules constrain: [components.md](components.md)
- Why colors are rationed this way: [decisions.md](decisions.md)
- Contrast minimums and the measured ratio table: [accessibility.md](../accessibility.md)
