/**
 * Icon registry — single source of truth for "which icon stands for which
 * Foundry concept."
 *
 * Every screen that needs an icon for invoice / vendor / template / approval /
 * payment / exception / analytics / verified should import from here, never
 * reach for a raw Lucide glyph. When the brand decides to swap theApproved
 * mark, change it once here and every screen follows.
 *
 * The domain icons are kept as aliases of the wrapped Lucide glyphs today so
 * the library ships with zero new SVG surface area until a custom mark is
 * justified. FoundryStamp and the other custom marks in `brand.tsx` are
 * exported separately and can be wired in here when a screen wants the
 * Foundry-specific drawing instead of the generic Lucide equivalent.
 */

import type { Icon } from "./icon";
import {
  Invoice,
  Vendor,
  Template,
  Approval,
  Payment,
  Exception,
  Analytics,
  Verified,
  Warning,
  FileText,
  Stamp,
  Check,
} from "./catalog";

/** Domain → icon. Used by PageHeader, EmptyState, section headers, route
 * tabs, and any place that speaks Foundry vocabulary out loud. */
export const domainIcon = {
  invoice: Invoice as Icon,
  vendor: Vendor as Icon,
  template: Template as Icon,
  approval: Approval as Icon,
  payment: Payment as Icon,
  exception: Exception as Icon,
  analytics: Analytics as Icon,
  verified: Verified as Icon,
  warning: Warning as Icon,
} as const;

export type DomainIconKey = keyof typeof domainIcon;

/** Return the branded icon for a domain concept. Prefer this over importing
 * the icon directly when the call site is wired to a concept string (e.g.
 * a route manifest or a dynamic EmptyState). */
export function iconFor(key: DomainIconKey): Icon {
  return domainIcon[key];
}

// Status pipeline icons — the three step glyphs from `PIPELINE_STEPS` in
// `src/components/ap/status.tsx`, imported with the domain set above.
export const pipelineIcon = {
  draft: FileText as Icon,
  review: Stamp as Icon,
  scheduled: Stamp as Icon,
  done: Check as Icon,
} as const;

export type PipelineIconKey = keyof typeof pipelineIcon;
