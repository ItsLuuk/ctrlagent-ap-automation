import type { ReactNode } from "react";
import type { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

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
        "overflow-hidden rounded-lg border border-border bg-card",
        sticky && "self-start lg:sticky lg:top-2",
        className,
      )}
    >
      {children}
    </section>
  );
}

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
        "flex items-center justify-between border-b border-border px-4 py-3",
        className,
      )}
    >
      <p className="flex items-center gap-1.5 text-[19px] font-semibold tracking-tight text-foreground">
        {icon}
        {title}
      </p>
      <div className="flex items-center gap-2">
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {action}
      </div>
    </div>
  );
}

export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-border", className)}>{children}</div>;
}

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
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "px-4 py-3 transition-colors",
        onClick && "cursor-pointer hover:bg-secondary/50",
        active && "bg-accent-soft",
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
  hint: ReactNode;
  action?: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-5",
        accent && "border-primary/30 bg-primary-soft",
        className,
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-3 font-mono text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

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
  children?: ReactNode;
  variant?: "card" | "inline";
  className?: string;
}) {
  const inline = variant === "inline";
  return (
    <div
      className={cn(
        inline
          ? "px-4 py-8 text-center"
          : "rounded-xl border border-dashed border-border bg-card p-12 text-center",
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

const TONE_LABEL: Record<StatusTone, string> = {
  neutral: "Neutral",
  success: "Success",
  warning: "Warning",
  danger: "Error",
  info: "Information",
};
const TONE_STYLE: Record<StatusTone, string> = {
  neutral: "border-border bg-secondary text-secondary-foreground",
  success: "border-success/25 bg-success-soft text-success-soft-foreground",
  warning: "border-warning/30 bg-warning-soft text-warning-soft-foreground",
  danger: "border-destructive/30 bg-danger-soft text-danger-soft-foreground",
  info: "border-primary/25 bg-accent-soft text-accent-soft-foreground",
};
export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

export function StatusPill({
  tone = "neutral",
  dot = false,
  pulse = false,
  children,
  className = "",
}: {
  tone?: StatusTone;
  dot?: boolean | undefined;
  pulse?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <span
      aria-label={TONE_LABEL[tone]}
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-semibold",
        TONE_STYLE[tone],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={cn("mr-1.5 size-1.5 rounded-full bg-current", pulse && "animate-pulse")}
        />
      ) : null}
      {children}
    </span>
  );
}

/** @deprecated Use StatusPill. */
export function Pill({
  children,
  variant = "default",
  className,
  mono,
  tone,
}: {
  children: ReactNode;
  variant?: "default" | "accent" | "success" | "warning" | "destructive" | "outline";
  className?: string;
  mono?: boolean;
  tone?: StatusTone;
}) {
  const mappedTone =
    tone ??
    (
      {
        default: "neutral",
        accent: "info",
        success: "success",
        warning: "warning",
        destructive: "danger",
        outline: "neutral",
      } as const
    )[variant];
  return (
    <StatusPill className={cn(mono && "font-mono", className)} tone={mappedTone}>
      {children}
    </StatusPill>
  );
}

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
  return (
    <StatusPill
      className={className}
      dot={dot}
      tone={
        variant === "default"
          ? "neutral"
          : variant === "destructive"
            ? "danger"
            : variant === "info"
              ? "info"
              : variant
      }
    >
      {label}
    </StatusPill>
  );
}

export function PageHeader({
  backLink,
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
    accent: "border-accent/30 bg-accent-soft text-accent-soft-foreground",
    warning: "border-warning/40 bg-warning-soft text-warning-soft-foreground",
    destructive: "border-danger/40 bg-danger-soft text-danger-soft-foreground",
    success: "border-success/30 bg-success-soft text-success-soft-foreground",
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
