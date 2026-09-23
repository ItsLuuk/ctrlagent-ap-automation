# Accessibility & Contrast

> Foundry design system — the contrast, focus, keyboard and motion rules. They apply to **both** surfaces: the app UI ([foundry.md](foundry.md)) and marketing/brand pages ([DESIGN.md](DESIGN.md)).
>
> **Target: WCAG 2.1 AA.** Every ratio below was computed against the shipped tokens in `src/styles.css` — these are measurements, not intentions. If a token changes, recompute.

## 1. Contrast minimums

| Content | Minimum | Applies to |
|---------|---------|-----------|
| Body text under 24px | **4.5:1** | labels, table cells, helper text, 14–17px copy |
| Large text — ≥24px, or ≥18.66px at weight 700 | **3:1** | display and hero statements |
| Non-text indicators | **3:1** | focus rings, status accents, icons, chart lines |
| Disabled, decorative, pure surface shifts | exempt | never the only carrier of meaning |

### The mechanism: color travels with its `-foreground`

`success`, `warning`, `destructive`, `info` and `accent` are **fills and strokes**. The text-safe value is always the paired `-foreground` token — this is the whole reason that pair exists.

**Light**

| Pair | Ratio | |
|------|-------|--|
| `foreground` `#1d1d1f` on `background` `#ffffff` | 16.83 | AAA |
| `muted-foreground` `#6e6e73` on white | 5.07 | AA |
| `muted-foreground` `#6e6e73` on `muted` `#f5f5f7` | 4.66 | AA |
| `input` `#86868b` on white | 3.62 | **large text only** |
| `primary-foreground` white on `primary` `#0071e3` | 4.70 | AA |
| `accent-foreground` `#004999` on `accent` `#e8f1fd` | 7.64 | AAA |
| `success-foreground` `#0c5c22` on white | 8.17 | AAA |
| `warning-foreground` `#5c4300` on white | 9.30 | AAA |
| `destructive-foreground` white on `#d92d20` | 4.83 | AA |
| `foundry-link` `#0066cc` on white | 5.57 | AA |
| `ring` `#0071e3` on white | 4.70 | AA (focus) |

**Dark Stage and Midnight** — semantic text values flip, so a passing light pair is not automatically a passing dark pair:

| Pair | Ratio | |
|------|-------|--|
| `foreground` `#f5f5f7` on `card` `#1d1d1f` / `secondary` `#333336` | 15.46 / 11.57 | AAA |
| `muted-foreground` `#86868b` on `#1d1d1f` / `#000000` | 4.65 / 5.80 | AA |
| `success-foreground` `#b9f5c9` on `#1d1d1f` / `#000000` | 13.60 / 16.97 | AAA |
| `warning-foreground` `#f7be00` on `#1d1d1f` / `#000000` | 9.87 / 12.32 | AAA |
| `foreground` `#ffffff` on Midnight `#0d0021` | 20.21 | AAA |
| Midnight `muted-foreground` `#cccccc` on `#05010d` | 12.86 | AAA |
| `foundry-link` `#2997ff` on black | 6.96 | AA |
| `ring` `#0071e3` on `#1d1d1f` | 3.58 | AA (focus) |

### Never on light

- **White on the `accent` wash `#e8f1fd` — 1.14.** Use `accent-foreground` (7.64).
- **White on Vivid Green `#34c759` — 2.22**, and green as text on white — also 2.22.
- **White on Amber `#f7be00` — 1.70.** An Amber fill takes `#1d1d1f` ink (9.87), which is why the download button is specified that way.
- **Amber as text on white — 1.70**, and Steel `#86868b` for text under 24px — 3.62.

### The accent hues are a dark-surface palette

| Hue | on white | on `#000000` | on `#1d1d1f` | on `#0d0021` |
|-----|---------:|-------------:|-------------:|-------------:|
| Foundry Orange `#f56900` | 3.04 | 6.90 | 5.53 | 6.64 |
| Vivid Green `#34c759` | 2.22 | 9.46 | 7.58 | 9.10 |
| Electric Magenta `#cb30e0` | 4.17 | 5.04 | 4.04 | 4.85 |
| Iris Violet `#8668ff` | 3.86 | 5.44 | 4.36 | 5.23 |
| Reef Teal `#00a1b3` | 3.11 | 6.75 | 5.41 | 6.50 |
| Alert Red `#d92d20` | 4.83 | 4.35 | 3.48 | 4.18 |

Read the table by surface, not by mode:

- **On pure black and Midnight canvas**, every accent but Alert Red clears 4.5:1 at any size; red lands at 4.35 / 4.18 — large text or non-text only.
- **On an Ink card `#1d1d1f`** it gets stricter again: magenta (4.04), violet (4.36) and red (3.48) fall under 4.5:1. Treat a card as one step tighter than the canvas behind it.
- **On light, only Alert Red clears 4.5:1** (4.83). Green, amber, orange, teal, violet and magenta all need ≥24px (or 18.66px/700) there.

That is why category and brand colors stay at eyebrow/display scale on light surfaces, and why small semantic text uses the `-foreground` variants instead of the raw hue.

**Color is never the only signal.** A 3px status accent may sit below 3:1 when a text label carries the same meaning — `Badge` in `src/components/ap/primitives.tsx` (3px left border + `text-foreground` label) is the model. An icon that is the sole indicator of state does not get that exemption.

## 2. Focus visibility

- The focus ring is `--ring: #0071e3` in all three modes — 4.70 against white, 3.58 against an Ink card. Both clear the 3:1 non-text minimum: **keep it, in every mode**.
- Never remove focus without replacing it. `outline-none` / `focus:ring-0` is only acceptable when the element renders a visible substitute state.
- A 20%-opacity ring does not qualify: `#0071e3` at 20% on white composites to 1.32. `focusRingClasses()` in `src/lib/colors.ts` mixes rings this way and is unused today — do not adopt it as-is.
- Every interactive element has a visible focus state: buttons, inputs, selects, table rows, inline-editable cells, chart points, and the document overlay in the draft mapper.

## 3. Keyboard

- Anything reachable with a mouse must be reachable with `Tab`, and anything revealed on hover needs a focus equivalent.
- Tab order follows reading order. A dialog traps focus while open and returns it to the trigger on close — Radix already does this, so don't hand-roll overlays.
- `Escape` closes the topmost layer (dialog, popover, menu, command palette); `Enter` activates the focused control; `Space` toggles a checkbox.
- Icon-only buttons get an accessible name (`aria-label`), never a bare icon. Vendor actions and dialogs already do this — keep the pattern.
- Status updates announce themselves: toasts, `role="alert"` banners, and the processing badge. A state change is never visual-only.
- No keyboard traps, and nothing focusable left in the tab order while hidden.

## 4. Motion

- Honor `prefers-reduced-motion: reduce`: drop looping animation (`animate-pulse`, `animate-spin`) and scale/translate transitions; keep opacity, color and focus transitions.
- Motion is already rationed, so the reduced variant is small by construction: pulse, spin, `scale-95` presses, and the `duration-300`/`duration-500` transforms.
- Never rely on motion to carry meaning — a pulsing pipeline connector also reads as text, in the same view.
- No carousel auto-advances without a visible pause control ([components.md](design/components.md) already specifies one).

## 5. Known gaps (verified in the code)

| Where | Problem | Ratio |
|-------|---------|------:|
| `src/components/ap/processing-badge.tsx:25` | header processing button is `bg-accent … text-white` | 1.14 |
| `src/components/ap/zone-check-chip.tsx:27,28` | `bg-success text-white` chip; amber fill with white text | 2.22 / 1.70 |
| `src/components/ap/draft-mapper.tsx:352` | drift chip `bg-success text-white` | 2.22 |
| `src/components/ap/primitives.tsx:245` | Pill variant `success: "text-success"` — its `warning` sibling correctly uses `-foreground` | 2.22 |
| `src/components/ap/vendor-profile-card.tsx:226,355` · `assign-popover.tsx:100` | `text-success` for validation text and for an icon that is the only signal | 2.22 |
| `src/components/ap/line-items-list.tsx:67,77,87` | inline-editable cells are `outline-none … focus:ring-0` — no visible focus for keyboard users | — |
| `src/styles.css` | no `prefers-reduced-motion` block, against 4 `animate-pulse`, 6 `animate-spin`, 15 `transition-all`, 2 `scale-95` uses | — |
| `design/colors.md` | category hues specified "at 16–18px scale" on light, below the size where they pass | 2.22–4.17 |
| `src/lib/colors.ts` `darkColor` | raw `oklch(…)` literals on an unshipped `#1c1c1e` surface — bypasses the token set and can't be verified per mode | — |

**The counterexample to copy:** `STATUS_TONES` + `TAG_TONES` (status/tag strips) keep all words in foreground ink and put hue only in the 3px border, dot, or icon — so text contrast is mode-independent by construction. Every new status color should be built the same way.

## 6. Review checklist

Before shipping any new component or screen:

1. Every text pair clears 4.5:1 (or 3:1 at large size) in **all three modes**, not just light.
2. No white text on `accent`, `success`, or `warning` fills.
3. Focus is visible on every interactive element, and nothing suppresses it without a replacement.
4. The whole flow is completable with the keyboard alone, and `Escape` works everywhere it should.
5. Nothing depends on motion, color, or hover as its only signal.

## Related

- Token values and roles per mode: [design/colors.md](design/colors.md), [foundry.md](foundry.md) §6
- App cards, banners and widgets: [foundry.md](foundry.md) §5
- App UI component rules: [foundry.md](foundry.md)
- Marketing component specs: [design/components.md](design/components.md)
- Copy rules for errors and empty states: [brand-voice.md](brand-voice.md)
