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

  /** Primary — the single interactive blue */
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
  softText?: string;
};

function makeColorClasses(
  bg: string,
  text: string,
  border: string,
  softBg = bg,
  softText = text,
  softBorder = border,
): ColorClasses {
  return {
    bg,
    bgSubtle: softBg,
    bgMuted: softBg,
    text,
    border,
    borderSubtle: softBorder,
    ring: bg.replace("bg-", "ring-") + "/20",
    // Keep semantic text readable on soft surfaces.
    softText,
  };
}

export const colorClasses = {
  accent: makeColorClasses(
    "bg-accent",
    "text-accent-foreground",
    "border-accent",
    "bg-accent-soft",
    "text-accent-soft-foreground",
    "border-accent/20",
  ),
  success: makeColorClasses(
    "bg-success",
    "text-success-foreground",
    "border-success",
    "bg-success-soft",
    "text-success-soft-foreground",
    "border-success/20",
  ),
  warning: makeColorClasses(
    "bg-warning",
    "text-warning-foreground",
    "border-warning",
    "bg-warning-soft",
    "text-warning-soft-foreground",
    "border-warning/20",
  ),
  destructive: makeColorClasses(
    "bg-destructive",
    "text-destructive-foreground",
    "border-destructive",
    "bg-danger-soft",
    "text-danger-soft-foreground",
    "border-danger/20",
  ),
  // Informational states reuse the product's only interactive blue.
  info: makeColorClasses(
    "bg-primary",
    "text-primary-foreground",
    "border-primary",
    "bg-primary-soft",
    "text-primary-soft-foreground",
    "border-primary/20",
  ),
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
 * border + dot/icon. Semantic tokens only, never fills.
 */
export const STATUS_TONES: Record<InvoiceStatus, { text: string; pulse?: boolean }> = {
  vendor_profile: { text: "text-warning-foreground" },
  draft: { text: "text-muted-foreground" },
  review: { text: "text-warning-foreground" },
  scheduled: { text: "text-primary" },
  paid: { text: "text-foreground" },
  rejected: { text: "text-destructive" },
  archived: { text: "text-muted-foreground" },
  failed: { text: "text-destructive" },
  processing: { text: "text-primary", pulse: true },
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
  return cn("rounded-lg border p-3 text-sm", c.borderSubtle, c.bgSubtle, c.softText ?? c.text);
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
    c.softText ?? c.text,
  );
}

/** Dot indicator: small colored circle. */
export function dotClasses(tone: "success" | "warning" | "destructive" | "info" | "muted"): string {
  const map = {
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
    info: "bg-primary",
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
}/* ══════════════════════════════════════════════════════════════════════
   5. Dark-context colors — for dark surfaces like Dynamic Island
   ══════════════════════════════════════════════════════════════════════
   These reuse the global semantic tokens so alerts stay consistent everywhere.
*/
export const darkColor = {
  /** Success green at 90% opacity on dark bg */
  successBg: "bg-success/90",
  successBgMuted: "bg-success/15",
  successText: "text-success-foreground",

  /** Warning amber at various opacities */
  warningBg: "bg-warning",
  warningBgMuted: "bg-warning/15",
  warningText: "text-warning-foreground",

  /** Destructive red at various opacities */
  destructiveBg: "bg-destructive/90",
  destructiveBgMuted: "bg-destructive/15",
  destructiveRing: "ring-destructive/30",
  destructiveText: "text-destructive-soft-foreground",

  /** Info blue */
  infoBg: "bg-primary",
  infoBgMuted: "bg-primary/15",
  infoText: "text-primary-soft-foreground",

  /** Accent on dark */
  accentBg: "bg-white/10",
  accentBgActive: "bg-primary",
  accentRing: "ring-white/10",
  accentText: "text-white",

  /** Neutral on dark */
  mutedBg: "bg-white/8",
  mutedText: "text-white/50",
  mutedTextFaint: "text-white/25",
} as const;
