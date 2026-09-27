/**
 * Draft mapping state — the hook behind the DraftMapper screen.
 *
 * Owns the mapping state machine: assignments (field → zone + anchor), undo
 * history, and the field→source / region→field interactions. What those
 * assignments *mean* is domain policy, not view logic: triage comes from
 * `draftTriage` and the template-save preconditions from `templateSaveGate`.
 * Rendering lives in the sibling component files.
 *
 * The screen runs in Profiling as well as Draft; `confirmChoice` picks the
 * transition the stage allows, so this hook stays stage-agnostic.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  MAPPING_FIELDS,
  ZONE_LABEL,
  type DraftFields,
  type ExtractedField,
  type Invoice,
  type LineItemsSpec,
  type OcrWord,
  type VendorTemplate,
  type Zone,
  type ZoneField,
} from "@/lib/ap/types";
import {
  firstPageWords,
  IDENTITY_FIELDS,
  proposeAnchor,
  resizeZone,
  totalsCrossCheck,
  unionBox,
  wordAtPoint,
  wordsInRect,
  type ResizeDirection,
} from "@/lib/ap/mapping";
import { runForShape } from "@/lib/ap/field-shape";
import { moneyToNumber } from "@/lib/ap/zones";
import {
  learnFieldFromValue as learnFieldInProfile,
  type LearnOutcome,
} from "@/lib/ap/vendor-profile-store";
import { resolveVendorKey } from "@/lib/ap/vendor-profile-store";
import { countOf } from "@/lib/ap/vocabulary";
import type { ValueLocation } from "@/lib/ap/mapping";
import { useAp } from "@/lib/app/store";
import { operatorActorWithRole } from "@/lib/ap/operator";
import type { VendorMaster } from "@/lib/ap/vendor-master";
import {
  confirmDraft,
  persistDraftLineItemsSpec,
} from "@/lib/ap/use-cases/confirm-draft";
import { draftTriage } from "@/lib/ap/use-cases/draft-triage";
import { templateSaveGate } from "@/lib/ap/use-cases/template-save";
import {
  hasPendingProposal,
  pendingRoutineProposalFields,
  proposeFieldMappings,
  type DraftAssignment,
  type DraftAssignments,
} from "@/lib/ap/mapping-proposals";

/** Maximum undo steps kept in memory. */
const UNDO_HISTORY_LIMIT = 20;
/** Scroll margin (px) above a zone when panning the document to a field. */
const FOCUS_SCROLL_MARGIN_PX = 120;
/** Padding (normalized) around a freshly assigned value region. */
const VALUE_REGION_PAD = 0.008;

/** The draft mapper's assignment vocabulary is domain-owned; the screen just
 *  carries it. These aliases keep the names the mapper components already use. */
export type Assignment = DraftAssignment;
export type AssignmentsByField = DraftAssignments;
export type { DraftFields } from "@/lib/ap/types";

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
  const proposals = proposeFieldMappings(invoice, words);
  for (const field of MAPPING_FIELDS) {
    const proposal = proposals[field];
    if (!proposal) {
      out[field] = undefined;
      continue;
    }
    out[field] = {
      field,
      zone: proposal.zone,
      anchor: proposal.anchor ?? (words ? proposeAnchor(words, proposal.zone) : undefined),
      proposal,
    };
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
    businessProfile,
    vendorProfiles,
  } = useAp();
  const words = useMemo(() => firstPageWords(invoice), [invoice]);
  const existingTemplate: VendorTemplate | undefined = templates[invoice.vendor];

  const [fields, setFields] = useState<DraftFields>(() => toDraftFields(invoice));
  /** Fields found to be missing from this page, remembered for next time. */
  const [absentNow, setAbsentNow] = useState<ZoneField[]>([]);
  const [assignments, setAssignments] = useState<AssignmentsByField>(() =>
    seedAssignments(invoice, words),
  );
  const [undoStack, setUndoStack] = useState<AssignmentsByField[]>([]);
  const [confirmedMappings, setConfirmedMappings] = useState<Partial<Record<ZoneField, boolean>>>(
    {},
  );
  const [activeField, setActiveField] = useState<ExtractedField | null>(null);
  const [assignMode, setAssignMode] = useState(false);
  const [pendingClickPoint, setPendingClickPoint] = useState<{ x: number; y: number } | null>(null);
  const [pendingSelection, setPendingSelection] = useState<Zone | null>(null);
  const selectionStart = useRef<{ x: number; y: number } | null>(null);
  const resizeGesture = useRef<{
    field: ZoneField;
    direction: ResizeDirection;
    zone: Zone;
    pointerId: number;
    clientX: number;
    clientY: number;
    snapshot: AssignmentsByField;
    changed: boolean;
  } | null>(null);
  const [isLineItemEditorOpen, setLineItemEditorOpen] = useState(false);
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const [documentImage, setDocumentImage] = useState<HTMLImageElement | null>(null);

  // Triage is domain policy: statuses, work order, blocking issues and the
  // proposal counts come from one call instead of six derivations in the view.
  // Profiling a first-time vendor pulls the identity values into the same
  // worklist, so the document is mapped once rather than typed and then mapped.
  const profiling = invoice.status === "vendor_profile";
  /**
   * Fields remembered as not printed, learned earlier for this vendor plus any
   * found on this invoice. A field remembered as absent is not raised as
   * missing again — asking for it every time is how a reviewer learns to stop
   * reading the question.
   */
  const absentFields = useMemo<ZoneField[]>(() => {
    const known = vendorProfiles[resolveVendorKey(invoice)]?.absentFields ?? [];
    return [...new Set([...known, ...absentNow])];
  }, [vendorProfiles, invoice, absentNow]);
  const triage = useMemo(
    () =>
      draftTriage({
        invoice,
        assignments,
        confirmedMappings,
        includeIdentity: profiling,
        absentFields,
      }),
    [invoice, assignments, confirmedMappings, profiling, absentFields],
  );
  const crossCheck = totalsCrossCheck(invoice);

  const recordSnapshotForUndo = useCallback((snapshotBeforeChange: AssignmentsByField) => {
    setUndoStack((stack) => [...stack.slice(-(UNDO_HISTORY_LIMIT - 1)), snapshotBeforeChange]);
  }, []);

  const recordForUndo = useCallback(
    (snapshotBeforeChange: AssignmentsByField, next: AssignmentsByField) => {
      recordSnapshotForUndo(snapshotBeforeChange);
      setAssignments(next);
    },
    [recordSnapshotForUndo],
  );

  const undoLastAssignment = useCallback(() => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setAssignments(previous);
    setConfirmedMappings((current) => {
      const next = { ...current };
      for (const field of MAPPING_FIELDS) {
        if (assignments[field] === previous[field]) continue;
        const restored = previous[field];
        if (!restored) {
          delete next[field];
        } else if (restored.proposal && restored.proposal.source !== "saved") {
          // A proposal restored by undo is unconfirmed again. Never let a prior
          // manual confirmation leak onto a different candidate region.
          next[field] = false;
        } else {
          next[field] = true;
        }
      }
      return next;
    });
    setUndoStack(undoStack.slice(0, -1));
  }, [assignments, undoStack]);

  /** The undo a toast offers must run the latest undo, not the one captured
   *  when the toast was raised. */
  const undoLastAssignmentRef = useRef(undoLastAssignment);
  useEffect(() => {
    undoLastAssignmentRef.current = undoLastAssignment;
  }, [undoLastAssignment]);

  /**
   * Removes one source region. A wrong box is a mistake the mapper has to be
   * able to take back, not something to undo field by field: the region is
   * dropped from the assignments, its confirmation is dropped with it, and
   * the whole step goes on the undo stack like any other mapping edit.
   */
  const removeAssignment = useCallback(
    (field: ZoneField) => {
      if (!assignments[field]) return;
      const next = { ...assignments };
      delete next[field];
      recordForUndo(assignments, next);
      setConfirmedMappings((current) => {
        const updated = { ...current };
        delete updated[field];
        return updated;
      });
      setActiveField((current) => (current === field ? null : current));
      toast(`${ZONE_LABEL[field]} box removed`, {
        description: "The value stays on the invoice — only the source region is gone.",
        action: { label: "Undo", onClick: () => undoLastAssignmentRef.current?.() },
      });
    },
    [assignments, recordForUndo],
  );

  /** Explicitly accepts one proposed source region after visual review. */
  const confirmMapping = useCallback(
    (field: ZoneField) => {
      const proposal = assignments[field]?.proposal;
      if (!proposal || !hasPendingProposal(assignments[field], confirmedMappings[field])) return;
      setConfirmedMappings((current) => ({ ...current, [field]: true }));
      setActiveField(field);
      toast.success(`${ZONE_LABEL[field]} mapping confirmed`, {
        description: proposal.reason,
      });
    },
    [assignments, confirmedMappings],
  );

  /**
   * Agrees a list of proposed regions in one action. The screen calls this for
   * the fields the machine is sure about, so twelve bookkeeping presses become
   * one and the reviewer's attention lands on the two that are genuinely
   * undecided. A single toast, because a dozen toasts is a dozen decisions.
   */
  const confirmFields = useCallback(
    (fields: readonly ZoneField[]) => {
      const agreeing = fields.filter((field) =>
        hasPendingProposal(assignments[field], confirmedMappings[field]),
      );
      if (agreeing.length === 0) return;
      setConfirmedMappings((current) => {
        const next = { ...current };
        for (const field of agreeing) next[field] = true;
        return next;
      });
      toast.success(`${countOf(agreeing.length, "field")} checked`, {
        description: "What was left is what we are not sure about.",
      });
    },
    [assignments, confirmedMappings],
  );

  /** Accepts the routine, non-critical proposals in one deliberate action. */
  const acceptAllNonCriticalProposals = useCallback(() => {
    const fields = pendingRoutineProposalFields(assignments, confirmedMappings);
    if (fields.length === 0) {
      toast.info("All routine proposals are already accepted");
      return;
    }
    setConfirmedMappings((current) => {
      const next = { ...current };
      for (const field of fields) next[field] = true;
      return next;
    });
    toast.success(`${fields.length} routine mapping${fields.length === 1 ? "" : "s"} accepted`, {
      description: "Critical fields still need a separate confirmation.",
    });
  }, [assignments, confirmedMappings]);

  const isMappingConfirmed = useCallback(
    (field: ZoneField) => !hasPendingProposal(assignments[field], confirmedMappings[field]),
    [assignments, confirmedMappings],
  );

  useEffect(() => {
    const handleUndoShortcut = (event: KeyboardEvent) => {
      const isUndoKey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z";
      if (isUndoKey) {
        event.preventDefault();
        undoLastAssignment();
      }
    };
    const handleDeleteShortcut = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      // Never steal a keystroke from a field the reviewer is typing in.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (!activeField) return;
      const field = activeField as ZoneField;
      if (!assignments[field]) return;
      event.preventDefault();
      removeAssignment(field);
    };
    window.addEventListener("keydown", handleUndoShortcut);
    window.addEventListener("keydown", handleDeleteShortcut);
    return () => {
      window.removeEventListener("keydown", handleUndoShortcut);
      window.removeEventListener("keydown", handleDeleteShortcut);
    };
  }, [undoLastAssignment, removeAssignment, activeField, assignments]);

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

  /** Starts an edge or corner resize for one source region. */
  const handleResizePointerDown = useCallback(
    (
      event: React.PointerEvent<HTMLButtonElement>,
      field: ZoneField,
      direction: ResizeDirection,
    ) => {
      const assignment = assignments[field];
      if (!assignment) return;
      event.preventDefault();
      event.stopPropagation();
      // Capture on the scroll pane rather than the handle. Pointer capture
      // retargets events to the handle, which makes scrolling out of the pane
      // an unreliable way to finish a resize.
      (scrollContainer ?? event.currentTarget).setPointerCapture(event.pointerId);
      resizeGesture.current = {
        field,
        direction,
        zone: assignment.zone,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        snapshot: assignments,
        changed: false,
      };
      setActiveField(field);
      setConfirmedMappings((current) => ({ ...current, [field]: true }));
    },
    [assignments, scrollContainer],
  );

  const handleResizeKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLButtonElement>,
      field: ZoneField,
      direction: ResizeDirection,
    ): boolean => {
      const horizontal = direction.includes("e") || direction.includes("w");
      const vertical = direction.includes("n") || direction.includes("s");
      const step = event.shiftKey ? 0.02 : 0.004;
      let deltaX = 0;
      let deltaY = 0;
      if (horizontal && event.key === "ArrowLeft") deltaX = -step;
      if (horizontal && event.key === "ArrowRight") deltaX = step;
      if (vertical && event.key === "ArrowUp") deltaY = -step;
      if (vertical && event.key === "ArrowDown") deltaY = step;
      if (deltaX === 0 && deltaY === 0) return false;
      const assignment = assignments[field];
      if (!assignment) return false;
      const zone = resizeZone(assignment.zone, direction, deltaX, deltaY);
      const unchanged =
        zone.x === assignment.zone.x &&
        zone.y === assignment.zone.y &&
        zone.w === assignment.zone.w &&
        zone.h === assignment.zone.h;
      if (unchanged) return false;
      event.preventDefault();
      event.stopPropagation();
      recordSnapshotForUndo(assignments);
      const anchor = words ? proposeAnchor(words, zone) : undefined;
      setAssignments((current) => ({
        ...current,
        [field]: { field, zone, anchor },
      }));
      setConfirmedMappings((current) => ({ ...current, [field]: true }));
      setActiveField(field);
      return true;
    },
    [assignments, recordSnapshotForUndo, words],
  );

  /**
   * The one place words on the page become a mapped field: box, anchor, value
   * and invoice all move together, and the whole thing is one undo step.
   *
   * Both routes in — a click on a focused field, and the region → field
   * popover — go through here, so a mapping made either way is identical.
   */
  const linkWordsToField = useCallback(
    (field: ZoneField, selectedWords: OcrWord[], opts?: { keepValue?: boolean }) => {
      if (selectedWords.length === 0 || !words) return;
      const zone = unionBox(selectedWords, VALUE_REGION_PAD);
      const anchor = proposeAnchor(words, zone);
      const ocrText = selectedWords
        .map((w) => w.text)
        .join(" ");
      recordForUndo(assignments, { ...assignments, [field]: { field, zone, anchor } });
      setConfirmedMappings((current) => ({ ...current, [field]: true }));
      setPendingClickPoint(null);
      setPendingSelection(null);
      setAssignMode(false);
      // The link target is spent. Leaving it armed would mean the next stray
      // click on the page overwrites a mapping the reviewer just made.
      setActiveField(null);
      // A person who typed the value is the authority on it — the page is only
      // being asked where it lives, not what it says.
      if (opts?.keepValue) {
        toast.success(`${ZONE_LABEL[field]} found on the page`, {
          description: anchor
            ? `Boxed the text next to “${anchor}” and remembered it.`
            : "Boxed the text. No label beside it to remember the place by.",
        });
        return;
      }
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
    [words, assignments, fields, invoice.id, recordForUndo, updateInvoice],
  );

  /**
   * "Find it on the page": the person typed the value, we look for that text
   * and box it. The box, the assignment and the remembered template all come
   * from the same words, so what they see on the page is what was learned.
   */
  const findValueOnPage = useCallback(
    (field: ZoneField, chosen?: ValueLocation): LearnOutcome => {
      const outcome = learnFieldInProfile(invoice, field, fields[field], chosen);
      if (outcome.status === "learned") {
        linkWordsToField(field, outcome.words, { keepValue: true });
      } else if (outcome.status === "absent") {
        setAbsentNow((prev) => (prev.includes(field) ? prev : [...prev, field]));
        toast(`${ZONE_LABEL[field]} is not printed on this invoice`, {
          description: "The value is saved. We will not ask for it on this vendor again.",
        });
      } else if (outcome.status === "ambiguous") {
        toast("Found more than one place", {
          description: "Pick the right one and we will remember that.",
        });
      } else if (outcome.status === "no-anchor") {
        toast("Found it, but nothing to remember it by", {
          description: `${ZONE_LABEL[field]} has no label beside it, so no box is saved. Draw one if it should be remembered.`,
        });
      } else {
        toast("This page has no text to search", {
          description: "The value is saved; the place is not remembered.",
        });
      }
      return outcome;
    },
    [invoice, fields, linkWordsToField],
  );

  /** Region → field, step 2: link the pending selection to the chosen field. */
  const assignPendingClickTo = useCallback(
    (field: ZoneField) => {
      if (!pendingSelection || !words) return;
      linkWordsToField(field, wordsInRect(words, pendingSelection));
    },
    [pendingSelection, words, linkWordsToField],
  );

  /**
   * The words a click landed on: the word under the cursor, extended rightwards
   * along its own line as far as this field's shape allows.
   *
   * Anchoring on the word actually touched is what makes the gesture safe —
   * a box around the cursor would happily swallow the label beside the value —
   * while the extension is what lets "1.210,00" be caught by a click on its
   * first digit.
   */
  const wordsFromClick = useCallback(
    (field: ZoneField, point: { x: number; y: number }): OcrWord[] => {
      if (!words) return [];
      const hit = wordAtPoint(words, point.x, point.y);
      if (!hit) return [];
      const toRight = words
        .filter(
          (word) =>
            Math.abs(word.y + word.h / 2 - (hit.y + hit.h / 2)) <= Math.max(word.h, hit.h) * 0.6 &&
            word.x >= hit.x - 0.001,
        )
        .sort((a, b) => a.x - b.x);
      return runForShape(field, toRight);
    },
    [words],
  );

  /** Region → field, step 1: draw a precise selection on the document. */
  const handleDocumentPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Two ways in, both without a mode to discover: a field the reviewer has
      // focused, or the explicit "draw a region" mode.
      if ((!assignMode && !activeField) || !documentImage) return;
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
    [assignMode, activeField, documentImage],
  );

  const handleDocumentPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const resize = resizeGesture.current;
      if (resize?.pointerId === event.pointerId && documentImage) {
        event.preventDefault();
        event.stopPropagation();
        const rect = documentImage.getBoundingClientRect();
        const zone = resizeZone(
          resize.zone,
          resize.direction,
          (event.clientX - resize.clientX) / rect.width,
          (event.clientY - resize.clientY) / rect.height,
        );
        if (!resize.changed) {
          recordSnapshotForUndo(resize.snapshot);
          resize.changed = true;
        }
        const anchor = words ? proposeAnchor(words, zone) : undefined;
        setAssignments((current) => ({
          ...current,
          [resize.field]: { field: resize.field, zone, anchor },
        }));
        return;
      }

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
    [documentImage, recordSnapshotForUndo, words],
  );

  const handleDocumentPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const resize = resizeGesture.current;
      if (resize?.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopPropagation();
        resizeGesture.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        return;
      }

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
        // A click, not a drag. With a field armed that is the whole gesture:
        // touch the row, touch the value. Without one, say what to do instead.
        if (activeField) {
          const clicked = wordsFromClick(activeField, point);
          if (clicked.length === 0) {
            setPendingSelection(null);
            toast.info("No readable text there", {
              description: `Click on the ${ZONE_LABEL[activeField].toLowerCase()} itself.`,
            });
            return;
          }
          linkWordsToField(activeField, clicked);
          return;
        }
        setPendingSelection(null);
        toast.info("Draw a box around the value", {
          description: "Pick a field first, then click its value. Or press and drag.",
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

      // A field the reviewer has focused takes the click directly: the whole
      // gesture is "touch the row, touch the value". The popover is kept for
      // the unguided case, where there is no field to assign to yet.
      if (activeField) {
        linkWordsToField(activeField, selectedWords);
        return;
      }
      const center = unionBox(selectedWords);
      setPendingClickPoint({ x: center.x + center.w / 2, y: center.y + center.h / 2 });
    },
    [documentImage, words, activeField, linkWordsToField, wordsFromClick],
  );

  /** Pointer cancellation must clear transient gesture state, not commit a partial edit. */
  const handleDocumentPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    selectionStart.current = null;
    resizeGesture.current = null;
    setPendingSelection(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

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

  const confirmChoice = useCallback(
    (opts?: { profile?: VendorMaster | undefined; learnedCount?: number | undefined }) => {
      const gate = templateSaveGate({ invoice, assignments, confirmedMappings, absentFields });
      if (!gate.ok) {
        toast.error(gate.title, { description: gate.message });
        return;
      }

      const result = confirmDraft(
        {
          invoice,
          fields,
          assignments,
          words: words ?? [],
          existingTemplate,
          confirmedMappings,
          profile: opts?.profile,
          profileUpdatedAt: new Date().toISOString(),
          learnedCount: opts?.learnedCount ?? 0,
          actor: operatorActorWithRole("processor", businessProfile),
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
        toast.error("We couldn't submit this for approval", {
          description: result.message,
        });
        return;
      }

      toast.success(`We confirmed ${invoice.vendor} — ready for approval`, {
        description: `Profile saved · ${result.learnedCount} anchor${
          result.learnedCount === 1 ? "" : "s"
        } learned.`,
      });
    },
    [
      assignments,
      fields,
      invoice,
      words,
      existingTemplate,
      confirmedMappings,
      saveVendorTemplate,
      updateInvoice,
      applyTransition,
      confirmTemplateExtraction,
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
      const result = persistDraftLineItemsSpec(
        {
          invoice,
          vendor: fields.vendor || invoice.vendor,
          assignments,
          words: words ?? [],
          lineItems,
          existingTemplate,
          confirmedMappings,
        },
        { saveVendorTemplate },
      );
      if (!result.ok) toast.info(result.message);
    },
    [
      assignments,
      confirmedMappings,
      existingTemplate,
      fields.vendor,
      invoice,
      saveVendorTemplate,
      words,
    ],
  );

  return {
    // data
    words,
    existingTemplate,
    fields,
    /** True while a first-time vendor's identity is being mapped. */
    profiling,
    assignments,
    undoStack,
    activeField,
    assignMode,
    pendingClickPoint,
    pendingSelection,
    isLineItemEditorOpen,
    // Triage values arrive from the domain use case, under the names the
    // mapper components already read.
    triageStatuses: triage.statuses,
    triageOrder: triage.order,
    crossCheck,
    validationIssues: triage.validationIssues,
    blockingIssues: triage.blockingIssues,
    absentFields,
    allFieldsVerified: triage.allFieldsVerified,
    mappedCount: triage.mappedCount,
    proposalCount: triage.proposalCount,
    pendingNonCriticalProposalCount: triage.pendingRoutineProposalCount,
    unconfirmedProposalCount: triage.unconfirmedProposalCount,
    unconfirmedCriticalFields: triage.unconfirmedCriticalFields,
    attention: triage.attention,
    /** Proposals one deliberate action can agree, so the worklist stays the work. */
    settleable: triage.settleable,
    isMappingConfirmed,
    // refs (callback refs so the hook can pan/measure)
    setScrollContainer,
    setDocumentImage,
    // actions
    focusField,
    setActiveField,
    linkWordsToField,
    findValueOnPage,
    toggleAssignMode,
    handleDocumentPointerDown,
    handleDocumentPointerMove,
    handleDocumentPointerUp,
    handleDocumentPointerCancel,
    handleResizePointerDown,
    handleResizeKeyDown,
    removeAssignment,
    assignPendingClickTo,
    dismissPendingClick: () => {
      setPendingClickPoint(null);
      setPendingSelection(null);
    },
    editDraftValue,
    confirmMapping,
    confirmFields,
    acceptAllNonCriticalProposals,
    confirmChoice,
    saveLineItemsSpec,
    undoLastAssignment,
  };
}

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
  // Identity values are read off the document like any other field and written
  // back to the invoice they were read from. The vendor record is derived from
  // them at confirm time (`seedProfileFromInvoice`), so there is one value in
  // one place instead of a form shadowing the mapping.
  if (IDENTITY_FIELDS.includes(field)) return { [field]: value };
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
