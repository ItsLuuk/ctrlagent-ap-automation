/**
 * Background upload jobs. Each new-vendor upload becomes a job that runs
 * outside the upload dialog — the modal closes once the quick phase returns
 * a skeleton, and this context tracks the in-flight work until the invoice
 * is ready to review.
 *
 * Persistence is intentional: a job that was running when the user closed
 * the tab picks up where it left off when they reopen, because the skeleton
 * invoice carries the cached OCR pages on its `processing` field.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { runBackgroundJob, type ProcessingSkeleton } from "@/lib/ap/ocr";
import {
  processingFailureReason,
  processingFailureState,
  processingStageLabel,
} from "@/lib/ap/processing-errors";
import { useAp } from "./store";
import { decideInitialStatus } from "@/lib/ap/vendor-routing";
import { type Invoice, type ProcessingState } from "@/lib/ap/types";

export type UploadJob = {
  id: string;
  invoiceId: string;
  fileName: string;
  startedAt: string;
  state: ProcessingState;
  /** Skeleton payload, including the cached OCR pages the job fills from. */
  skeleton: ProcessingSkeleton;
};

type Ctx = {
  jobs: UploadJob[];
  /** Registers a quick-phase skeleton as a background job and kicks it off
   *  (bounded by MAX_PARALLEL_JOBS). The caller runs `extractQuickPhase` itself
   *  because it owns the progress UI and the template-hit decision, so this
   *  must never run that phase a second time. */
  enqueue: (skeleton: ProcessingSkeleton) => UploadJob;
  /** Re-runs a failed job from its cached skeleton. */
  retry: (jobId: string) => Promise<void>;
  /** Removes a job from the list and clears the invoice's processing state. */
  dismiss: (jobId: string) => void;
  /** Records a problem report against the failed invoice and removes it from the tray. */
  reportProblem: (jobId: string) => void;
};

const JobsContext = createContext<Ctx | null>(null);

/** Cap concurrent VLM jobs so the local model isn't swamped by a batch. */
const MAX_PARALLEL_JOBS = 2;

export function UploadJobsProvider({ children }: { children: ReactNode }) {
  const { addInvoice, updateInvoice, applyTransition, vendors, templates, businessProfile } =
    useAp();
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const inFlightRef = useRef(0);
  const waitingRef = useRef<UploadJob[]>([]);
  const templatesRef = useRef(templates);
  const profileRef = useRef(businessProfile);

  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);
  useEffect(() => {
    profileRef.current = businessProfile;
  }, [businessProfile]);

  const updateJob = useCallback((jobId: string, patch: Partial<UploadJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, ...patch } : j)));
  }, []);

  const removeJob = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  /** Drives a single job from skeleton to completed invoice. */
  const runOne = useCallback(
    async (job: UploadJob): Promise<void> => {
      inFlightRef.current += 1;
      let currentStage = job.state.stage;
      try {
        updateJob(job.id, {
          state: { ...job.state, stage: "ai reading", progress: 0.5, background: true },
        });
        updateInvoice(job.invoiceId, {
          processing: {
            stage: "ai reading",
            progress: 0.5,
            background: true,
            startedAt: job.startedAt,
          },
        });
        const invoice: Invoice = await runBackgroundJob(
          job.skeleton,
          (p: { stage: string; progress: number }) => {
            const stage = mapStage(p.stage);
            currentStage = stage;
            updateJob(job.id, {
              state: { ...job.state, stage, progress: p.progress, background: true },
            });
            updateInvoice(job.invoiceId, {
              processing: {
                stage,
                progress: p.progress,
                background: true,
                startedAt: job.startedAt,
              },
            });
          },
          undefined,
          templatesRef.current,
          profileRef.current,
        );
        // Replace the skeleton with the finalised invoice; keep its id so
        // existing UI links keep working. Vendor-master lookup decides
        // whether the invoice lands in Draft (known vendor) or in the new
        // vendor_profile phase for first-time registration.
        const initialStatus = decideInitialStatus(invoice.vendor, vendors);
        updateInvoice(job.invoiceId, {
          ...invoice,
          id: job.invoiceId,
          processing: undefined,
          status: initialStatus,
        });
        // Audit the system-init decision — the audit trail must show how the
        // invoice arrived at vendor_profile (or why it skipped it).
        applyTransition(job.invoiceId, {
          transition: "register-profile",
          actor: { name: "system", roles: ["system"] },
          note:
            initialStatus === "vendor_profile"
              ? `${invoice.vendor || "(unknown)"} not in vendor-master — routed to registration.`
              : `${invoice.vendor} matched vendor-master — entered Draft.`,
        });
        removeJob(job.id);
        toast.success(
          initialStatus === "vendor_profile"
            ? "New vendor — pin the profile and the fields"
            : "Invoice ready for review",
          {
            description: invoice.templateDrift
              ? `${invoice.vendor} — missing fields recovered, review before submitting.`
              : `${invoice.vendor} — fields extracted, template saved for next time.`,
            action: {
              label: "Open",
              onClick: () => {
                window.location.hash = `#/invoices/${job.invoiceId}`;
              },
            },
          },
        );
      } catch (err) {
        const failure = processingFailureState(err, currentStage, job.startedAt);
        const reason = processingFailureReason(err, currentStage);
        updateInvoice(job.invoiceId, {
          status: "failed",
          processing: failure,
        });
        updateJob(job.id, {
          state: {
            ...job.state,
            ...failure,
          },
        });
        toast.error("Invoice processing needs attention", {
          description: `${processingStageLabel(currentStage)} — ${reason}`,
          action: {
            label: "Retry",
            onClick: () => {
              const next = waitingRef.current.shift();
              if (next) {
                inFlightRef.current = Math.max(0, inFlightRef.current - 1);
                void runOne(next);
              }
              void runOne(job);
            },
          },
        });
      } finally {
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
        const next = waitingRef.current.shift();
        if (next) {
          void runOne(next);
        }
      }
    },
    [updateInvoice, updateJob, removeJob],
  );

  /** Schedules a job, respecting the concurrency cap. */
  const schedule = useCallback(
    (job: UploadJob) => {
      if (inFlightRef.current < MAX_PARALLEL_JOBS) {
        void runOne(job);
      } else {
        waitingRef.current.push(job);
      }
    },
    [runOne],
  );

  /** Public API used by the upload dialog. Takes the skeleton the dialog
   *  already produced and schedules a background job for it. */
  const enqueue = useCallback(
    (skeleton: ProcessingSkeleton): UploadJob => {
      const startedAt = new Date().toISOString();
      const job: UploadJob = {
        id: skeleton.invoice.id,
        invoiceId: skeleton.invoice.id,
        fileName: skeleton.invoice.fileName ?? "invoice",
        startedAt,
        state: {
          stage: "queued",
          progress: 0.1,
          background: true,
          startedAt,
        },
        skeleton,
      };
      setJobs((prev) => [...prev, job]);
      addInvoice(skeleton.invoice);
      if (skeleton.firstSlow) {
        toast.info("First-time vendor — creating template", {
          description:
            "This slow pass saves a layout template so future invoices from this vendor extract instantly.",
          duration: 8000,
        });
      }
      schedule(job);
      return job;
    },
    [addInvoice, schedule],
  );

  const retry = useCallback(
    async (jobId: string) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return;
      // Clear the error state and re-enter the queue.
      updateJob(jobId, {
        state: {
          stage: "queued",
          progress: 0.1,
          background: true,
          startedAt: new Date().toISOString(),
        },
      });
      updateInvoice(jobId, {
        status: "processing",
        processing: {
          stage: "queued",
          progress: 0.1,
          background: true,
          startedAt: new Date().toISOString(),
        },
      });
      schedule({ ...job, state: { ...job.state, error: undefined } });
    },
    [jobs, schedule, updateJob, updateInvoice],
  );

  const dismiss = useCallback(
    (jobId: string) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return;
      updateInvoice(job.invoiceId, { processing: undefined });
      removeJob(jobId);
    },
    [jobs, updateInvoice, removeJob],
  );

  const reportProblem = useCallback(
    (jobId: string) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return;
      updateInvoice(
        job.invoiceId,
        { processing: undefined },
        "Extraction problem reported",
        "The original document and failed extraction were saved for investigation.",
      );
      removeJob(jobId);
      toast.success("Problem report recorded", {
        description: "The original document and failed extraction details are attached.",
      });
    },
    [jobs, updateInvoice, removeJob],
  );

  const value = useMemo(
    () => ({ jobs, enqueue, retry, dismiss, reportProblem }),
    [jobs, enqueue, retry, dismiss, reportProblem],
  );

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useUploadJobs() {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error("useUploadJobs must be used inside UploadJobsProvider");
  return ctx;
}

function mapStage(raw: string): ProcessingState["stage"] {
  if (raw.includes("preprocess")) return "preprocessing";
  if (raw.includes("matching") || raw.includes("template")) return "matching vendor";
  if (raw.includes("AI") || raw.includes("VLM") || raw.includes("ai reading")) {
    return "ai reading";
  }
  if (raw.includes("final")) return "finalizing";
  return "queued";
}
