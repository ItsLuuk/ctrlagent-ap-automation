/**
 * Color system — single source of truth for all semantic colors.
 *
 * These map 1:1 to the CSS custom properties in styles.css. Components
 * should import from here instead of hardcoding oklch values.
 *
 * Two layers:
 *  1. CSS variable references (for inline styles / dynamic values)
 *  2. Tailwind class compositions (for className props)
 */
import { cn } from "./utils";

/* ══════════════════════════════════════════════════════════════════════
   1. CSS variable references — use in inline styles or dynamic values
   ══════════════════════════════════════════════════════════════════════ */

export const color = {
  /** Brand highlight wash — light Foundry blue */
  accent: "var(--accent)",
  accentForeground: "var(--accent-foreground)",

  /** Primary — Action Blue #0071e3 */
  primary: "var(--primary)",
  primaryForeground: "var(--primary-foreground)",

  /** Success — green (verified, done) */
  success: "var(--success)",
  successForeground: "var(--success-foreground)",

  /** Warning — amber (review needed, low confidence) */
  warning: "var(--warning)",
  warningForeground: "var(--warning-foreground)",

  /** Destructive — red (error, rejected) */
  destructive: "var(--destructive)",
  destructiveForeground: "var(--destructive-foreground)",

  /** Info — blue (informational) */
  info: "var(--info)",
  infoForeground: "var(--info-foreground)",

  /** Neutral surfaces */
  background: "var(--background)",
  card: "var(--card)",
  cardForeground: "var(--card-foreground)",
  muted: "var(--muted)",
  mutedForeground: "var(--muted-foreground)",
  secondary: "var(--secondary)",
  secondaryForeground: "var(--secondary-foreground)",

  /** Borders */
  border: "var(--border)",
  input: "var(--input)",

  /** Sidebar */
  sidebar: "var(--sidebar)",
  sidebarForeground: "var(--sidebar-foreground)",
} as const;

/* ══════════════════════════════════════════════════════════════════════
   2. Tailwind class compositions — use in className props
   ══════════════════════════════════════════════════════════════════════
   
   Each semantic color gets a set of pre-composed classes:
     color[name].bg         — solid background
     color[name].bgSubtle   — very light background (5-15% opacity)
     color[name].bgMuted    — medium background (15-30% opacity)
     color[name].text       — foreground text
     color[name].border     — border color
     color[name].borderSubtle — light border
     color[name].ring       — focus ring
*/

type ColorClasses = {
  bg: string;
  bgSubtle: string;
  bgMuted: string;
  text: string;
  border: string;
  borderSubtle: string;
  ring: string;
};

function makeColorClasses(bg: string, text: string, border: string): ColorClasses {
  return {
    bg,
    bgSubtle: bg.replace("bg-", "bg-") + "/5",
    bgMuted: bg.replace("bg-", "bg-") + "/15",
    text,
    border,
    borderSubtle: border.replace("border-", "border-") + "/30",
    ring: bg.replace("bg-", "ring-") + "/20",
  };
}

export const colorClasses = {
  accent: makeColorClasses("bg-accent", "text-accent-foreground", "border-accent"),
  success: makeColorClasses("bg-success", "text-success-foreground", "border-success"),
  warning: makeColorClasses("bg-warning", "text-warning-foreground", "border-warning"),
  destructive: makeColorClasses(
    "bg-destructive",
    "text-destructive-foreground",
    "border-destructive",
  ),
  info: makeColorClasses("bg-info", "text-info-foreground", "border-info"),
  muted: makeColorClasses("bg-muted", "text-muted-foreground", "border-muted"),
  secondary: makeColorClasses("bg-secondary", "text-secondary-foreground", "border-secondary"),
} as const;

/* ══════════════════════════════════════════════════════════════════════
   3. Status → color mapping — the single source of truth for which
      color represents which invoice status
   ══════════════════════════════════════════════════════════════════════ */

import type { InvoiceStatus } from "./ap/types";

/**
 * Stage tone map — strip language shared with TagBadge.
 * Words are always foreground ink; hue lives only in the 3px left
 * border + dot/icon. Foundry tokens only, never fills.
 */
export const STATUS_TONES: Record<InvoiceStatus, { text: string; pulse?: boolean }> = {
  vendor_profile: { text: "text-foundry-orange" },
  draft: { text: "text-muted-foreground" },
  review: { text: "text-foundry-orange" },
  scheduled: { text: "text-info" },
  paid: { text: "text-foreground" },
  rejected: { text: "text-destructive" },
  archived: { text: "text-muted-foreground" },
  failed: { text: "text-destructive" },
  processing: { text: "text-info", pulse: true },
};

/**
 * Returns the Tailwind classes for a semantic tone (success, warning, etc).
 * Use this for inline status indicators, not invoice statuses.
 */
export function toneClasses(
  tone: "success" | "warning" | "destructive" | "info" | "accent" | "muted",
): ColorClasses {
  return colorClasses[tone];
}

/* ══════════════════════════════════════════════════════════════════════
   4. Semantic class presets — common compound patterns
   ══════════════════════════════════════════════════════════════════════ */

/** Banner: light background + border + text for a semantic tone. */
export function bannerClasses(tone: "accent" | "warning" | "destructive" | "success"): string {
  const c = colorClasses[tone];
  return cn("rounded-lg border p-3 text-sm", c.borderSubtle, c.bgSubtle, c.text);
}

/** Pill/badge: small rounded label with semantic color. */
export function pillClasses(
  tone: "accent" | "warning" | "destructive" | "success" | "default",
): string {
  if (tone === "default") return "bg-secondary text-secondary-foreground";
  const c = colorClasses[tone];
  return cn(
    "rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
    c.bgMuted,
    c.text,
  );
}

/** Dot indicator: small colored circle. */
export function dotClasses(tone: "success" | "warning" | "destructive" | "info" | "muted"): string {
  const map = {
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
    info: "bg-info",
    muted: "bg-muted-foreground",
  };
  return cn("size-1.5 rounded-full", map[tone]);
}

/** Progress bar fill: colored bar for a semantic tone. */
export function progressFillClasses(
  tone: "accent" | "success" | "warning" | "destructive",
  pulsing?: boolean,
): string {
  const map = {
    accent: "bg-accent",
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
  };
  return cn(
    "h-full rounded-full transition-[width,background-color] duration-500 ease-out-expo",
    map[tone],
    pulsing && "animate-pulse",
  );
}

/** Focus ring: accessible focus indicator for a semantic tone. */
export function focusRingClasses(tone: "accent" | "success" | "warning" | "destructive"): string {
  const map = {
    accent: "focus-visible:ring-accent/20",
    success: "focus-visible:ring-success/20",
    warning: "focus-visible:ring-warning/20",
    destructive: "focus-visible:ring-destructive/20",
  };
  return map[tone];
}

/* ══════════════════════════════════════════════════════════════════════
   5. Dark-context colors — for dark surfaces like Dynamic Island
   ══════════════════════════════════════════════════════════════════════
   These use the same oklch values as the CSS variables but with
   opacity modifiers suitable for dark (#1c1c1e) backgrounds.
*/

export const darkColor = {
  /** Success green at 90% opacity on dark bg */
  successBg: "bg-[oklch(0.55_0.16_150)]/90",
  successBgMuted: "bg-[oklch(0.55_0.16_150)]/15",
  successText: "text-[oklch(0.55_0.16_150)]",

  /** Warning amber at various opacities */
  warningBg: "bg-[oklch(0.75_0.16_70)]",
  warningBgMuted: "bg-[oklch(0.75_0.16_70)]/15",
  warningText: "text-[oklch(0.75_0.16_70)]",

  /** Destructive red at various opacities */
  destructiveBg: "bg-[oklch(0.58_0.25_27)]/90",
  destructiveBgMuted: "bg-[oklch(0.58_0.25_27)]/15",
  destructiveRing: "ring-[oklch(0.58_0.25_27)]/30",
  destructiveText: "text-[oklch(0.58_0.25_27)]",

  /** Info blue */
  infoBg: "bg-[oklch(0.55_0.1_250)]",
  infoBgMuted: "bg-[oklch(0.55_0.1_250)]/15",
  infoText: "text-[oklch(0.55_0.1_250)]",

  /** Accent on dark */
  accentBg: "bg-white/15",
  accentBgActive: "bg-white/20",
  accentRing: "ring-white/10",
  accentText: "text-white",

  /** Neutral on dark */
  mutedBg: "bg-white/8",
  mutedText: "text-white/50",
  mutedTextFaint: "text-white/25",
} as const;
