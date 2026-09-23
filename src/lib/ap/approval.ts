/**
 * Approval verdict — the For approval page answers exactly one question: does
 * what the document says match what we already hold?
 *
 * "What we hold" is the vendor master record, the linked purchase order, and
 * our own arithmetic. Everything here is pure: no store, no UI. The page
 * renders the result; `approval.test.ts` pins the one invariant that matters —
 * a row blocks approval **only** when the state machine's own approve-scope
 * validation says so (see `validateInvoiceForConfirmation(inv, "approve")` in
 * `mapping.ts`). A check we invent here can look alarming, but it can never
 * disagree with what the Approve button actually does.
 *
 * Copy rules this file obeys (Branding/brand-voice.md §3–4): count and locate,
 * name what still works, first person plural for what we did, and the canonical
 * nouns from `vocabulary.ts`.
 */
import {
  totalsCrossCheck,
  validateInvoiceForConfirmation,
  type InvoiceValidationIssue,
} from "./mapping";
import { matchSummary, type MatchResult } from "./matching";
import { ibanChecksumValid, normalizeIban } from "./iban";
import { money, ZONE_LABEL, type Invoice, type ZoneCheckResult, type ZoneField } from "./types";
import { countOf, term } from "./vocabulary";
import type { PurchaseOrder } from "./po-store";
import type { VendorMaster } from "./vendor-master";

/** Sections of the compare list, in the order they read. */
export type CheckGroup = "vendor" | "header" | "amounts" | "lines" | "commitments" | "coding";

export const GROUP_LABEL: Record<CheckGroup, string> = {
  vendor: "Vendor identity",
  header: "Invoice header",
  amounts: "Amounts",
  lines: "Purchase order lines",
  commitments: "Commitments & flags",
  coding: "Coding",
};

export const GROUP_ORDER: CheckGroup[] = [
  "vendor",
  "header",
  "amounts",
  "lines",
  "commitments",
  "coding",
];

/**
 * `blocking` rows are generated from the validation issues and keep the issue
 * code as their id, so the verdict and the Approve button can never disagree.
 * `attention` rows need a person's judgment but do not stop the approval.
 */
export type CheckSeverity = "ok" | "attention" | "blocking";

export type ApprovalCheck = {
  id: string;
  group: CheckGroup;
  label: string;
  severity: CheckSeverity;
  /** What the document says. "—" when the value is ours, not the page's. */
  documentValue: string;
  /**
   * What we already hold: master record, purchase order, or our arithmetic.
   * Absent when we hold nothing, so the row stops printing a placeholder in the
   * column where a second opinion belongs.
   */
  heldValue?: string | undefined;
  /** One plain-language sentence when the row needs a look. */
  detail?: string | undefined;
  /** 1-based page the document value was read from, when known. */
  sourcePage?: number | undefined;
  confidence?: number | undefined;
  zoneCheck?: ZoneCheckResult | undefined;
  /** Field whose value region the row can highlight in the document. */
  field?: ZoneField | undefined;
  /**
   * The validation code this row carries when it blocks approval. Rows block
   * `only` because of one of the approve-scope validation issues, so this is
   * how the verdict and the Approve button stay in lockstep.
   */
  code?: string | undefined;
  /** Offered by the row itself when the gap can be filled in place. */
  action?: "create-vendor-record" | undefined;
  /** True when the value was edited after we read it (the audit trail records it). */
  corrected?: boolean | undefined;
};

export type ApprovalGroup = { group: CheckGroup; label: string; checks: ApprovalCheck[] };

export type ApprovalVerdict = {
  checks: ApprovalCheck[];
  groups: ApprovalGroup[];
  blocking: ApprovalCheck[];
  attention: ApprovalCheck[];
  ok: ApprovalCheck[];
  /** False while any blocking row is open — mirrors the state machine's gate. */
  canApprove: boolean;
  /** The page's one sentence. */
  headline: string;
};

/** Audit action prefix for a value a person changed after extraction. */
export const CORRECTION_PREFIX = "Corrected";

/** The audit action written when someone changes a value on this screen. */
export function correctionAction(label: string): string {
  return `${CORRECTION_PREFIX} ${label}`;
}

/** Labels corrected after extraction, from the audit trail. */
export function correctedLabels(invoice: Invoice): Set<string> {
  const out = new Set<string>();
  for (const entry of invoice.audit) {
    if (!entry.action.startsWith(`${CORRECTION_PREFIX} `)) continue;
    out.add(
      entry.action
        .slice(CORRECTION_PREFIX.length + 1)
        .trim()
        .toLowerCase(),
    );
  }
  return out;
}

/* ── Value comparison ──────────────────────────────────────────────────── */

/**
 * Codes and numbers compare exactly; names and emails compare by containment
 * (the rule `compareZoneValue` already uses for text fields); addresses compare
 * by how many of the document's words we can find in ours, because the same
 * address is written in many orders.
 */
function sanitize(field: ZoneField, value: string): string {
  if (field === "iban") return normalizeIban(value);
  if (field === "vatNumber" || field === "businessRegistrationNumber") {
    return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }
  return value.replace(/[^A-Za-z0-9]/gi, "").toLowerCase();
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

function addressCoverage(document: string, held: string): number {
  const docWords = words(document);
  if (docWords.length === 0) return 0;
  const heldWords = new Set(words(held));
  const hits = docWords.filter((w) => heldWords.has(w)).length;
  return hits / docWords.length;
}

/** Do the two sides say the same thing, for this field's kind of value? */
export function valuesAgree(field: ZoneField, document: string, held: string): boolean {
  const a = sanitize(field, document);
  const b = sanitize(field, held);
  if (!a || !b) return false;
  if (a === b) return true;
  if (field === "iban" || field === "vatNumber" || field === "businessRegistrationNumber")
    return false;
  if (field === "address") return addressCoverage(document, held) >= 0.8;
  return a.includes(b) || b.includes(a);
}

/** Identity rows, in the order a reviewer reads a vendor block on an invoice. */
const IDENTITY_FIELDS: { field: ZoneField; key: keyof VendorMaster }[] = [
  { field: "vendor", key: "name" },
  { field: "vendorEmail", key: "email" },
  { field: "address", key: "address" },
  { field: "iban", key: "iban" },
  { field: "vatNumber", key: "vatNumber" },
  { field: "businessRegistrationNumber", key: "businessRegistrationNumber" },
];

/** The document's value for an identity field, or "" when we didn't read one. */
function documentIdentity(invoice: Invoice, field: ZoneField): string {
  const value = invoice[field as keyof Invoice];
  if (typeof value !== "string") return "";
  // The email is the one field whose absence we can state, because a name
  // without a contact address is normal on an invoice.
  return value.trim();
}

function identityChecks(invoice: Invoice, record: VendorMaster | undefined): ApprovalCheck[] {
  // `corrected` is applied once at assembly, so every row naming a field picks
  // it up — the amount and header rows, not just the identity ones.
  const base = (
    field: ZoneField,
  ): Pick<ApprovalCheck, "sourcePage" | "confidence" | "zoneCheck"> => ({
    sourcePage: invoice.fieldSources?.[field],
    confidence: invoice.confidence[field],
    zoneCheck: invoice.zoneCheck?.find((z) => z.field === field),
  });

  // No record: the row's two sides say it — the document's vendor against
  // "No record yet" — and the row itself offers the create action (route
  // supplies the button from `action: "create-vendor-record"`). A paragraph
  // explaining the absence here only restated the columns.
  if (!record) {
    return [
      {
        id: "vendor:no-record",
        group: "vendor",
        label: "Vendor record",
        severity: "attention",
        documentValue: invoice.vendor,
        heldValue: "No record yet",
        field: "vendor",
        action: "create-vendor-record",
        ...base("vendor"),
      },
    ];
  }

  const checks: ApprovalCheck[] = [];
  for (const { field, key } of IDENTITY_FIELDS) {
    const fromDocument = documentIdentity(invoice, field);
    const held = (record[key] ?? "").toString().trim();
    const label = ZONE_LABEL[field];
    const common = { id: `vendor:${field}`, group: "vendor" as const, label, ...base(field) };

    // The IBAN carries its own checksum, so it can be wrong even when our two
    // sides agree (or when we hold nothing at all).
    const badCheckDigits = field === "iban" && ibanCheckDigitsValid(fromDocument) === false;

    if (fromDocument && held && valuesAgree(field, fromDocument, held)) {
      checks.push({
        ...common,
        severity: badCheckDigits ? "attention" : "ok",
        documentValue: fromDocument,
        heldValue: held,
        ...(badCheckDigits
          ? {
              // The fact only: the field's editor and the crosshair beside it
              // are the controls that carry re-reading against the page.
              detail:
                "Our record and the document agree, but the IBAN's own check digits don't add up.",
            }
          : {}),
      });
      continue;
    }
    if (badCheckDigits) {
      checks.push({
        ...common,
        severity: "attention",
        documentValue: fromDocument,
        heldValue: held || "Not on file",
        detail: `The IBAN's own check digits don't add up.`,
      });
      continue;
    }
    if (fromDocument && held) {
      checks.push({
        ...common,
        severity: "attention",
        documentValue: fromDocument,
        heldValue: held,
        detail: `The document says ${fromDocument}, our vendor record says ${held}.`,
      });
      continue;
    }
    if (fromDocument) {
      checks.push({
        ...common,
        severity: "attention",
        documentValue: fromDocument,
        heldValue: "Not on file",
        // The gap, as a fact — the vendor-record menu above the rows is the
        // control that carries adding it.
        detail: `We don't hold a ${label.toLowerCase()} for this vendor yet.`,
      });
      continue;
    }
    if (held) {
      checks.push({
        ...common,
        severity: "attention",
        documentValue: "Not read",
        heldValue: held,
        detail: `This document doesn't show a ${label.toLowerCase()}, so we couldn't check it against our record.`,
      });
      continue;
    }
    checks.push({
      ...common,
      severity: "ok",
      documentValue: "—",
      heldValue: "—",
    });
  }
  return checks;
}

/* ── Blocking rows, generated from the state machine's own gate ─────────── */

/**
 * The gap each validation issue names, as a fact. The issue's own `message`
 * is an imperative ("Choose a currency") because the draft screen lists the
 * things to do there; a compare row only states what is missing — the field's
 * editor, the currency menu, or the coding selects beside it carries the
 * instruction.
 */
const ISSUE_FACT: Record<InvoiceValidationIssue["code"], string> = {
  missing_vendor: "No vendor name was read from the document.",
  missing_invoice_number: "No invoice number was read from the document.",
  missing_issue_date: "No issue date was read from the document.",
  invalid_issue_date: "The issue date we read isn't a calendar date.",
  missing_due_date: "No due date was read from the document.",
  invalid_due_date: "The due date we read isn't a calendar date.",
  missing_currency: "No currency was read from the document.",
  invalid_currency: "The currency we read isn't one of the supported currencies.",
  missing_total: "The invoice total we have isn't a positive amount.",
  invalid_total: "The invoice total isn't a usable number.",
  missing_coding: "Neither a department nor a GL account is chosen.",
  line_total_mismatch: "The line items don't add up to the invoice total.",
};

/** How one validation issue presents as a row: where the value lives. */
function blockingRow(invoice: Invoice, issue: InvoiceValidationIssue): ApprovalCheck {
  const currency = invoice.currency || "EUR";
  const totals = totalsCrossCheck(invoice);
  const common = {
    id: issue.code,
    code: issue.code,
    severity: "blocking" as const,
    detail: issue.code === "line_total_mismatch" ? totals.fact : ISSUE_FACT[issue.code],
  };
  switch (issue.code) {
    case "line_total_mismatch":
      return {
        ...common,
        group: "amounts",
        label: "Amounts reconcile",
        documentValue: `${countOf(invoice.lineItems.length, "line")} totalling ${money(totals.sum, currency)}`,
        heldValue: `Invoice total ${money(invoice.total, currency)}`,
        field: "total",
        sourcePage: invoice.fieldSources?.total,
        confidence: invoice.confidence.total,
        zoneCheck: invoice.zoneCheck?.find((z) => z.field === "total"),
      };
    case "missing_coding":
      return {
        ...common,
        group: "coding",
        label: "Coding",
        documentValue: "—",
        heldValue: "Nothing chosen",
      };
    case "invalid_total":
    case "missing_total":
      return {
        ...common,
        group: "amounts",
        label: "Invoice total",
        documentValue: String(invoice.total ?? "Not read"),
        heldValue: "A positive amount",
        field: "total",
      };
    // The header codes and `missing_vendor` are carried by the compare rows
    // that always render for those fields (`headerChecks`, the vendor rows).
    case "missing_invoice_number":
    case "missing_vendor":
    case "missing_issue_date":
    case "invalid_issue_date":
    case "missing_due_date":
    case "invalid_due_date":
    case "missing_currency":
    case "invalid_currency":
      return {
        ...common,
        group: "header",
        label: "Invoice header",
        documentValue: "—",
        heldValue: "—",
      };
  }
}

/**
 * The header fields every record needs. They are not comparisons: we hold no
 * value to check these against, only the requirement that they are there. So a
 * row only names a counterpart when it is blocking ("Required before approval"
 * means something then); when the field is present the row is the document's
 * value and nothing else.
 */
const HEADER_FIELDS: {
  field: ZoneField;
  label: string;
  codes: string[];
}[] = [
  { field: "invoiceNumber", label: "Invoice no.", codes: ["missing_invoice_number"] },
  {
    field: "issueDate",
    label: "Issue date",
    codes: ["missing_issue_date", "invalid_issue_date"],
  },
  { field: "dueDate", label: "Due date", codes: ["missing_due_date", "invalid_due_date"] },
];

/** The requirement a header row is checked against, said only when it fails. */
const HEADER_REQUIREMENT = "Required before approval";

function headerChecks(
  invoice: Invoice,
  issueByCode: Map<InvoiceValidationIssue["code"], InvoiceValidationIssue>,
): ApprovalCheck[] {
  const rows: ApprovalCheck[] = HEADER_FIELDS.map(({ field, label, codes }) => {
    const blockingCode = codes.find((code) =>
      issueByCode.has(code as InvoiceValidationIssue["code"]),
    );
    const issue = blockingCode
      ? issueByCode.get(blockingCode as InvoiceValidationIssue["code"])
      : undefined;
    return {
      id: `header:${field}`,
      group: "header" as const,
      label,
      severity: blockingCode ? ("blocking" as const) : ("ok" as const),
      documentValue: documentIdentity(invoice, field) || "Not read",
      ...(blockingCode ? { heldValue: HEADER_REQUIREMENT } : {}),
      ...(blockingCode ? { code: blockingCode } : {}),
      ...(issue ? { detail: ISSUE_FACT[issue.code] } : {}),
      field,
      sourcePage: invoice.fieldSources?.[field],
      confidence: invoice.confidence[field],
      zoneCheck: invoice.zoneCheck?.find((z) => z.field === field),
    };
  });

  // Currency is read off the document and has no counterpart of ours, so it is
  // not a compare row at all: it appears only when the currency itself is the
  // problem, and then it carries the reason. A passing row said "Matches our
  // currency list", which restates the verdict it was already sitting next to.
  const currencyCode = (["missing_currency", "invalid_currency"] as const).find((code) =>
    issueByCode.has(code),
  );
  if (currencyCode) {
    rows.push({
      id: "header:currency",
      group: "header",
      label: "Currency",
      severity: "blocking",
      documentValue: invoice.currency || "Not read",
      heldValue: "One of the supported currencies",
      code: currencyCode,
      detail: ISSUE_FACT[currencyCode],
    });
  }
  return rows;
}

/* ── The compare groups that never block ────────────────────────────────── */

/**
 * The amount reconciliation row. It carries the `line_total_mismatch` code as
 * its id, so when it blocks it IS that validation issue — one cause, one row.
 */
function amountCheck(invoice: Invoice, issue: InvoiceValidationIssue | undefined): ApprovalCheck {
  const currency = invoice.currency || "EUR";
  const totals = totalsCrossCheck(invoice);
  const lines = countOf(invoice.lineItems.length, "line");
  return {
    id: "amounts:reconcile",
    group: "amounts",
    label: "Amounts reconcile",
    severity: issue ? "blocking" : "ok",
    ...(issue ? { code: issue.code } : {}),
    documentValue: `${lines} totalling ${money(totals.sum, currency)}${
      invoice.subtotal > 0 || invoice.tax > 0
        ? ` · ${money(invoice.subtotal, currency)} + ${money(invoice.tax, currency)} tax`
        : ""
    }`,
    heldValue: `Invoice total ${money(invoice.total, currency)}`,
    detail: issue ? totals.fact : totals.detail || undefined,
    field: "total",
    sourcePage: invoice.fieldSources?.total,
    confidence: invoice.confidence.total,
    zoneCheck: invoice.zoneCheck?.find((z) => z.field === "total"),
  };
}

function lineChecks(
  invoice: Invoice,
  po: PurchaseOrder | undefined,
  match: MatchResult | null | undefined,
): ApprovalCheck[] {
  const currency = invoice.currency || "EUR";
  if (!match) return [];
  if (match.mode === "no_po") {
    return [
      {
        id: "lines:no-po",
        group: "lines",
        label: "Purchase order",
        severity: "attention",
        documentValue: countOf(invoice.lineItems.length, "line"),
        heldValue: "No purchase order linked",
        // States the finding only. Linking a PO and approving anyway are the
        // review screen's controls, sitting right below — and a decided record
        // has neither, so the sentence must not promise them.
        detail:
          "There is nothing on our side to match these lines against — the content was only checked against the total.",
      },
    ];
  }
  const ordered = [...match.lines].sort((a, b) => {
    const aOk = a.status === "matched" ? 1 : 0;
    const bOk = b.status === "matched" ? 1 : 0;
    return aOk - bOk;
  });
  return ordered.map((line, index) => {
    const item = invoice.lineItems.find((x) => x.id === line.invoiceLineId);
    const poLine = po?.lines.find((l) => l.id === line.poLineId);
    const qty = item?.quantity ?? 0;
    const unitPrice = item?.unitPrice ?? 0;
    return {
      id: `lines:${line.invoiceLineId}`,
      group: "lines" as const,
      label: item?.description?.trim() || `${term("line", index + 1)} ${index + 1}`,
      severity: line.status === "matched" ? ("ok" as const) : ("attention" as const),
      documentValue: `${qty} × ${money(unitPrice, currency)} = ${money(item?.amount ?? qty * unitPrice, currency)}`,
      heldValue: poLine
        ? `${poLine.quantity} × ${money(poLine.unitPrice, currency)} = ${money(poLine.amount, currency)}`
        : "No matching PO line",
      ...(line.explanation ? { detail: line.explanation } : {}),
    };
  });
}

function commitmentChecks(
  invoice: Invoice,
  po: PurchaseOrder | undefined,
  match: MatchResult | null | undefined,
): ApprovalCheck[] {
  const checks: ApprovalCheck[] = [];
  const exceptions = match?.exceptions.length ?? 0;
  checks.push({
    id: "commitments:po",
    group: "commitments",
    label: "Purchase order",
    severity: po && exceptions === 0 ? "ok" : "attention",
    // The purchase order is ours, not the page's: this is evidence, not a comparison.
    documentValue: "—",
    heldValue: po
      ? matchSummary(
          match ?? { mode: "no_po", lines: [], exceptions: [], matchedCount: 0 },
          po.number,
        )
      : "Nothing linked",
    // Without a PO the held column already says "Nothing linked" and the lines
    // row carries the one sentence about the absence — a paragraph here only
    // said the same thing twice on the same screen. With one, the fact is the
    // count; the lines rows above carry what each difference is.
    detail:
      po && exceptions > 0
        ? `${countOf(exceptions, "line")} ${exceptions === 1 ? "differs" : "differ"} from ${po.number}.`
        : undefined,
  });

  for (const tag of invoice.tags) {
    const evidence = TAG_EVIDENCE[tag];
    checks.push({
      id: `commitments:flag:${tag}`,
      group: "commitments",
      label: tag,
      severity: evidence?.severity ?? "attention",
      documentValue: "—",
      heldValue: evidence ? evidence.held : "System flag",
      ...(evidence?.detail ? { detail: evidence.detail } : {}),
    });
  }
  return checks;
}

/** What each system flag means to a person deciding on the payment. */
const TAG_EVIDENCE: Record<string, { severity: CheckSeverity; held: string; detail?: string }> = {
  "Duplicate risk": {
    severity: "attention",
    held: "Similar invoice on file",
    detail:
      "Another invoice from this vendor for a similar amount arrived within a week — the same charge may be billed twice.",
  },
  "First-time vendor": {
    severity: "attention",
    held: "No earlier invoices",
    detail:
      "This is the first invoice we have seen from this vendor, so there is no history to compare it against.",
  },
  Late: {
    severity: "attention",
    held: "Due date passed",
    detail: "The due date has passed and no payment is recorded for it.",
  },
  "High value": {
    severity: "ok",
    held: "Above the review threshold",
    detail: "A second pair of eyes is the point of this screen, not a problem with the invoice.",
  },
  Recurring: {
    severity: "ok",
    held: "Earlier invoices on file",
  },
};

function codingChecks(invoice: Invoice, blocked: boolean): ApprovalCheck[] {
  if (blocked) return [];
  const held = [invoice.department, invoice.glAccount].filter((v) => v && v.trim()).join(" · ");
  return [
    {
      id: "coding:chosen",
      group: "coding",
      label: "Coding",
      severity: "ok",
      documentValue: "—",
      heldValue: held || "—",
    },
  ];
}

/** The vendor rows, plus the one validation issue that belongs to them. */
function vendorChecks(
  invoice: Invoice,
  record: VendorMaster | undefined,
  issueByCode: Map<InvoiceValidationIssue["code"], InvoiceValidationIssue>,
): ApprovalCheck[] {
  const rows = identityChecks(invoice, record);
  const issue = issueByCode.get("missing_vendor");
  if (!issue) return rows;
  // Missing vendor name: the row that shows the name carries the block — that
  // is the row a person has to fix.
  const index = Math.max(
    0,
    rows.findIndex((row) => row.id === "vendor:vendor"),
  );
  const row = rows[index]!;
  rows[index] = { ...row, severity: "blocking", code: issue.code, detail: ISSUE_FACT[issue.code] };
  return rows;
}

/* ── Assembly ──────────────────────────────────────────────────────────── */

function naturalList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The head of a row label, for the one-sentence headline. A compare row can be
 * named after something long and dashed ("Compute cluster — annual commitment");
 * inside a sentence that dash reads as punctuation, so the headline keeps only
 * the head. The full label stays on the row itself.
 */
function headlineLabel(label: string): string {
  const head = label.split(/\s[—–]\s|\s\|\s/)[0]?.trim();
  return (head || label).toLowerCase();
}

/** Labels in the order the compare list reads, deduplicated. */
function causeLabels(rows: ApprovalCheck[]): string[] {
  const ordered = [...rows].sort(
    (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
  );
  return [...new Set(ordered.map((row) => headlineLabel(row.label)))];
}

/** The page's one sentence: what stops approval, else what needs a look. */
export function approvalHeadline(
  verdict: Pick<ApprovalVerdict, "blocking" | "attention" | "ok">,
): string {
  if (verdict.blocking.length > 0) {
    return `${countOf(verdict.blocking.length, "issue")} must be fixed before this can be approved — ${naturalList(causeLabels(verdict.blocking))}.`;
  }
  if (verdict.attention.length > 0) {
    const rows = countOf(verdict.attention.length, "row");
    return `Nothing blocks approval. ${rows} ${verdict.attention.length === 1 ? "needs" : "need"} your judgment — ${naturalList(causeLabels(verdict.attention))}.`;
  }
  return `Everything matches — ${countOf(verdict.ok.length, "check")} agree. Nothing needs your judgment.`;
}

export type ApprovalVerdictInput = {
  invoice: Invoice;
  /** Vendor master record for this invoice's vendor, when one exists. */
  vendorRecord?: VendorMaster | undefined;
  /** The linked purchase order, when one is linked. */
  po?: PurchaseOrder | undefined;
  /** PO match result; null/undefined when there are no lines to match. */
  match?: MatchResult | null | undefined;
};

export function buildApprovalVerdict({
  invoice,
  vendorRecord,
  po,
  match,
}: ApprovalVerdictInput): ApprovalVerdict {
  const issues = validateInvoiceForConfirmation(invoice, "approve").filter(
    (issue) => issue.severity === "error",
  );
  const issueByCode = new Map(issues.map((issue) => [issue.code, issue] as const));

  // Codes that a compare row already renders: the header rows, the vendor
  // identity rows, and the amount reconciliation. The rest become their own
  // blocking rows, so every validation error appears exactly once.
  const rendered = new Set([
    "line_total_mismatch",
    "missing_vendor",
    ...HEADER_FIELDS.flatMap((f) => f.codes),
    "missing_currency",
    "invalid_currency",
  ]);
  const blocking = issues
    .filter((issue) => !rendered.has(issue.code))
    .map((issue) => blockingRow(invoice, issue));

  const corrected = correctedLabels(invoice);
  const markCorrected = (check: ApprovalCheck): ApprovalCheck => {
    if (!check.field) return check;
    const label = ZONE_LABEL[check.field].toLowerCase();
    return corrected.has(label) ? { ...check, corrected: true } : check;
  };

  const all: ApprovalCheck[] = [
    ...vendorChecks(invoice, vendorRecord, issueByCode),
    ...headerChecks(invoice, issueByCode),
    ...blocking,
    amountCheck(invoice, issueByCode.get("line_total_mismatch")),
    ...lineChecks(invoice, po, match),
    ...commitmentChecks(invoice, po, match),
    ...codingChecks(invoice, issueByCode.has("missing_coding")),
  ].map(markCorrected);

  const groups: ApprovalGroup[] = GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABEL[group],
    checks: all.filter((check) => check.group === group),
  })).filter((group) => group.checks.length > 0);

  const blockingRows = all.filter((c) => c.severity === "blocking");
  const attention = all.filter((c) => c.severity === "attention");
  const ok = all.filter((c) => c.severity === "ok");

  // Prepaid: the document states the amount was already paid (e.g. "reeds betaald").
  // This is an attention flag, not a blocker — the reviewer still decides how to
  // handle it (see the `paying` flow decision), but it stays visible on the check
  // list so it cannot be missed on a high-value invoice.
  if (invoice.prepaid && invoice.total != null && invoice.total > 0) {
    const snippet = (invoice as { prepaidPhrase?: string }).prepaidPhrase;
    const prepaidRow: ApprovalCheck = {
      id: "header:prepaid",
      group: "header",
      label: "Prepaid",
      severity: "attention",
      documentValue: snippet || "The document states the amount was already paid",
      heldValue: money(invoice.total, invoice.currency || "EUR"),
      detail: `The invoice text describes this amount as already paid (${snippet ?? "reeds betaald"}). Paying it again would be a duplicate payment.`,
    };
    attention.unshift(prepaidRow);
  }

  const verdict: ApprovalVerdict = {
    checks: all,
    groups,
    blocking: blockingRows,
    attention,
    ok,
    canApprove: blockingRows.length === 0,
    headline: "",
  };
  verdict.headline = approvalHeadline(verdict);
  return verdict;
}

/** True when the IBAN we read fails its own check digits — a re-read, not a mismatch. */
export function ibanCheckDigitsValid(iban: string | undefined): boolean | undefined {
  if (!iban || !iban.trim()) return undefined;
  return ibanChecksumValid(normalizeIban(iban));
}
