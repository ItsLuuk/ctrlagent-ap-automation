/**
 * Status components — badges, chips, pipeline visualization.
 *
 * All colors reference the centralized color system in @/lib/colors.
 * No hardcoded oklch values.
 */
import { Fragment } from "react";
import {
  Brain,
  Building2,
  Check,
  Cpu,
  FileText,
  Layers,
  Loader2,
  ScanLine,
  Stamp,
  X,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_ORDER, type InvoiceStatus } from "@/lib/ap/types";
import { LOW_CONFIDENCE } from "@/lib/ap/mapping";
import { STATUS_TONES, colorClasses } from "@/lib/colors";

export function StatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  const tone = STATUS_TONES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium",
        tone.text,
        tone.pulse && "animate-pulse",
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ConfidenceChip({
  value,
  label,
  title,
  tone = "pill",
}: {
  value?: number | undefined;
  /** What the percentage is about, when a screen shows two kinds. */
  label?: string | undefined;
  title?: string | undefined;
  /**
   * "quiet" is a dot and a number in muted text, for a row that already has
   * content in it. A filled pill per row turns supporting metadata into the
   * loudest thing on the screen, and a screen where everything is loud has no
   * reading order at all.
   */
  tone?: "pill" | "quiet";
}) {
  if (value === undefined) return null;
  const pct = Math.round(value * 100);
  const low = value < LOW_CONFIDENCE;
  const description =
    title ?? (low ? "Low confidence — check against the document" : "High confidence");
  if (tone === "quiet") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground"
        title={description}
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            low ? colorClasses.warning.bg : colorClasses.success.bg,
          )}
        />
        {label ? `${label} ${pct}%` : `${pct}%`}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 font-mono text-xs font-medium",
        low ? `${colorClasses.warning.bg} text-white` : `${colorClasses.success.bg} text-white`,
      )}
      title={description}
    >
      {label ? `${label} ${pct}%` : `${pct}%`}
    </span>
  );
}

/**
 * Surfaces which engine produced this invoice.
 */
export function EngineBadge({
  engine,
  templateFingerprint,
  model,
  className,
}: {
  engine: "template" | "gemma" | "text" | undefined;
  templateFingerprint?: string | undefined;
  model?: string | undefined;
  className?: string | undefined;
}) {
  if (!engine) return null;
  const config =
    engine === "template"
      ? {
          icon: Layers,
          label: "Template match",
          tone: `${colorClasses.accent.bg} text-white`,
          tip: templateFingerprint
            ? `Vendor template · ${templateFingerprint}`
            : "Vendor template matched",
        }
      : engine === "gemma"
        ? {
            icon: Brain,
            label: "Vision model",
            tone: `${colorClasses.warning.bg} text-white`,
            tip: model ? `Vision model · ${model}` : "Vision model",
          }
        : {
            icon: ScanLine,
            label: "Text reader",
            tone: "bg-sidebar text-white",
            tip: "Read from the document text — no model involved",
          };
  const Icon = config.icon;
  return (
    <span
      title={config.tip}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-4 py-0.5 text-xs font-medium tracking-tight",
        config.tone,
        className,
      )}
    >
      <Icon className="size-3" />
      {config.label}
    </span>
  );
}

/** Inline per-field chip showing the engine that produced this value. */
export function FieldPathChip({
  path,
  className,
}: {
  path: "template" | "vlm" | "text" | undefined;
  className?: string | undefined;
}) {
  if (!path) return null;
  const config =
    path === "template"
      ? {
          icon: Layers,
          label: "Template",
          tone: `${colorClasses.accent.bg} text-white`,
          tip: "Read from the vendor template",
        }
      : path === "vlm"
        ? {
            icon: Cpu,
            label: "Vision model",
            tone: `${colorClasses.warning.bg} text-white`,
            tip: "Read by the vision model",
          }
        : {
            icon: ScanLine,
            label: "Text reader",
            tone: "bg-sidebar text-white",
            tip: "Read from the document text",
          };
  const Icon = config.icon;
  return (
    <span
      title={config.tip}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium",
        config.tone,
        className,
      )}
    >
      <Icon className="size-2.5" />
      {config.label}
    </span>
  );
}

// Pipeline step configuration — single source of truth
const PIPELINE_STEPS = [
  { key: "vendor_profile", label: "Vendor profile", icon: Building2 },
  { key: "draft", label: "Draft", icon: FileText },
  { key: "review", label: "For approval", icon: Stamp },
  { key: "scheduled", label: "Ready for handoff", icon: Stamp },
] as const;

type StepState = "done" | "active" | "pending";

function statusToStep(status: InvoiceStatus): number {
  if (status === "processing" || status === "failed") return STATUS_ORDER.indexOf("draft");
  if (status === "paid") return STATUS_ORDER.indexOf("scheduled");
  if (status === "rejected") return STATUS_ORDER.indexOf("review");
  return STATUS_ORDER.indexOf(status);
}

function currentPhaseLabel(status: InvoiceStatus): string {
  if (status === "processing") return "Processing";
  if (status === "failed") return "Needs attention";
  if (status === "rejected") return "Rejected";
  return STATUS_LABEL[status];
}

function getStepState(index: number, current: number, isRejected: boolean): StepState {
  if (isRejected) {
    if (index < current) return "done";
    if (index === current) return "active";
    return "pending";
  }
  if (index < current) return "done";
  if (index === current) return "active";
  return "pending";
}

function circleStyles(state: StepState, isRejected: boolean): string {
  return cn(
    "size-8 rounded-full flex items-center justify-center transition-[background-color,color,box-shadow] duration-300 ease-out-expo",
    state === "done" && `${colorClasses.accent.bg} ${colorClasses.accent.text}`,
    state === "active" &&
      !isRejected &&
      `${colorClasses.accent.bg} ${colorClasses.accent.text} ring-4 ${colorClasses.accent.ring}`,
    state === "active" &&
      isRejected &&
      `${colorClasses.destructive.bg} ${colorClasses.destructive.text} ring-4 ${colorClasses.destructive.ring}`,
    state === "pending" && "bg-muted text-muted-foreground",
  );
}

/** Progress bar connecting two steps — filled, pulsing, or empty. */
function ProgressBar({ filled, pulsing }: { filled: boolean; pulsing: boolean }) {
  return (
    <div className="mx-5 h-2 w-full rounded-full bg-border overflow-hidden">
      <div
        className={cn(
          "h-full rounded-full transition-[width,background-color] duration-500 ease-out-expo",
          filled && !pulsing && "bg-accent",
          pulsing && "bg-accent/50 animate-pulse",
        )}
        style={{ width: filled ? "100%" : pulsing ? "50%" : "0%" }}
      />
    </div>
  );
}

export function Pipeline({
  status,
  variant = "card",
}: {
  status: InvoiceStatus;
  variant?: "card" | "embedded";
}) {
  const currentStep = statusToStep(status);
  const isRejected = status === "rejected";
  const isProcessing = status === "processing";
  const isFailed = status === "failed";
  const isTerminal = status === "paid";

  const effectiveStep = isTerminal ? STATUS_ORDER.length - 1 : currentStep;

  return (
    <div className={cn(variant === "card" && "rounded-lg bg-card p-4 shadow-whisper")}>
      <div>
        <p className="text-sm font-semibold tracking-tight">{currentPhaseLabel(status)}</p>
      </div>

      <ol className="mt-4 flex items-center" aria-label="Invoice phases">
        {PIPELINE_STEPS.map((step, index) => {
          const state = getStepState(index, effectiveStep, isRejected);
          return (
            <Fragment key={step.key}>
              <li className="shrink-0">
                <div
                  role="img"
                  aria-label={`${step.label}: ${state}`}
                  title={step.label}
                  className={cn(
                    circleStyles(state, isRejected),
                    isFailed &&
                      index === effectiveStep &&
                      `${colorClasses.destructive.bg} ${colorClasses.destructive.text} ring-4 ${colorClasses.destructive.ring}`,
                  )}
                >
                  {isProcessing && index === effectiveStep ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : isFailed && index === effectiveStep ? (
                    <X className="size-4" />
                  ) : state === "done" ? (
                    <Check className="size-4" />
                  ) : (
                    <step.icon className="size-4" />
                  )}
                </div>
              </li>
              {index < PIPELINE_STEPS.length - 1 && (
                <li className="min-w-0 flex-1">
                  <ProgressBar
                    filled={index < effectiveStep}
                    pulsing={index === effectiveStep && !isTerminal}
                  />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>

      {(isRejected || isFailed) && (
        <div
          className={cn(
            "mt-2.5 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium",
            isRejected && `${colorClasses.destructive.bgMuted} ${colorClasses.destructive.text}`,
            isFailed && `${colorClasses.warning.bgMuted} ${colorClasses.warning.text}`,
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {isRejected ? "Rejected" : "Needs attention"}
        </div>
      )}
    </div>
  );
}
