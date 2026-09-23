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
  type AnchorSpec,
  type ExtractedField,
  type Invoice,
  type LineItemsSpec,
  type VendorTemplate,
  type Zone,
  type ZoneField,
  type ZoneMap,
} from "@/lib/ap/types";
import {
  buildAnchorSpec,
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

/** Maximum undo steps kept in memory. */
const UNDO_HISTORY_LIMIT = 20;
/** Scroll margin (px) above a zone when panning the document to a field. */
const FOCUS_SCROLL_MARGIN_PX = 120;
/** Padding (normalized) around a freshly assigned value region. */
const VALUE_REGION_PAD = 0.008;

export type Assignment = { field: ZoneField; zone: Zone; anchor?: string | undefined };
export type AssignmentsByField = Record<ZoneField, Assignment | undefined>;

/** Draft fields as strings — exactly what the inputs edit. */
export type DraftFields = {
  vendor: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  subtotal: string;
  tax: string;
  total: string;
  address: string;
  vendorEmail: string;
  iban: string;
  vatNumber: string;
  businessRegistrationNumber: string;
};

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
        invoicePatchFor(field, value),
        `Corrected ${ZONE_LABEL[field]}`,
        "Human correction during draft review",
      );
    },
    [invoice.id, updateInvoice],
  );

  const buildAnchorSpecs = useCallback((): {
    specs: Partial<Record<ZoneField, AnchorSpec>>;
    zones: ZoneMap;
  } => {
    const specs: Partial<Record<ZoneField, AnchorSpec>> = {};
    const zones: ZoneMap = {};
    for (const field of ZONE_FIELDS) {
      const assignment = assignments[field];
      if (!assignment) continue;
      specs[field] = buildAnchorSpec(words ?? [], field, assignment.zone, assignment.anchor);
      zones[field] = assignment.zone;
    }
    return { specs, zones };
  }, [assignments, words]);

  const saveTemplate = useCallback(
    (confirmNextCount: number) => {
      const { specs, zones } = buildAnchorSpecs();
      if (Object.keys(specs).length === 0) return;
      const vendorName = fields.vendor || invoice.vendor;
      saveVendorTemplate({
        vendor: vendorName,
        fields: specs,
        zones,
        confirmNextCount,
        origin: invoice.templateDrift ? "drift-update" : "confirmed",
        invoiceId: invoice.id,
      });
      toast.success(existingTemplate ? "Template updated" : "Template saved", {
        description:
          confirmNextCount > 0
            ? `Next ${confirmNextCount} ${vendorName} invoices will ask you to confirm.`
            : `Future ${vendorName} invoices will be read from this template.`,
      });
    },
    [buildAnchorSpecs, fields.vendor, invoice, existingTemplate, saveVendorTemplate],
  );

  const confirmChoice = useCallback(
    (opts?: { profile?: VendorMaster | undefined; learnedCount?: number | undefined }) => {
      if (blockingIssues.length > 0) {
        toast.error("Fix the highlighted issues before confirming", {
          description: blockingIssues[0]?.message,
        });
        return;
      }
      // Template-hit drafts (training wheels) carry no new mappings —
      // confirming validates the existing template instead of writing an empty one.
      const hasMappings = ZONE_FIELDS.some((f) => assignments[f]);
      const isInvoiceOnly = !hasMappings && !invoice.templateDrift;
      const currentFields = draftFieldsToInvoicePatch(fields);
      if (isInvoiceOnly) {
        updateInvoice(
          invoice.id,
          { ...currentFields, templateHold: undefined },
          // Never "Confirmed draft" here: that exact action string is the
          // SoD "confirmed" marker and the transition below writes the real
          // entry. Logging it early bricks every confirm attempt.
          "Saved draft field values",
          "Confirmed template extraction",
        );
      } else {
        saveTemplate(0);
        updateInvoice(
          invoice.id,
          { ...currentFields, templateHold: undefined, zones: buildAnchorSpecs().zones },
          existingTemplate ? "Template updated" : "Template saved",
          "Confirmed draft",
        );
      }
      if (invoice.templateHold) confirmTemplateExtraction(invoice.vendor);
      const result = applyTransition(invoice.id, {
        transition: "confirm",
        actor: { name: "Luuk Koppen", roles: ["processor"] },
      });
      if (!result.accepted) {
        toast.error("We couldn't submit this for approval", {
          description: result.reason ?? "Fix the highlighted issues and try again.",
        });
        return;
      }
      if (opts?.profile) {
        upsertVendor({ ...opts.profile, updatedAt: new Date().toISOString() });
      }
      const learned = opts?.learnedCount ?? 0;
      toast.success(`We confirmed ${invoice.vendor} — ready for approval`, {
        description: `Profile saved · ${learned} anchor${learned === 1 ? "" : "s"} learned.`,
      });
    },
    [
      assignments,
      blockingIssues,
      fields,
      invoice,
      buildAnchorSpecs,
      confirmTemplateExtraction,
      existingTemplate,
      saveTemplate,
      updateInvoice,
      applyTransition,
      upsertVendor,
    ],
  );

  const toggleAssignMode = useCallback(() => {
    setAssignMode((currentlyOn) => !currentlyOn);
    setPendingClickPoint(null);
  }, []);

  /** Saves a learned line-item block alongside the current header mappings. */
  const saveLineItemsSpec = useCallback(
    (lineItems: LineItemsSpec) => {
      const { specs, zones } = buildAnchorSpecs();
      const vendorName = fields.vendor || invoice.vendor;
      if (Object.keys(specs).length === 0) {
        toast.info("Map the header fields first", {
          description: "The line-item block is stored with the vendor's template.",
        });
        return;
      }
      saveVendorTemplate({
        vendor: vendorName,
        fields: specs,
        zones,
        lineItems,
        origin: "confirmed",
        invoiceId: invoice.id,
      });
    },
    [buildAnchorSpecs, fields.vendor, invoice, saveVendorTemplate],
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

/** Routes a draft value into the corresponding invoice patch shape. */
function draftFieldsToInvoicePatch(fields: DraftFields): Partial<Invoice> {
  return {
    vendor: fields.vendor,
    invoiceNumber: fields.invoiceNumber,
    issueDate: fields.issueDate,
    dueDate: fields.dueDate,
    subtotal: Number(fields.subtotal) || 0,
    tax: Number(fields.tax) || 0,
    total: Number(fields.total) || 0,
  };
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
