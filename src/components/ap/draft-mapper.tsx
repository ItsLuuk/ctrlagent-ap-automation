/**
 * DraftMapper — the mapping screen from "Draft invoice mapping.md", in its
 * three-pane shape: document with zone overlays, triaged draft fields, and
 * the template preview. State and interactions live in `useDraftMapping`;
 * the sibling components render one pane or dialog each.
 *
 * It runs in two stages. In Profiling it is a first-time vendor: the vendor
 * profile card in the fields pane pins the identity, and one confirm saves the
 * profile, learns the template, and sends the invoice to For approval. In Draft
 * the vendor is known and only the template needs confirming.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronRight,
  CircleSlash,
  GraduationCap,
  Layers,
  MousePointerClick,
  Search,
  Undo2,
  X,
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
import { cn } from "@/lib/utils";
import type { ValueLocation } from "@/lib/ap/mapping";
import { AssignPopover } from "./assign-popover";
import { usePdfPageImage } from "./use-pdf-page-image";
import { isImageInvoice, isPdfInvoice } from "@/lib/ap/file-type";
import {
  useDraftMapping,
  type Assignment,
  type AssignmentsByField,
  type DraftFields,
} from "./use-draft-mapping";
import { useAp } from "@/lib/app/store";
import {
  MAPPING_FIELDS,
  ZONE_LABEL,
  money,
  type DriftInfo,
  type ExtractedField,
  type Invoice,
  type ZoneField,
  type Zone,
  CURRENCY_OPTIONS,
  DEPARTMENTS,
} from "@/lib/ap/types";
import { buildQueue, type QueueField } from "@/lib/ap/draft-queue";
import {
  notableFor,
  type AttentionReason,
  type FieldAttention,
} from "@/lib/ap/use-cases/draft-triage";
import { trackRecordLine, vendorTrackRecord } from "@/lib/ap/use-cases/vendor-track-record";
import { totalsCrossCheck } from "@/lib/ap/mapping";
import { countOf } from "@/lib/ap/vocabulary";
import type { ProfileField, VendorMaster } from "@/lib/ap/vendor-master";
import { vendorProfileFromMapping } from "@/lib/ap/vendor-master";
import { ReviewHeader } from "./review-header";
import { RemoveFromQueue } from "./remove-from-queue";
import { VendorProfileCard } from "./vendor-profile-card";
import { requiresVendorBankApproval } from "@/lib/ap/vendor-bank-changes";
import { CRITICAL_MAPPING_FIELDS } from "@/lib/ap/mapping-proposals";
import type { ResizeDirection } from "@/lib/ap/mapping";
import { IDENTITY_FIELDS } from "@/lib/ap/mapping";

/**
 * The number each linked region wears on the document: its position among the
 * fields that have one. The list and the page both read it from here, so the
 * badge in a row is the badge on the page.
 */
function regionNumbers(
  assignments: AssignmentsByField,
): Partial<Record<ZoneField, number>> {
  const out: Partial<Record<ZoneField, number>> = {};
  let count = 0;
  for (const field of MAPPING_FIELDS) {
    if (!assignments[field]) continue;
    count += 1;
    out[field] = count;
  }
  return out;
}

/** The vendor-record value each identity row would write. */
const IDENTITY_PROFILE_FIELD: Partial<Record<ZoneField, ProfileField>> = {
  vendor: "name",
  address: "address",
  vendorEmail: "email",
  iban: "iban",
  vatNumber: "vatNumber",
  businessRegistrationNumber: "businessRegistrationNumber",
};

/** Stagger between successive extraction beats, ms. */
const BEAT_MS = 90;
/** How long after its zone flashes the form row lands, ms. */
const LAND_LAG_MS = 180;

const RESIZE_HANDLES: ReadonlyArray<{
  direction: ResizeDirection;
  className: string;
  label: string;
}> = [
  { direction: "n", className: "-left-1/2 -top-2 h-4 w-8 -translate-x-1/2", label: "top edge" },
  {
    direction: "s",
    className: "-bottom-2 -left-1/2 h-4 w-8 -translate-x-1/2",
    label: "bottom edge",
  },
  { direction: "w", className: "-left-2 top-1/2 h-4 w-4 -translate-y-1/2", label: "left edge" },
  { direction: "e", className: "-right-2 top-1/2 h-4 w-4 -translate-y-1/2", label: "right edge" },
  { direction: "nw", className: "-left-1.5 -top-1.5 size-3", label: "top-left corner" },
  { direction: "ne", className: "-right-1.5 -top-1.5 size-3", label: "top-right corner" },
  { direction: "sw", className: "-bottom-1.5 -left-1.5 size-3", label: "bottom-left corner" },
  { direction: "se", className: "-bottom-1.5 -right-1.5 size-3", label: "bottom-right corner" },
];

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
  const { updateInvoice, vendors, invoices } = useAp();
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
    proposalCount,
    unconfirmedProposalCount,
    unconfirmedCriticalFields,
    isMappingConfirmed,
    validationIssues,
    blockingIssues,
    absentFields,
    attention,
    settleable,
  } = mapping;

  /**
   * Why this invoice is not like the last one, and what this vendor's template
   * has already saved. Two lines of context above the work, because a screen
   * that looks the same every time teaches people the work never changes.
   */
  const notable = useMemo(
    () =>
      notableFor(invoice, {
        profiling: mapping.profiling,
        hasTemplate: Boolean(mapping.existingTemplate),
        attention,
        totalsOk: crossCheck.ok,
      }),
    [invoice, mapping.profiling, mapping.existingTemplate, attention, crossCheck.ok],
  );
  const trackRecord = useMemo(
    () => trackRecordLine(vendorTrackRecord(invoices, invoice)),
    [invoices, invoice],
  );

  const storeProfile = vendors[invoice.vendor];
  /** First-time vendor: the identity is being mapped, not typed into a form. */
  const profiling = mapping.profiling;
  const [profileDraftState, setProfileDraft] = useState<VendorMaster>(() => ({
    name: invoice.vendor,
    email: storeProfile?.email ?? invoice.vendorEmail ?? "",
    logoUrl: storeProfile?.logoUrl,
    address: storeProfile?.address ?? invoice.address,
    iban: storeProfile?.iban ?? invoice.iban,
    vatNumber: storeProfile?.vatNumber ?? invoice.vatNumber,
    // Seeded from the invoice like every other identity value: a registration
    // number mapped in Profiling is on the record, and a card that showed it
    // blank would read as "missing" on a known vendor.
    businessRegistrationNumber:
      storeProfile?.businessRegistrationNumber ?? invoice.businessRegistrationNumber,
    updatedAt: storeProfile?.updatedAt ?? new Date().toISOString(),
  }));
  /**
   * What the vendor record would be if the invoice were confirmed now. While
   * profiling that is derived from the mapped values — the same rows the
   * operator is looking at — so the gate below, the queue and the record that
   * gets written all read one source. In Draft the card is still a form, so
   * its own state is the truth.
   */
  const profileDraft = useMemo(
    () => (profiling ? vendorProfileFromMapping(invoice, storeProfile) : profileDraftState),
    [profiling, invoice, storeProfile, profileDraftState],
  );

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
          .filter(
            (f) =>
              triageStatuses[f] === "amber" &&
              // In Draft the vendor name is edited in the profile card, so it
              // would only be a second thing to go look at. Profiling has no
              // card — every amber field is a row on this screen.
              (profiling || f !== "vendor"),
          )
          .map((f) => ({ field: f, label: ZONE_LABEL[f] })),
        crossCheckOk: crossCheck.ok,
        crossCheckDetail:
          crossCheck.detail ||
          `Lines sum ${money(crossCheck.sum, invoice.currency)} vs total ${money(invoice.total, invoice.currency)}.`,
        /** In draft scope a totals mismatch is a warning the processor can dismiss
         *  (it may be a discount the line items don't capture) — it must not block
         *  the Confirm button. Approval owns content blocking. */
        crossCheckKind: "warning",
        vendor: profileDraft,
      }).filter(
        (i) =>
          !acceptedKeys.includes(i.key) &&
          // Lines are approval's concern now: a totals mismatch must never
          // hold the Draft queue (and its Confirm button) hostage. The
          // FieldsPane status line still shows it; approval blocks on it.
          !i.key.endsWith(":cross-check"),
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
      profiling,
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

  // Escape stands down from a link-in-progress, wherever focus happens to be:
  // a half-armed gesture that can only be left one particular way is a trap.
  useEffect(() => {
    if (!activeField) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        mapping.setActiveField(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeField, mapping]);

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

  /**
   * Where the value was found, when the page prints it more than once. Held
   * here rather than in the hook because choosing between two places is the
   * screen's question, not the document's.
   */
  const [candidates, setCandidates] = useState<Partial<Record<ZoneField, ValueLocation[]>>>({});

  const handleFindValue = (field: ZoneField, chosen?: ValueLocation) => {
    const outcome = mapping.findValueOnPage(field, chosen);
    setCandidates((current) => {
      if (outcome.status !== "ambiguous") {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      }
      return { ...current, [field]: outcome.options };
    });
  };

  /**
   * Agreeing one proposed box: the row's own version of the queue's "accept",
   * for the reviewer who is looking at that row and nothing else.
   */
  const handleConfirmField = (field: ZoneField) => {
    mapping.confirmMapping(field);
    toast.success(`${ZONE_LABEL[field]} checked`, {
      description: "The box beside it is now part of what we remember.",
    });
  };

  /**
   * Agree every field the machine is sure about, in one press. What is left on
   * the worklist afterwards is the part that was genuinely undecided, which is
   * the only part worth a person's attention.
   */
  const handleConfirmSettleable = () => mapping.confirmFields(settleable);

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
      if (unconfirmedCriticalFields.includes(field)) {
        mapping.confirmMapping(field);
      }
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

  const showMappingTools =
    showVendorImprovement || Boolean(invoice.templateDrift) || proposalCount > 0 || mappedCount > 0;

  return (
    <>
      <ReviewHeader
        invoice={invoice}
        removeAction={null}
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
            onDocumentPointerCancel={mapping.handleDocumentPointerCancel}
            onResizePointerDown={mapping.handleResizePointerDown}
            onResizeKeyDown={mapping.handleResizeKeyDown}
            onRemoveMapping={mapping.removeAssignment}
            onAssignPendingClick={mapping.assignPendingClickTo}
            onDismissPendingClick={mapping.dismissPendingClick}
            onFocusField={mapping.focusField}
            isMappingConfirmed={isMappingConfirmed}
            vendorImprovementOpen={showMappingTools}
            proposalCount={proposalCount}
            unconfirmedProposalCount={unconfirmedProposalCount}
            mappedCount={mappedCount}
            canUndo={mapping.undoStack.length > 0}
            onUndo={mapping.undoLastAssignment}
            revealBeats={revealBeats}
            removeAction={<RemoveFromQueue invoice={invoice} />}
          />

          <div className="space-y-4">
            {/* Profiling has no profile form: the identity is mapped from the
                document like everything else, and the record is derived from
                those values. The card stays for Draft, where a known vendor's
                identity is corrected rather than discovered. */}
            {profiling ? null : (
              <VendorProfileCard
                vendor={profileDraft}
                onChange={(field, value) => {
                  setProfileDraft((p) => ({ ...p, [field]: value }));
                  if (field === "name") handleFieldEdit("vendor", value);
                }}
                focusField={profileFocus}
                onFocusDone={() => setProfileFocus(null)}
              />
            )}
            <FieldsPane
              invoice={invoice}
              fields={fields}
              assignments={assignments}
              absentFields={absentFields}
              candidates={candidates}
              attention={attention}
              settleable={settleable}
              notable={notable}
              trackRecord={trackRecord}
              onConfirmAll={handleConfirmSettleable}
              triageOrder={
                profiling ? triageOrder : triageOrder.filter((f) => f !== "vendor")
              }
              activeField={activeField}
              onFindValue={handleFindValue}
              onConfirmField={handleConfirmField}
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
  const fromText = drift.missing.filter((field) => drift.recoveredBy[field] === "text");
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
  onDocumentPointerCancel,
  onResizePointerDown,
  onResizeKeyDown,
  onRemoveMapping,
  onAssignPendingClick,
  onDismissPendingClick,
  onFocusField,
  isMappingConfirmed,
  vendorImprovementOpen,
  proposalCount,
  unconfirmedProposalCount,
  mappedCount,
  canUndo,
  onUndo,
  revealBeats,
  removeAction,
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
  onDocumentPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (
    event: React.PointerEvent<HTMLButtonElement>,
    field: ZoneField,
    direction: ResizeDirection,
  ) => void;
  onResizeKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    field: ZoneField,
    direction: ResizeDirection,
  ) => boolean;
  /** Drops one source region from the mapping. */
  onRemoveMapping: (field: ZoneField) => void;
  onAssignPendingClick: (field: ZoneField) => void;
  onDismissPendingClick: () => void;
  onFocusField: (field: ExtractedField) => void;
  isMappingConfirmed: (field: ZoneField) => boolean;
  vendorImprovementOpen: boolean;
  proposalCount: number;
  unconfirmedProposalCount: number;
  mappedCount: number;
  canUndo: boolean;
  onUndo: () => void;
  revealBeats: Partial<Record<ZoneField, number>>;
  /** The record-level removal control, kept to the right of the draw tool. */
  removeAction?: ReactNode;
}) {
  const [announcement, setAnnouncement] = useState("");
  const [documentSize, setDocumentSize] = useState({ width: 0, height: 0 });
  const selectedMappingField = activeField ? (activeField as ZoneField) : null;
  const numberedFields = MAPPING_FIELDS.filter((field) => Boolean(assignments[field]));
  const numbers = regionNumbers(assignments);
  const selectedNumber = selectedMappingField
    ? numberedFields.indexOf(selectedMappingField) + 1
    : 0;
  const selectedAssignment = selectedMappingField ? assignments[selectedMappingField] : undefined;

  const announceKeyboardResize = (field: ZoneField, handleLabel: string) => {
    setAnnouncement(
      `${ZONE_LABEL[field]} source region resized from the ${handleLabel}. Press Control or Command Z to undo.`,
    );
  };

  const handleKeyboardResize = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    field: ZoneField,
    direction: ResizeDirection,
    handleLabel: string,
  ) => {
    if (!onResizeKeyDown(event, field, direction)) return;
    announceKeyboardResize(field, handleLabel);
  };

  const handleRegionKeyboardResize = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    field: ZoneField,
  ) => {
    const direction =
      event.key === "ArrowLeft" || event.key === "ArrowRight"
        ? "e"
        : event.key === "ArrowUp"
          ? "n"
          : event.key === "ArrowDown"
            ? "s"
            : undefined;
    if (!direction) return;
    if (!onResizeKeyDown(event, field, direction)) return;
    const edge = direction === "e" ? "right edge" : direction === "n" ? "top edge" : "bottom edge";
    announceKeyboardResize(field, edge);
  };

  return (
    <section
      data-draft-document
      className="self-start overflow-hidden rounded-lg bg-card shadow-whisper lg:sticky lg:top-2"
    >
      <div className="flex w-full flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="shrink-0 text-sm font-semibold text-foreground">Document</p>
            {selectedAssignment ? (
              <span
                id="active-mapping-label"
                data-active-mapping-label
                className="flex min-w-0 items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-foreground"
                title={ZONE_LABEL[selectedMappingField!]}
              >
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent text-[9px] font-semibold leading-none text-accent-foreground">
                  {selectedNumber}
                </span>
                <span className="truncate font-medium">{ZONE_LABEL[selectedMappingField!]}</span>
              </span>
            ) : proposalCount > 0 ? (
              <span className="truncate rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {proposalCount} preselected
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {selectedAssignment
              ? "Drag an edge or focus a handle and use arrow keys · Delete to remove"
              : proposalCount > 0
                ? `${unconfirmedProposalCount} need review · Click a box to inspect it`
                : "Click a source box to inspect or resize it"}
          </p>
          <p id="mapping-keyboard-help" className="sr-only">
            Press Enter to select this source region. After selection, focus a resize handle and use
            the arrow keys to resize it. Hold Shift for larger steps, then press Control or Command Z
            to undo. Press Delete to remove the selected region.
          </p>
          <p id="mapping-announcer" role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </div>
        {/* The document tools come and go with what is on the page; the removal
            does not. Keeping it outside the guard is the whole reason it can
            live here without becoming something the reviewer has to find. */}
        <div className="flex shrink-0 items-center gap-2">
          {vendorImprovementOpen ? (
            <>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {mappedCount}/{MAPPING_FIELDS.length} mapped
              </span>
              {canUndo ? (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onUndo}
                  aria-label="Undo last mapping"
                  title="Undo last mapping (⌘Z)"
                  className="size-8"
                >
                  <Undo2 className="size-3.5" />
                </Button>
              ) : null}
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
                {assignMode ? "Cancel draw" : "Draw box"}
              </Button>
            </>
          ) : null}
          {removeAction}
        </div>
      </div>

      <div
        ref={setScrollContainer}
        className={`max-h-[640px] overflow-auto p-4 ${assignMode ? "touch-none select-none" : ""}`}
        onPointerDown={canShowDocument ? onDocumentPointerDown : undefined}
        onPointerMove={canShowDocument ? onDocumentPointerMove : undefined}
        onPointerUp={canShowDocument ? onDocumentPointerUp : undefined}
        onPointerCancel={canShowDocument ? onDocumentPointerCancel : undefined}
      >
        <div className="relative mx-auto w-fit">
          <div
            className="relative shrink-0"
            style={{ width: documentSize.width || undefined, height: documentSize.height || undefined }}
          >
          {canShowDocument && imgSrc ? (
            <img
              ref={setDocumentImage}
              src={imgSrc}
              alt={invoice.fileName ?? "Invoice"}
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              onLoad={(event) => {
                const { clientWidth, clientHeight } = event.currentTarget;
                setDocumentSize({ width: clientWidth, height: clientHeight });
              }}
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

          {/* One box at a time: the field being worked on. Twelve boxes at once
              is a page of overlapping rectangles that answers nothing — the
              reviewer cannot tell which one belongs to the row they are
              looking at, and the page stops being a document they can read. */}
          {canShowDocument &&
            MAPPING_FIELDS.map((field) => {
              const assignment = assignments[field];
              if (!assignment) return null;
              const isActive = activeField === field;
              if (!isActive) return null;
              return (
                <div
                  key={field}
                  data-mapping-zone={field}
                  className="pointer-events-none absolute"
                  style={{
                    left: `${assignment.zone.x * 100}%`,
                    top: `${assignment.zone.y * 100}%`,
                    width: `${assignment.zone.w * 100}%`,
                    height: `${assignment.zone.h * 100}%`,
                  }}
                >
                  <button
                    type="button"
                    aria-label={`${ZONE_LABEL[field]} source region`}
                    aria-describedby={
                      isActive ? "active-mapping-label mapping-keyboard-help" : undefined
                    }
                    aria-pressed={isActive}
                    onPointerEnter={() =>
                      setAnnouncement(
                        `${ZONE_LABEL[field]} mapping region hovered. Click or press Enter to select it.`,
                      )
                    }
                    onFocus={() => {
                      onFocusField(field);
                      setAnnouncement(
                        `${ZONE_LABEL[field]} source region selected. Focus a resize handle and use the arrow keys to resize it.`,
                      );
                    }}
                    onKeyDown={(event) => handleRegionKeyboardResize(event, field)}
                    onPointerDown={(event) => {
                      // Select on press so the handles are available for the next
                      // drag. In draw mode the underlying image must receive the
                      // gesture instead, including when it crosses an existing box.
                      if (assignMode) return;
                      event.stopPropagation();
                      onFocusField(field);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!assignMode) onFocusField(field);
                    }}
                    className={`absolute inset-0 rounded-sm border-2 transition-shadow ${
                      assignMode ? "pointer-events-none" : "pointer-events-auto"
                    } ${
                      isActive
                        ? "z-10 border-accent bg-accent/25 shadow-[0_0_0_4px] shadow-accent/20"
                        : assignment.proposal && !isMappingConfirmed(field)
                          ? "border-warning bg-warning/15 hover:bg-warning/25"
                          : "border-accent/50 bg-accent/10 hover:bg-accent/20"
                    } animate-zone-flash`}
                    style={{
                      animationDelay: `${(revealBeats[field] ?? 0) * BEAT_MS}ms`,
                    }}
                  />
                  {!assignMode
                    ? RESIZE_HANDLES.map((handle) => (
                        <button
                          key={handle.direction}
                          type="button"
                          aria-label={`Resize ${ZONE_LABEL[field]} from ${handle.label}`}
                          aria-describedby="mapping-keyboard-help"
                          className={`pointer-events-auto absolute z-20 touch-none rounded-[3px] border border-white bg-accent/80 shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-foreground ${handle.className}`}
                          style={{ cursor: `${handle.direction}-resize` }}
                          onPointerEnter={() => {
                            setAnnouncement(
                              `${ZONE_LABEL[field]} ${handle.label} resize handle hovered. Activate it, then use the arrow keys to resize.`,
                            );
                          }}
                          onFocus={() => {
                            setAnnouncement(
                              `${ZONE_LABEL[field]} ${handle.label} resize handle focused. Use the arrow keys to resize; hold Shift for larger steps.`,
                            );
                          }}
                          onKeyDown={(event) =>
                            handleKeyboardResize(event, field, handle.direction, handle.label)
                          }
                          onClick={() => {
                            setAnnouncement(
                              `${ZONE_LABEL[field]} ${handle.label} resize handle selected. Use the arrow keys to resize.`,
                            );
                          }}
                          onPointerDown={(event) => {
                            onResizePointerDown(event, field, handle.direction);
                          }}
                        />
                      ))
                    : null}
                  {!assignMode && isActive ? (
                    <button
                      type="button"
                      data-remove-mapping={field}
                      aria-label={`Remove the ${ZONE_LABEL[field]} source region`}
                      aria-describedby="mapping-keyboard-help"
                      title="Remove this box (Delete)"
                      className="pointer-events-auto absolute -right-6 -top-2 z-30 flex size-4 items-center justify-center rounded-full border border-background bg-foreground/80 text-background shadow-sm transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                      onPointerDown={(event) => {
                        // Pressing the remove control must not also select the
                        // zone or start a drag on the document.
                        event.stopPropagation();
                      }}
                      onFocus={() =>
                        setAnnouncement(
                          `${ZONE_LABEL[field]} remove-region button focused. Activate to remove the box, or press Delete while the region is selected.`,
                        )
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveMapping(field);
                      }}
                    >
                      <X className="size-2.5" />
                    </button>
                  ) : null}
                </div>
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
      </div>

      {pendingClickPoint && (
        <AssignPopover onAssign={onAssignPendingClick} onCancelSelection={onDismissPendingClick} />
      )}
    </section>
  );
}
/**
 * The order the vendor's own details are read in: who they are, how to reach
 * them, who they are registered as, where they are, and where to pay them.
 */
const VENDOR_FIELD_ORDER: readonly ExtractedField[] = [
  "vendor",
  "vendorEmail",
  "businessRegistrationNumber",
  "address",
  "vatNumber",
  "iban",
];

/**
 * The fields beside the document, split into the two things a reviewer is
 * actually deciding: who this vendor is, and what this invoice says. Each is
 * one column, one field per row — the name, then the value, nothing else. The
 * name is a button because pressing it points at that value on the page.
 */
function FieldsPane({
  invoice,
  fields,
  triageOrder,
  assignments,
  absentFields,
  candidates,
  attention,
  settleable,
  notable,
  trackRecord,
  activeField,
  currency,
  onCurrencyChange,
  department,
  onDepartmentChange,
  onFocusField,
  onEditValue,
  onFindValue,
  onConfirmField,
  onConfirmAll,
}: {
  invoice: Invoice;
  fields: DraftFields;
  triageOrder: ZoneField[];
  /** Fields whose place on the page is already known. */
  assignments: AssignmentsByField;
  /** Fields this vendor's invoices are known not to print. */
  absentFields: readonly ZoneField[];
  /** Places the value was found, when there was more than one. */
  candidates: Partial<Record<ZoneField, ValueLocation[]>>;
  /** The worklist, in the order it should be worked. */
  attention: FieldAttention[];
  /** Proposed regions one deliberate action can agree. */
  settleable: readonly ZoneField[];
  /** What makes this invoice its own problem. */
  notable: string[];
  /** What this vendor's template has saved so far, or null. */
  trackRecord: string | null;
  activeField: ExtractedField | null;
  currency: string;
  onCurrencyChange: (value: string) => void;
  department: string;
  onDepartmentChange: (value: string) => void;
  onFocusField: (field: ExtractedField) => void;
  onEditValue: (field: ExtractedField, value: string) => void;
  onFindValue: (field: ZoneField, chosen?: ValueLocation) => void;
  onConfirmField: (field: ZoneField) => void;
  onConfirmAll: () => void;
}) {
  const attentionFor = new Map(attention.map((item) => [item.field, item.reason]));
  const row = (field: ExtractedField) => (
    <FieldRow
      key={field}
      field={field}
      value={fields[field]}
      confidence={invoice.confidence?.[field]}
      isActive={activeField === field}
      hasBox={Boolean(assignments[field])}
      absent={absentFields.includes(field)}
      attention={attentionFor.get(field)}
      candidates={candidates[field]}
      onFocus={() => onFocusField(field)}
      onEdit={(value) => onEditValue(field, value)}
      onFindValue={() => onFindValue(field)}
      onConfirm={() => onConfirmField(field)}
      onPick={(chosen) => onFindValue(field, chosen)}
    />
  );
  const vendorFields = VENDOR_FIELD_ORDER.filter((field) => triageOrder.includes(field));
  // The vendor name belongs to the vendor group and is edited there once. It is
  // a document field like any other, so it arrives in the triage order with
  // the rest — but the invoice group is about what this document says about
  // itself, and a name shown in both groups is a name edited in two places.
  const invoiceFields = triageOrder.filter(
    (field) => field !== "vendor" && !IDENTITY_FIELDS.includes(field),
  );
  const openIn = (group: ExtractedField[]) =>
    group.filter((field) => attentionFor.has(field)).length;
  return (
    <div className="space-y-4">
      {/* What the template has already saved for this vendor. It sits above the
          work because it is the answer to "will this be like the last twelve",
          and the honest answer is: no, and here is what it cost you. */}
      {trackRecord ? <p className="px-1 text-xs text-muted-foreground">{trackRecord}</p> : null}
      <AttentionHeader
        attention={attention}
        settleable={settleable}
        notable={notable}
        onFocus={onFocusField}
        onConfirmAll={onConfirmAll}
      />
      <FieldCard title="Vendor" attentionCount={openIn(vendorFields)}>
        {vendorFields.map(row)}
      </FieldCard>
      <FieldCard title="Invoice" attentionCount={openIn(invoiceFields)}>
        {invoiceFields.map(row)}
        <CurrencySelect value={currency} onChange={onCurrencyChange} />
        <DepartmentSelect value={department} onChange={onDepartmentChange} />
        {invoice.lineItems.length > 0 ? <CrossCheckNote invoice={invoice} /> : null}
      </FieldCard>
    </div>
  );
}

/**
 * What the line items add up to against what the invoice says. One line, at
 * the foot of the invoice group: it is a check, and a check that fails is worth
 * a reviewer's time before anyone approves the payment.
 */
function CrossCheckNote({ invoice }: { invoice: Invoice }) {
  const crossCheck = totalsCrossCheck(invoice);
  return (
    <div className="flex items-center gap-2 px-4 py-2.5">
      {crossCheck.ok ? (
        <Check aria-hidden className="size-3.5 shrink-0 text-success-foreground" />
      ) : (
        <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-foundry-amber" />
      )}
      <p
        className={`text-xs ${crossCheck.ok ? "text-muted-foreground" : "text-foreground"}`}
        role="status"
      >
        {crossCheck.ok
          ? `Lines ${money(crossCheck.sum, invoice.currency)} add up to the total.`
          : `${crossCheck.detail} Flagged for approval.`}
      </p>
    </div>
  );
}

function FieldCard({
  title,
  attentionCount,
  children,
}: {
  title: string;
  /** How many of this group's rows are on the worklist. */
  attentionCount: number;
  children: ReactNode;
}) {
  const headingId = `field-card-${title.toLowerCase()}`;
  return (
    <section aria-labelledby={headingId}>
      {/* Inset grouped list, iOS/Mac style: the group's name sits outside it,
          because the name describes the rows rather than being one of them.
          Hairlines go between rows, never around each one. */}
      <h2
        id={headingId}
        className="mb-1.5 flex items-baseline gap-2 px-1 text-xs font-medium text-muted-foreground"
      >
        {title}
        {/* The group carries its own count, so the eye can leave the groups
            that are done instead of reading every row to find that out. */}
        {attentionCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-foundry-amber">
            <AlertTriangle aria-hidden className="size-3" />
            {countOf(attentionCount, "row")} need a look
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
            <Check aria-hidden className="size-3" />
            All clear
          </span>
        )}
      </h2>
      <div className="divide-y divide-border/70 overflow-hidden rounded-lg bg-card shadow-whisper">
        {children}
      </div>
    </section>
  );
}

/**
 * The worklist, in one card above the groups: how much is left, which one to do
 * first, and a button that takes the reviewer straight there.
 *
 * A screen where everything looks the same is a screen where the reviewer reads
 * all of it to find the one thing that matters. The first item is named in
 * words, because "2 fields need a look" alone makes the reviewer hunt.
 */
function AttentionHeader({
  attention,
  settleable,
  notable,
  onFocus,
  onConfirmAll,
}: {
  attention: FieldAttention[];
  /** Proposals one action can agree, so the worklist stays the only work. */
  settleable: readonly ZoneField[];
  /** What made this invoice different from the last one. */
  notable: string[];
  onFocus: (field: ZoneField) => void;
  onConfirmAll: () => void;
}) {
  const settled = attention.length === 0;
  const first = attention[0];
  return (
    <div className="rounded-lg bg-card px-4 py-3 shadow-whisper">
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
            settled ? "bg-success/15" : "bg-foundry-amber/15",
          )}
        >
          {settled ? (
            <Check aria-hidden className="size-3.5 text-success-foreground" />
          ) : (
            <AlertTriangle aria-hidden className="size-3.5 text-foundry-amber" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {settled ? "Every field checks out" : `${countOf(attention.length, "field")} need a look`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {settled
              ? "Confirm when you are ready."
              : `Start with ${ZONE_LABEL[first!.field].toLowerCase()} — ${ATTENTION_REASON[first!.reason]}.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* The quiet one. It exists so the fields nobody needs to think about
              are not a queue of twelve decisions: agreeing a region the
              machine read exactly, on a field where being wrong is cheap, is
              bookkeeping — and one press of it is honest bookkeeping. */}
          {settleable.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-foundry-link hover:bg-foundry-link/10 hover:text-foundry-link"
              onClick={onConfirmAll}
              title="Agree the source regions for the fields we are sure about"
            >
              Confirm {countOf(settleable.length, "sureField")}
            </Button>
          ) : null}
          {first ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 px-2.5 text-xs"
              onClick={() => onFocus(first.field)}
              title={`Show ${ZONE_LABEL[first.field]} on the document`}
            >
              Show me
            </Button>
          ) : null}
        </div>
      </div>
      {/* What makes this invoice its own problem. Two invoices from the same
          vendor used to look identical on this screen, which is the surest way
          to teach someone that the work never changes. */}
      {notable.length > 0 ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border/60 pt-2.5">
          {notable.map((item) => (
            <li
              key={item}
              className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {item}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Why a field is on the worklist, in one clause a person can act on. */
const ATTENTION_REASON: Record<AttentionReason, string> = {
  empty: "nothing came back for it",
  "no-box": "we cannot point to it on the page",
  unconfirmed: "the box beside it has not been agreed with",
  unverified: "the reading is not certain",
};

/**
 * One field: the name, the value, and one slot on the right that holds the
 * single action that row can take.
 *
 * The value is styled as content rather than as a form control — no box or
 * fill until it is reached for, a hairline on hover, the focus ring while
 * editing. Twelve grey inputs in a column read as a form nobody filled in and
 * bury the values that were read perfectly well; the value is what the reviewer
 * came to look at.
 */
function FieldFrame({
  field,
  label,
  onShow,
  action,
  tag,
  active,
  emphasis,
  aside,
  children,
}: {
  field: ZoneField | "currency" | "department";
  label: string;
  /** Points the reviewer at this value on the page. */
  onShow?: (() => void) | undefined;
  action?: ReactNode;
  /** A single state marker, right-aligned beside the action. */
  tag?: ReactNode;
  active?: boolean;
  /** The one value the decision is made on, so it gets the size. */
  emphasis?: boolean;
  /** The confidence the extraction reported, kept at the rank of metadata. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      data-draft-field={field}
      className={cn(
        "relative px-4 py-2.5 transition-colors duration-150",
        active && "bg-accent/[0.07]",
      )}
    >
      {/* A 2px rule rather than a full-width tint: it says "this is the row on
          the page" without recolouring the value being read. */}
      {active ? (
        <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent-foreground/70" />
      ) : null}
      <div className="flex items-baseline gap-2">
        {onShow ? (
          <button
            type="button"
            onClick={onShow}
            title={`Show ${label} on the document`}
            className={cn(
              "font-medium underline-offset-4 transition-colors duration-150 hover:underline",
              emphasis ? "text-sm text-foreground" : "text-xs text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ) : (
          <span
            className={cn(
              "font-medium",
              emphasis ? "text-sm text-foreground" : "text-xs text-muted-foreground",
            )}
          >
            {label}
          </span>
        )}
        {aside}
        {tag || action ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {tag}
            {action}
          </div>
        ) : null}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * The one tag this screen uses: not settled yet. A tag rather than a tint,
 * because a tint on every unfinished row is a colour the eye has to read past
 * on every row to get to the values. The reason lives in the tooltip, so the
 * detail is one hover away and the row itself stays quiet.
 */
function UnconfirmedTag({ reason }: { reason: AttentionReason }) {
  return (
    <span
      className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning-foreground"
      title={ATTENTION_REASON[reason]}
    >
      Not confirmed
    </span>
  );
}

/** The value as content: quiet until touched, monospaced so digits line up. */
const VALUE_CONTROL =
  "h-9 w-full rounded-sm border-transparent px-0 font-mono text-sm tabular-nums " +
  "transition-colors duration-150 hover:border-border focus-visible:border-ring";

function CurrencySelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <FieldFrame field="currency" label="Currency">
      <Select {...(value ? { value } : {})} onValueChange={onChange}>
        <SelectTrigger aria-label="Currency" className={VALUE_CONTROL}>
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
    </FieldFrame>
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
    <FieldFrame field="department" label="Department">
      <Select {...(value ? { value } : {})} onValueChange={onChange}>
        <SelectTrigger aria-label="Department" className={VALUE_CONTROL}>
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
    </FieldFrame>
  );
}

function FieldRow({
  field,
  value,
  confidence,
  isActive,
  hasBox,
  absent,
  attention,
  candidates,
  onFocus,
  onEdit,
  onFindValue,
  onConfirm,
  onPick,
}: {
  field: ZoneField;
  value: string;
  /** How sure the extraction was of this value, 0..1. Absent = no signal. */
  confidence?: number | undefined;
  isActive: boolean;
  /** True when we already know where this value sits on the page. */
  hasBox: boolean;
  /** True when this vendor's invoices are known not to print this field. */
  absent: boolean;
  /** Why this row is on the worklist, when it is. */
  attention?: AttentionReason | undefined;
  /** Places the value was found, when there was more than one. */
  candidates?: ValueLocation[] | undefined;
  onFocus: () => void;
  onEdit: (value: string) => void;
  onFindValue: () => void;
  onConfirm: () => void;
  onPick: (location: ValueLocation) => void;
}) {
  const isDate = field === "issueDate" || field === "dueDate";
  /**
   * A box is worth learning when the page prints this field somewhere. Vendor
   * identity is the exception: those values belong on the vendor record, not
   * in a box, and the record is written whether or not anyone maps them.
   */
  const learnable = !IDENTITY_FIELDS.includes(field);
  const canFind = learnable && !hasBox && !absent && value.trim() !== "";
  /**
   * The one action that resolves what is wrong with this row, chosen by the
   * reason: an empty value needs typing, an unagreed box needs agreeing with,
   * anything else needs the page searched. A row never offers both.
   */
  const action =
    attention === "unconfirmed" ? (
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1 px-2 text-xs"
        onClick={onConfirm}
        title={`Agree the box beside ${ZONE_LABEL[field].toLowerCase()} and mark it checked`}
      >
        <BadgeCheck className="size-3.5" /> Check it
      </Button>
    ) : canFind ? (
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1 px-2 text-xs text-foundry-link hover:bg-foundry-link/10 hover:text-foundry-link"
        onClick={onFindValue}
        title={`Search the page for "${value}" and remember where it is`}
      >
        <Search className="size-3.5" /> Find on page
      </Button>
    ) : null;
  return (
    <FieldFrame
      field={field}
      label={ZONE_LABEL[field]}
      onShow={onFocus}
      active={isActive}
      emphasis={field === "total"}
      aside={
        /* A low reading is the reason the row is unsettled, so the number would
           only repeat the tag; every other reason keeps it as metadata. */
        attention === "unverified" ? null : (
          <ConfidenceChip
            value={confidence}
            tone="quiet"
            title="How sure the extraction is of this value"
          />
        )
      }
      tag={attention ? <UnconfirmedTag reason={attention} /> : null}
      action={action}
    >
      {isDate ? (
        <DraftDatePicker value={value} onEdit={onEdit} onFocus={onFocus} />
      ) : (
        <Input
          className={cn(VALUE_CONTROL, field === "total" && "text-[15px] font-medium")}
          value={value}
          onChange={(event) => onEdit(event.target.value)}
          onFocus={onFocus}
          placeholder="—"
        />
      )}
      {candidates && candidates.length > 0 ? (
        <div className="mt-2 space-y-0.5">
          <p className="text-xs text-muted-foreground">
            This text is on the page {candidates.length} times — which one is {ZONE_LABEL[field]}?
          </p>
          {/* A flat inset list, not a card inside the card: one fill, no border
              around the group, so the eye reads it as part of the row. */}
          <div className="mt-1.5 space-y-0.5 rounded-md bg-muted/50 p-0.5">
            {candidates.map((location) => (
              <button
                key={`${location.zone.y}-${location.zone.x}`}
                type="button"
                className="group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors duration-150 hover:bg-background"
                onClick={() => onPick(location)}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {location.text}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {positionHint(location.zone)}
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                />
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {absent ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleSlash aria-hidden className="size-3 shrink-0" />
          Not on this vendor&apos;s invoices — not asked again.
        </p>
      ) : null}
    </FieldFrame>
  );
}

/** "top left", "middle right" — enough to point at a spot on the page. */
function positionHint(zone: Zone): string {
  const row = zone.y < 0.33 ? "top" : zone.y > 0.66 ? "bottom" : "middle";
  const column = zone.x < 0.33 ? "left" : zone.x > 0.66 ? "right" : "middle";
  return `${row} ${column}`;
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
          className="h-9 w-full justify-between border-transparent bg-transparent px-0 font-mono text-sm font-normal tabular-nums transition-colors duration-150 hover:border-border hover:bg-transparent"
        >
          <span className={value ? "" : "text-muted-foreground"}>
            {displayDate(value) || "Pick a date"}
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
    <section className="rounded-lg bg-card p-4 shadow-whisper">
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
