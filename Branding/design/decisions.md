# Reconciliation Decisions

> Foundry design system — where the sources conflicted, and why colors were merged. Context: [DESIGN.md](../DESIGN.md).

## Source conflicts

| Topic | Inputs | Decision |
|-------|--------|----------|
| Action blue | `#0071e3`, `#0088ff`, `#007bff` | Single action blue `#0071e3` |
| Link blue | `#0066cc` vs `#2997ff` | Both kept, keyed to surface: `#0066cc` on light, `#2997ff` on dark. Link only, never a fill |
| Primary text on light | `#1d1d1f`, `#101010`, `#000000` | `#1d1d1f`. `#000000` reserved for icons and floating-card headlines |
| Secondary text on light | `#707070`, `#6e6e73`, `#595959`, `#333333` | `#6e6e73` |
| Hairline | `#d6d6d6`, `#d0d0d3`, `#cfcfcf`, `#d2d2d7` | `#d2d2d7` |
| Page max-width | 1200px vs 1440px | 1440px for full-bleed product stages, 1200px for content columns |
| Section gap | 80–120, 88–120, 64–80, 90 | 90px default, 80–120px range, 64px hard minimum |
| Card radius | 28px vs 16–20px | 28px large media cards; 20px floating cards; 16px small cards and tiles |
| Button radius | 9999px, 980px, 100px, 999px, 36px | Standardized to 9999px |
| Shadows | None vs ambient vs whisper stack | Flat by default. Ambient and whisper shadows allowed on floating cards in app-marketing contexts only |
| Font weight 700 | Forbidden vs used | 600 default; 700 allowed for headlines in the expressive app-marketing variant only |
| Single chromatic CTA | Blue only vs blue plus amber | Blue default. Amber Download is a permitted replacement (not companion) for app-install pages on dark |
| Typeface | SF Pro Display/Text, Inter, system fonts | **Open Sauce One** (Mark Simonson Studio), single family, self-hosted WOFF2, weights 400/500/600/700 only |
| Card grids | Prohibited vs 3-column grids | Avoid by default; permitted only for equal-weight feature sets on dark stages |
| Search input font | Arial fallback | Open Sauce One; Arial dropped |

## Color merges applied

| Removed | Survives | Why |
|---|---|---|
| Amber Flame `#f06413`, Category Red `#ff383c`, Ember `#b64400` | **Foundry Orange `#f56900`** | Near-identical warm accents → one hot brand color |
| Honey Glow `#feab30` | **Amber `#f7be00`** | One amber; the brand gradient runs Orange → Amber |
| Paper Frost `#fafafc`, Linen `#faf8f7` | **Silk `#f5f5f7`** | Three off-whites → one |
| Platinum `#cccccc` | **Hairline `#d2d2d7`** | Dim text on dark becomes white at 80% opacity instead of a gray token |
| Carbon `#111111`, Graphite `#424245` | **Ink `#1d1d1f` / Smoke `#333336`** | Tighter dark ramp; glass re-based to `rgba(51,51,54,0.72)` |

Blues (`#0071e3` / `#0066cc` / `#2997ff`) and Alert Red `#d92d20` were kept — they're role-locked (fill vs. link vs. functional status) and perceptually distinct.

**Dropped entirely:** the duplicate warm accents, redundant off-whites, Platinum, Carbon, Graphite, and the source fonts.

## Related

- Values that resulted: [colors.md](colors.md)
- Ready-to-paste tokens: [quick-start.md](quick-start.md)
