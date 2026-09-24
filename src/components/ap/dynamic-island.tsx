/**
 * DynamicIsland — Apple-style adaptive status capsule for the invoice pipeline.
 *
 * All colors reference the centralized color system in @/lib/colors.
 * No hardcoded oklch values.
 */
import { Fragment, useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Brain,
  Check,
  ChevronDown,
  FileText,
  Layers,
  Loader2,
  ScanLine,
  Stamp,
  X,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  money,
  shortDate,
  stageLabel,
  STATUS_LABEL,
  type InvoiceStatus,
  type Invoice,
} from "@/lib/ap/types";
import type { QueueItem } from "@/lib/ap/draft-queue";
import { darkColor, colorClasses } from "@/lib/colors";

/* ── Phase definitions ─────────────────────────────────────────────── */

const PHASES = [
  { key: "draft", label: "Draft", icon: FileText },
  { key: "review", label: "Approval", icon: Stamp },
  { key: "scheduled", label: "Handoff", icon: Stamp },
] as const;

/**
 * Which phase of PHASES each status sits in. Named rather than derived from
 * `STATUS_ORDER` — that list leads with `vendor_profile`, so indexing PHASES
 * with it put Draft in Approval, Approval in Handoff, and sent `scheduled` one
 * past the end of the array, throwing on every scheduled invoice. The Record is
 * exhaustive, so a new status fails to compile.
 */
const PHASE_INDEX: Record<InvoiceStatus, number> = {
  processing: 0,
  failed: 0,
  vendor_profile: 0,
  draft: 0,
  rejected: 1,
  review: 1,
  scheduled: 2,
  paid: 2,
  // Removed records never reach this island (they are out of the queue), but
  // the map stays exhaustive so a new status cannot be added unnoticed.
  archived: 0,
};

function phaseLabel(status: InvoiceStatus): string {
  if (status === "processing") return "Processing";
  if (status === "failed") return "Needs attention";
  if (status === "rejected") return "Rejected";
  if (status === "paid") return "Paid";
  // `archived` has no special case: STATUS_LABEL calls it Removed.
  return STATUS_LABEL[status];
}

/* ── Engine badge icon ─────────────────────────────────────────────── */

function EngineIcon({ engine }: { engine?: "template" | "gemma" | "ocr" | undefined }) {
  if (!engine) return null;
  const Icon = engine === "template" ? Layers : engine === "gemma" ? Brain : ScanLine;
  return <Icon className="size-3 opacity-60" />;
}

/* ── Progress bar ──────────────────────────────────────────────────── */

function MiniProgress({ value, pulsing }: { value: number; pulsing?: boolean }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={cn(
          "h-full rounded-full transition-[width,background-color] duration-500 ease-out-expo",
          pulsing ? "bg-white/40 animate-pulse" : "bg-white/80",
        )}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────────── */

export type DynamicIslandProps = {
  invoice: Invoice;
  queueItems?: QueueItem[] | undefined;
  onFocusField?: ((field: string) => void) | undefined;
  onAcceptField?: ((field: string) => void) | undefined;
};

export function DynamicIsland({
  invoice,
  queueItems = [],
  onFocusField,
  onAcceptField,
}: DynamicIslandProps) {
  const [expanded, setExpanded] = useState(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const status = invoice.status;
  const isProcessing = status === "processing";
  const isFailed = status === "failed";
  const isRejected = status === "rejected";
  const isTerminal = status === "paid";
  const phaseIndex = PHASE_INDEX[status];
  const hasAttention = queueItems.length > 0;
  const hasBlocking = queueItems.some((i) => i.kind === "blocking");

  const handleMouseEnter = useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => setExpanded(true), 200);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => setExpanded(false), 300);
  }, []);

  const handleClick = useCallback(() => setExpanded((v) => !v), []);

  return (
    <div className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {/* ── Compact pill ───────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          // Ink chrome in light; the Dark Stage card surface carries the lift on black.
          "flex items-center gap-2.5 rounded-full bg-sidebar px-4 py-2 text-sidebar-foreground transition-[border-radius,padding,box-shadow] duration-300 ease-out-expo",
          expanded ? "rounded-[22px] px-5" : "rounded-full",
          hasAttention && !expanded && "ring-1 ring-white/10",
        )}
        aria-label={`${phaseLabel(status)} — click to expand`}
      >
        {/* Phase icon circle */}
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full transition-colors duration-300 ease-out-expo",
            isProcessing && darkColor.accentBgActive,
            isFailed && darkColor.destructiveBg,
            isRejected && darkColor.destructiveBg,
            isTerminal && darkColor.successBg,
            !isProcessing && !isFailed && !isRejected && !isTerminal && darkColor.accentBg,
          )}
        >
          {isProcessing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : isFailed || isRejected ? (
            <X className="size-3.5" />
          ) : isTerminal ? (
            <Check className="size-3.5" />
          ) : (
            (() => {
              const Icon = PHASES[phaseIndex]!.icon;
              return <Icon className="size-3.5" />;
            })()
          )}
        </span>

        {/* Label */}
        <span className="text-[13px] font-semibold tracking-tight whitespace-nowrap">
          {phaseLabel(status)}
        </span>

        {/* Processing progress bar (inline in compact) */}
        {isProcessing && invoice.processing && (
          <span className="w-16">
            <MiniProgress value={invoice.processing.progress ?? 0} pulsing />
          </span>
        )}

        {/* Attention dot */}
        {hasAttention && (
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              hasBlocking ? `${darkColor.destructiveBg} animate-pulse` : darkColor.warningBg,
            )}
          />
        )}

        {/* Expand chevron */}
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 opacity-50 transition-transform duration-300",
            expanded && "rotate-180",
          )}
        />
      </button>

      {/* ── Expanded panel ─────────────────────────────────────── */}
      {expanded && (
        <div
          className={cn(
            "absolute right-0 top-full z-50 mt-2 w-[340px] overflow-hidden rounded-[22px] border border-white/10 bg-surface-inverse text-white shadow-2xl",
            "animate-in fade-in slide-in-from-top-2 duration-200",
          )}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Vendor summary header */}
          <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{invoice.vendor}</p>
              <p className="mt-0.5 truncate text-[11px] text-white/50">
                <span className="font-mono">{invoice.invoiceNumber || "—"}</span>
                {" · "}
                {shortDate(invoice.dueDate)}
                {" · "}
                {money(invoice.total, invoice.currency)}
              </p>
            </div>
            <EngineIcon engine={invoice.engine} />
          </div>

          {/* Pipeline steps */}
          <div className="px-5 py-4">
            <ol className="flex items-center gap-0">
              {PHASES.map((phase, index) => {
                const isActive = index === phaseIndex;
                const isDone = index < phaseIndex || (isTerminal && index <= 2);
                const isCurrentRejected = isRejected && isActive;
                const PhaseIcon = phase.icon;
                return (
                  <Fragment key={phase.key}>
                    <li className="flex flex-col items-center gap-1.5">
                      <span
                        className={cn(
                          "grid size-9 place-items-center rounded-full transition-[background-color,box-shadow,color] duration-300 ease-out-expo",
                          isDone && !isCurrentRejected && darkColor.successBg,
                          isActive &&
                            !isCurrentRejected &&
                            !isProcessing &&
                            !isFailed &&
                            `${darkColor.accentBgActive} ring-2 ${darkColor.accentRing}`,
                          isActive &&
                            isProcessing &&
                            `${darkColor.accentBgActive} ring-2 ${darkColor.accentRing}`,
                          isActive &&
                            isFailed &&
                            `${darkColor.destructiveBg} ring-2 ${darkColor.destructiveRing}`,
                          isActive &&
                            isCurrentRejected &&
                            `${darkColor.destructiveBg} ring-2 ${darkColor.destructiveRing}`,
                          !isDone && !isActive && darkColor.mutedBg,
                        )}
                      >
                        {isProcessing && isActive ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : isDone && !isCurrentRejected ? (
                          <Check className="size-4" />
                        ) : isFailed && isActive ? (
                          <X className="size-4" />
                        ) : (
                          <PhaseIcon className="size-4" />
                        )}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] font-medium tracking-wide",
                          isActive
                            ? "text-white/90"
                            : isDone
                              ? "text-white/50"
                              : darkColor.mutedTextFaint,
                        )}
                      >
                        {phase.label}
                      </span>
                    </li>
                    {index < PHASES.length - 1 && (
                      <li className="mx-2 mb-5 h-px flex-1">
                        <div
                          className={cn(
                            "h-full transition-colors duration-500 ease-out-expo",
                            index < phaseIndex || (isTerminal && index < 2)
                              ? `${darkColor.successBg}`
                              : index === phaseIndex
                                ? "bg-gradient-to-r from-white/30 to-white/5"
                                : darkColor.mutedBg,
                          )}
                        />
                      </li>
                    )}
                  </Fragment>
                );
              })}
            </ol>

            {/* Processing detail */}
            {isProcessing && invoice.processing && (
              <div className="mt-3 rounded-xl bg-white/5 px-3 py-2">
                <p className="text-[11px] font-medium text-white/60">
                  {stageLabel(invoice.processing.stage)}
                </p>
                <div className="mt-1.5">
                  <MiniProgress value={invoice.processing.progress ?? 0} />
                </div>
              </div>
            )}

            {/* Attention items */}
            {hasAttention && !isProcessing && (
              <div className="mt-3 space-y-1">
                {queueItems.slice(0, 4).map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2"
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        item.kind === "blocking"
                          ? darkColor.destructiveBg
                          : item.kind === "warning" || item.kind === "amber"
                            ? darkColor.warningBg
                            : darkColor.infoBg,
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-white/70">
                      {item.label}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.field) onAcceptField?.(item.field);
                      }}
                      className="shrink-0 rounded-sm bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/80 hover:bg-white/20 transition-colors"
                    >
                      OK
                    </button>
                  </div>
                ))}
                {queueItems.length > 4 && (
                  <p className="text-center text-[10px] text-white/40">
                    +{queueItems.length - 4} more
                  </p>
                )}
              </div>
            )}

            {/* Status label strip */}
            {(isRejected || isFailed) && (
              <div
                className={cn(
                  "mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium",
                  isRejected && `${darkColor.destructiveBgMuted} ${darkColor.destructiveText}`,
                  isFailed && `${darkColor.warningBgMuted} ${darkColor.warningText}`,
                )}
              >
                <span className="size-1.5 rounded-full bg-current" />
                {isRejected ? "Rejected — reason in audit" : "Needs attention"}
              </div>
            )}

            {/* Terminal success */}
            {isTerminal && (
              <div
                className={`mt-3 flex items-center gap-2 rounded-lg ${darkColor.successBgMuted} px-3 py-2 text-[11px] font-medium ${darkColor.successText}`}
              >
                <BadgeCheck className="size-3.5" />
                Invoice paid
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
