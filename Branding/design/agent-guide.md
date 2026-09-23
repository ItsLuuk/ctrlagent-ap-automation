# Agent Prompt Guide

> Foundry design system — quick color lookup and ready-made prompts for composing pages. Context: [DESIGN.md](../DESIGN.md).

## Quick Color Reference

- Canvas light: `#ffffff` · band: `#f5f5f7`
- Canvas dark: `#000000` · card on dark: `#1d1d1f` · glass: `rgba(51,51,54,0.72)`
- Canvas midnight: `#0d0021` · tile: `#05010d`
- Text on light: `#1d1d1f` · secondary: `#6e6e73`
- Text on dark: `#f5f5f7` · secondary: `#86868b`
- Primary action: `#0071e3` (filled) · link light: `#0066cc` · link dark: `#2997ff`
- Hairline light: `#d2d2d7` · hairline dark: `#333336`
- Brand hot accent (eyebrows, launch label, power category): `#f56900` · download conversion: `#f7be00`
- Brand gradient (headline/logo only): `linear-gradient(0deg, #f56900 0%, #f7be00 100%)`

## Example Component Prompts

1. **Light launch hero.** `#ffffff` canvas. Centered 21px/600 product label, then an 80px/600 headline at 84px line height and -1.2px tracking in `#1d1d1f`. Place an oversized device render directly beneath with no enclosing card. Add a floating white 28px-radius pricing capsule with 14px/600 price text and a compact `#0071e3` 12px pill.
2. **Dark left-aligned hero.** Full-bleed `#000000`, 1440px max. Product image at 60% viewport height, centered. Bottom-left: 17px/600 eyebrow in `#f5f5f7`, an 80px/600 headline in `#f5f5f7` at -1.2px, then a row with "From €899" in 14px `#ffffff` and a `#0071e3` pill (14px/600, 10px 20px padding).
3. **Highlights band.** `#f5f5f7` section with a 40px/600 `#1d1d1f` heading left and a `#0066cc` text link right. Below, a horizontal carousel of `#ffffff` 28px-radius cards, no shadow, each with a 40px/600 statement and a centered device render. Playback control is a small translucent pill.
4. **Category block on white.** Two columns, image edge-to-edge in one. Text column: `#f56900` 17px/600 eyebrow, a 56px/600 `#1d1d1f` headline at -0.28px tracking, 17px/400 body in `#6e6e73` at 1.47 line height, max-width 460px.
5. **Floating notification cluster.** A phone-in-hand mockup on white. Around it, 4–5 white 20px-radius cards with whisper shadow, 16px padding, 15px/600 black headline, 13px `#6e6e73` metadata, rotated between -3° and +3°. One card carries a 3px `#0071e3` left border.
6. **Midnight download section.** `#0d0021` canvas with Midnight Glow behind a phone. 56px/700 white headline centered at -1.4px, 17px `#cccccc` subtext at 1.5 line height. Row of an Amber Download button and a Dark Ghost button. Below, a 4×2 press-tile grid.
7. **Molten feature intro.** `#f5f5f7` band, 120px vertical padding. 60–80px/700 headline filled with the Molten gradient via background-clip, -1.04px tracking, centered.

## Related
- Full component specs: [components.md](components.md)
- Constraint rules: [rules.md](rules.md)
