# Quick Start — Tokens

> Foundry design system — copy-paste token blocks. Context: [DESIGN.md](../DESIGN.md). The app implements these in `src/styles.css` (Tailwind v4 `@theme`); values below are the source of truth.

## CSS Custom Properties

```css
:root {
  /* Neutrals */
  --color-white: #ffffff;
  --color-silk: #f5f5f7;
  --color-control-gray: #e6e6e8;
  --color-hairline: #d2d2d7;
  --color-steel: #86868b;
  --color-slate: #6e6e73;
  --color-smoke: #333336;
  --color-ink: #1d1d1f;
  --color-black: #000000;
  --color-midnight: #0d0021;
  --color-midnight-deep: #05010d;

  /* Action & link */
  --color-blue: #0071e3;
  --color-link: #0066cc;
  --color-link-dark: #2997ff;

  /* Foundry accents (text/outline only — never fills) */
  --color-orange: #f56900;
  --color-amber: #f7be00;
  --color-green: #34c759;
  --color-magenta: #cb30e0;
  --color-violet: #8668ff;
  --color-teal: #00a1b3;
  --color-alert: #d92d20;

  /* Gradients (complete list — nothing else) */
  --gradient-molten: linear-gradient(0deg, #f56900 0%, #f7be00 100%);
  --gradient-prismatic: linear-gradient(108deg, rgb(0,144,247), rgb(186,98,252) 33%, rgb(242,65,107) 66%, rgb(245,105,0));
  --gradient-midnight-glow: linear-gradient(180deg, rgb(18,0,54) 0%, rgb(37,1,96) 51%, rgb(18,0,54) 100%);
  --gradient-midnight-wash: linear-gradient(171deg, rgb(97,97,112) -45%, rgb(18,18,140) 69%);

  /* Type */
  --font-sans: "Open Sauce One", "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif;

  /* Radius */
  --radius-pill: 9999px;
  --radius-card: 28px;
  --radius-float: 20px;
  --radius-card-sm: 16px;
  --radius-input: 12px;
  --radius-link: 10px;
  --radius-glass: 36px;

  /* Shadows (floating UI only) */
  --shadow-ring: 0 0 0 1px #e6e6e8;
  --shadow-ring-strong: 0 0 0 1px #86868b;
  --shadow-ring-dark: 0 0 0 1px rgba(255, 255, 255, 0.08);
  --shadow-ambient: 0 0 30px 0 rgba(16, 16, 16, 0.1);
  --shadow-whisper: 0 0 0 1px rgba(0, 0, 0, 0.04), 0 1px 1px 0.5px rgba(0, 0, 0, 0.02), 0 3px 3px 1.5px rgba(0, 0, 0, 0.02), 0 6px 6px -3px rgba(0, 0, 0, 0.02), 0 12px 12px -6px rgba(0, 0, 0, 0.02), 0 24px 24px -12px rgba(0, 0, 0, 0.02);

  /* Surfaces */
  --surface-canvas-light: #ffffff;
  --surface-band: #f5f5f7;
  --surface-canvas-dark: #000000;
  --surface-ink-card: #1d1d1f;
  --surface-smoke-panel: #333336;
  --surface-glass: rgba(51, 51, 54, 0.72);
  --surface-midnight: #0d0021;
  --surface-midnight-card: #05010d;
}
```

## Self-hosted font

```css
@font-face {
  font-family: "Open Sauce One";
  src: url("/fonts/OpenSauceOne-Regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
/* Repeat for 500, 600, 700. WOFF2 preferred; TTF acceptable. */
```

## Related

- Why these values: [decisions.md](decisions.md)
- How to use them: [agent-guide.md](agent-guide.md)
