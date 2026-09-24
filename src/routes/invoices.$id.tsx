import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Check, Loader2, Send } from "@/components/icons";
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
import { VendorProfileRegistration } from "@/components/ap/vendor-profile-registration";
import { LineItemsList } from "@/components/ap/line-items-list";
import { CrossCheckLine } from "@/components/ap/assign-popover";
import { suggestZone, totalsCrossCheck } from "@/lib/ap/mapping";
import { VendorProfile } from "@/components/ap/vendor-profile";
import { resultFor } from "@/components/ap/zone-check-chip";
import { useAp } from "@/lib/ap/store";
import { ApprovalVerdictStrip } from "@/components/ap/approval-verdict";
import { DecisionNotice } from "@/components/ap/decision-notice";
import { ApprovalCompare } from "@/components/ap/approval-compare";
import { CreateVendorRecordButton } from "@/components/ap/create-vendor-record";
import { ApprovalDecisionBar } from "@/components/ap/approval-decision-bar";
import { RecordDetails } from "@/components/ap/record-details";
import { buildApprovalVerdict, correctionAction } from "@/lib/ap/approval";
import { matchInvoiceToPo } from "@/lib/ap/matching";
import { suggestPo } from "@/lib/ap/po-store";
import {
  freezeLabel,
  handoffMarkerInForce,
  isFrozen,
  type Actor,
  type TransitionId,
} from "@/lib/ap/state-machine";
import {
  APPROVAL_AHEAD,
  CURRENCY_OPTIONS,
  DEPARTMENTS,
  GL_ACCOUNTS,
  ZONE_FIELDS,
  money,
  type ExtractedField,
  type Invoice,
  type LineItem,
  type Zone,
  type ZoneField,
} from "@/lib/ap/types";
import { erpRefsFor, syncStateFor } from "@/lib/ap/erp-sync";
import { cn } from "@/lib/utils";
import { processingStageLabel } from "@/lib/ap/processing-errors";

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
  if (invoice.status === "vendor_profile") return <VendorProfileRegistration invoice={invoice} />;
  return <Detail invoice={invoice} />;
}

function ProcessingInvoice({ invoice }: { invoice: Invoice }) {
  return (
    <Shell>
      <ReviewHeader invoice={invoice} />
      <div className="mt-6 rounded-lg border border-border bg-card p-8 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_40px_rgba(0,0,0,0.07)]">
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
    vendors,
    operator,
  } = useAp();
  const navigate = useNavigate();
  const [legacyZoneEdit, setLegacyZoneEdit] = useState(false);
  const [focusedField, setFocusedField] = useState<ZoneField | undefined>(undefined);

  const syncState = syncStateFor(invoice.id);
  const erpRefs = erpRefsFor(invoice.id);
  const hasHandoffMarker = handoffMarkerInForce(invoice);
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
  const useDraftMapperView =
    invoice.status === "draft" && invoice.source === "upload" && !invoice.processing;

  /**
   * The one person running this install signs every action on this screen.
   *
   * It used to be a trio of invented colleagues — a processor, an approver and
   * a "Payments" box — picked per phase to satisfy the role gates. That made
   * every signature fiction, and two people sharing a device would both have
   * signed as the same invented processor, so the name-based SoD comparison
   * compared an alias against itself. One operator holding all three human
   * roles is both the truth and what the gates need; the gates themselves are
   * untouched, and the machine still signs extraction events as `system`.
   */
  /** The comparison runs against the linked purchase order, so no link means
   *  there is nothing on our side to match the lines against. */
  const linkedPo = invoice.poId ? purchaseOrders.find((p) => p.id === invoice.poId) : undefined;
  const matchResult =
    invoice.lineItems.length > 0
      ? matchInvoiceToPo(invoice.lineItems, linkedPo?.lines ?? [], {
          receipts: linkedPo?.receipts,
        })
      : null;
  const poSuggestion = suggestPo(invoice.vendor, invoice.lineItems);
  const totalsCheck = totalsCrossCheck(invoice);

  const vendorRecord = vendors[invoice.vendor];
  const verdict = buildApprovalVerdict({
    invoice,
    vendorRecord,
    po: linkedPo,
    match: matchResult,
  });

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
      operator.name,
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
      operator.name,
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

  /* ── Editable pieces of the compare list ────────────────────────────── */

  function lockedField(label: string, value: ReactNode) {
    return (
      <div className="flex flex-col gap-1 rounded-md border border-border bg-card/50 px-3 py-2">
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
            onCommit={(v) => correct("address", "Address", v)}
          />
        ),
        "vendor:iban": (
          <EditableValue
            label="IBAN"
            mono
            value={invoice.iban ?? ""}
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
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/50 px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">Amounts locked</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-border bg-card/50 px-3 py-2">
              <p className="text-xs text-muted-foreground">Subtotal</p>
              <p className="font-mono text-sm">{money(invoice.subtotal, invoice.currency)}</p>
            </div>
            <div className="rounded-md border border-border bg-card/50 px-3 py-2">
              <p className="text-xs text-muted-foreground">Tax</p>
              <p className="font-mono text-sm">{money(invoice.tax, invoice.currency)}</p>
            </div>
            <div className="rounded-md border border-border bg-card/50 px-3 py-2">
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
        subtotal={invoice.subtotal}
        tax={invoice.tax}
        invoiceTotal={invoice.total}
        onChange={canEdit ? onLineItemsChange : undefined}
      />
    </div>
  );

  const codingEditor = canEdit ? (
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
            {GL_ACCOUNTS.map((account) => (
              <SelectItem key={account} value={account}>
                {account}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        A department or a GL account is enough for approval — Foundry needs one dimension of coding.
      </p>
    </div>
  ) : (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/50 px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground">Coding locked</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-card/50 px-3 py-2">
          <p className="text-xs text-muted-foreground">Department</p>
          <p className="text-sm font-medium">{invoice.department || "—"}</p>
        </div>
        <div className="rounded-md border border-border bg-card/50 px-3 py-2">
          <p className="text-xs text-muted-foreground">GL account</p>
          <p className="text-sm font-medium">{invoice.glAccount || "—"}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{lockedHint}</p>
    </div>
  );

  const commitmentsEditor = canEdit ? (
    <div className="flex flex-wrap items-center gap-2">
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
    </div>
  ) : (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/50 px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground">Purchase order locked</p>
      <div className="rounded-md border border-border bg-card/50 px-3 py-2">
        <p className="text-xs text-muted-foreground">Linked purchase order</p>
        <p className="text-sm font-medium">
          {invoice.poId
            ? purchaseOrders.find((p) => p.id === invoice.poId)?.number ?? "—"
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
        {invoice.status === "draft" ? (
          <Button
            className="gap-2"
            onClick={() => advance("confirm", operator, "Sent for approval")}
          >
            <Send className="size-4" /> Submit for approval
          </Button>
        ) : null}
        {invoice.status === "scheduled" && !hasHandoffMarker ? (
          <Button
            className="gap-2"
            onClick={() =>
              advance("release", operator, "Invoice marked ready for external handoff", {
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
            onClick={() => advance("reopen-draft", operator, "Reopened as draft")}
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
        <DraftMapper invoice={invoice} />
      ) : (
        <>
          <ReviewHeader invoice={invoice} />

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
            <ApprovalVerdictStrip verdict={verdict} />
          ) : (
            <DecisionNotice invoice={invoice} />
          )}

          <div className="mt-5 grid gap-5 pb-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <section className="self-start overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] lg:sticky lg:top-2">
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
            onApprove={() => advance("approve", operator, "Invoice approved")}
            onQuery={(reason) => advance("query", operator, "Query sent", { reason })}
            onReject={(reason) => advance("reject", operator, "Invoice rejected", { reason })}
            onReviewNext={approvalIsAhead ? reviewNext : undefined}
            {...(invoice.status === "scheduled"
              ? {
                  // The door back in: signed, so an approver retracts it with a
                  // reason in the trail — the only way the frozen fields move.
                  onReopen: (reason: string) =>
                    advance("re-open", operator, "Re-opened for approval", { reason }),
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
 * The editable side of a compare row: local state, committed on blur or Enter
 * so a correction is logged once, as one change — not once per keystroke.
 */
function EditableValue({
  label,
  value,
  onCommit,
  type = "text",
  mono,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  type?: string;
  mono?: boolean;
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
      className={cn("mt-0.5 h-9 text-sm", mono || type === "number" ? "font-mono" : "")}
    />
  );
}
