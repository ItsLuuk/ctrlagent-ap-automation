import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ICON_SIZE, ICON_STROKE, type Icon, type IconProps } from "./icon";

/** Pill icon container — branded radius 9999px. */
export type IconWellVariant = "filled" | "ghost" | "subtle";

const WELL_SIZE = {
  sm: "size-6",
  md: "size-8",
  lg: "size-10",
} as const;

const WELL_VARIANT_CLASS: Record<IconWellVariant, string> = {
  filled: "bg-primary text-primary-foreground shadow-none",
  ghost: "border border-current/20 bg-transparent text-current",
  subtle: "bg-muted/60 text-foreground",
};

/**
 * Pill icon container — branding radius 9999px. Default well is Action Blue
 * with white glyph (sidebar mark). Ghost wells use a hairline, never a shadow.
 * Subtle wells sit on Silk/muted for empty-state headers.
 *
 * Brand rule: 9999px radius pills, no shadow. Never recolor the glyph —
 * it is always currentColor.
 */
export function IconWell({
  children,
  className,
  variant = "filled",
  size = "md",
}: {
  children: ReactNode;
  className?: string;
  variant?: IconWellVariant;
  size?: keyof typeof WELL_SIZE;
}) {
  return (
    <span
      className={cn(
        "inline-grid place-items-center rounded-full",
        WELL_SIZE[size],
        WELL_VARIANT_CLASS[variant],
        "shadow-none",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Foundry mark — a ledger card, rounded, three lines. Monochrome outline so it
 * reads on Action Blue, Ink, Silk, Dark Stage, and Midnight. Never recolor the
 * strokes; never fill with Molten except as a well behind this glyph.
 */
export const FoundryMark: Icon = forwardRef<SVGSVGElement, IconProps>(function FoundryMark(
  { className, size = "xl", strokeWidth = ICON_STROKE, color, ...props },
  ref,
) {
  const px = typeof size === "number" ? size : ICON_SIZE[size];
  const labelled = Boolean(props["aria-label"] || props.title);
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      {...props}
      aria-hidden={labelled ? false : true}
    >
      <rect x="6" y="4.5" width="12" height="15" rx="2.5" />
      <path d="M9 9.25h6" />
      <path d="M9 12.25h6" />
      <path d="M9 15.25h3.5" />
    </svg>
  );
});
