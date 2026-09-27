import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, BadgeCheck, Brain, Check, Loader2, PenLine, Send } from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Shell } from "@/components/ap/shell";
import { EmptyState } from "@/components/ap/primitives";
import { ReviewHeader } from "@/components/ap/review-header";
import { DocPreview } from "@/components/ap/doc-preview";
import { isImageInvoice } from "@/lib/ap/file-type";
import { businessRegistrationLabel, registrationCountry } from "@/lib/ap/business-registration";
import { DraftMapper } from "@/components/ap/draft-mapper";
import { LineItemsList } from "@/components/ap/line-items-list";
import { GoodsReceiptEditor } from "@/components/ap/goods-receipt-editor";
import { CrossCheckLine } from "@/components/ap/assign-popover";
import { suggestZone, totalsCrossCheck } from "@/lib/ap/mapping";
import { VendorProfile } from "@/components/ap/vendor-profile";
import { vendorProfileFromMapping } from "@/lib/ap/vendor-master";
import { resultFor } from "@/components/ap/zone-check-chip";
import { useAp } from "@/lib/app/store";
import { ApprovalVerdictStrip } from "@/components/ap/approval-verdict";
import { DecisionNotice } from "@/components/ap/decision-notice";
import { ApprovalCompare } from "@/components/ap/approval-compare";
import { CreateVendorRecordButton } from "@/components/ap/create-vendor-record";
import { ApprovalDecisionBar } from "@/components/ap/approval-decision-bar";
import { RecordDetails } from "@/components/ap/record-details";
import { buildApprovalVerdict, correctionAction } from "@/lib/ap/approval";
import { matchInvoiceToPo } from "@/lib/ap/matching";
import { matchNoPoInvoice } from "@/lib/ap/flex-matching";
import { suggestGlCoding, type CodingField } from "@/lib/ap/gl-coding";
import { suggestPo } from "@/lib/ap/po-store";
import { codingOptionsFor } from "@/lib/ap/entities";
import { isFrozen, freezeLabel, type Actor, type TransitionId } from "@/lib/ap/state-machine";
import { operatorActorWithRole } from "@/lib/ap/operator";
import {
  APPROVAL_AHEAD,
  CURRENCY_OPTIONS,
  DEPARTMENTS,
  ZONE_FIELDS,
  money,
  type ExtractedField,
  type Invoice,
  type LineItem,
  type Zone,
  type ZoneField,
} from "@/lib/ap/types";
import { erpRefsFor, latestSyncByInvoice, syncStateFor } from "@/lib/ap/erp-sync";
import { attentionForInvoice } from "@/lib/ap/attention";
import { cn } from "@/lib/utils";
import { countOf } from "@/lib/ap/vocabulary";
import { processingStageLabel } from "@/lib/ap/processing-errors";

const LOW_CONFIDENCE_THRESHOLD = 0.75;
const CODING_FIELD_LABELS: Record<CodingField, string> = {
  glAccount: "GL account",
  category: "Category",
  department: "Department",
  costCenter: "Cost center",
  project: "Project",
  location: "Location",
};

export const Route = createFileRoute("/invoices/$id")({
  head: () => ({
    meta: [
      { title: "Invoice review — Foundry" },
      {
        name: "description",
        content:
          "Compare the scanned document with the vendor record, the linked purchase order and the totals, then approve or send it back.",
      },
      { property: "og:title", content: "Invoice review — Foundry" },
      {
        property: "og:description",
        content:
          "Compare the scanned document with the vendor record, the linked purchase order and the totals, then approve or send it back.",
      },
    ],
  }),
  component: InvoiceDetail,
});

function InvoiceDetail() {
  const { id } = Route.useParams();
  const { invoices } = useAp();
  const invoice = invoices.find((i) => i.id === id);

  if (!invoice) {
    return (
      <Shell>
        <EmptyState
          title="This invoice isn't in the inbox anymore."
          action={
            <Link
              to="/"
              className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Back to invoice inbox
            </Link>
          }
        >
          It left the queue: removed invoices wait under Removed in the inbox, and completed ones
          under History.
        </EmptyState>
      </Shell>
    );
  }

  if (invoice.status === "processing") return <ProcessingInvoice invoice={invoice} />;
  if (invoice.status === "failed") return <FailedInvoice invoice={invoice} />;
  if (isMapperView(invoice)) return <MapperView invoice={invoice} />;
  return <Detail invoice={invoice} />;
}

/**
 * Where the mapper runs. It is the one screen that pins a vendor's identity
 * *and* teaches its template, so it owns both ends of the front of the flow:
 * Profiling (a vendor we have never seen — the identity is mapped off the same
 * document as the invoice fields) and Draft (a known one whose template still
 * has to be confirmed). Only uploads have a document to map against.
 */
function isMapperView(invoice: Invoice): boolean {
  if (invoice.source !== "upload" || invoice.processing) return false;
  return invoice.status === "vendor_profile" || invoice.status === "draft";
}

/** The mapper screen in its shell, with the low-confidence banner it needs. */
function MapperView({ invoice }: { invoice: Invoice }) {
  const lowConfidence = (Object.keys(invoice.confidence ?? {}) as ExtractedField[]).filter(
    (k) => (invoice.confidence?.[k] ?? 1) < LOW_CONFIDENCE_THRESHOLD,
  );
  return (
    <Shell>
      <DraftMapper
        invoice={invoice}
        banner={
          lowConfidence.length > 0 ? <LowConfidenceNotice count={lowConfidence.length} /> : null
        }
      />
    </Shell>
  );
}

function ProcessingInvoice({ invoice }: { invoice: Invoice }) {
  return (
    <Shell>
      <ReviewHeader invoice={invoice} />
      <div className="mt-6 rounded-lg bg-card p-8 text-center shadow-whisper">
        <Loader2 className="mx-auto size-7 animate-spin text-muted-foreground" />
        <p className="mt-4 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Preparing → Ready to review
        </p>
        <h2 className="mt-2 text-heading-xs font-semibold">Preparing this invoice</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {invoice.processing?.stage
            ? `${invoice.processing.stage} — ${Math.round((invoice.processing.progress ?? 0) * 100)}% complete.`
            : "The extracted fields will appear here when processing is complete."}
        </p>
        <Link
          to="/"
          className="mt-5 inline-flex text-sm font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Back to invoice inbox
        </Link>
      </div>
    </Shell>
  );
}

function FailedInvoice({ invoice }: { invoice: Invoice }) {
  const { updateInvoice } = useAp();
  const reason =
    invoice.processing?.error ??
    "The processor stopped without a recorded reason. The original file is saved.";
  return (
    <Shell>
      <ReviewHeader invoice={invoice} />
      <div className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-8">
        <AlertTriangle className="size-7 text-warning-foreground" />
        <p className="mt-4 text-xs font-medium uppercase tracking-[0.16em] text-warning-foreground">
          Preparing → Ready to review
        </p>
        <h2 className="mt-2 text-heading-xs font-semibold">This invoice needs attention</h2>
        <p className="mt-2 text-sm text-warning-foreground">
          Processing stopped while{" "}
          {processingStageLabel(invoice.processing?.errorStage ?? invoice.processing?.stage)}.
        </p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{reason}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              updateInvoice(
                invoice.id,
                { status: "draft", processing: undefined },
                "Manual review started",
                "Processing stopped; the invoice was opened for manual entry.",
              )
            }
          >
            Review manually
          </Button>
          <Link
            to="/"
            className="inline-flex items-center rounded-md px-3 py-2 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Back to invoice inbox
          </Link>
        </div>
      </div>
    </Shell>
  );
}

/** Fields with an anchor worth pointing at, beyond the seven the extractor zones. */
const FOCUSABLE_EXTRA_FIELDS: ZoneField[] = [
  "address",
  "vendorEmail",
  "iban",
  "vatNumber",
  "businessRegistrationNumber",
];

function Detail({ invoice }: { invoice: Invoice }) {
  const {
    updateInvoice,
    applyTransition,
    upsertTemplate,
    purchaseOrders,
    linkPo,
    recordReceipt,
    vendors,
    upsertVendor,
    flexRules,
    flexContracts,
    flexReceipts,
    invoices,
    history,
    removed,
    vendorProfiles,
    businessProfile,
    activeEntity,
  } = useAp();
  const navigate = useNavigate();
  const [legacyZoneEdit, setLegacyZoneEdit] = useState(false);
  const [focusedField, setFocusedField] = useState<ZoneField | undefined>(undefined);

  const syncState = syncStateFor(invoice.id);
  const erpRefs = erpRefsFor(invoice.id);
  const hasHandoffMarker = invoice.audit.some(
    (entry) => entry.action === "Marked ready for external handoff",
  );
  const startManualReview = () => {
    updateInvoice(
      invoice.id,
      { status: "draft", processing: undefined },
      "Manual review started",
      "Extraction failed; processor is entering the invoice manually.",
    );
    toast.info("Manual review started", {
      description: "Enter the required fields and confirm when the invoice is ready.",
    });
  };

  /** Draft uploads map through the DraftMapper (the teaching screen). */
  const useDraftMapperView = isMapperView(invoice);

  const lowConfidence = (Object.keys(invoice.confidence ?? {}) as ExtractedField[]).filter(
    (k) => (invoice.confidence?.[k] ?? 1) < LOW_CONFIDENCE_THRESHOLD,
  );
  const isLow = (confidence: number | undefined) =>
    confidence !== undefined && confidence < LOW_CONFIDENCE_THRESHOLD;

  /** Demo personas per phase role (until real auth exists). SoD is enforced
   *  by the state machine, not by hiding buttons. The `actingAs` identity is
   *  shown on screen so the user always knows whose signature they are putting
   *  on the record — today this names a real person the app invented, which is
   *  the bug: two people using the same device would both sign as Dana and SoD
   *  would compare an alias against itself. */
  const actors = {
    processor: operatorActorWithRole("processor", businessProfile),
    approver: operatorActorWithRole("approver", businessProfile),
    treasury: operatorActorWithRole("treasury", businessProfile),
  };

  /** The persona whose name goes on this screen's actions and audit entries.
   *  Shown in the header so the user always knows who they are acting as. */
  const editor = invoice.status === "review" ? actors.approver : actors.processor;

  /** The comparison runs against the linked purchase order, so no link means
   *  there is nothing on our side to match the lines against. */
  const linkedPo = invoice.poId ? purchaseOrders.find((p) => p.id === invoice.poId) : undefined;
  const matchResult =
    invoice.lineItems.length > 0
      ? matchInvoiceToPo(invoice.lineItems, linkedPo?.lines ?? [], {
          receipts: linkedPo ? linkedPo.receipts ?? [] : undefined,
        })
      : null;
  const flexMatch =
    !linkedPo
      ? matchNoPoInvoice(invoice, {
          contracts: flexContracts,
          receipts: flexReceipts,
          rules: flexRules,
        })
      : undefined;
  const attention = attentionForInvoice(
    invoice,
    latestSyncByInvoice()[invoice.id],
    flexMatch,
  );
  const poSuggestion = suggestPo(invoice.vendor, invoice.lineItems);
  const totalsCheck = totalsCrossCheck(invoice);

  const vendorRecord = vendors[invoice.vendor];
  const verdict = buildApprovalVerdict({
    invoice,
    vendorRecord,
    po: linkedPo,
    match: matchResult,
    flexMatch,
    profile: businessProfile,
    entity: activeEntity,
  });
  const codingSuggestion = suggestGlCoding(
    invoice,
    [...invoices, ...history, ...removed],
    vendorProfiles,
  );
  const suggestedCoding = codingSuggestion?.fields ?? {};
  const codingSuggestionItems = (Object.keys(suggestedCoding) as CodingField[])
    .filter((field) => suggestedCoding[field] !== invoice[field])
    .map((field) => ({ field, value: suggestedCoding[field]! }));
  const acceptCodingSuggestion = () => {
    if (!codingSuggestion || codingSuggestionItems.length === 0) return;
    const patch: Partial<Invoice> = {
      glAccount: suggestedCoding.glAccount ?? invoice.glAccount,
      department: suggestedCoding.department ?? invoice.department,
      ...(suggestedCoding.category !== undefined ? { category: suggestedCoding.category } : {}),
      ...(suggestedCoding.costCenter !== undefined
        ? { costCenter: suggestedCoding.costCenter }
        : {}),
      ...(suggestedCoding.project !== undefined ? { project: suggestedCoding.project } : {}),
      ...(suggestedCoding.location !== undefined ? { location: suggestedCoding.location } : {}),
    };
    updateInvoice(
      invoice.id,
      patch,
      "Accepted coding suggestion",
      `${codingSuggestion.reason} Confidence ${Math.round(codingSuggestion.confidence * 100)}%.`,
      editor.name,
    );
  };

  /** Content is still editable while it can still change hands: Draft and
   *  For approval. Past that the record is the record.
   *
   *  `isFrozen` already covers `scheduled`, `paid`, `rejected`, `archived` — but
   *  the checkEditors, linesEditor, codingEditor and commitmentsEditor gates below
   *  are the visible counterpart: a locked record keeps its values on screen as
   *  facts, each with a one-line hint saying why it can't move (bug 1 + bug 6). */
  // One rule, the same one the store enforces: past a decision (approved,
  // rejected, removed) the record shows its fields as facts. Asking the machine
  // here rather than listing statuses is what keeps this gate and the store's
  // refusal from drifting apart.
  const canEdit = !isFrozen(invoice);
  const lockedHint = freezeLabel(invoice);

  /** The verdict strip and the bar's blocked sentence both speak for a decision
   *  that is still ahead. A rejected record has none: nothing can be approved on
   *  it, so it states the rejection instead, and its bar carries only the way
   *  back — which the state machine does not gate on the compare rows. */
  /** Whether approving is still a question at all: the strip is a verdict about
   *  approving, so it runs only where that decision is still open. */
  const approvalIsAhead = APPROVAL_AHEAD.includes(invoice.status);
  /** The last query sent on this invoice, if any — shown until the user leaves
   *  the screen so they always know what question is sitting on the record. */
  const lastQuery = useMemo(
    () => invoice.audit.filter((e) => e.action === "Query sent").slice(-1)[0]?.note,
    [invoice.audit],
  );
  const isImage = Boolean(invoice.fileUrl && isImageInvoice(invoice.fileType, invoice.fileName));

  /** Where each field sits on the page, for the row → document jump. */
  const zones = useMemo(() => {
    const out: Partial<Record<ZoneField, Zone>> = {};
    if (!isImage) return out;
    for (const field of [...ZONE_FIELDS, ...FOCUSABLE_EXTRA_FIELDS]) {
      const zone = invoice.zones?.[field] ?? suggestZone(invoice, field);
      if (zone) out[field] = zone;
    }
    return out;
  }, [invoice, isImage]);
  const canFocus = (field: ZoneField) => zones[field] !== undefined;
  const highlight = focusedField ? zones[focusedField] : undefined;

  /**
   * Every change a person makes here is logged. The audit trail is what keeps
   * "what we read" and "what you changed" apart (foundry.md §2 forbids silent
   * data mutation) and it is what the compare rows then label as corrected.
   */
  const recordCorrection = (
    patchValue: Partial<Invoice>,
    label: string,
    before: string,
    after: string,
  ) => {
    const applied = updateInvoice(
      invoice.id,
      patchValue,
      correctionAction(label),
      `was ${before || "empty"} → ${after || "empty"}`,
      editor.name,
    );
    if (!applied.accepted) {
      // The record moved under the editor (an approval landing mid-edit, say):
      // say what happened rather than celebrate a change that did not happen.
      toast.error(applied.reason ?? "That change was refused.", {
        description: "Nothing changed — the invoice is exactly as you left it.",
      });
      return;
    }
    toast.success(`We recorded the change to ${label.toLowerCase()}`, {
      description: "The audit trail keeps what we read and what you changed.",
    });
  };

  const correct = (field: ExtractedField, label: string, next: string) => {
    const before = String(invoice[field] ?? "");
    if (next === before) return;
    recordCorrection({ [field]: next } as Partial<Invoice>, label, before, next);
  };

  const correctAmount = (field: "subtotal" | "tax" | "total", label: string, next: string) => {
    const before = invoice[field] ?? 0;
    const parsed = Number(next.replace(",", "."));
    const value = Number.isFinite(parsed) ? parsed : 0;
    if (value === before) return;
    recordCorrection(
      { [field]: value },
      label,
      money(before, invoice.currency),
      money(value, invoice.currency),
    );
  };

  /** Line-item edits land per keystroke, so the commit (and its audit entry)
   *  waits for a pause instead of writing one entry per character. */
  const lineItemTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLineItems = useRef<LineItem[] | null>(null);
  const commitLineItems = () => {
    const next = pendingLineItems.current;
    pendingLineItems.current = null;
    if (!next) return;
    updateInvoice(
      invoice.id,
      { lineItems: next },
      correctionAction("line items"),
      "Line items changed while reviewing.",
      editor.name,
    );
  };
  const onLineItemsChange = (items: LineItem[]) => {
    pendingLineItems.current = items;
    if (lineItemTimer.current) clearTimeout(lineItemTimer.current);
    lineItemTimer.current = setTimeout(commitLineItems, 700);
  };
  useEffect(
    () => () => {
      if (lineItemTimer.current) clearTimeout(lineItemTimer.current);
      commitLineItems();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Walks to the first row that needs a person. */
  const reviewNext = () => {
    const target = verdict.blocking[0] ?? verdict.attention[0];
    if (!target) return;
    if (target.field && canFocus(target.field)) setFocusedField(target.field);
    const row = document.getElementById(`check-${target.id}`);
    if (!row) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    row.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  };

  /** Runs a state-machine transition; illegal/blocked moves show a toast
   *  instead of silently succeeding. */
  const advance = (
    id: TransitionId,
    actor: Actor,
    message: string,
    opts?: { reason?: string; onDone?: () => void },
  ) => {
    // The reason is only ever supplied by the dialog that collects it for a
    // step the state machine requires it for — there is no field on the page
    // waiting to be filled in for a decision nobody has made.
    const reason = opts?.reason;
    const result = applyTransition(invoice.id, {
      transition: id,
      actor,
      ...(reason ? { note: reason } : {}),
    });
    if (!result.accepted) {
      toast.error(result.reason ?? "Your role can't take this step.", {
        description: "Nothing changed — the invoice is exactly as you left it.",
      });
      return;
    }
    toast.success(message);
    opts?.onDone?.();
  };

  /** The draft mapper is the only screen that states read confidence: by review
   *  time every row carries its own chip, so a banner here would be a count of
   *  information already marked where it matters. */
  const lowConfidenceNotice =
    lowConfidence.length > 0 ? <LowConfidenceNotice count={lowConfidence.length} /> : null;

  /* ── Editable pieces of the compare list ────────────────────────────── */

  function lockedField(label: string, value: ReactNode) {
    return (
      <div className="flex flex-col gap-1 rounded-md bg-card/50 px-3 py-2 shadow-whisper">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
        <p className="text-xs text-muted-foreground">{lockedHint}</p>
      </div>
    );
  }

  const vendorValue = (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">On the document</p>
      <p className="text-sm font-medium">{invoice.vendor}</p>
    </div>
  );
  const vendorHeld = (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">What we hold</p>
      <p className="text-sm font-medium">{vendorRecord?.name ?? "No record yet"}</p>
    </div>
  );

  const checkEditors: Record<string, ReactNode> = canEdit
    ? {
        "vendor:vendorEmail": (
          <EditableValue
            label="Vendor email"
            value={invoice.vendorEmail ?? ""}
            onCommit={(v) => correct("vendorEmail", "Vendor email", v)}
          />
        ),
        "vendor:address": (
          <EditableValue
            label="Address"
            value={invoice.address ?? ""}
            low={isLow(invoice.confidence?.address)}
            onCommit={(v) => correct("address", "Address", v)}
          />
        ),
        "vendor:iban": (
          <EditableValue
            label="IBAN"
            mono
            value={invoice.iban ?? ""}
            low={isLow(invoice.confidence?.iban)}
            onCommit={(v) => correct("iban", "IBAN", v)}
          />
        ),
        "vendor:vatNumber": (
          <EditableValue
            label="BTW number"
            mono
            value={invoice.vatNumber ?? ""}
            onCommit={(v) => correct("vatNumber", "BTW number", v)}
          />
        ),
        "vendor:businessRegistrationNumber": (
          <EditableValue
            label={businessRegistrationLabel(registrationCountry(invoice.vatNumber, invoice.iban))}
            mono
            value={invoice.businessRegistrationNumber ?? ""}
            onCommit={(v) =>
              correct("businessRegistrationNumber", "Business registration number", v)
            }
          />
        ),
        "header:invoiceNumber": (
          <EditableValue
            label="Invoice no."
            value={invoice.invoiceNumber}
            low={isLow(invoice.confidence?.invoiceNumber)}
            onCommit={(v) => correct("invoiceNumber", "Invoice no.", v)}
          />
        ),
        "header:issueDate": (
          <EditableValue
            label="Issue date"
            type="date"
            value={invoice.issueDate}
            onCommit={(v) => correct("issueDate", "Issue date", v)}
          />
        ),
        "header:dueDate": (
          <EditableValue
            label="Due date"
            type="date"
            value={invoice.dueDate}
            onCommit={(v) => correct("dueDate", "Due date", v)}
          />
        ),
        "header:currency": (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Currency</Label>
            <Select
              value={invoice.currency}
              onValueChange={(value) =>
                recordCorrection({ currency: value }, "Currency", invoice.currency, value)
              }
            >
              <SelectTrigger aria-label="Currency" className="h-9 font-mono">
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
          </div>
        ),
      }
    : {
        "vendor:vendorEmail": lockedField("Vendor email", invoice.vendorEmail ?? "—"),
        "vendor:address": lockedField("Address", invoice.address ?? "—"),
        "vendor:iban": lockedField("IBAN", invoice.iban ?? "—"),
        "vendor:vatNumber": lockedField("BTW number", invoice.vatNumber ?? "—"),
        "vendor:businessRegistrationNumber": lockedField(
          businessRegistrationLabel(registrationCountry(invoice.vatNumber, invoice.iban)),
          invoice.businessRegistrationNumber ?? "—",
        ),
        "header:invoiceNumber": lockedField("Invoice no.", invoice.invoiceNumber),
        "header:issueDate": lockedField("Issue date", invoice.issueDate),
        "header:dueDate": lockedField("Due date", invoice.dueDate),
        "header:currency": lockedField("Currency", invoice.currency),
      };

  /**
   * The lines block: editable while the record is still being worked, facts once
   * it is not. A decided record drops the amount inputs entirely rather than
   * locking them — they exist to correct the totals, and the reconciliation line
   * below already states each one.
   */
  const linesEditor = (
    <div className="space-y-3 p-4">
      {canEdit ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <EditableValue
            label="Subtotal"
            type="number"
            mono
            value={String(invoice.subtotal)}
            onCommit={(v) => correctAmount("subtotal", "Subtotal", v)}
          />
          <EditableValue
            label="Tax"
            type="number"
            mono
            value={String(invoice.tax)}
            onCommit={(v) => correctAmount("tax", "Tax", v)}
          />
          <EditableValue
            label="Total"
            type="number"
            mono
            value={String(invoice.total)}
            onCommit={(v) => correctAmount("total", "Total", v)}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg bg-card/50 px-4 py-3 shadow-whisper">
          <p className="text-xs font-medium text-muted-foreground">Amounts locked</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-md bg-card/50 px-3 py-2 shadow-whisper">
              <p className="text-xs text-muted-foreground">Subtotal</p>
              <p className="font-mono text-sm">{money(invoice.subtotal, invoice.currency)}</p>
            </div>
            <div className="rounded-md bg-card/50 px-3 py-2 shadow-whisper">
              <p className="text-xs text-muted-foreground">Tax</p>
              <p className="font-mono text-sm">{money(invoice.tax, invoice.currency)}</p>
            </div>
            <div className="rounded-md bg-card/50 px-3 py-2 shadow-whisper">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="font-mono text-sm">{money(invoice.total, invoice.currency)}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{lockedHint}</p>
        </div>
      )}
      <CrossCheckLine
        isConsistent={totalsCheck.ok}
        lineItemsSum={totalsCheck.sum}
        subtotal={invoice.subtotal}
        tax={invoice.tax}
        invoiceTotal={invoice.total}
        currency={invoice.currency}
        detail={totalsCheck.detail || undefined}
      />
      <LineItemsList
        items={invoice.lineItems}
        currency={invoice.currency}
        editable={canEdit}
        isDraft={invoice.status === "draft"}
        subtotal={invoice.subtotal}
        tax={invoice.tax}
        invoiceTotal={invoice.total}
        onChange={canEdit ? onLineItemsChange : undefined}
      />
    </div>
  );

  const codingEditor = canEdit ? (
    <div className="space-y-3">
      {codingSuggestion && codingSuggestionItems.length > 0 ? (
        <div className="rounded-lg border border-info/30 bg-info/5 p-3 shadow-whisper">
          <div className="flex items-start gap-2">
            <Brain className="mt-0.5 size-4 shrink-0 text-info" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Suggested coding</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {codingSuggestion.reason} Confidence {Math.round(codingSuggestion.confidence * 100)}%.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {codingSuggestionItems.map(({ field, value }) => (
                  <span key={field} className="rounded-full bg-card px-2 py-1 text-xs">
                    {CODING_FIELD_LABELS[field]}: {value}
                  </span>
                ))}
              </div>
            </div>
            <Button size="sm" onClick={acceptCodingSuggestion} className="shrink-0 gap-1.5">
              <Check className="size-3.5" /> Use suggestion
            </Button>
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Department</Label>
          <Select
            value={invoice.department}
            onValueChange={(value) =>
              recordCorrection({ department: value }, "Department", invoice.department, value)
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Choose a department" />
            </SelectTrigger>
            <SelectContent>
              {DEPARTMENTS.map((department) => (
                <SelectItem key={department} value={department}>
                  {department}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">GL account</Label>
          <Select
            value={invoice.glAccount}
            onValueChange={(value) =>
              recordCorrection({ glAccount: value }, "GL account", invoice.glAccount, value)
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Choose a GL account" />
            </SelectTrigger>
            <SelectContent>
              {codingOptionsFor(activeEntity, invoice.glAccount).map((account) => (
                <SelectItem key={account} value={account}>
                  {account}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(
          [
            ["category", "Category"],
            ["costCenter", "Cost center"],
            ["project", "Project"],
            ["location", "Location"],
          ] as const
        ).map(([field, label]) => (
          <div key={field} className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{label}</Label>
            <Input
              value={invoice[field] ?? ""}
              onChange={(event) =>
                recordCorrection(
                  { [field]: event.target.value },
                  label,
                  invoice[field] ?? "",
                  event.target.value,
                )
              }
              placeholder="Not set"
              className="h-9"
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Suggestions learn from corrected coding on prior invoices. Review before applying.
      </p>
    </div>
  ) : (
    <div className="flex flex-col gap-2 rounded-lg bg-card/50 px-4 py-3 shadow-whisper">
      <p className="text-xs font-medium text-muted-foreground">Coding locked</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          ["Department", invoice.department],
          ["GL account", invoice.glAccount],
          ["Category", invoice.category],
          ["Cost center", invoice.costCenter],
          ["Project", invoice.project],
          ["Location", invoice.location],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md bg-card/50 px-3 py-2 shadow-whisper">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-sm font-medium">{value || "—"}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{lockedHint}</p>
    </div>
  );

  const commitmentsEditor = canEdit ? (
    <div className="flex flex-wrap items-center gap-2">
      {!linkedPo && flexMatch ? (
        <div
          className={cn(
            "w-full rounded-lg border px-4 py-3 text-sm shadow-whisper",
            flexMatch.status === "matched" && flexMatch.canAutoApprove
              ? "border-success/30 bg-success/5"
              : flexMatch.blocksApproval
                ? "border-destructive/30 bg-destructive/5"
                : "border-warning/40 bg-warning/5",
          )}
        >
          <div className="flex items-start gap-2">
            {flexMatch.status === "matched" && flexMatch.canAutoApprove ? (
              <Check className="mt-0.5 size-4 shrink-0 text-success-foreground" />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
            )}
            <div>
              <p className="font-medium">
                {flexMatch.status === "matched" && flexMatch.canAutoApprove
                  ? "Eligible for approval without a PO"
                  : "No-PO approval evidence needs attention"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{flexMatch.explanation}</p>
            </div>
          </div>
        </div>
      ) : null}
      <Select
        value={invoice.poId ?? "none"}
        onValueChange={(value) => linkPo(invoice.id, value === "none" ? undefined : value)}
      >
        <SelectTrigger aria-label="Linked purchase order" className="h-9 w-60 text-sm">
          <SelectValue placeholder="No purchase order linked" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No purchase order linked</SelectItem>
          {purchaseOrders.map((po) => (
            <SelectItem key={po.id} value={po.id}>
              {po.number} · {po.vendor}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!invoice.poId && poSuggestion ? (
        <p className="text-xs text-muted-foreground">
          Did you mean{" "}
          <button
            type="button"
            className="font-medium text-foreground underline underline-offset-2"
            onClick={() => linkPo(invoice.id, poSuggestion.id)}
          >
            {poSuggestion.number}
          </button>
          ?
        </p>
      ) : null}
      {linkedPo ? (
        <div className="w-full">
          <GoodsReceiptEditor purchaseOrder={linkedPo} onRecord={recordReceipt} />
        </div>
      ) : null}
    </div>
  ) : (
    <div className="flex flex-col gap-2 rounded-lg bg-card/50 px-4 py-3 shadow-whisper">
      <p className="text-xs font-medium text-muted-foreground">Purchase order locked</p>
      <div className="rounded-md bg-card/50 px-3 py-2 shadow-whisper">
        <p className="text-xs text-muted-foreground">Linked purchase order</p>
        <p className="text-sm font-medium">
          {invoice.poId
            ? (purchaseOrders.find((p) => p.id === invoice.poId)?.number ?? "—")
            : "None"}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">{lockedHint}</p>
    </div>
  );

  const linesEditorOpen =
    verdict.attention.some((check) => check.group === "lines") ||
    verdict.blocking.some((check) => check.group === "amounts" || check.group === "lines");

  /* ── Actions for the phases outside For approval ────────────────────── */

  const statusActions =
    invoice.status === "review" ? undefined : (
      <>
        {/* A record that reaches Profiling without a document to map (nothing
            in the app creates one today, but a restore can) still needs a way
            out: save the profile the invoice already carries, into Draft. */}
        {invoice.status === "vendor_profile" ? (
          <Button
            className="gap-2"
            onClick={() => {
              const saved = upsertVendor(vendorProfileFromMapping(invoice, vendorRecord));
              if (!saved.accepted) {
                toast.error("Couldn't save the vendor record", {
                  description: saved.reason ?? "Try again — the audit log has more detail.",
                });
                return;
              }
              advance("vendor-profile-confirmed", actors.processor, "Profile saved from the record");
            }}
          >
            <BadgeCheck className="size-4" /> Save profile & open draft
          </Button>
        ) : null}
        {invoice.status === "draft" ? (
          <Button
            className="gap-2"
            onClick={() => advance("confirm", actors.processor, "Sent for approval")}
          >
            <Send className="size-4" /> Submit for approval
          </Button>
        ) : null}
        {invoice.status === "scheduled" && !hasHandoffMarker ? (
          <Button
            className="gap-2"
            onClick={() =>
              advance("release", actors.treasury, "Invoice marked ready for external handoff", {
                reason: "Approved invoice marked ready for external handoff",
              })
            }
          >
            <Check className="size-4" /> Mark ready for external handoff
          </Button>
        ) : null}
        {invoice.status === "scheduled" && hasHandoffMarker ? (
          <p className="text-xs text-muted-foreground">
            This handoff marker is recorded. Foundry has not sent a payment.
          </p>
        ) : null}
        {invoice.status === "rejected" ? (
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => advance("reopen-draft", actors.processor, "Reopened as draft")}
          >
            Reopen as draft
          </Button>
        ) : null}
      </>
    );

  const statusHint =
    invoice.status === "draft"
      ? "Submitting sends it to For approval — the record stays readable."
      : invoice.status === "scheduled"
        ? "Foundry will not send money. This marks the handoff for your external process. The record is locked — use Re-open below to change anything."
        : invoice.status === "rejected"
          ? "Reopening returns it to Draft for the processor to fix."
          : undefined;

  return (
    <Shell>
      {useDraftMapperView ? (
        <DraftMapper invoice={invoice} banner={lowConfidenceNotice} />
      ) : (
        <>
          <ReviewHeader invoice={invoice} actingAs={editor.name} />

          {attention ? (
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
              <div>
                <p className="text-sm font-medium text-warning-foreground">{attention.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{attention.detail}</p>
              </div>
            </div>
          ) : null}

          {invoice.status === "failed" && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                <div className="space-y-1 text-warning-foreground">
                  <p className="font-medium">Invoice processing needs attention</p>
                  <p className="text-xs">
                    Stopped while{" "}
                    {processingStageLabel(
                      invoice.processing?.errorStage ?? invoice.processing?.stage,
                    )}
                    .
                  </p>
                  <p className="max-w-2xl text-xs text-muted-foreground">
                    {invoice.processing?.error ??
                      "The processor stopped without a recorded reason. The original file is saved; review it manually."}
                  </p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={startManualReview}>
                Review manually
              </Button>
            </div>
          )}

          {approvalIsAhead ? (
            <ApprovalVerdictStrip verdict={verdict} onReviewNext={reviewNext} />
          ) : (
            <>
              <DecisionNotice invoice={invoice} />
              {lastQuery ? (
                <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
                  <div className="flex items-start gap-2">
                    <PenLine className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                    <div>
                      <p className="text-xs font-medium text-warning-foreground">Question sent</p>
                      <p className="mt-1 text-sm text-foreground">{lastQuery}</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}

          <div className="mt-5 grid gap-5 pb-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <section className="self-start overflow-hidden rounded-lg bg-card shadow-whisper lg:sticky lg:top-2">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <p className="text-xs font-medium text-muted-foreground">Document</p>
                <div className="flex items-center gap-2">
                  {isImage && canEdit ? (
                    <Button
                      size="sm"
                      variant={legacyZoneEdit ? "default" : "outline"}
                      onClick={() => setLegacyZoneEdit((v) => !v)}
                    >
                      Edit field positions
                    </Button>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {invoice.pageCount && invoice.pageCount > 1
                      ? `${invoice.pageCount} pages · `
                      : ""}
                    {invoice.fileName ?? "sample-invoice.pdf"}
                  </p>
                </div>
              </div>
              <div>
                <DocPreview
                  invoice={invoice}
                  editingZones={legacyZoneEdit}
                  highlight={highlight}
                  onSaveZones={(newZones) => {
                    const saved = updateInvoice(invoice.id, { zones: newZones });
                    setLegacyZoneEdit(false);
                    if (!saved.accepted) {
                      toast.error(saved.reason ?? "Those field positions were refused.", {
                        description: "Nothing changed — the invoice is exactly as you left it.",
                      });
                      return;
                    }
                    upsertTemplate(invoice.vendor, newZones);
                    toast.success(`We saved the field positions for ${invoice.vendor}`);
                  }}
                />
              </div>
            </section>

            <ApprovalCompare
              verdict={verdict}
              onFocus={(field) =>
                setFocusedField((current) => (current === field ? undefined : field))
              }
              canFocus={canFocus}
              focusedField={focusedField}
              checkEditors={checkEditors}
              checkActions={
                !vendors[invoice.vendor]
                  ? {
                      "vendor:no-record": (
                        <CreateVendorRecordButton key={invoice.id} invoice={invoice} />
                      ),
                    }
                  : undefined
              }
              vendorHeader={
                <VendorProfile
                  vendor={invoice.vendor}
                  confidence={invoice.confidence?.vendor}
                  sourcePage={invoice.fieldSources?.vendor}
                  showPage={(invoice.pageCount ?? 1) > 1}
                  // A frozen record takes no vendor patch either: the menu drops
                  // the items that would write one, and keeps the way out.
                  {...(canEdit
                    ? { onChange: (value: string) => correct("vendor", "Vendor", value) }
                    : {})}
                  zoneCheck={resultFor(invoice.zoneCheck, "vendor")}
                />
              }
              linesEditor={linesEditor}
              linesEditorOpen={linesEditorOpen}
              linesToggleLabel={canEdit ? undefined : "Show the line items"}
              codingEditor={codingEditor}
              commitmentsEditor={commitmentsEditor}
            />
          </div>

          <RecordDetails
            className="mt-5"
            invoice={invoice}
            erpRef={erpRefs.bill}
            syncFailed={syncState.bill?.status === "failed"}
          />

          <ApprovalDecisionBar
            blocked={approvalIsAhead && !verdict.canApprove}
            amount={invoice.total}
            currency={invoice.currency}
            onApprove={() => advance("approve", actors.approver, "Invoice approved")}
            onQuery={(reason) => advance("query", actors.approver, "Query sent", { reason })}
            onReject={(reason) =>
              advance("reject", actors.approver, "Invoice rejected", { reason })
            }
            onReviewNext={approvalIsAhead ? reviewNext : undefined}
            {...(invoice.status === "scheduled"
              ? {
                  // The door back in: signed, so an approver retracts it with a
                  // reason in the trail — the only way the frozen fields move.
                  onReopen: (reason: string) =>
                    advance("re-open", actors.approver, "Re-opened for approval", { reason }),
                }
              : {})}
            {...(statusActions ? { actions: statusActions } : {})}
            {...(statusHint ? { hint: statusHint } : {})}
          />
        </>
      )}
    </Shell>
  );
}

/**
 * The read-confidence sentence, written once — the draft mapper's banner renders
 * it in a box, on the screen where the values are still being read.
 */
function lowConfidenceLine(count: number): string {
  return `${countOf(count, "field")} read with low confidence — check the highlighted values against the document.`;
}

function LowConfidenceNotice({ count }: { count: number }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <PenLine className="mt-0.5 size-4 text-warning-foreground" />
      <p className="text-warning-foreground">{lowConfidenceLine(count)}</p>
    </div>
  );
}

/**
 * The editable side of a compare row: local state, committed on blur or Enter
 * so a correction is logged once, as one change — not once per keystroke.
 */
function EditableValue({
  label,
  value,
  onCommit,
  type = "text",
  mono,
  low,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  type?: string;
  mono?: boolean;
  low?: boolean | undefined;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <Input
      type={type}
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        }
      }}
      className={cn(
        "mt-0.5 h-9 text-sm",
        mono || type === "number" ? "font-mono" : "",
        low ? "border-warning bg-warning/10" : "",
      )}
    />
  );
}
