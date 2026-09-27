/**
 * Zone check chip — shown beside each zoned field on the invoice review
 * page. Green when the AI value and the OCR crop agree, amber when they
 * disagree, null when no check ran (no template for this vendor, or the
 * crop was unreadable). Clicking focuses the field via the `fieldRef`.
 */
import { AlertTriangle, Check } from "@/components/icons";
import { cn } from "@/lib/utils";
import { parseDateParts } from "@/lib/ap/zones";
import type { ZoneCheckResult, ZoneField } from "@/lib/ap/types";

export function ZoneCheckChip({
  result,
  currency,
  onFocus,
  className,
}: {
  result: ZoneCheckResult | undefined;
  currency?: string | undefined;
  onFocus?: () => void;
  className?: string | undefined;
}) {
  if (!result) return null;
  const { field, ai, ocr, match } = result;
  const tone = match
    ? "bg-success/15 text-success-foreground"
    : "bg-warning/15 text-warning-foreground";
  const displayAi = ai || "(empty)";
  // Display DD-MM-YYYY for date fields to match the UI convention.
  const formattedAi =
    (field === "issueDate" || field === "dueDate") && ai
      ? (() => {
          const p = parseDateParts(ai);
          return p
            ? `${String(p.day).padStart(2, "0")}-${String(p.month).padStart(2, "0")}-${p.year}`
            : ai;
        })()
      : ai;
  const formattedOcr = ocr.trim() || "(unreadable)";
  return (
    <button
      type="button"
      onClick={onFocus}
      title={
        match
          ? `Read twice: the value and the document text agree for ${fieldLabel(field)}.`
          : `Read twice: the extracted value "${formattedAi}" doesn't match the document text "${formattedOcr}" for ${fieldLabel(field)}.`
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs font-medium",
        tone,
        className,
      )}
    >
      {match ? <Check className="size-2.5" /> : <AlertTriangle className="size-2.5" />}
      <span className="font-mono">
        {match
          ? `✓ ${fieldLabel(field)} · text agrees`
          : `✗ ${fieldLabel(field)} · text differs: ${truncate(formattedOcr)}`}
      </span>
    </button>
  );
}

function fieldLabel(field: ZoneField): string {
  switch (field) {
    case "vendor":
      return "vendor";
    case "invoiceNumber":
      return "invoice no.";
    case "issueDate":
      return "issue date";
    case "dueDate":
      return "due date";
    case "subtotal":
      return "subtotal";
    case "tax":
      return "tax";
    case "total":
      return "total";
    default:
      return field;
  }
}

function truncate(s: string): string {
  return s.length > 18 ? `${s.slice(0, 18)}…` : s;
}

/** Returns the ZoneCheckResult for a given field, if any. Domain-owned now —
 *  triage reads the same query without going through a component. */
export { resultFor } from "@/lib/ap/mapping";

