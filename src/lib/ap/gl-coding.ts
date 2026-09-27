import { resolveVendorIdentity } from "./duplicate-detection";
import type { Invoice, VendorProfile } from "./types";

export type CodingField =
  | "glAccount"
  | "category"
  | "department"
  | "costCenter"
  | "project"
  | "location";

export type CodingSuggestion = {
  fields: Partial<Record<CodingField, string>>;
  confidence: number;
  basedOn: number;
  reason: string;
};

const codingValue = (invoice: Invoice, field: CodingField): string | undefined => {
  const value = invoice[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const categoryOf = (invoice: Invoice): string | undefined =>
  codingValue(invoice, "category") ?? codingValue(invoice, "department");

function textTokens(invoice: Invoice): Set<string> {
  const text = [
    ...invoice.lineItems.map((line) => line.description),
    invoice.memo,
    categoryOf(invoice) ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return new Set(text.split(/\s+/).filter((token) => token.length > 2));
}

function tokenOverlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / Math.min(left.size, right.size);
}

function recencyScore(invoice: Invoice, now: number): number {
  const timestamp = new Date(invoice.issueDate || invoice.createdAt).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const days = Math.max(0, (now - timestamp) / (1000 * 60 * 60 * 24));
  return days <= 365 ? 0.05 * (1 - days / 365) : 0;
}

function candidateScore(
  invoice: Invoice,
  candidate: Invoice,
  profiles: Record<string, VendorProfile>,
  tokens: Set<string>,
  now: number,
): number {
  if (resolveVendorIdentity(invoice, profiles) !== resolveVendorIdentity(candidate, profiles)) return 0;

  let score = 0.55;
  const category = categoryOf(invoice);
  const candidateCategory = categoryOf(candidate);
  if (category && candidateCategory && category.toLowerCase() === candidateCategory.toLowerCase()) {
    score += 0.2;
  } else if (category && candidateCategory) {
    score -= 0.2;
  }
  score += tokenOverlap(tokens, textTokens(candidate)) * 0.15;
  return score + recencyScore(candidate, now);
}

/**
 * Suggests coding from prior invoices for the same vendor. The result is
 * explainable and deterministic: it is a weighted memory of what people chose,
 * not an opaque model call. New dimensions stay optional so existing records
 * remain valid while the learning loop grows.
 */
export function suggestGlCoding(
  invoice: Invoice,
  pastInvoices: Invoice[],
  profiles: Record<string, VendorProfile> = {},
  now = Date.now(),
): CodingSuggestion | undefined {
  const candidates = pastInvoices.filter(
    (candidate) =>
      candidate.id !== invoice.id &&
      candidate.status !== "failed" &&
      candidate.status !== "processing" &&
      (candidate.glAccount || candidate.department),
  );
  const tokens = textTokens(invoice);
  const ranked = candidates
    .map((candidate, order) => ({
      candidate,
      order,
      score: candidateScore(invoice, candidate, profiles, tokens, now),
    }))
    .filter(({ score }) => score >= 0.4)
    .sort((left, right) => right.score - left.score || right.order - left.order)
    .slice(0, 8);

  if (ranked.length === 0) return undefined;

  const fields: CodingSuggestion["fields"] = {};
  const fieldCandidates: Record<CodingField, { value: string; weight: number }[]> = {
    glAccount: [],
    category: [],
    department: [],
    costCenter: [],
    project: [],
    location: [],
  };

  for (const { candidate, score } of ranked) {
    for (const field of Object.keys(fieldCandidates) as CodingField[]) {
      const value = codingValue(candidate, field);
      if (value) fieldCandidates[field].push({ value, weight: score });
    }
  }

  let glAccountShare = 0;
  for (const [field, values] of Object.entries(fieldCandidates) as [CodingField, { value: string; weight: number }[]][]) {
    const totals = new Map<string, number>();
    for (const { value, weight } of values) totals.set(value, (totals.get(value) ?? 0) + weight);
    const best = [...totals.entries()].sort((left, right) => right[1] - left[1])[0];
    if (!best) continue;
    const [value, weight] = best;
    const total = [...totals.values()].reduce((sum, current) => sum + current, 0);
    fields[field] = value;
    if (field === "glAccount") glAccountShare = total > 0 ? weight / total : 0;
  }

  if (Object.keys(fields).length === 0) return undefined;
  const confidence = Math.round(Math.min(0.98, 0.5 + glAccountShare * 0.48) * 100) / 100;
  return {
    fields,
    confidence,
    basedOn: ranked.length,
    reason: `Based on ${ranked.length} similar ${invoice.vendor} invoice${ranked.length === 1 ? "" : "s"}.`,
  };
}
