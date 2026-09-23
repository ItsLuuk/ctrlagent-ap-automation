import { forwardRef, type ForwardRefExoticComponent, type RefAttributes } from "react";
import type { LucideIcon as LucideSource, LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Optical sizes. Product UI uses `md` in chrome (nav, buttons) and `lg` on
 * page titles — foundry.md §4. Marketing icon wells are `xl` inside a pill.
 */
export const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
} as const;

export type IconSizeToken = keyof typeof ICON_SIZE;

export type IconProps = Omit<LucideProps, "ref" | "size"> & {
  size?: IconSizeToken | number;
};

export type Icon = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;

/** Drop-in for former `LucideIcon` props on PageHeader / EmptyState. */
export type LucideIcon = Icon;

export const ICON_STROKE = 1.5;

/**
 * Wrap a Lucide drawing so every glyph shares Foundry's SF Symbols rules:
 * monochrome `currentColor`, one stroke weight, round caps, small.
 */
export function createIcon(Source: LucideSource, displayName: string): Icon {
  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
    { className, size = "xl", strokeWidth = ICON_STROKE, ...props },
    ref,
  ) {
    const px = typeof size === "number" ? size : ICON_SIZE[size];
    const labelled = Boolean(props["aria-label"] || props.title);
    return (
      <Source
        ref={ref}
        size={px}
        strokeWidth={strokeWidth}
        className={cn("shrink-0", className)}
        {...props}
        aria-hidden={labelled ? false : true}
      />
    );
  });
  Icon.displayName = displayName;
  return Icon;
}

export function createSpinningIcon(Source: LucideSource, displayName: string): Icon {
  const Base = createIcon(Source, displayName);
  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon({ className, ...props }, ref) {
    return (
      <Base
        ref={ref}
        className={cn("animate-spin motion-reduce:animate-none", className)}
        {...props}
      />
    );
  });
  Icon.displayName = displayName;
  return Icon;
}

/**
 * Pill icon container variants — branding rules from foundry.md §UI elements:
 * all pills are 9999px radius, no shadow on any well, glyph is always
 * currentColor.
 */
export type IconWellVariant = "filled" | "ghost" | "subtle";

/**
 * BadgeIcon — filled circle carrying a single glyph, used in pipeline step
 * indicators and status badges. Tone is a semantic token, never a raw
 * Tailwind palette class.
 */
export type BadgeTone =
  | "accent"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "muted"
  | "sidebar"
  | "foreground";

export interface BadgeIconProps {
  icon: Icon;
  tone?: BadgeTone;
  size?: IconSizeToken | number;
  ring?: boolean;
  className?: string;
  /** For screen readers — the circle is decorative when a label is nearby. */
  "aria-label"?: string;
}
