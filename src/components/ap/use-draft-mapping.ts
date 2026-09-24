/**
 * Draft mapping state — the hook behind the DraftMapper screen.
 *
 * Owns the mapping state machine: assignments (field → zone + anchor),
 * triage statuses, undo history, and the field→source / region→field
 * interactions. Rendering lives in the sibling component files.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ZONE_FIELDS,
  ZONE_LABEL,
  type ExtractedField,
  type Invoice,
  type LineItemsSpec,
  type VendorTemplate,
  type Zone,
  type ZoneField,
} from "@/lib/ap/types";
import {
  fieldStatus,
  firstPageWords,
  orderedFields,
  proposeAnchor,
  totalsCrossCheck,
  validateInvoiceForConfirmation,
  unionBox,
  wordsInRect,
  type FieldStatus,
} from "@/lib/ap/mapping";
import { resultFor } from "./zone-check-chip";
import { moneyToNumber } from "@/lib/ap/zones";
import { useAp } from "@/lib/ap/store";
import type { VendorMaster } from "@/lib/ap/vendor-master";
import {
  confirmDraft,
  persistDraftLineItemsSpec,
  type DraftFields,
} from "@/lib/ap/use-cases/confirm-draft";

export type { DraftFields };

/** Maximum undo steps kept in memory. */
const UNDO_HISTORY_LIMIT = 20;
/** Scroll margin (px) above a zone when panning the document to a field. */
const FOCUS_SCROLL_MARGIN_PX = 120;
/** Padding (normalized) around a freshly assigned value region. */
const VALUE_REGION_PAD = 0.008;

export type Assignment = { field: ZoneField; zone: Zone; anchor?: string | undefined };
export type AssignmentsByField = Record<ZoneField, Assignment | undefined>;

const toDraftFields = (invoice: Invoice): DraftFields => ({
  vendor: invoice.vendor,
  invoiceNumber: invoice.invoiceNumber,
  issueDate: invoice.issueDate,
  dueDate: invoice.dueDate,
  subtotal: String(invoice.subtotal ?? 0),
  tax: String(invoice.tax ?? 0),
  total: String(invoice.total ?? 0),
  address: invoice.address ?? "",
  vendorEmail: invoice.vendorEmail ?? "",
  iban: invoice.iban ?? "",
  vatNumber: invoice.vatNumber ?? "",
  businessRegistrationNumber: invoice.businessRegistrationNumber ?? "",
});

/** Seeds each field with the drawn zone, else the value-text suggestion. */
const seedAssignments = (
  invoice: Invoice,
  words: ReturnType<typeof firstPageWords>,
): AssignmentsByField => {
  const out = {} as AssignmentsByField;
  for (const field of ZONE_FIELDS) {
    // Initial suggestions are deliberately conservative. A guessed box can
    // teach a vendor template the wrong region, so only persisted/template
    // zones are shown until a person draws a precise selection.
    const zone = invoice.zones?.[field];
    if (!zone) {
      out[field] = undefined;
      continue;
    }
    out[field] = { field, zone, anchor: words ? proposeAnchor(words, zone) : undefined };
  }
  return out;
};

export function useDraftMapping(invoice: Invoice) {
  const {
    templates,
    saveVendorTemplate,
    updateInvoice,
    applyTransition,
    confirmTemplateExtraction,
    upsertVendor,
    operator,
  } = useAp();
  const words = useMemo(() => firstPageWords(invoice), [invoice]);
  const existingTemplate: VendorTemplate | undefined = templates[invoice.vendor];

  const [fields, setFields] = useState<DraftFields>(() => toDraftFields(invoice));
  const [assignments, setAssignments] = useState<AssignmentsByField>(() =>
    seedAssignments(invoice, words),
  );
  const [undoStack, setUndoStack] = useState<AssignmentsByField[]>([]);
  const [activeField, setActiveField] = useState<ExtractedField | null>(null);
  const [assignMode, setAssignMode] = useState(false);
  const [pendingClickPoint, setPendingClickPoint] = useState<{ x: number; y: number } | null>(null);
  const [pendingSelection, setPendingSelection] = useState<Zone | null>(null);
  const selectionStart = useRef<{ x: number; y: number } | null>(null);
  const [isLineItemEditorOpen, setLineItemEditorOpen] = useState(false);
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const [documentImage, setDocumentImage] = useState<HTMLImageElement | null>(null);

  const triageStatuses = useMemo(() => {
    const out = {} as Record<ZoneField, FieldStatus>;
    for (const field of ZONE_FIELDS) {
      const check = resultFor(invoice.zoneCheck, field);
      out[field] = fieldStatus(invoice, field, { zoneCheckMatch: check?.match });
    }
    return out;
  }, [invoice]);

  const triageOrder = useMemo(
    () => orderedFields(invoice, triageStatuses),
    [invoice, triageStatuses],
  );
  const crossCheck = totalsCrossCheck(invoice);
  const validationIssues = useMemo(() => validateInvoiceForConfirmation(invoice), [invoice]);
  const blockingIssues = validationIssues.filter((issue) => issue.severity === "error");
  const allFieldsVerified =
    triageOrder.every((f) => triageStatuses[f] === "green") && blockingIssues.length === 0;
  const mappedCount = ZONE_FIELDS.filter((f) => assignments[f]).length;

  const recordForUndo = useCallback(
    (snapshotBeforeChange: AssignmentsByField, next: AssignmentsByField) => {
      setUndoStack((stack) => [...stack.slice(-(UNDO_HISTORY_LIMIT - 1)), snapshotBeforeChange]);
      setAssignments(next);
    },
    [],
  );

  const undoLastAssignment = useCallback(() => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setAssignments(previous);
    setUndoStack(undoStack.slice(0, -1));
  }, [undoStack]);

  useEffect(() => {
    const handleUndoShortcut = (event: KeyboardEvent) => {
      const isUndoKey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z";
      if (isUndoKey) {
        event.preventDefault();
        undoLastAssignment();
      }
    };
    window.addEventListener("keydown", handleUndoShortcut);
    return () => window.removeEventListener("keydown", handleUndoShortcut);
  }, [undoLastAssignment]);

  /** Field → source: pulse the zone and pan the document to it. */
  const focusField = useCallback(
    (field: ExtractedField) => {
      setActiveField(field);
      const assignment = assignments[field];
      if (!assignment || !scrollContainer) return;
      const imageTop = scrollContainer.offsetTop;
      const zoneTop = assignment.zone.y * (documentImage?.clientHeight ?? 0);
      scrollContainer.scrollTo({
        top: Math.max(0, imageTop + zoneTop - FOCUS_SCROLL_MARGIN_PX),
        behavior: "smooth",
      });
    },
    [assignments, scrollContainer, documentImage],
  );

  /** Normalizes a pointer into document coordinates (0..1), null outside. */
  const clickPointFromEvent = (rect: DOMRect, clientX: number, clientY: number) => {
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  };

  /** Region → field, step 1: draw a precise selection on the document. */
  const handleDocumentPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!assignMode || !documentImage) return;
      event.preventDefault();
      event.stopPropagation();
      const point = clickPointFromEvent(
        documentImage.getBoundingClientRect(),
        event.clientX,
        event.clientY,
      );
      if (!point) return;
      selectionStart.current = point;
      setPendingSelection({ x: point.x, y: point.y, w: 0, h: 0 });
      setPendingClickPoint(null);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [assignMode, documentImage],
  );

  const handleDocumentPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = selectionStart.current;
      if (!start || !documentImage) return;
      event.preventDefault();
      const point = clickPointFromEvent(
        documentImage.getBoundingClientRect(),
        event.clientX,
        event.clientY,
      );
      if (!point) return;
      const x = Math.min(start.x, point.x);
      const y = Math.min(start.y, point.y);
      setPendingSelection({
        x,
        y,
        w: Math.abs(point.x - start.x),
        h: Math.abs(point.y - start.y),
      });
    },
    [documentImage],
  );

  const handleDocumentPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = selectionStart.current;
      if (!start || !documentImage) return;
      event.preventDefault();
      event.stopPropagation();
      selectionStart.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      const point = clickPointFromEvent(
        documentImage.getBoundingClientRect(),
        event.clientX,
        event.clientY,
      );
      if (!point) return;
      const selection = {
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        w: Math.abs(point.x - start.x),
        h: Math.abs(point.y - start.y),
      };
      if (selection.w < 0.006 || selection.h < 0.004) {
        setPendingSelection(null);
        toast.info("Draw a box around the value", {
          description: "Press, drag across the value, then release.",
        });
        return;
      }
      const selectedWords = words ? wordsInRect(words, selection) : [];
      if (selectedWords.length === 0) {
        setPendingSelection(null);
        toast.info("No readable text in that box", {
          description: "Draw the box over the value you want to map.",
        });
        return;
      }
      setPendingSelection(selection);
      const center = unionBox(selectedWords);
      setPendingClickPoint({ x: center.x + center.w / 2, y: center.y + center.h / 2 });
    },
    [documentImage, words],
  );

  /** Region → field, step 2: link the clicked value to the chosen field. */
  const assignPendingClickTo = useCallback(
    (field: ZoneField) => {
      if (!pendingSelection || !words) return;
      const selectedWords = wordsInRect(words, pendingSelection);
      if (selectedWords.length === 0) return;
      const zone = unionBox(selectedWords, VALUE_REGION_PAD);
      const anchor = proposeAnchor(words, zone);
      const ocrText = wordsInRect(words, zone)
        .map((w) => w.text)
        .join(" ");
      recordForUndo(assignments, { ...assignments, [field]: { field, zone, anchor } });
      setPendingClickPoint(null);
      setPendingSelection(null);
      setAssignMode(false);
      setActiveField(field);
      const nextValue = coerceOcrToDraftValue(field, ocrText, fields[field]);
      setFields((prev) => ({ ...prev, [field]: nextValue }));
      updateInvoice(
        invoice.id,
        invoicePatchFor(field, nextValue),
        `Mapped ${ZONE_LABEL[field]}`,
        "Value corrected from the document",
      );
      toast.success(`${ZONE_LABEL[field]} mapped`, {
        description: anchor
          ? `Anchor “${anchor}” proposed — safer against layout shifts.`
          : undefined,
      });
    },
    [pendingSelection, words, assignments, fields, invoice.id, recordForUndo, updateInvoice],
  );

  /** Routes an edited draft value into the matching invoice patch. */
  const editDraftValue = useCallback(
    (field: ExtractedField, value: string) => {
      setFields((prev) => ({ ...prev, [field]: value }));
      updateInvoice(
        invoice.id,
        {
          ...invoicePatchFor(field, value),
          provenance: { ...invoice.provenance, [field]: "manual" },
        },
        `Corrected ${ZONE_LABEL[field]}`,
        "Human correction during draft review",
        operator.name,
      );
    },
    [invoice.id, invoice.provenance, operator.name, updateInvoice],
  );

  /** Mark a field as checked without changing its value. */
  const markFieldVerified = useCallback(
    (field: ExtractedField) => {
      updateInvoice(
        invoice.id,
        {
          ...invoicePatchFor(field, fields[field]),
          provenance: { ...invoice.provenance, [field]: "manual" },
        },
        `Verified ${ZONE_LABEL[field]}`,
        "Marked as verified against the document",
        operator.name,
      );
    },
    [fields, invoice.id, invoice.provenance, operator.name, updateInvoice],
  );

  const confirmChoice = useCallback(
    (opts?: { profile?: VendorMaster | undefined; learnedCount?: number | undefined }) => {
      const result = confirmDraft(
        {
          invoice,
          fields,
          assignments,
          words: words ?? [],
          existingTemplate,
          profile: opts?.profile,
          profileUpdatedAt: new Date().toISOString(),
          learnedCount: opts?.learnedCount,
          actor: operator,
        },
        {
          saveVendorTemplate,
          updateInvoice,
          applyTransition,
          confirmTemplateExtraction,
          upsertVendor,
        },
      );

      if (!result.ok) {
        if (result.kind === "blocked") {
          toast.error("Fix the highlighted issues before confirming", {
            description: result.message,
          });
        } else if (result.kind === "transition-rejected") {
          toast.error("We couldn't submit this for approval", {
            description: result.message,
          });
        } else {
          toast.error("We couldn't save the draft", {
            description: result.message,
          });
        }
        return;
      }

      if (result.templateAction !== "none") {
        toast.success(result.templateAction === "updated" ? "Template updated" : "Template saved", {
          description: `Future ${result.vendor} invoices will be read from this template.`,
        });
      }
      const learned = result.learnedCount;
      toast.success(`We confirmed ${result.vendor} — ready for approval`, {
        description: `Profile saved · ${learned} anchor${learned === 1 ? "" : "s"} learned.`,
      });
    },
    [
      applyTransition,
      assignments,
      confirmTemplateExtraction,
      existingTemplate,
      fields,
      invoice,
      saveVendorTemplate,
      updateInvoice,
      upsertVendor,
      words,
    ],
  );

  const toggleAssignMode = useCallback(() => {
    setAssignMode((currentlyOn) => !currentlyOn);
    setPendingClickPoint(null);
  }, []);

  /** Saves a learned line-item block alongside the current header mappings. */
  const saveLineItemsSpec = useCallback(
    (lineItems: LineItemsSpec) => {
      const result = persistDraftLineItemsSpec(
        {
          invoice,
          vendor: fields.vendor || invoice.vendor,
          assignments,
          words: words ?? [],
          lineItems,
        },
        { saveVendorTemplate },
      );
      if (!result.ok) {
        toast.info("Map the header fields first", {
          description: result.message,
        });
      }
    },
    [assignments, fields.vendor, invoice, saveVendorTemplate, words],
  );

  return {
    // data
    words,
    existingTemplate,
    fields,
    assignments,
    undoStack,
    activeField,
    assignMode,
    pendingClickPoint,
    pendingSelection,
    isLineItemEditorOpen,
    triageStatuses,
    triageOrder,
    crossCheck,
    validationIssues,
    blockingIssues,
    allFieldsVerified,
    mappedCount,
    // refs (callback refs so the hook can pan/measure)
    setScrollContainer,
    setDocumentImage,
    // actions
    focusField,
    toggleAssignMode,
    handleDocumentPointerDown,
    handleDocumentPointerMove,
    handleDocumentPointerUp,
    assignPendingClickTo,
    dismissPendingClick: () => {
      setPendingClickPoint(null);
      setPendingSelection(null);
    },
    editDraftValue,
    markFieldVerified,
    confirmChoice,
    saveLineItemsSpec,
    undoLastAssignment,
  };
}

/**
 * Training wheels hold this many future extractions for manual confirmation
 * before a vendor template is trusted outright.
 */
export const TRAINING_WHEELS_CONFIRMATIONS = 2;

const MONEY_FIELDS: ExtractedField[] = ["subtotal", "tax", "total"];
const DATE_FIELDS: ExtractedField[] = ["issueDate", "dueDate"];

/** Coerces OCR text from a freshly assigned region into an editable draft value. */
function coerceOcrToDraftValue(
  field: ExtractedField,
  rawOcrText: string,
  previous: string,
): string {
  const text = rawOcrText.trim();
  if (MONEY_FIELDS.includes(field)) {
    // Dutch/European money parsing lives in zones.ts and is shared with the
    // template-apply path — one parser, one behavior.
    const parsed = moneyToNumber(text);
    return parsed === undefined ? previous : String(parsed);
  }
  if (DATE_FIELDS.includes(field)) {
    // OCR/typed text is day-first (DD-MM-YYYY) or ISO; the invoice schema
    // stores YYYY-MM-DD. Values that don't parse keep the previous value.
    return parseIsoDate(text) ?? previous;
  }
  return text || previous;
}

function invoicePatchFor(field: ExtractedField, value: string): Partial<Invoice> {
  if (field === "vendor") return { vendor: value };
  if (field === "invoiceNumber") return { invoiceNumber: value };
  if (field === "issueDate") return { issueDate: value };
  if (field === "dueDate") return { dueDate: value };
  if (field === "subtotal" || field === "tax" || field === "total") {
    return { [field]: Number(value) || 0 };
  }
  // Identity fields (address, email, IBAN, BTW, KVK) live on the vendor
  // profile draft — never coerce them into the invoice total.
  return {};
}

/** Day-first (European) or ISO date text → YYYY-MM-DD, undefined when unparseable. */
export function parseIsoDate(text: string): string | undefined {
  const s = text.trim();
  const isoMatch = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]!.padStart(2, "0")}-${isoMatch[3]!.padStart(2, "0")}`;
  }
  const dayFirstMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dayFirstMatch) {
    const twoDigitYear = Number(dayFirstMatch[3]);
    const year = twoDigitYear < 100 ? 2000 + twoDigitYear : twoDigitYear;
    return `${year}-${dayFirstMatch[2]!.padStart(2, "0")}-${dayFirstMatch[1]!.padStart(2, "0")}`;
  }
  return undefined;
}
