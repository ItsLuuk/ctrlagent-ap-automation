import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readFile } from "@tauri-apps/plugin-fs";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FileUp, Loader2, ScanLine } from "@/components/icons";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useAp } from "@/lib/ap/store";
import { stageLabel, uid, type Invoice } from "@/lib/ap/types";
import { processingFailureReason, processingFailureState } from "@/lib/ap/processing-errors";
import { extractQuickPhase } from "@/lib/ap/ocr";
import { saveFile } from "@/lib/ap/file-store";
import { useUploadJobs } from "@/lib/ap/upload-jobs";
import { decideInitialStatus } from "@/lib/ap/vendor-routing";

async function filesFromNativePaths(paths: string[]): Promise<File[]> {
  const files: File[] = [];
  for (const path of paths) {
    const name = path.split(/[\\\\/]/).pop() || "invoice";
    try {
      const bytes = await readFile(path);
      const extension = name.split(".").pop()?.toLowerCase();
      const type =
        extension === "pdf"
          ? "application/pdf"
          : extension === "png"
            ? "image/png"
            : extension === "jpg" || extension === "jpeg"
              ? "image/jpeg"
              : "application/octet-stream";
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      files.push(new File([buffer], name, { type }));
    } catch (error) {
      console.error("[upload] could not read native file", path, error);
      toast.error("Couldn’t open the selected file", {
        description: `${name}: ${error instanceof Error ? error.message : "file access failed"}`,
      });
    }
  }
  return files;
}

/**
 * Upload dialog. Two phases per the upload-flow rework:
 *  1. Quick block (~1-2s per file): preprocess + layout OCR + fingerprint +
 *     template match. For known vendors this returns a finished invoice and we
 *     move on to the next file.
 *  2. For novel vendors, the skeleton is handed to the upload-jobs provider
 *     for the background VLM job, tracked by the persistent processing badge.
 *
 * Multiple files are welcome: a drop or file picker selection is quick-phased
 * one file at a time (each is fast and local), while background jobs for novel
 * vendors run concurrently underneath — capped by MAX_PARALLEL_JOBS.
 *
 * The blocking dialog is *never* shown for the slow path — it would defeat
 * the whole point of the rework. The only time the dialog stays up is during
 * the quick phases, which we cap at the OCR + fingerprint step.
 */
/**
 * One gesture, one capture. Several UploadDialogs are mounted at once — the
 * shell's narrow bar and the inbox header each render one — and every instance
 * registers the window listeners. The first to see a drop claims it and the
 * rest skip, so a single dropped PDF becomes one record instead of one per
 * mounted instance: the twin the queue kept flagging as a duplicate was this.
 * The native timestamp is also read by the dialog card, which must ignore the
 * browser drop event that follows Tauri's own.
 */
let lastNativeDropAt = 0;
let lastBrowserDropAt = 0;

export function UploadDialog({
  size,
}: {
  /** Trigger weight — the first-run action is the hero, the header one is not. */
  size?: ButtonProps["size"];
}) {
  const { addInvoice, applyTransition, templates, vendors } = useAp();
  const { enqueue } = useUploadJobs();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const [failureReasons, setFailureReasons] = useState<string[]>([]);
  const currentStageRef = useRef("uploading");
  const [current, setCurrent] = useState<{ name: string; index: number; total: number } | null>(
    null,
  );
  const openRef = useRef(open);
  const busyRef = useRef(busy);
  const handleFilesRef = useRef<((files: File[]) => Promise<void>) | undefined>(undefined);
  useEffect(() => {
    openRef.current = open;
    busyRef.current = busy;
  }, [open, busy]);
  // Freshest template set: a batch loop can outlive the render that started it,
  // so later files still see templates saved while earlier ones were reading.
  const templatesRef = useRef(templates);
  const chooseFiles = async () => {
    if (!("__TAURI_INTERNALS__" in window)) {
      inputRef.current?.click();
      return;
    }
    try {
      const selected = await openFileDialog({
        multiple: true,
        directory: false,
        filters: [{ name: "Invoices", extensions: ["pdf", "png", "jpg", "jpeg"] }],
      });
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        const files = await filesFromNativePaths(paths);
        if (files.length > 0 && !busyRef.current) {
          void handleFilesRef.current?.(files);
        }
      }
    } catch (error) {
      console.error("[upload] native file picker failed", error);
      toast.error("Couldn’t open the file picker", {
        description:
          error instanceof Error ? error.message : "The desktop file picker failed to open.",
      });
    }
  };
  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);

  const handleFiles = async (files: File[]) => {
    if (busyRef.current || files.length === 0) return;
    setBusy(true);
    setFailedFiles([]);
    setFailureReasons([]);
    const ready: Invoice[] = [];
    const failed: File[] = [];
    const reasons: string[] = [];
    let queued = 0;
    try {
      for (const [index, file] of files.entries()) {
        setCurrent({ name: file.name, index: index + 1, total: files.length });
        setProgress(2);
        setStage("uploading");
        currentStageRef.current = "uploading";
        try {
          // Quick phase — capped at the fast path; a template hit adds the
          // finished invoice, a novel vendor yields a skeleton that goes to
          // the upload-jobs provider for background completion. One bad file
          // must not abort the rest of the batch, so failures are collected.
          const result = await extractQuickPhase(
            file,
            (p: { stage: string; progress: number }) => {
              currentStageRef.current = p.stage;
              setStage(p.stage);
              setProgress(Math.max(5, Math.round(p.progress * 100)));
            },
            templatesRef.current,
          );
          if (result.kind === "processing") {
            // The skeleton invoice lands in the inbox with a processing row,
            // the header badge tracks the job. The quick phase already ran
            // above (with progress), so hand its result straight to the job
            // registry rather than running it again.
            // Persist before queueing: a processing row must never outlive
            // the source document it promises to make reviewable.
            await saveFile(result.invoice.id, file);
            enqueue(result as unknown as Parameters<typeof enqueue>[0]);
            queued += 1;
          } else {
            // Template hit — instant result. (`extractQuickPhase` is
            // untyped in ocr.ts, so its invoice literal needs a nudge.)
            const invoice = result.invoice as Invoice;
            // Template match ≠ vendor-master match: a template hit on a vendor
            // whose master record was deleted still routes through registration
            // so the user re-confirms the identity. (Vendor profile registration
            // spec §5.)
            const initialStatus = decideInitialStatus(invoice.vendor, vendors);
            const routed: Invoice = { ...invoice, status: initialStatus };
            addInvoice(routed);
            applyTransition(routed.id, {
              transition: "register-profile",
              actor: { name: "system", roles: ["system"] },
              note:
                initialStatus === "vendor_profile"
                  ? `${invoice.vendor || "(unknown)"} not in vendor-master — routed to registration.`
                  : `${invoice.vendor} matched vendor-master — entered Draft.`,
            });
            await saveFile(routed.id, file);
            ready.push(routed);
          }
        } catch (error) {
          const reason = processingFailureReason(error, currentStageRef.current);
          failed.push(file);
          reasons.push(`${file.name}: ${reason}`);
          const failedInvoice: Invoice = {
            id: uid(),
            vendor: "",
            invoiceNumber: "",
            issueDate: "",
            dueDate: "",
            currency: "",
            subtotal: 0,
            tax: 0,
            total: 0,
            status: "failed",
            lineItems: [],
            glAccount: "",
            department: "",
            memo: "",
            tags: [],
            confidence: {},
            audit: [
              {
                id: uid(),
                at: new Date().toISOString(),
                actor: "Foundry",
                action: "Extraction failed",
                note: `${stageLabel(currentStageRef.current)} — ${reason}`,
              },
            ],
            source: "upload",
            fileName: file.name,
            fileType: file.type,
            fileUrl: URL.createObjectURL(file),
            processing: processingFailureState(error, currentStageRef.current),
            createdAt: new Date().toISOString(),
          };
          addInvoice(failedInvoice);
          try {
            await saveFile(failedInvoice.id, file);
          } catch (persistenceError) {
            const persistenceReason = processingFailureReason(
              persistenceError,
              "saving source file",
            );
            reasons[reasons.length - 1] =
              `${file.name}: ${reason} Source-file persistence also failed: ${persistenceReason}`;
            console.error("[upload] could not persist failed invoice source", persistenceError);
          }
        }
      }
    } finally {
      setBusy(false);
      setProgress(0);
      setStage("");
      setCurrent(null);
    }

    if (failed.length > 0) {
      // Keep the dialog open on the failure panel; everything that succeeded
      // has already been captured or queued.
      setFailedFiles(failed);
      setFailureReasons(reasons);
      const captured = ready.length + queued;
      toast.error(
        failed.length === 1
          ? "Invoice processing needs attention"
          : `${failed.length} invoices need attention`,
        {
          description:
            captured > 0
              ? `${captured} of ${files.length} captured. ${reasons[0]}`
              : (reasons[0] ??
                "The original files were saved. Open the invoice for the processing details."),
        },
      );
      return;
    }

    setOpen(false);
    if (files.length === 1) {
      const file = files[0]!;
      if (ready.length === 1) {
        // Single template hit — jump straight into the draft.
        const invoice = ready[0]!;
        toast.success("Invoice captured", {
          description: `${invoice.vendor} — review the extracted fields before submitting.`,
        });
        window.location.hash = `#/invoices/${invoice.id}`;
      } else {
        toast.info("Processing in the background", {
          description: `${file.name} — we'll notify you when fields are ready to review.`,
        });
      }
      return;
    }

    // Batch summary — no single draft to jump to, the badge and toasts carry
    // the ongoing work.
    if (ready.length > 0 && queued > 0) {
      toast.success(`${ready.length} invoices captured`, {
        description: `${queued} more ${
          queued === 1 ? "is" : "are"
        } processing in the background — we'll notify you when fields are ready to review.`,
      });
    } else if (ready.length > 0) {
      toast.success(`${ready.length} invoices captured`, {
        description: "Review the extracted fields before submitting.",
      });
    } else if (queued > 0) {
      toast.info(`Processing ${queued} invoices in the background`, {
        description: "We'll notify you when fields are ready to review.",
      });
    }
  };

  handleFilesRef.current = handleFiles;

  // Tauri's native window drop event provides filesystem paths rather than
  // browser DataTransfer files. Convert those paths into File objects so the
  // desktop path uses the exact same extraction, persistence, and navigation
  // pipeline as the web picker and browser drag/drop path.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onDragDropEvent(async ({ payload }) => {
        if (disposed) return;
        if (payload.type === "enter" || payload.type === "over") {
          if (openRef.current) setDragging(true);
          return;
        }
        if (payload.type === "leave") {
          setDragging(false);
          return;
        }
        if (payload.type !== "drop" || busyRef.current) return;
        // Another instance of this dialog already claimed the gesture.
        if (Date.now() - lastNativeDropAt < 1000) return;

        // A document dropped on the window is always a request to capture it,
        // open dialog or not. The first-run screen has nothing but this path,
        // and forcing the user to open a dialog first would be a step for the
        // app's convenience rather than theirs.
        if (!openRef.current) setOpen(true);

        setDragging(false);
        lastNativeDropAt = Date.now();
        const files = await filesFromNativePaths(payload.paths);
        if (files.length > 0) void handleFilesRef.current?.(files);
      })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch((error) => console.warn("[upload] native drop listener unavailable", error));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // The browser has no native window drop, so "drop a PDF anywhere in this
  // window" is wired here — the same gesture the desktop gets from Tauri above.
  // The dialog card stops propagation on its own drop, so the two cannot both
  // take the same file.
  useEffect(() => {
    if ("__TAURI_INTERNALS__" in window) return;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      if (busyRef.current) return;
      const dropped = Array.from(e.dataTransfer?.files ?? []);
      if (dropped.length === 0) return;
      // Another instance of this dialog already captured this gesture.
      if (Date.now() - lastBrowserDropAt < 1000) return;
      lastBrowserDropAt = Date.now();
      // A document dropped anywhere is a request to capture it, dialog open or
      // not — same rule as the native path.
      if (!openRef.current) setOpen(true);
      void handleFilesRef.current?.(dropped);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  const reviewManually = (files: File[]) => {
    if (files.length === 0) return;
    let firstId: string | undefined;
    for (const failedFile of files) {
      const invoiceId = uid();
      firstId ??= invoiceId;
      const manualInvoice: Invoice = {
        id: invoiceId,
        vendor: "",
        invoiceNumber: "",
        issueDate: "",
        dueDate: "",
        currency: "",
        subtotal: 0,
        tax: 0,
        total: 0,
        status: "draft",
        lineItems: [],
        glAccount: "",
        department: "",
        memo: "",
        tags: [],
        confidence: {},
        audit: [
          {
            id: uid(),
            at: new Date().toISOString(),
            actor: "Foundry",
            action: "Extraction failed",
            note: "Processor chose manual review.",
          },
        ],
        source: "upload",
        fileName: failedFile.name,
        fileType: failedFile.type,
        fileUrl: URL.createObjectURL(failedFile),
        createdAt: new Date().toISOString(),
      };
      addInvoice(manualInvoice);
      void saveFile(invoiceId, failedFile).catch((error) => {
        console.error("[upload] could not persist manual-review file", invoiceId, error);
      });
    }
    setFailedFiles([]);
    setOpen(false);
    window.location.hash = `#/invoices/${firstId!}`;
  };

  const reportProblem = () => {
    setFailedFiles([]);
    setOpen(false);
    toast.success("We recorded the problem", {
      description:
        failedFiles.length > 1
          ? "The uploads have been recorded for investigation."
          : "The upload has been recorded for investigation.",
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button size={size} className="gap-2">
          <FileUp className="size-4" />
          Upload invoice
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload invoices</DialogTitle>
          <DialogDescription>
            Drop one or more PDFs or photos/scans. Known vendors extract in about a second — first
            time we see a vendor, the layout gets read in the background and a template is saved for
            next time.
          </DialogDescription>
        </DialogHeader>

        {failedFiles.length > 0 ? (
          <div className="space-y-4 rounded-xl border border-warning/40 bg-warning/10 p-6">
            <div>
              <p className="text-sm font-medium">
                {failedFiles.length === 1
                  ? `Processing needs attention for ${failedFiles[0]!.name}`
                  : `${failedFiles.length} invoices need attention`}
              </p>
              {failedFiles.length > 1 ? (
                <ul className="mt-1 max-h-24 list-inside list-disc overflow-auto text-xs text-muted-foreground">
                  {failedFiles.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="truncate">
                      {f.name}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                {failureReasons.map((reason) => (
                  <p key={reason}>{reason}</p>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                The original file is saved. Retry, review it manually, or open the invoice from the
                inbox for these details.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void handleFiles(failedFiles)}>
                Retry
              </Button>
              <Button size="sm" variant="outline" onClick={() => reviewManually(failedFiles)}>
                Review manually
              </Button>
              <Button size="sm" variant="ghost" onClick={reportProblem}>
                Report problem
              </Button>
            </div>
          </div>
        ) : (
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dragDepthRef.current += 1;
              if (e.dataTransfer.types.includes("Files")) setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "copy";
              if (e.dataTransfer.types.includes("Files")) setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
              if (dragDepthRef.current === 0) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              // The window listens too (browser build): one drop, one capture.
              e.stopPropagation();
              dragDepthRef.current = 0;
              setDragging(false);
              // Tauri can deliver both its native path event and the browser
              // drop event. The native event is authoritative; ignore the
              // browser duplicate that arrives in the same gesture.
              if (Date.now() - lastNativeDropAt < 1000) return;
              // While a batch is running the drop zone shows progress instead;
              // ignore drops rather than interleaving two loops.
              if (busy) return;
              const dropped = Array.from(e.dataTransfer.files);
              if (dropped.length > 0) void handleFiles(dropped);
            }}
            className={`rounded-xl border border-dashed p-8 text-center transition-colors ${
              dragging ? "border-foreground bg-muted" : "border-border bg-secondary/40"
            }`}
          >
            {busy ? (
              <div className="space-y-3">
                <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
                <p className="text-sm font-medium capitalize">
                  {stageLabel(stage) || "Processing"}…
                </p>
                {current ? (
                  <p className="text-xs text-muted-foreground">
                    {current.total > 1 ? `File ${current.index} of ${current.total} — ` : null}
                    <span className="font-mono">{current.name}</span>
                  </p>
                ) : null}
                <Progress value={progress} className="h-1.5" />
                <p className="text-xs text-muted-foreground">
                  {stage.includes("template") || stage.includes("matching")
                    ? "Matched a known vendor — opening the draft."
                    : stage.includes("scanning") || stage.includes("layout")
                      ? "Reading the page layout on this device."
                      : "Reading the document on this device."}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <ScanLine className="mx-auto size-6 text-muted-foreground" />
                <p className="text-sm font-medium">Drag files here</p>
                <p className="text-xs text-muted-foreground">
                  PDF, PNG or JPG — up to 10 MB each, select as many as you like
                </p>
                <Button variant="outline" size="sm" onClick={() => void chooseFiles()}>
                  Choose files
                </Button>
              </div>
            )}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length > 0) void handleFiles(picked);
            e.target.value = "";
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
