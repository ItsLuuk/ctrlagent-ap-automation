import { forwardRef } from "react";
import type { LucideIcon as LucideSource } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON_SIZE, ICON_STROKE, type Icon, type IconProps } from "./icon";

/**
 * FoundryStamp — approval / sign-off glyph.
 *
 * A rounded-rect stamp body with a check inside. Monochrome outline so it
 * reads on Ink, Silk, Midnight, and Action Blue fills alike. Used on the
 * review screen decision bar and on paid-history tombstones.
 *
 * Brand contract: stroke only, never filled; color is always currentColor.
 */
export const FoundryStamp: Icon = forwardRef<SVGSVGElement, IconProps>(function FoundryStamp(
  { className, size = "lg", strokeWidth = ICON_STROKE, color, ...props },
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
      {/* stamp body — slightly rounded stamp shape */}
      <rect x="3" y="3" width="18" height="18" rx="4" />
      {/* inner check — the sign-off */}
      <path d="M8 12.5l2.8 2.8L15 9.5" />
    </svg>
  );
});

/**
 * InvoiceStack — two overlapping document cards.
 *
 * Replaces plain `FileText` where the UI wants to say "these are records,
 * not a single page." Two sheets, offset, no fill.
 */
export const InvoiceStack: Icon = forwardRef<SVGSVGElement, IconProps>(function InvoiceStack(
  { className, size = "lg", strokeWidth = ICON_STROKE, color, ...props },
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
      {/* back sheet */}
      <rect x="4" y="5" width="14" height="16" rx="2" />
      <path d="M4 9h14" />
      <path d="M4 13h10" />
      {/* front sheet, offset up-right */}
      <rect x="6" y="3" width="14" height="16" rx="2" />
      <path d="M6 7h14" />
      <path d="M6 11h10" />
    </svg>
  );
});

/**
 * VendorBuilding — a simple building / company silhouette.
 *
 * Foundry vocabulary says *vendor*, not *supplier*. This glyph gives vendor
 * rows a house-mark that is distinct from the user/avatar treatment.
 * Single-weight outline, no fill.
 */
export const VendorBuilding: Icon = forwardRef<SVGSVGElement, IconProps>(function VendorBuilding(
  { className, size = "lg", strokeWidth = ICON_STROKE, color, ...props },
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
      {/* ground line */}
      <path d="M3 21h18" />
      {/* building body */}
      <rect x="7" y="8" width="10" height="13" rx="1" />
      {/* roof cap */}
      <path d="M6 8h12" />
      {/* windows — two columns */}
      <path d="M9 11h2" />
      <path d="M13 11h2" />
      <path d="M9 14h2" />
      <path d="M13 14h2" />
    </svg>
  );
});

/**
 * VerifiedSeal — a circular seal with a check, for the trust/verified story.
 *
 * Used in marketing wells and on vendor-profile verification badges. Outline
 * ring + inner check, never filled with Molten (Molten is reserved for hero
 * gradient text and the logo icon per branding §components).
 */
export const VerifiedSeal: Icon = forwardRef<SVGSVGElement, IconProps>(function VerifiedSeal(
  { className, size = "lg", strokeWidth = ICON_STROKE, color, ...props },
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
      {/* outer ring */}
      <circle cx="12" cy="12" r="10" />
      {/* inner check */}
      <path d="M9 12.5l2 2 4-4.5" />
    </svg>
  );
});

/**
 * PaymentCheck — landmark pin with a check, the "payment landed" glyph.
 *
 * Foundry maps Payment → Landmark in the catalog already. This is the
 * *completed* variant: a pin shape carrying a check, for the paid-history
 * and decision-bar "approved" story. Outline only.
 */
export const PaymentCheck: Icon = forwardRef<SVGSVGElement, IconProps>(function PaymentCheck(
  { className, size = "lg", strokeWidth = ICON_STROKE, color, ...props },
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
      {/* pin / landmark body */}
      <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" />
      <circle cx="12" cy="9" r="2.5" />
      {/* check sitting in the pin head */}
      <path d="M10 9.2l1.4 1.4L14 8" />
    </svg>
  );
});
