/**
 * ApprovalCompare — the one comparison surface of the For approval page.
 *
 * Every group reads the same way: what the document says, what we already hold,
 * and a verdict for the pair. Matching rows collapse behind a count so the
 * exceptions are what's left on screen (the rule the approval card already used
 * for PO lines, generalized to vendor identity, amounts, flags and coding).
 *
 * The component is presentational: the verdict rows come from
 * `lib/ap/approval.ts`, and the editable pieces sit in slots the route fills —
 * an inline editor per field, the line-items editor, and the coding controls.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, Crosshair, Pencil } from "@/components/icons";
import { ZoneCheckChip } from "./zone-check-chip";
import { List, ListItem, Pill, Section, SectionHeader } from "./primitives";
import { cn } from "@/lib/utils";
import { countOf } from "@/lib/ap/vocabulary";
import type { ApprovalCheck, ApprovalGroup, ApprovalVerdict } from "@/lib/ap/approval";
import type { ZoneField } from "@/lib/ap/types";

type GroupProps = {
  group: ApprovalGroup;
  onFocus: (field: ZoneField) => void;
  canFocus: (field: ZoneField) => boolean;
  focusedField?: ZoneField | undefined;
  /** Editable control for a row, keyed by its check id — replaces the read-only
   *  document value, so correcting a value happens where it is compared. */
  checkEditors?: Record<string, ReactNode> | undefined;
  /** Route-supplied action node(s), keyed by check id. */
  checkActions?: Record<string, ReactNode> | undefined;
  /** Vendor logo + name + the vendor-record menu, above the identity rows. */
  vendorHeader?: ReactNode | undefined;
  /** The line-items block, revealed from the Lines group: editable on a record
   *  that is still being worked, the amounts as facts on one already decided. */
  linesEditor?: ReactNode | undefined;
  linesEditorOpen?: boolean | undefined;
  /** Label for that block while it is closed — "Correct the…" promises an edit
   *  a locked record cannot take, so the route names it after what is inside. */
  linesToggleLabel?: string | undefined;
  /** Editable coding controls (department + GL account). */
  codingEditor?: ReactNode | undefined;
  /** The purchase-order picker, under the commitment rows. */
  commitmentsEditor?: ReactNode | undefined;
};

/** A check with no document side is evidence about the invoice, not a comparison. */
const isEvidence = (check: ApprovalCheck): boolean => check.documentValue === "—";

function chip(check: ApprovalCheck): {
  label: string;
  variant: "success" | "warning" | "destructive";
} {
  if (check.severity === "blocking") return { label: "blocks approval", variant: "destructive" };
  if (isEvidence(check)) {
    if (check.severity === "attention") return { label: "flagged", variant: "warning" };
    // Coding is ours: "chosen" says what happened, "noted" does not.
    return check.group === "coding"
      ? { label: "chosen", variant: "success" }
      : { label: "noted", variant: "success" };
  }
  return check.severity === "attention"
    ? { label: "needs a look", variant: "warning" }
    : { label: "matches", variant: "success" };
}

function CheckRow({
  check,
  onFocus,
  canFocus,
  focused,
  editor,
  checkActions,
}: {
  check: ApprovalCheck;
  onFocus: (field: ZoneField) => void;
  canFocus: (field: ZoneField) => boolean;
  focused: boolean;
  editor?: ReactNode | undefined;
  checkActions?: Record<string, ReactNode> | undefined;
}) {
  const action = checkActions?.[check.id];
  const verdict = chip(check);
  const field = check.field;
  const focusable = field !== undefined && canFocus(field);
  // Two columns only when both sides exist. A row with one real side gets one
  // column and no column headings: when we hold nothing (the header fields the
  // record simply needs) the document value stands alone, and when the document
  // says nothing (our PO match, our coding) our own record stands alone. A
  // header over an em dash is a label that carries nothing.
  const evidence = isEvidence(check);
  const counterpart = check.heldValue;
  const twoColumn = counterpart !== undefined && !evidence;
  const soleValue = counterpart ?? check.documentValue;
  // The source page describes where the document value was read; it means
  // nothing beside our own record.
  const meta = !evidence && check.sourcePage !== undefined;
  const zoneChip =
    check.zoneCheck && field !== undefined ? (
      <ZoneCheckChip
        result={check.zoneCheck}
        verified={check.corrected}
        {...(focusable ? { onFocus: () => onFocus(field) } : {})}
      />
    ) : null;
  return (
    <ListItem
      id={`check-${check.id}`}
      className={cn("transition-colors", focused && "bg-accent/5")}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{check.label}</p>
        <span className="flex shrink-0 items-center gap-1.5">
          {check.corrected ? (
            <span
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              title="You changed this after we read it."
            >
              <Pencil className="size-2.5" /> corrected
            </span>
          ) : null}
          <Pill variant={verdict.variant}>{verdict.label}</Pill>
          {focusable ? (
            <button
              type="button"
              onClick={() => onFocus(field)}
              aria-label={`Show ${check.label} in the document`}
              title="Show in the document"
              className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Crosshair className="size-3" />
            </button>
          ) : null}
        </span>
      </div>

      {!twoColumn ? (
        <div className="mt-1.5 min-w-0">
          {editor ?? <p className="text-sm break-words text-foreground">{soleValue}</p>}
          {meta || zoneChip ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {check.sourcePage !== undefined ? (
                <span className="font-mono text-xs text-muted-foreground">
                  p.{check.sourcePage}
                </span>
              ) : null}
              {zoneChip}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">On the document</p>
            {editor ?? (
              <p className="mt-0.5 text-sm break-words text-foreground">{check.documentValue}</p>
            )}
            {meta || zoneChip ? (
              <p className="mt-1 flex flex-wrap items-center gap-1.5">
                {check.sourcePage !== undefined ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    p.{check.sourcePage}
                  </span>
                ) : null}
                {zoneChip}
              </p>
            ) : null}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">What we hold</p>
            <p className="mt-0.5 text-sm break-words text-foreground">{counterpart}</p>
          </div>
        </div>
      )}

      {check.detail ? (
        <p
          className={cn(
            "mt-2 text-xs",
            check.severity === "blocking"
              ? "text-destructive"
              : check.severity === "attention"
                ? "text-warning-foreground"
                : "text-muted-foreground",
          )}
        >
          {check.detail}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </ListItem>
  );
}

function Group({
  group,
  onFocus,
  canFocus,
  focusedField,
  checkEditors,
  checkActions,
  vendorHeader,
  linesEditor,
  linesEditorOpen = false,
  linesToggleLabel = "Correct the line items",
  codingEditor,
  commitmentsEditor,
}: GroupProps) {
  const issues = group.checks.filter((check) => check.severity !== "ok");
  const matches = group.checks.filter((check) => check.severity === "ok");
  const collapsible = issues.length > 0 && matches.length > 0;
  const [showMatches, setShowMatches] = useState(!collapsible);
  const [showLines, setShowLines] = useState(linesEditorOpen);

  const row = (check: ApprovalCheck) => (
    <CheckRow
      key={check.id}
      check={check}
      onFocus={onFocus}
      canFocus={canFocus}
      focused={check.field !== undefined && check.field === focusedField}
      {...(checkEditors?.[check.id] ? { editor: checkEditors[check.id] } : {})}
      checkActions={checkActions}
    />
  );

  return (
    <Section>
      {/* The group states its name and nothing more: a row-level count above
          rows that are already marked was a fourth counter saying what the
          pills and the collapsed-matches toggle say. */}
      <SectionHeader title={group.label} />
      {group.group === "vendor" && vendorHeader ? (
        <div className="border-b border-border px-4 py-3">{vendorHeader}</div>
      ) : null}
      <List>
        {issues.map(row)}
        {collapsible ? (
          <ListItem className="p-0">
            <button
              type="button"
              onClick={() => setShowMatches((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40"
            >
              <span>
                {countOf(matches.length, "row")} match ✓ — {showMatches ? "collapse" : "expand"}
              </span>
              <ChevronDown
                className={cn("size-3.5 transition-transform", showMatches && "rotate-180")}
              />
            </button>
          </ListItem>
        ) : null}
        {showMatches ? matches.map(row) : null}
      </List>

      {group.group === "lines" && linesEditor ? (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setShowLines((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40"
          >
            <span className="font-medium">
              {showLines ? "Hide the line items" : linesToggleLabel}
            </span>
            <ChevronDown
              className={cn("size-3.5 transition-transform", showLines && "rotate-180")}
            />
          </button>
          {showLines ? linesEditor : null}
        </div>
      ) : null}

      {group.group === "commitments" && commitmentsEditor ? (
        <div className="border-t border-border p-4">{commitmentsEditor}</div>
      ) : null}

      {group.group === "coding" && codingEditor ? (
        <div className="border-t border-border p-4">{codingEditor}</div>
      ) : null}
    </Section>
  );
}

export function ApprovalCompare({
  verdict,
  onFocus,
  canFocus,
  focusedField,
  checkEditors,
  checkActions,
  vendorHeader,
  linesEditor,
  linesEditorOpen,
  linesToggleLabel,
  codingEditor,
  commitmentsEditor,
}: {
  verdict: ApprovalVerdict;
  onFocus: (field: ZoneField) => void;
  canFocus: (field: ZoneField) => boolean;
  focusedField?: ZoneField | undefined;
  checkEditors?: Record<string, ReactNode> | undefined;
  /** Route-supplied action node(s), keyed by check id. */
  checkActions?: Record<string, ReactNode> | undefined;
  vendorHeader?: ReactNode | undefined;
  linesEditor?: ReactNode | undefined;
  linesEditorOpen?: boolean | undefined;
  linesToggleLabel?: string | undefined;
  codingEditor?: ReactNode | undefined;
  commitmentsEditor?: ReactNode | undefined;
}) {
  return (
    <div className="space-y-5">
      {verdict.groups.map((group) => (
        <Group
          key={group.group}
          group={group}
          onFocus={onFocus}
          canFocus={canFocus}
          focusedField={focusedField}
          checkEditors={checkEditors}
          checkActions={checkActions}
          vendorHeader={vendorHeader}
          linesEditor={linesEditor}
          linesEditorOpen={linesEditorOpen}
          linesToggleLabel={linesToggleLabel}
          codingEditor={codingEditor}
          commitmentsEditor={commitmentsEditor}
        />
      ))}
    </div>
  );
}
