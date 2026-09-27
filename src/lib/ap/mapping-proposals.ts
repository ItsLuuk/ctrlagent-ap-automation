import { unionBox } from "./mapping";
import { runForShape, shapeFit, shapeNote } from "./field-shape";
import { MAPPING_FIELDS, type Invoice, type OcrWord, type Zone, type ZoneField } from "./types";

export type MappingProposalSource = "saved" | "label" | "value" | "identity";

export type MappingProposal = {
  field: ZoneField;
  zone: Zone;
  anchor?: string | undefined;
  confidence: number;
  source: MappingProposalSource;
  reason: string;
};

export type MappingProposals = Partial<Record<ZoneField, MappingProposal>>;

/**
 * A field's source region in the draft mapper: where to look, and what the
 * reviewer was shown for it. It lives beside the proposal because the proposal
 * is what gives an assignment its review state.
 */
export type DraftAssignment = {
  field: ZoneField;
  zone: Zone;
  anchor?: string | undefined;
  proposal?: MappingProposal | undefined;
};
export type DraftAssignments = Record<ZoneField, DraftAssignment | undefined>;

/** Explicit acceptance of a proposed region; critical fields default to unconfirmed. */
export type ConfirmedMappings = Partial<Record<ZoneField, boolean>>;

export const CRITICAL_MAPPING_FIELDS: ZoneField[] = [
  "vendor",
  "invoiceNumber",
  "issueDate",
  "total",
];

/** A newly saved vendor template is held for this many future confirmations. */
export const TEMPLATE_TRAINING_WHEELS = 2;

/**
 * A proposed region is waiting for review until the reviewer accepts it. A
 * region from an already-trusted template is not a proposal to review, and a
 * hand-drawn box has nothing to confirm — both count as settled.
 */
export function hasPendingProposal(
  assignment: DraftAssignment | undefined,
  confirmed: boolean | undefined,
): boolean {
  return Boolean(assignment?.proposal && assignment.proposal.source !== "saved" && !confirmed);
}

/** Critical fields whose proposed source region the reviewer has not accepted. */
export function unconfirmedCriticalFields(
  assignments: DraftAssignments,
  confirmedMappings: ConfirmedMappings = {},
): ZoneField[] {
  return CRITICAL_MAPPING_FIELDS.filter((field) =>
    hasPendingProposal(assignments[field], confirmedMappings[field]),
  );
}

/**
 * Proposed, unaccepted regions one deliberate action can accept. Critical
 * fields are never in this set: they always get their own look.
 */
export function pendingRoutineProposalFields(
  assignments: DraftAssignments,
  confirmedMappings: ConfirmedMappings = {},
): ZoneField[] {
  return MAPPING_FIELDS.filter(
    (field) =>
      !CRITICAL_MAPPING_FIELDS.includes(field) &&
      hasPendingProposal(assignments[field], confirmedMappings[field]),
  );
}

const FIELD_LABELS: Record<ZoneField, string[]> = {
  vendor: ["van", "from", "leverancier", "supplier", "afzender", "verkoper"],
  invoiceNumber: [
    "factuurnummer",
    "factuurnr",
    "factuur nr",
    "invoice number",
    "invoice no",
    "invoice #",
  ],
  issueDate: ["factuurdatum", "datum factuur", "invoice date", "issue date", "datum"],
  dueDate: ["vervaldatum", "betalingsdatum", "due date", "payment due", "due"],
  subtotal: ["subtotaal", "subtotal", "netto", "totaal excl", "totaal excl btw"],
  tax: ["btw bedrag", "btw-bedrag", "btw", "vat", "tax"],
  total: [
    "totaal",
    "total",
    "te betalen",
    "amount due",
    "total due",
    "grand total",
    "totaalbedrag",
    "totaal incl",
  ],
  address: ["leveranciersadres", "supplier address", "vendor address", "adres"],
  vendorEmail: ["e-mail", "email", "mail"],
  iban: ["iban", "bankrekening", "bank account"],
  vatNumber: ["btw nummer", "btw-nummer", "btw nr", "vat number", "vat"],
  businessRegistrationNumber: ["kvk", "kvk nummer", "company number", "registration"],
};

const IDENTITY_FIELDS = new Set<ZoneField>([
  "vendorEmail",
  "iban",
  "vatNumber",
  "businessRegistrationNumber",
]);

const MONEY_FIELDS = new Set<ZoneField>(["subtotal", "tax", "total"]);
const DATE_FIELDS = new Set<ZoneField>(["issueDate", "dueDate"]);

type TextLine = OcrWord[];

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compact(value: string): string {
  return normalize(value).replace(/\s/g, "");
}

function centerY(word: OcrWord): number {
  return word.y + word.h / 2;
}

function clusterLines(words: OcrWord[]): TextLine[] {
  const sorted = [...words].sort((a, b) => centerY(a) - centerY(b) || a.x - b.x);
  const lines: Array<{ cy: number; height: number; words: TextLine }> = [];
  for (const word of sorted) {
    const cy = centerY(word);
    const current = lines.at(-1);
    const tolerance = Math.max(word.h, current?.height ?? word.h) * 0.65;
    if (current && Math.abs(cy - current.cy) <= tolerance) {
      current.words.push(word);
      current.cy = current.words.reduce((sum, item) => sum + centerY(item), 0) / current.words.length;
      current.height = Math.max(current.height, word.h);
    } else {
      lines.push({ cy, height: word.h, words: [word] });
    }
  }
  return lines.map((line) => line.words.sort((a, b) => a.x - b.x));
}

function fieldValue(invoice: Invoice, field: ZoneField): string | number | undefined {
  return invoice[field];
}

function isMoney(value: string): boolean {
  return /(?:\d{1,3}(?:[.\s]\d{3})+|\d+)[,.](\d{2})\b/.test(value.trim());
}

function isDate(value: string): boolean {
  return /\b(?:\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\b/.test(
    value,
  );
}

function valueScore(field: ZoneField, expected: string | number | undefined, candidate: string): number {
  if (expected === undefined || expected === "") return 0;
  const actual = candidate.trim();
  if (!actual) return 0;
  if (MONEY_FIELDS.has(field)) {
    const expectedDigits = Number(expected).toFixed(2);
    const actualDigits = actual.match(/\d+(?:[.,]\d{1,2})?/g)?.at(-1)?.replace(",", ".");
    return actualDigits === expectedDigits ? 1 : 0;
  }
  if (DATE_FIELDS.has(field)) {
    return isDate(actual) ? 0.72 : 0;
  }
  const expectedCompact = compact(String(expected));
  const actualCompact = compact(actual);
  if (!expectedCompact || !actualCompact) return 0;
  if (expectedCompact === actualCompact) return 1;
  if (actualCompact.includes(expectedCompact) || expectedCompact.includes(actualCompact)) return 0.9;
  const expectedTokens = new Set(normalize(String(expected)).split(" ").filter(Boolean));
  const actualTokens = normalize(actual).split(" ").filter(Boolean);
  const shared = actualTokens.filter((token) => expectedTokens.has(token)).length;
  return expectedTokens.size > 0 ? shared / expectedTokens.size : 0;
}

function plausibleForField(field: ZoneField, text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (MONEY_FIELDS.has(field)) return isMoney(value);
  if (DATE_FIELDS.has(field)) return isDate(value);
  if (field === "vendorEmail") return /@/.test(value);
  if (field === "iban") return /[A-Z]{2}\d{2}[A-Z0-9]{10,}/i.test(value.replace(/\s/g, ""));
  if (field === "vatNumber") return /\b[A-Z]{2}[A-Z0-9.-]{8,}\b/i.test(value);
  if (field === "businessRegistrationNumber") return /\b\d{6,12}\b/.test(value);
  return true;
}

const hasAlphanumeric = (text: string): boolean => /[\p{L}\p{N}]/u.test(text);

/**
 * The word an anchor should be, from a matched label span.
 *
 * The span is taken last-word-first so "grand total" anchors on "total", but a
 * span can end on a symbol — "Totaal €" matches the two-word window and would
 * anchor on the currency sign, which occurs on every money line on the page
 * and so names nothing. The last word carrying a letter or digit is the one
 * worth re-finding next time.
 */
function anchorWordFor(words: OcrWord[]): string | undefined {
  for (let index = words.length - 1; index >= 0; index--) {
    const text = words[index]!.text.trim();
    if (hasAlphanumeric(text)) return text;
  }
  return undefined;
}

function findLabel(line: TextLine, aliases: string[]): { end: number; text: string } | undefined {
  for (let start = 0; start < line.length; start++) {
    for (let length = Math.min(4, line.length - start); length >= 1; length--) {
      const words = line.slice(start, start + length);
      const text = normalize(words.map((word) => word.text).join(" "));
      if (aliases.some((alias) => text === normalize(alias))) {
        const anchor = anchorWordFor(words);
        if (anchor) return { end: start + length, text: anchor };
      }
    }
  }
  return undefined;
}

function zoneForWords(words: OcrWord[]): Zone {
  return unionBox(words, 0.004);
}

function uniqueValueLine(lines: TextLine[], field: ZoneField, expected: string | number | undefined) {
  if (expected === undefined || expected === "") return undefined;
  const matches = lines.filter((line) => valueScore(field, expected, line.map((word) => word.text).join(" ")) >= 0.9);
  return matches.length === 1 ? matches[0] : undefined;
}

function labelProposal(
  lines: TextLine[],
  field: ZoneField,
  expected: string | number | undefined,
): MappingProposal | undefined {
  for (const line of lines) {
    const label = findLabel(line, FIELD_LABELS[field]);
    if (!label) continue;
    const rest = line.slice(label.end).filter((word) => word.x >= line[label.end - 1]!.x);
    if (rest.length === 0) continue;
    // The label says where the value starts, not how far it runs. The shape
    // model says how far, so a total does not swallow the payment terms
    // printed after it on the same line.
    const nearby = runForShape(field, rest);
    if (nearby.length === 0) continue;
    const text = nearby.map((word) => word.text).join(" ");
    const match = valueScore(field, expected, text);
    if (!plausibleForField(field, text) && match < 0.9) continue;
    const fit = shapeFit(field, nearby);
    // A value match is the strongest evidence there is; a label alone is good
    // but not conclusive. The width fit moves both, in either direction.
    const base = match >= 0.9 ? 0.96 : 0.82;
    const confidence = Math.round(Math.min(0.99, base * (0.85 + 0.15 * fit)) * 100) / 100;
    return {
      field,
      zone: zoneForWords(nearby),
      anchor: label.text,
      confidence,
      source: "label",
      reason: [
        match >= 0.9 ? `Matched the ${label.text} label and the current value` : `Matched the ${label.text} label`,
        shapeNote(field, nearby),
      ]
        .filter(Boolean)
        .join(" — "),
    };
  }
  return undefined;
}

function identityProposal(
  lines: TextLine[],
  field: ZoneField,
  expected: string | number | undefined,
): MappingProposal | undefined {
  if (!IDENTITY_FIELDS.has(field) || expected === undefined || expected === "") return undefined;
  const expectedCompact = compact(String(expected));
  const matches = lines.filter((line) => line.some((word) => compact(word.text) === expectedCompact));
  if (matches.length !== 1) return undefined;
  const matchingLine = matches[0];
  if (!matchingLine) return undefined;
  const words = matchingLine.filter((word) => compact(word.text) === expectedCompact);
  if (words.length === 0) return undefined;
  return {
    field,
    zone: zoneForWords(words),
    anchor: words[0]!.text,
    confidence: 0.97,
    source: "identity",
    reason: "Exact value match with a unique identity pattern",
  };
}

/**
 * Proposes source regions for the first invoice of an unknown vendor.
 * Existing zones always win. Low-confidence or ambiguous guesses are omitted
 * so the reviewer never inherits a plausible-but-wrong template.
 */
export function proposeFieldMappings(invoice: Invoice, words: OcrWord[] | undefined): MappingProposals {
  const proposals: MappingProposals = {};
  for (const field of Object.keys(invoice.zones ?? {}) as ZoneField[]) {
    const zone = invoice.zones?.[field];
    if (!zone) continue;
    proposals[field] = {
      field,
      zone,
      confidence: 1,
      source: "saved",
      reason: "Existing confirmed mapping",
    };
  }
  if (!words || words.length === 0) return proposals;

  const lines = clusterLines(words);
  for (const field of Object.keys(FIELD_LABELS) as ZoneField[]) {
    if (proposals[field]) continue;
    const expected = fieldValue(invoice, field);
    const identity = identityProposal(lines, field, expected);
    if (identity) {
      proposals[field] = identity;
      continue;
    }
    const labelled = labelProposal(lines, field, expected);
    if (labelled) {
      proposals[field] = labelled;
      continue;
    }
    const valueLine = uniqueValueLine(lines, field, expected);
    if (valueLine) {
      const plausible = valueLine.filter((word) => plausibleForField(field, word.text));
      // A line can hold several plausible words (a total and a subtotal, two
      // amounts in a summary block); the shape model cuts the run to what one
      // value of this field would look like.
      const wordsInValue = runForShape(field, plausible);
      if (wordsInValue.length > 0) {
        const fit = shapeFit(field, wordsInValue);
        proposals[field] = {
          field,
          zone: zoneForWords(wordsInValue),
          confidence: Math.round(Math.min(0.95, 0.78 * (0.85 + 0.15 * fit)) * 100) / 100,
          source: "value",
          reason: ["Unique value match without a reliable label", shapeNote(field, wordsInValue)]
            .filter(Boolean)
            .join(" — "),
        };
      }
    }
  }
  return proposals;
}

