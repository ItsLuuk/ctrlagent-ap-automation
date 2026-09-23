/**
 * Persistent processing badge for the header. Shows the count of in-flight
 * upload jobs, opens a small tray with per-job status when clicked, and
 * surfaces retries for failed jobs.
 */
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronDown, Loader2, RotateCcw } from "@/components/icons";
import { useState } from "react";
import { toast } from "sonner";
import { useUploadJobs } from "@/lib/ap/upload-jobs";
import { stageLabel, type ProcessingState } from "@/lib/ap/types";
import { processingStageLabel } from "@/lib/ap/processing-errors";

export function ProcessingBadge() {
  const { jobs, retry, dismiss, reportProblem } = useUploadJobs();
  const [open, setOpen] = useState(false);
  if (jobs.length === 0) return null;
  const active = jobs.filter((j) => !j.state.error);
  const failed = jobs.filter((j) => j.state.error);
  const count = jobs.length;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90"
      >
        {active.length > 0 ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <AlertTriangle className="size-3" />
        )}
        {active.length > 0 ? `${active.length} processing` : `${failed.length} needs attention`}
        <ChevronDown
          className={`size-3 opacity-60 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="absolute bottom-full right-0 z-40 mb-2 w-80 rounded-xl border border-border bg-card p-2">
          {active.length > 0 ? (
            <div className="space-y-1">
              <p className="px-3 pb-1 text-xs font-medium  text-muted-foreground">Running</p>
              {active.map((j) => (
                <ProcessingRow
                  key={j.id}
                  label={j.fileName}
                  state={j.state}
                  onDismiss={() => dismiss(j.id)}
                />
              ))}
            </div>
          ) : null}
          {failed.length > 0 ? (
            <div className="mt-2 space-y-1 border-t border-border pt-2">
              <p className="px-3 pb-1 text-xs font-medium  text-muted-foreground">
                Needs attention
              </p>
              {failed.map((j) => (
                <FailedRow
                  key={j.id}
                  invoiceId={j.invoiceId}
                  label={j.fileName}
                  state={j.state}
                  onRetry={() => {
                    void retry(j.id).then(() =>
                      toast.info("Retrying extraction", {
                        description: j.fileName,
                      }),
                    );
                  }}
                  onReport={() => reportProblem(j.id)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProcessingRow({
  label,
  state,
  onDismiss,
}: {
  label: string;
  state: ProcessingState;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-sm px-3 py-2 hover:bg-secondary/60">
      <div className="min-w-0">
        <p className="truncate font-mono text-xs">{label}</p>
        <p className="text-xs text-muted-foreground">{labelStage(state.stage)}</p>
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-accent transition-[width] ease-out-expo"
            style={{ width: `${Math.round((state.progress ?? 0) * 100)}%` }}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground"
        title="Stop watching this upload"
      >
        ×
      </button>
    </div>
  );
}

function FailedRow({
  invoiceId,
  label,
  state,
  onRetry,
  onReport,
}: {
  invoiceId: string;
  label: string;
  state: ProcessingState;
  onRetry: () => void;
  onReport: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-sm border border-warning/30 bg-warning/10 px-3 py-1.5">
      <div className="min-w-0">
        <Link
          to="/invoices/$id"
          params={{ id: invoiceId }}
          className="truncate font-mono text-xs hover:underline"
        >
          {label}
        </Link>
        <p className="mt-0.5 text-xs font-medium text-warning-foreground">
          {processingStageLabel(state.errorStage ?? state.stage)}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{state.error}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-sm border border-border bg-card px-1.5 py-0.5 text-xs font-medium hover:bg-secondary"
        >
          <RotateCcw className="size-3" /> Retry
        </button>
        <Link
          to="/invoices/$id"
          params={{ id: invoiceId }}
          className="rounded-sm border border-border bg-card px-1.5 py-0.5 text-xs font-medium hover:bg-secondary"
        >
          Review manually
        </Link>
        <button
          type="button"
          onClick={onReport}
          className="rounded-sm border border-border bg-card px-1.5 py-0.5 text-xs font-medium hover:bg-secondary"
        >
          Report problem
        </button>
      </div>
    </div>
  );
}

function labelStage(stage: ProcessingState["stage"]): string {
  return stageLabel(stage);
}
