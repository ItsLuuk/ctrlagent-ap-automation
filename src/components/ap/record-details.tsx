/**
 * RecordDetails — everything about the record that is not the comparison:
 * how the invoice was read, where it stands in the pipeline, and who did what.
 *
 * Collapsed by default (foundry.md §3 litmus test): an approver's question is
 * whether the content matches, and six workflow facts plus a full audit trail
 * on screen dilute it. Nothing is hidden — it is one click away, and the audit
 * trail stays surfaced rather than buried, as §2 requires.
 *
 * Engine provenance says what happened to the invoice, never what our stack is
 * built from (brand-voice.md §3: no "Vision model", no "Text reader").
 */
import { useState } from "react";
import { ChevronDown } from "@/components/icons";
import { List, ListItem, Section, SectionHeader } from "./primitives";
import { cn } from "@/lib/utils";
import { verifyAuditTrail } from "@/lib/ap/audit-evidence";
import {
  ZONE_LABEL,
  money,
  shortDate,
  shortDateTime,
  type ExtractedField,
  type FieldEvidence,
  type Invoice,
  type OcrMethod,
} from "@/lib/ap/types";

const READ_METHOD: Record<OcrMethod, string> = {
  "text-layer": "read from the document's text layer",
  none: "read from the page image",
};

/** What read the invoice, in the reviewer's language. */
function readPathLabel(invoice: Invoice): string {
  if (invoice.engine === "template") return "Read from this vendor's template";
  if (invoice.engine === "gemma") return "Read from the page image";
  if (invoice.engine === "text") return "Read from the document text";
  return "Read by hand";
}

function RecordFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );
}

export function RecordDetails({
  invoice,
  erpRef,
  syncFailed,
  className,
}: {
  invoice: Invoice;
  erpRef?: string | undefined;
  syncFailed: boolean;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);

  const hasConfirmed = invoice.audit.some((entry) => entry.action === "Confirmed draft");
  const hasApproved = invoice.audit.some((entry) => entry.action === "Approved");
  const hasExported = invoice.audit.some((entry) => entry.action === "Exported");
  const hasHandoffMarker = invoice.audit.some(
    (entry) => entry.action === "Marked ready for external handoff",
  );
  const integrity = verifyAuditTrail(invoice);
  const evidence = Object.entries(invoice.fieldEvidence ?? {}) as [ExtractedField, FieldEvidence][];
  const pages = invoice.ocrPages ?? [];
  const avgConfidence = pages.length
    ? pages.reduce((sum, page) => sum + page.confidence, 0) / pages.length
    : undefined;

  return (
    <Section {...(className ? { className } : {})}>
      <SectionHeader
        title="Record details"
        {...(open ? {} : { hint: "Who did what, and how we read it" })}
        action={
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {open ? "Hide" : "Show"}
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
        }
      />

      {open ? (
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{readPathLabel(invoice)}</span>
            {invoice.pageCount ? (
              <span className="font-mono">
                {invoice.pageCount} page{invoice.pageCount === 1 ? "" : "s"}
                {invoice.ocrMethod ? ` · ${READ_METHOD[invoice.ocrMethod]}` : ""}
              </span>
            ) : null}
            {avgConfidence !== undefined ? (
              <span className="font-mono">
                {Math.round(avgConfidence * 100)}% average confidence
              </span>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <RecordFact label="Extraction" value="Done on this device" />
            <RecordFact
              label="Confirmation"
              value={hasConfirmed ? "Confirmed by a person" : "Not confirmed"}
            />
            <RecordFact label="Approval" value={hasApproved ? "Approved" : "Awaiting approval"} />
            <RecordFact
              label="External handoff"
              value={
                hasHandoffMarker
                  ? "Marked ready for external handoff"
                  : hasExported
                    ? "Exported"
                    : "Not marked"
              }
            />
            <RecordFact
              label="ERP sync"
              value={
                syncFailed
                  ? "Sync failed — needs attention"
                  : erpRef
                    ? `Synced to ERP · ${erpRef}`
                    : "Not synced · ERP not connected"
              }
            />
            <RecordFact label="Payment" value="Not connected — no payment sent" />
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                Field evidence · {evidence.length} fields
              </p>
              <p className={cn("text-xs", integrity.valid ? "text-success-foreground" : "text-destructive")}>
                {integrity.valid ? "Audit chain verified" : "Audit chain needs review"}
                {integrity.legacy > 0 ? ` · ${integrity.legacy} legacy events` : ""}
              </p>
            </div>
            <List className="mt-2 rounded-lg shadow-whisper">
              {evidence.map(([field, item]) => (
                <ListItem key={field} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{ZONE_LABEL[field]}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.value}
                      {item.page !== undefined ? ` · page ${item.page}` : ""}
                      {item.region ? " · document region captured" : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {item.confidence !== undefined ? `${Math.round(item.confidence * 100)}%` : "—"}
                  </span>
                </ListItem>
              ))}
            </List>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Audit history · {invoice.audit.length} events
            </p>
            <List className="mt-2 rounded-lg shadow-whisper">
              {[...invoice.audit].reverse().map((entry) => (
                <ListItem key={entry.id} className="flex gap-3">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/50" />
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{entry.actor}</span> — {entry.action}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {shortDateTime(entry.at)}
                      {entry.note ? ` · ${entry.note}` : ""}
                    </p>
                    {entry.changes && Object.keys(entry.changes).length > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {Object.entries(entry.changes)
                          .map(([field, change]) => `${field}: ${String(change.before ?? "empty")} → ${String(change.after ?? "empty")}`)
                          .join(" · ")}
                      </p>
                    ) : null}
                  </div>
                </ListItem>
              ))}
            </List>
          </div>

          <p className="text-xs text-muted-foreground">
            Due {shortDate(invoice.dueDate)} · {money(invoice.total, invoice.currency)} · recorded{" "}
            {shortDate(invoice.createdAt.slice(0, 10))}
          </p>
        </div>
      ) : null}
    </Section>
  );
}
