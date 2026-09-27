/**
 * Primitives — modular, reusable UI building blocks for the AP automation app.
 *
 * These are the containers from foundry.md §5 (Cards & widgets). One card, one
 * empty state, one KPI widget — so the shapes can't drift apart again:
 *  - Section:  the standard card wrapper (16px radius, bg-card, subtle shadow)
 *  - Header:   SectionHeader — 19px/600 title + hint/counter + optional action
 *  - List:     divided rows with consistent padding
 *  - Empty:    EmptyState — zero-state card (soft shadow, p-12)
 *  - Field:    label + hint + input slot
 *  - Stat:     KPI widget — label / value / hint / optional action
 *  - Pill:     small rounded label
 *
 * Import from '@/components/ap/primitives' — not from ui/card, etc.
 */
import { type ReactNode } from "react";
import type { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

/* ══════════════════════════════════════════════════════════════════════
   Section — the standard card wrapper
   ══════════════════════════════════════════════════════════════════════ */

export function Section({
  children,
  className,
  sticky,
}: {
  children: ReactNode;
  className?: string;
  sticky?: boolean;
}) {
  return (
    <section
      className={cn(
        // The soft shadow separates the card from the canvas without adding a
        // hard outline; the header keeps its divider for internal structure.
        "overflow-hidden rounded-lg bg-card shadow-whisper",
        sticky && "self-start lg:sticky lg:top-2",
        className,
      )}
    >
      {children}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   SectionHeader — the repeated header strip
   ══════════════════════════════════════════════════════════════════════ */

export function SectionHeader({
  title,
  hint,
  icon,
  action,
  className,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-border px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[19px] font-semibold tracking-tight text-foreground">
          {icon}
          {title}
        </p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   List — a divided list container
   ══════════════════════════════════════════════════════════════════════ */

export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-border", className)}>{children}</div>;
}

/* ══════════════════════════════════════════════════════════════════════
   ListItem — a single row in a List
   ══════════════════════════════════════════════════════════════════════ */

export function ListItem({
  children,
  className,
  onClick,
  active,
  id,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
  /** Anchor for "jump to this row" actions. */
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "px-4 py-3 transition-colors",
        onClick && "cursor-pointer hover:bg-secondary/50",
        active && "bg-accent/5",
        className,
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   FormField — label + hint + content slot
   ══════════════════════════════════════════════════════════════════════ */

export function FormField({
  label,
  hint,
  required,
  mono,
  children,
  className,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  mono?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline gap-2">
        <span className={cn("text-sm font-medium", mono && "font-mono")}>{label}</span>
        {required && <span className="text-xs text-destructive">*</span>}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Stat — the KPI widget (foundry.md §5)

   Anatomy is always label / value / hint, plus an optional action for the set
   the tile summarizes. The value stays at text-2xl so it
   never outranks the page title, and it is mono + tabular so amounts align.
   ══════════════════════════════════════════════════════════════════════ */

export function Stat({
  label,
  value,
  hint,
  action,
  accent,
  className,
}: {
  label: string;
  value: ReactNode;
  /** The unit or the "so what" — required unless the label already carries it. */
  hint: ReactNode;
  /** An affordance for the set this tile summarizes (e.g. export). */
  action?: ReactNode;
  /** The one tile per band that needs action; never a second chromatic fill. */
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("rounded-xl bg-card p-5 shadow-whisper", accent && "bg-primary/10", className)}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-3 font-mono text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   EmptyState — the zero-state of a page, queue or list

   One component, two densities (foundry.md §5):
   - "card" (default) — replaces the whole container, so it is never nested in
     another card. The same soft shadow every other card wears, p-12, always
     a title plus the trigger sentence that says what makes the state fill in.
   - "inline" — the quiet empty body of a card that stays because it has a
     header or totals (a line-items table, a list beside a document preview).
     No container of its own, p-8, text-xs.
   ══════════════════════════════════════════════════════════════════════ */

export function EmptyState({
  icon: Icon,
  title,
  action,
  children,
  variant = "card",
  className,
}: {
  icon?: Icon;
  title: string;
  action?: ReactNode;
  /** The full-card trigger sentence: what makes this state fill in. */
  children?: ReactNode;
  variant?: "card" | "inline";
  className?: string;
}) {
  const inline = variant === "inline";
  return (
    <div
      className={cn(
        inline ? "px-4 py-8 text-center" : "rounded-xl bg-card p-12 text-center shadow-whisper",
        className,
      )}
    >
      {Icon && (
        <Icon className={cn("mx-auto text-muted-foreground", inline ? "size-4" : "size-6")} />
      )}
      <p className={cn(inline ? "text-xs font-medium" : "text-sm font-medium", Icon && "mt-3")}>
        {title}
      </p>
      {children && (
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{children}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Pill — small rounded label / badge
   ══════════════════════════════════════════════════════════════════════ */

export function Pill({
  children,
  variant = "default",
  className,
  mono,
}: {
  children: ReactNode;
  variant?: "default" | "accent" | "success" | "warning" | "destructive" | "outline";
  className?: string;
  mono?: boolean;
}) {
  const styles = {
    default: "text-muted-foreground",
    accent: "text-foundry-link",
    success: "text-foreground",
    warning: "text-warning-foreground",
    destructive: "text-destructive",
    outline: "border border-border text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1 py-0.5 text-xs font-semibold tracking-tight",
        styles[variant],
        mono && "font-mono",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Badge — status indicator with dot
   ══════════════════════════════════════════════════════════════════════ */

export function Badge({
  label,
  variant = "default",
  dot,
  className,
}: {
  label: string;
  variant?: "default" | "success" | "warning" | "destructive" | "info";
  dot?: boolean;
  className?: string;
}) {
  const dotColor = {
    default: "bg-muted-foreground",
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
    info: "bg-info",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border-l-[3px] py-0.5 pl-2 pr-1 text-xs font-medium text-foreground",
        variant === "success" && "border-success",
        variant === "warning" && "border-warning",
        variant === "destructive" && "border-destructive",
        variant === "info" && "border-info",
        variant === "default" && "border-border",
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dotColor[variant])} />}
      {label}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PageHeader — back link + title + subtitle + right-side controls
   ══════════════════════════════════════════════════════════════════════ */

export function PageHeader({
  backLink,
  backLabel,
  title,
  subtitle,
  controls,
  className,
}: {
  backLink?: ReactNode;
  backLabel?: string;
  title: string;
  subtitle?: ReactNode;
  controls?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {backLink}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-subheading font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {controls && <div className="flex flex-wrap items-start gap-3">{controls}</div>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   InfoBanner — contextual info/warning strip
   ══════════════════════════════════════════════════════════════════════ */

export function InfoBanner({
  children,
  variant = "accent",
  icon,
  className,
}: {
  children: ReactNode;
  variant?: "accent" | "warning" | "destructive" | "success";
  icon?: ReactNode;
  className?: string;
}) {
  const styles = {
    accent: "border-accent/30 bg-accent/5 text-accent-foreground",
    warning: "border-warning/40 bg-warning/10 text-warning-foreground",
    destructive: "border-destructive/40 bg-destructive/10 text-destructive-foreground",
    success: "border-success/30 bg-success/10 text-success-foreground",
  };
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-sm",
        styles[variant],
        className,
      )}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div>{children}</div>
    </div>
  );
}
