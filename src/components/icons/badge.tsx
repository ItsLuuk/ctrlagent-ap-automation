import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { ICON_SIZE, type IconSizeToken, type Icon, type BadgeTone } from "./icon";

/**
 * BadgeIcon — a filled circle carrying a single glyph.
 *
 * Used in the pipeline as the step indicator and in status badges. Extracted
 * from the inline circle styles in `src/components/ap/status.tsx` so routes
 * and cards can drop in `<BadgeIcon icon={Check} tone="accent" size="md" />`
 * without re-stating the ring and fill classes each time.
 *
 * Brand contract:
 *  - circle is always `rounded-full`
 *  - fill is a semantic token — never raw Tailwind palette (no
 *    `bg-emerald-500`). Pass one of the `tone` keys below.
 *  - glyph is monochrome `currentColor`, 1.5px stroke, same rules as every
 *    other icon in the library.
 *  - on light, a BadgeIcon that is the *only* indicator of state is not
 *    allowed — pair it with a label (accessibility.md §1).
 */
export function BadgeIcon(
  {
    icon: Icon,
    tone = "accent",
    size = "md",
    ring = false,
    className,
    "aria-label": ariaLabel,
    ...props
  }: {
    icon: Icon;
    tone?: BadgeTone;
    size?: IconSizeToken | number;
    ring?: boolean;
    className?: string;
    /** For screen readers — the circle is decorative when a label is nearby. */
    "aria-label"?: string;
  },
  ref: React.ForwardedRef<HTMLSpanElement>,
) {
  const px = typeof size === "number" ? size : ICON_SIZE[size];
  const labelled = Boolean(ariaLabel);
  const toneClass: Record<BadgeTone, string> = {
    accent: "bg-accent text-accent-foreground",
    success: "bg-success text-success-foreground",
    warning: "bg-warning text-warning-foreground",
    destructive: "bg-destructive text-destructive-foreground",
    info: "bg-primary text-primary-foreground",
    muted: "bg-muted text-muted-foreground",
    sidebar: "bg-sidebar text-white",
    foreground: "bg-foreground text-white",
  };
  const ringClass: Record<BadgeTone, string> = {
    accent: "ring-accent/30",
    success: "ring-success/30",
    warning: "ring-warning/30",
    destructive: "ring-destructive/30",
    info: "ring-primary/30",
    muted: "ring-muted/30",
    sidebar: "ring-sidebar/30",
    foreground: "ring-foreground/30",
  };
  return (
    <span
      ref={ref}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? ariaLabel : undefined}
      className={cn(
        "inline-flex items-center justify-center rounded-full transition-[background-color,color,box-shadow] duration-200 ease-out-expo",
        toneClass[tone],
        ring && ringClass[tone],
        className,
      )}
      {...props}
    >
      <Icon size={Math.round(px * 0.5)} strokeWidth={1.5} aria-hidden={labelled ? false : true} />
    </span>
  );
}
