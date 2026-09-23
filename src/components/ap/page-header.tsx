/**
 * PageHeader — the standardized page title pattern from DESIGN.md:
 * h1 (text-2xl, tracking-tight) with a size-5 icon, one-line muted subtitle,
 * and an optional right-aligned actions slot.
 */
import type { ReactNode } from "react";
import type { Icon } from "@/components/icons";

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: Icon;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-subheading font-semibold">
          <Icon size="lg" /> {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
