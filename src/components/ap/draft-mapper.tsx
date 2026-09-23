/**
 * DraftMapper — the mapping screen from "Draft invoice mapping.md", in its
 * three-pane shape: document with zone overlays, triaged draft fields, and
 * the template preview. State and interactions live in `useDraftMapping`;
 * the sibling components render one pane or dialog each.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  Check,
  GraduationCap,
  Layers,
  MousePointerClick,
  Undo2,
} from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfidenceChip } from "./status";
import { ZoneCheckChip, resultFor } from "./zone-check-chip";
import { AnchorChip, AssignPopover } from "./assign-popover";
import { usePdfPageImage } from "./use-pdf-page-image";
import { isImageInvoice, isPdfInvoice } from "@/lib/ap/file-type";
import { useDraftMapping, type AssignmentsByField, type DraftFields } from "./use-draft-mapping";
import { useAp } from "@/lib/ap/store";
import {
  ZONE_FIELDS,
  ZONE_LABEL,
  money,
  type DriftInfo,
  type ExtractedField,
  type Invoice,
  type ZoneField,
  CURRENCY_OPTIONS,
  DEPARTMENTS,
} from "@/lib/ap/types";
import { buildQueue, type QueueField } from "@/lib/ap/draft-queue";
import { countOf } from "@/lib/ap/vocabulary";
import type { ProfileField, VendorMaster } from "@/lib/ap/vendor-master";
import { ReviewHeader } from "./review-header";
import { VendorProfileCard } from "./vendor-profile-card";

/** Stagger between successive extraction beats, ms. */
const BEAT_MS = 90;
/** How long after its zone flashes the form row lands, ms. */
const LAND_LAG_MS = 180;

/**
 * Reading-order beat index for the extraction reveal: fields with document
 * zones are ordered top-to-bottom, left-to-right (rows within ~2% of page
 * height read as one line); unmapped fields trail without a beat.
 */
function extractionBeats(
  assignments: AssignmentsByField,
  triageOrder: ZoneField[],
): Partial<Record<ZoneField, number>> {
  const ordered = triageOrder
    .filter((f) => assignments[f])
    .sort((a, b) => {
      const za = assignments[a]!.zone;
      const zb = assignments[b]!.zone;
      return Math.abs(za.y - zb.y) > 0.02 ? za.y - zb.y : za.x - zb.x;
    });
  const beats: Partial<Record<ZoneField, number>> = {};
  ordered.forEach((field, index) => {
    beats[field] = index;
  });
  return beats;
}

export function DraftMapper({ invoice, banner }: { invoice: Invoice; banner?: ReactNode }) {
  const { updateInvoice, vendors } = useAp();
  const [showVendorImprovement, setShowVendorImprovement] = useState(
    Boolean(invoice.templateDrift),
  );
  const mapping = useDraftMapping(invoice);
  const {
    words,
    fields,
    assignments,
    activeField,
    assignMode,
    pendingClickPoint,
    pendingSelection,
    isLineItemEditorOpen,
    triageStatuses,
    triageOrder,
    crossCheck,
    allFieldsVerified,
    mappedCount,
    validationIssues,
    blockingIssues,
  } = mapping;

  const storeProfile = vendors[invoice.vendor];
  const [profileDraft, setProfileDraft] = useState<VendorMaster>(() => ({
    name: invoice.vendor,
    email: storeProfile?.email ?? invoice.vendorEmail ?? "",
    logoUrl: storeProfile?.logoUrl,
    address: storeProfile?.address ?? invoice.address,
    iban: storeProfile?.iban ?? invoice.iban,
    vatNumber: storeProfile?.vatNumber ?? invoice.vatNumber,
    businessRegistrationNumber: storeProfile?.businessRegistrationNumber,
    updatedAt: storeProfile?.updatedAt ?? new Date().toISOString(),
  }));

  const [profileFocus, setProfileFocus] = useState<ProfileField | null>(null);
  const [acceptedKeys, setAcceptedKeys] = useState<string[]>([]);
  const revealBeats = useMemo(
    () => extractionBeats(assignments, triageOrder),
    [assignments, triageOrder],
  );
  const queueItems = useMemo(
    () =>
      buildQueue({
        blockingIssues,
        warningIssues: validationIssues.filter((i) => i.severity === "warning"),
        amberFields: triageOrder
          .filter((f) => triageStatuses[f] === "amber" && f !== "vendor")
          .map((f) => ({ field: f, label: ZONE_LABEL[f] })),
        crossCheckOk: crossCheck.ok,
        crossCheckDetail:
          crossCheck.detail ||
          `Lines sum ${money(crossCheck.sum, invoice.currency)} vs total ${money(invoice.total, invoice.currency)}.`,
        vendor: profileDraft,
      }).filter(
        (i) =>
          !acceptedKeys.includes(i.key) &&
          // Lines are approval's concern now: a totals mismatch must never
          // hold the Draft queue (and its Confirm button) hostage. The
          // FieldsPane status line still shows it; approval blocks on it.
          i.key !== "blocking:cross-check",
      ),
    [
      blockingIssues,
      validationIssues,
      triageOrder,
      triageStatuses,
      crossCheck,
      invoice.currency,
      invoice.total,
      profileDraft,
      acceptedKeys,
    ],
  );
  const isImageFile = isImageInvoice(invoice.fileType, invoice.fileName) && !!invoice.fileUrl;
  const pdfBlobUrl = usePdfPageImage(
    invoice.fileUrl,
    invoice.fileType,
    Boolean(words && words.length > 0),
    invoice.fileName,
  );
  /** True when there is an <img> we can click on to map fields. */
  const canShowDocument = isImageFile || Boolean(pdfBlobUrl);
  /** True when the PDF rasterizer ran and failed — show an explicit error. */
  const renderFailed = pdfBlobUrl === null;
  const imgSrc = isImageFile ? invoice.fileUrl : (pdfBlobUrl ?? undefined);

  const focusFirstBlockingIssue = () => {
    const issue = blockingIssues[0];
    if (!issue) {
      const firstAmberField = triageOrder.find((field) => triageStatuses[field] === "amber");
      if (firstAmberField) {
        mapping.focusField(firstAmberField);
        if (firstAmberField === "vendor") {
          setProfileFocus("name");
          return;
        }
        const row = document.querySelector(`[data-draft-field="${firstAmberField}"]`);
        requestAnimationFrame(() => {
          (row?.querySelector("input") as HTMLInputElement | null)?.focus();
        });
        return;
      }
      mapping.confirmChoice({ profile: profileDraft });
      return;
    }

    if (issue.code === "missing_currency" || issue.code === "invalid_currency") {
      (document.querySelector('[aria-label="Currency"]') as HTMLElement | null)?.focus();
      return;
    }
    if (issue.code === "missing_coding") {
      (document.querySelector('[aria-label="Department"]') as HTMLElement | null)?.focus();
      return;
    }

    const fieldByIssue: Record<string, ExtractedField> = {
      missing_vendor: "vendor",
      missing_invoice_number: "invoiceNumber",
      missing_issue_date: "issueDate",
      invalid_issue_date: "issueDate",
      missing_due_date: "dueDate",
      invalid_due_date: "dueDate",
      missing_total: "total",
      invalid_total: "total",
      line_total_mismatch: "total",
    };
    const field = fieldByIssue[issue.code];
    if (!field) return;
    mapping.focusField(field);
    if (field === "vendor") {
      setProfileFocus("name");
      return;
    }
    const row = document.querySelector(`[data-draft-field="${field}"]`);
    requestAnimationFrame(() => {
      (row?.querySelector("input") as HTMLInputElement | null)?.focus();
    });
  };

  const handleFieldEdit = (field: ExtractedField, value: string) => {
    mapping.editDraftValue(field, value);
  };

  const focusQueueField = (field: QueueField) => {
    if (field === "currency") {
      (document.querySelector('[aria-label="Currency"]') as HTMLElement | null)?.focus();
      return;
    }
    if (field === "department") {
      (document.querySelector('[aria-label="Department"]') as HTMLElement | null)?.focus();
      return;
    }
    mapping.focusField(field);
    if (field === "vendor") setProfileFocus("name");
  };

  const handleQueueFocusField = (field: QueueField) => {
    focusQueueField(field);
  };

  const handleQueueShowOnDocument = (field: QueueField) => {
    focusQueueField(field);
    if (field === "currency" || field === "department") return;
    document
      .querySelector("[data-draft-document]")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const handleQueueAccept = (field: QueueField) => {
    if (field !== "currency" && field !== "department") {
      mapping.focusField(field);
    } else {
      focusQueueField(field);
    }
    const keys = queueItems.filter((i) => i.field === field).map((i) => i.key);
    if (keys.length > 0) {
      setAcceptedKeys((prev) => [...prev, ...keys.filter((k) => !prev.includes(k))]);
    }
    toast.success("Marked as verified against the document");
  };

  const handleQueueFocusProfileField = (field: ProfileField) => {
    setProfileFocus(field);
  };

  return (
    <>
      <ReviewHeader
        invoice={invoice}
        queueItems={queueItems}
        onFocusField={(f) => handleQueueFocusField(f as QueueField)}
        onAcceptField={(f) => handleQueueAccept(f as QueueField)}
      />

      <div className="mt-4 space-y-4">
        {banner}
        {invoice.templateHold && <TemplateHoldBanner vendor={invoice.vendor} />}
        {invoice.templateDrift && (
          <DriftBanner vendor={invoice.vendor} drift={invoice.templateDrift} />
        )}

        <div className="grid gap-5 lg:grid-cols-[1.1fr_minmax(0,1fr)]">
          <DocumentPane
            invoice={invoice}
            assignments={assignments}
            activeField={activeField}
            assignMode={assignMode}
            pendingClickPoint={pendingClickPoint}
            pendingSelection={pendingSelection}
            canShowDocument={canShowDocument}
            imgSrc={imgSrc}
            renderFailed={renderFailed}
            setScrollContainer={mapping.setScrollContainer}
            setDocumentImage={mapping.setDocumentImage}
            onToggleAssignMode={mapping.toggleAssignMode}
            onDocumentPointerDown={mapping.handleDocumentPointerDown}
            onDocumentPointerMove={mapping.handleDocumentPointerMove}
            onDocumentPointerUp={mapping.handleDocumentPointerUp}
            onAssignPendingClick={mapping.assignPendingClickTo}
            onDismissPendingClick={mapping.dismissPendingClick}
            onFocusField={mapping.focusField}
            vendorImprovementOpen={showVendorImprovement || Boolean(invoice.templateDrift)}
            mappedCount={mappedCount}
            canUndo={mapping.undoStack.length > 0}
            onUndo={mapping.undoLastAssignment}
            revealBeats={revealBeats}
          />

          <div className="space-y-4">
            <VendorProfileCard
              vendor={profileDraft}
              onChange={(field, value) => {
                setProfileDraft((p) => ({ ...p, [field]: value }));
                if (field === "name") handleFieldEdit("vendor", value);
              }}
              focusField={profileFocus}
              onFocusDone={() => setProfileFocus(null)}
            />
            <FieldsPane
              invoice={invoice}
              fields={fields}
              assignments={assignments}
              triageStatuses={triageStatuses}
              triageOrder={triageOrder.filter((f) => f !== "vendor")}
              activeField={activeField}
              crossCheck={crossCheck}
              currency={invoice.currency}
              onCurrencyChange={(value) =>
                updateInvoice(
                  invoice.id,
                  { currency: value },
                  "Corrected currency",
                  "Human correction during draft review",
                )
              }
              department={invoice.department}
              onDepartmentChange={(value) =>
                updateInvoice(
                  invoice.id,
                  { department: value },
                  "Corrected department",
                  "Human correction during draft review",
                )
              }
              onFocusField={mapping.focusField}
              onEditValue={handleFieldEdit}
              showVendorImprovement={showVendorImprovement || Boolean(invoice.templateDrift)}
              revealBeats={revealBeats}
            />
            <ConfirmActions
              vendorName={fields.vendor || invoice.vendor}
              allFieldsVerified={allFieldsVerified}
              validationIssues={validationIssues}
              blockingIssues={blockingIssues}
              onOpenConfirm={focusFirstBlockingIssue}
              queueEmpty={queueItems.length === 0}
              onConfirm={() => mapping.confirmChoice({ profile: profileDraft })}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function TemplateHoldBanner({ vendor }: { vendor: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm">
      <GraduationCap className="mt-0.5 size-4 text-accent-foreground" />
      <p className="text-accent-foreground">
        Template draft — {vendor} has a saved template, but asked to double-check the first
        extractions. Confirm below to keep the learning loop honest.
      </p>
    </div>
  );
}

type DriftChipTone = "text" | "model" | "missing";

const DRIFT_CHIP_CLASS: Record<DriftChipTone, string> = {
  text: "bg-success/15 text-success-foreground",
  model: "bg-warning/15 text-warning-foreground",
  missing: "bg-muted text-muted-foreground",
};

/**
 * Drift banner — what the template missed and how each field came back. The
 * text scan is the safer recovery (it re-reads the printed value); a field the
 * model recovered without a template anchor is called out so a person checks it.
 */
function DriftBanner({ vendor, drift }: { vendor: string; drift: DriftInfo }) {
  const fromText = drift.missing.filter((field) => drift.recoveredBy[field] === "ocr");
  const fromModel = drift.missing.filter((field) => drift.recoveredBy[field] === "vlm");
  const stillMissing = drift.missing.filter((field) => drift.recoveredBy[field] === undefined);
  const recoveredCount = fromText.length + fromModel.length;

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <div className="flex items-start gap-2">
        <Layers className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
        <p className="text-warning-foreground">
          {vendor} changed their layout — the template missed{" "}
          {countOf(drift.missing.length, "field")}
          {recoveredCount > 0
            ? `, and we read ${recoveredCount} of them from the document again.`
            : "."}
        </p>
      </div>

      <div className="mt-3 space-y-2.5 pl-6">
        {fromText.length > 0 && (
          <DriftGroup label="Read again from the document text" tone="text" fields={fromText} />
        )}
        {fromModel.length > 0 && (
          <DriftGroup
            label="Read by the model — check these against the document"
            tone="model"
            fields={fromModel}
          />
        )}
        {stillMissing.length > 0 && (
          <DriftGroup label="Still to map" tone="missing" fields={stillMissing} />
        )}
      </div>

      <p className="mt-3 pl-6 text-xs text-warning-foreground">
        Confirm below to update {vendor}&apos;s template.
      </p>
    </div>
  );
}

function DriftGroup({
  label,
  tone,
  fields,
}: {
  label: string;
  tone: DriftChipTone;
  fields: ZoneField[];
}) {
  return (
    <div>
      <p className="text-xs text-warning-foreground">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {fields.map((field) => (
          <span
            key={field}
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${DRIFT_CHIP_CLASS[tone]}`}
          >
            {ZONE_LABEL[field]}
          </span>
        ))}
      </div>
    </div>
  );
}

function DocumentPane({
  invoice,
  assignments,
  activeField,
  assignMode,
  pendingClickPoint,
  pendingSelection,
  canShowDocument,
  imgSrc,
  renderFailed,
  setScrollContainer,
  setDocumentImage,
  onToggleAssignMode,
  onDocumentPointerDown,
  onDocumentPointerMove,
  onDocumentPointerUp,
  onAssignPendingClick,
  onDismissPendingClick,
  onFocusField,
  vendorImprovementOpen,
  mappedCount,
  canUndo,
  onUndo,
  revealBeats,
}: {
  invoice: Invoice;
  assignments: AssignmentsByField;
  activeField: ExtractedField | null;
  assignMode: boolean;
  pendingClickPoint: { x: number; y: number } | null;
  pendingSelection: { x: number; y: number; w: number; h: number } | null;
  /** True when there is a rasterized <img> we can overlay and click on. */
  canShowDocument: boolean;
  /** Blob URL of the rasterized page — either the image itself or the rendered PDF page 1. */
  imgSrc: string | undefined;
  /** `null` when the PDF rasterizer attempted a render and failed. */
  renderFailed: boolean;
  setScrollContainer: (node: HTMLDivElement | null) => void;
  setDocumentImage: (node: HTMLImageElement | null) => void;
  onToggleAssignMode: () => void;
  onDocumentPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDocumentPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDocumentPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onAssignPendingClick: (field: ZoneField) => void;
  onDismissPendingClick: () => void;
  onFocusField: (field: ExtractedField) => void;
  vendorImprovementOpen: boolean;
  mappedCount: number;
  canUndo: boolean;
  onUndo: () => void;
  revealBeats: Partial<Record<ZoneField, number>>;
}) {
  return (
    <section
      data-draft-document
      className="self-start overflow-hidden rounded-lg border border-border bg-card lg:sticky lg:top-2"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-xs font-medium  text-muted-foreground">Document</p>
        {vendorImprovementOpen && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {mappedCount}/{ZONE_FIELDS.length} mapped
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={!canUndo}
              onClick={onUndo}
              title="Undo last mapping (⌘Z)"
            >
              <Undo2 className="size-3.5" /> Undo
            </Button>
            <Button
              size="sm"
              variant={assignMode ? "default" : "outline"}
              disabled={!canShowDocument}
              onClick={onToggleAssignMode}
              title={
                canShowDocument
                  ? "Draw a box around a value"
                  : "Assign mode needs a rendered preview"
              }
            >
              <MousePointerClick className="size-3.5" />
              {assignMode ? "Draw around a value…" : "Draw a value box"}
            </Button>
          </div>
        )}
      </div>

      <div
        ref={setScrollContainer}
        className={`max-h-[640px] overflow-auto p-4 ${assignMode ? "touch-none select-none" : ""}`}
        onPointerDown={canShowDocument ? onDocumentPointerDown : undefined}
        onPointerMove={canShowDocument ? onDocumentPointerMove : undefined}
        onPointerUp={canShowDocument ? onDocumentPointerUp : undefined}
        onPointerCancel={canShowDocument ? onDocumentPointerUp : undefined}
      >
        <div className="relative mx-auto w-fit">
          {canShowDocument && imgSrc ? (
            <img
              ref={setDocumentImage}
              src={imgSrc}
              alt={invoice.fileName ?? "Invoice"}
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              className={`block max-w-full select-none rounded-lg border border-border  ${assignMode ? "cursor-crosshair" : ""}`}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-secondary/40 p-8 text-center text-sm text-muted-foreground">
              {isPdfInvoice(invoice.fileType, invoice.fileName) && invoice.fileUrl
                ? renderFailed
                  ? "PDF preview failed to render — the extracted fields below are unaffected."
                  : "Rendering the first page…"
                : "Document preview unavailable — mapping overlay needs a supported file type. Fields can still be confirmed from the list."}
            </div>
          )}

          {ZONE_FIELDS.map((field) => {
            const assignment = assignments[field];
            if (!assignment) return null;
            const isActive = activeField === field;
            return (
              <button
                key={field}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onFocusField(field);
                }}
                className={`absolute rounded-sm border-2 transition-shadow ${
                  isActive
                    ? "z-10 border-accent bg-accent/25 shadow-[0_0_0_4px] shadow-accent/20"
                    : "border-accent/50 bg-accent/10 hover:bg-accent/20"
                } animate-zone-flash`}
                style={{
                  left: `${assignment.zone.x * 100}%`,
                  top: `${assignment.zone.y * 100}%`,
                  width: `${assignment.zone.w * 100}%`,
                  height: `${assignment.zone.h * 100}%`,
                  animationDelay: `${(revealBeats[field] ?? 0) * BEAT_MS}ms`,
                }}
                title={`${ZONE_LABEL[field]}${assignment.anchor ? ` · anchor “${assignment.anchor}”` : ""}`}
              >
                <span className="absolute -top-0.5 left-1 text-xs font-medium  text-accent-foreground">
                  {ZONE_LABEL[field]}
                </span>
              </button>
            );
          })}

          {pendingSelection && (
            <span
              className="pointer-events-none absolute z-20 border-2 border-accent bg-accent/20"
              style={{
                left: `${pendingSelection.x * 100}%`,
                top: `${pendingSelection.y * 100}%`,
                width: `${pendingSelection.w * 100}%`,
                height: `${pendingSelection.h * 100}%`,
              }}
            />
          )}

          {pendingClickPoint && (
            <span
              className="pointer-events-none absolute z-20 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-accent/40"
              style={{
                left: `${pendingClickPoint.x * 100}%`,
                top: `${pendingClickPoint.y * 100}%`,
              }}
            />
          )}
        </div>
      </div>

      {pendingClickPoint && (
        <AssignPopover onAssign={onAssignPendingClick} onCancelSelection={onDismissPendingClick} />
      )}
    </section>
  );
}
function FieldsPane({
  invoice,
  fields,
  assignments,
  triageStatuses,
  triageOrder,
  activeField,
  crossCheck,
  currency,
  onCurrencyChange,
  department,
  onDepartmentChange,
  onFocusField,
  onEditValue,
  showVendorImprovement,
  revealBeats,
}: {
  invoice: Invoice;
  fields: DraftFields;
  assignments: AssignmentsByField;
  triageStatuses: Record<ZoneField, "amber" | "green">;
  triageOrder: ZoneField[];
  activeField: ExtractedField | null;
  crossCheck: { ok: boolean; sum: number; detail: string };
  currency: string;
  onCurrencyChange: (value: string) => void;
  department: string;
  onDepartmentChange: (value: string) => void;
  onFocusField: (field: ExtractedField) => void;
  onEditValue: (field: ExtractedField, value: string) => void;
  showVendorImprovement: boolean;
  revealBeats: Partial<Record<ZoneField, number>>;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-xs font-medium  text-muted-foreground">Draft fields</p>
      </div>

      <div className="grid gap-3 border-b border-border px-4 py-3 sm:grid-cols-2">
        <CurrencySelect value={currency} onChange={onCurrencyChange} />
        <DepartmentSelect value={department} onChange={onDepartmentChange} />
      </div>

      <div className="divide-y divide-border">
        {(() => {
          const dateFields = triageOrder.filter(
            (f): f is "issueDate" | "dueDate" => f === "issueDate" || f === "dueDate",
          );
          const otherFields = triageOrder.filter((f) => f !== "issueDate" && f !== "dueDate");
          // Subtotal + Tax side by side so the eye reads the equation;
          // Total follows full-width directly below.
          const moneyPair = (["subtotal", "tax"] as const).filter((f) => otherFields.includes(f));
          const rest = otherFields.filter((f) => f !== "subtotal" && f !== "tax");
          const row = (field: ZoneField) => (
            <FieldRow
              key={field}
              invoice={invoice}
              field={field}
              value={fields[field]}
              assignment={assignments[field]}
              status={triageStatuses[field]}
              isActive={activeField === field}
              onFocus={() => onFocusField(field)}
              onEdit={(value) => onEditValue(field, value)}
              showVendorImprovement={showVendorImprovement}
              revealBeat={revealBeats[field]}
            />
          );
          return (
            <>
              {dateFields.length > 0 && (
                <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
                  {dateFields.map((field) => (
                    <FieldRow
                      key={field}
                      invoice={invoice}
                      field={field}
                      value={fields[field]}
                      assignment={assignments[field]}
                      status={triageStatuses[field]}
                      isActive={activeField === field}
                      onFocus={() => onFocusField(field)}
                      onEdit={(value) => onEditValue(field, value)}
                      showVendorImprovement={showVendorImprovement}
                      revealBeat={revealBeats[field]}
                    />
                  ))}
                </div>
              )}
              {moneyPair.length > 0 && (
                <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
                  {moneyPair.map((field) => row(field))}
                </div>
              )}
              {rest.map((field) => row(field))}
            </>
          );
        })()}
      </div>

      <div className="border-t border-border px-4 py-2.5">
        {/* Lines are checked at approval — Draft shows a quiet status only. */}
        <p
          className={`text-xs ${crossCheck.ok ? "text-muted-foreground" : "font-medium text-warning-foreground"}`}
          role="status"
        >
          {crossCheck.ok
            ? `Lines ${money(crossCheck.sum, invoice.currency)} reconcile ✓`
            : `${crossCheck.detail} Flagged for approval.`}
        </p>
      </div>
    </section>
  );
}

function CurrencySelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1.5">
      <span className="block text-xs font-medium text-muted-foreground">Currency</span>
      <Select {...(value ? { value } : {})} onValueChange={onChange}>
        <SelectTrigger aria-label="Currency" className="h-10 font-mono">
          <SelectValue placeholder="Choose currency" />
        </SelectTrigger>
        <SelectContent>
          {CURRENCY_OPTIONS.map(({ code, label }) => (
            <SelectItem key={code} value={code}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function DepartmentSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5">
      <span className="block text-xs font-medium text-muted-foreground">Department</span>
      <Select {...(value ? { value } : {})} onValueChange={onChange}>
        <SelectTrigger aria-label="Department" className="h-8">
          <SelectValue placeholder="Choose department" />
        </SelectTrigger>
        <SelectContent>
          {DEPARTMENTS.map((department) => (
            <SelectItem key={department} value={department}>
              {department}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function FieldRow({
  invoice,
  field,
  value,
  assignment,
  status,
  isActive,
  onFocus,
  onEdit,
  showVendorImprovement,
  revealBeat,
}: {
  invoice: Invoice;
  field: ZoneField;
  value: string;
  assignment: { anchor?: string | undefined } | undefined;
  status: "amber" | "green";
  isActive: boolean;
  onFocus: () => void;
  onEdit: (value: string) => void;
  showVendorImprovement: boolean;
  /** Extraction-reveal beat: row lands this many beats after the zone flashes. */
  revealBeat?: number | undefined;
}) {
  const landDelayMs = (revealBeat ?? 0) * BEAT_MS + LAND_LAG_MS;
  const isDate = field === "issueDate" || field === "dueDate";
  const needsAttention = status === "amber";

  return (
    <div
      data-draft-field={field}
      className={`px-4 py-3 transition-colors animate-field-land ${isActive ? "bg-accent/5" : ""} ${needsAttention ? "bg-warning/[0.04]" : ""}`}
      style={{ animationDelay: `${landDelayMs}ms` }}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left"
          onClick={onFocus}
        >
          {needsAttention ? (
            <span className="size-2 shrink-0 rounded-full bg-warning" title="Needs attention" />
          ) : (
            <Check className="size-3.5 shrink-0 text-success-foreground" />
          )}
          <span className="text-xs font-medium text-muted-foreground">{ZONE_LABEL[field]}</span>
        </button>
        <div className="flex items-center gap-1.5">
          {showVendorImprovement && assignment?.anchor ? (
            <AnchorChip anchor={assignment.anchor} />
          ) : null}
          <ZoneCheckChip result={resultFor(invoice.zoneCheck, field)} />
          <ConfidenceChip value={invoice.confidence[field]} />
        </div>
      </div>

      <div className="mt-1.5">
        {isDate ? (
          <DraftDatePicker value={value} onEdit={onEdit} onFocus={onFocus} />
        ) : (
          <Input
            className="h-10 font-mono text-sm"
            value={value}
            placeholder={
              assignment ? "click the value in the document" : "no value — map it from the document"
            }
            onChange={(event) => onEdit(event.target.value)}
            onFocus={onFocus}
          />
        )}
      </div>
    </div>
  );
}

/** YYYY-MM-DD → localized display, or a hint when no date is set. */
function displayDate(value: string): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

/** Calendar picker for draft date fields — one click opens, one click sets. */
function DraftDatePicker({
  value,
  onEdit,
  onFocus,
}: {
  value: string;
  onEdit: (value: string) => void;
  onFocus: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onFocus();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-between px-4 font-mono text-sm font-normal"
        >
          <span className={value ? "" : "font-sans italic text-muted-foreground"}>
            {displayDate(value) || "pick a date"}
          </span>
          <CalendarDays className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected && !Number.isNaN(selected.getTime()) ? selected : undefined}
          onSelect={(date) => {
            if (!date) return;
            const pad = (n: number) => String(n).padStart(2, "0");
            onEdit(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function ConfirmActions({
  vendorName,
  allFieldsVerified,
  validationIssues,
  blockingIssues,
  onOpenConfirm,
  queueEmpty,
  onConfirm,
}: {
  vendorName: string;
  allFieldsVerified: boolean;
  validationIssues: Array<{ code: string; message: string; severity: "error" | "warning" }>;
  blockingIssues: Array<{ code: string; message: string; severity: "error" | "warning" }>;
  onOpenConfirm: () => void;
  queueEmpty: boolean;
  onConfirm: () => void;
}) {
  const needsAttention = validationIssues.length > 0 || !allFieldsVerified;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            {blockingIssues.length > 0
              ? `${countOf(blockingIssues.length, "issue")} must be fixed`
              : allFieldsVerified
                ? "Ready to confirm"
                : "Review the highlighted fields"}
          </p>
        </div>
        {allFieldsVerified ? <BadgeCheck className="size-5 text-success-foreground" /> : null}
      </div>
      {needsAttention && (
        <div className="mt-3 space-y-1.5 rounded-lg border border-warning/30 bg-warning/10 p-3">
          {validationIssues.map((issue) => (
            <p key={issue.code} className="flex items-start gap-2 text-xs text-warning-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {issue.message}
            </p>
          ))}
          {!validationIssues.length && (
            <p className="text-xs text-warning-foreground">
              Check the amber fields against the document before confirming.
            </p>
          )}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          onClick={queueEmpty ? onConfirm : onOpenConfirm}
          title={
            queueEmpty
              ? "All fields verified — continue to approval"
              : "Jump to the first issue that needs attention"
          }
        >
          <BadgeCheck className="size-4" /> {queueEmpty ? "Confirm invoice" : "Review next issue"}
        </Button>
      </div>
    </section>
  );
}
