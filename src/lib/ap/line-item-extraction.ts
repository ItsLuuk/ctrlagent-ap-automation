/**
 * Pure deterministic line-item extraction policy.
 *
 * This module receives extracted page text and returns domain-shaped line items.
 * It has no PDF, DOM, AI, storage, or React dependencies, so the parser can be
 * tested and reused independently of the OCR infrastructure.
 */
import { DEPARTMENTS, GL_ACCOUNTS, type LineItem } from "./types";

/** Currency-shaped values supported by the deterministic text parser. */
export const MONEY_RE = new RegExp(
  "(?:€\\s?(?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,\\d{2,3})?|\\$\\s?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{2})?|(?<![\\d,.])\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+,\\d{2,3}|(?<![\\d,.])\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+\\.\\d{2}|(?<![\\d,.])\\d+[ \\u00a0\\u202f]\\d{2}(?![\\d.])|(?<![\\d,.])\\d{1,3}(?:\\.\\d{3})+,\\d{2}|(?<![\\d,.])\\d{1,3}(?:\\.\\d{3})+(?![\\d.,])|(?<![\\d,.])\\d{1,3},\\d{3}(?![\\d.,])|(?<![\\d,.])\\d+,\\d{2}(?![\\d.])|(?<![\\d.])\\d{1,3}(?:,\\d{3})+\\.\\d{2}|(?<![\\d,])\\d+\\.\\d{2})",
  "g",
);

const PRODUCT_BLOCK_RE = /^\s*product\s*:\s*$/i;
const PRODUCT_BLOCK_END_RE = /^\s*(?:subtotaal|btw|vat|belasting|orderbevestiging|pagina)\b/i;
const PRODUCT_META_RE =
  /^\s*(?:omschrijving|afleverdatum|volgt|opmerkingen|eénheid|eenheid|aantal|prijs|totaal|subtotaal|btw|vat|tax|euro|€)\s*:?\s*$/i;
const UNIT_ONLY_RE = /^\s*(?:stuks?|aantal|prijs|totaal|euro|eur|usd)\s*:?\s*$/i;
const PAYMENT_PROSE_RE =
  /(?:hiervan|reeds\s+betaald|betaald|door\s+middel|mollie|ideal|payment\s+status|paid\s+via)/i;
const NOISE_RE =
  /^(?:factuur|offerte|pakbon|kvk|btw[-\s]?(?:nr|nummer)|iban|bic|betaling|overschrijving|\bbank\b|rekening|invoice|bill\s*to|receipt|statement|tax\s*id|@|www\.|http)/i;
const TOTAL_OR_METADATA_RE =
  /totaal|subtotaal|btw|omzetbelasting|total|subtotal|tax|vat|balance|saldo|bedrag|amount\s*due|te betalen|te voldoen|payment|remit|account|rekening/i;

/** Parse a currency-shaped token using the same locale rules as the OCR layer. */
export function toNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const hadEuro = /€|\bEUR\b/i.test(raw);
  const s = raw.replace(/\b[A-Z]{2,3}\b/gi, "").replace(/[€$\s]/g, "");
  let n;
  if (/,\d{1,2}$/.test(s)) n = Number(s.replace(/\./g, "").replace(",", "."));
  else if (/,\d{3}$/.test(s))
    if (s.slice(0, s.length - 4).length <= 2 && !/\./g.test(s)) n = Number(s.replace(",", "."));
    else if (hadEuro) n = Number(s.replace(/\./g, "").replace(",", "."));
    else n = Number(s.replace(/,/g, ""));
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) n = Number(s.replace(/\./g, ""));
  else n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function makeItem(
  description: string,
  quantity: number,
  amount: number,
  page: number,
  index: number,
): LineItem {
  return {
    id: `extracted-line-${page}-${index + 1}`,
    description,
    quantity,
    unitPrice: Number((amount / quantity).toFixed(2)),
    amount,
    glAccount: GL_ACCOUNTS[0]!,
    department: DEPARTMENTS[0]!,
    page,
  };
}

/** Reads explicit Product blocks where description and amount are on separate lines. */
function guessProductBlockLineItems(text: string, page: number): LineItem[] {
  const lines = text.split("\n").map((line) => line.replace(/\s{2,}/g, " ").trim());
  const starts = lines
    .map((line, index) => (PRODUCT_BLOCK_RE.test(line) ? index : -1))
    .filter((index) => index >= 0);
  const items: LineItem[] = [];
  const preProductText = starts.length > 0 ? lines.slice(0, starts[0]).join(" ") : "";
  const preProductAmount = preProductText
    .match(MONEY_RE)
    ?.map((value) => toNumber(value))
    .find((value) => value !== undefined && value > 1);

  for (const [blockIndex, start] of starts.entries()) {
    const nextProduct = starts[blockIndex + 1] ?? lines.length;
    const totalsIndex = lines.findIndex(
      (line, index) => index > start && index < nextProduct && PRODUCT_BLOCK_END_RE.test(line),
    );
    const end = totalsIndex >= 0 ? totalsIndex : nextProduct;
    const block = lines.slice(start + 1, end);
    const descriptionLine = block.find(
      (line) =>
        line.length > 1 &&
        !PRODUCT_META_RE.test(line) &&
        !UNIT_ONLY_RE.test(line) &&
        !PAYMENT_PROSE_RE.test(line),
    );
    if (!descriptionLine || descriptionLine.length > 160) continue;

    const description = descriptionLine.replace(/^product\s*:\s*/i, "").trim();
    if (!description || UNIT_ONLY_RE.test(description) || PAYMENT_PROSE_RE.test(description)) {
      continue;
    }

    const amountMatches = block
      .slice(block.indexOf(descriptionLine) + 1)
      .join(" ")
      .match(MONEY_RE);
    const amount =
      amountMatches?.map((value) => toNumber(value)).find((value) => value && value > 0) ??
      (blockIndex === starts.length - 1 ? preProductAmount : undefined);
    if (!amount) continue;

    const quantityMatch = block
      .join(" ")
      .match(/\b(?:aantal|quantity)\s*:?\s*(\d{1,4}(?:[.,]\d+)?)\b/i);
    const quantity = quantityMatch ? Number(quantityMatch[1]!.replace(",", ".")) : 1;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    items.push(makeItem(description, quantity, amount, page, items.length));
    if (items.length >= 8) break;
  }

  return items;
}

/**
 * Extracts deterministic line items from one page of extracted text.
 * Product blocks win when present; otherwise amount-bearing rows are filtered
 * through the same noise and payment-prose rules used by the original OCR path.
 */
export function guessLineItemsIn(text: string, page: number): LineItem[] {
  const productItems = guessProductBlockLineItems(text, page);
  if (productItems.length > 0) return productItems;

  const items: LineItem[] = [];
  for (const line of text.split("\n")) {
    const amounts = line.match(MONEY_RE);
    const description = line
      .replace(MONEY_RE, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!amounts || amounts.length === 0) continue;
    if (description.length < 4) continue;
    if (TOTAL_OR_METADATA_RE.test(description)) continue;
    if (
      NOISE_RE.test(description) ||
      UNIT_ONLY_RE.test(description) ||
      PAYMENT_PROSE_RE.test(description) ||
      /\b(datum|date)\b/i.test(description)
    ) {
      continue;
    }

    const amount = toNumber(amounts[amounts.length - 1]) ?? 0;
    if (amount < 1) continue;
    const qtyMatch = description.match(
      /\b(\d{1,4})\s?(x|units?|hrs?|pcs?|stuks?|st\.?|uur|uren|aantal|keer|dagdelen?|dag|dagen|maanden?|week|weken|fles|flessen|doos|dozen|pak|pakken|pallet|pallets?|set|sets?|m[²2³3]|kg|g|liter|ltr|ml)\b/i,
    );
    const quantity = qtyMatch ? Number(qtyMatch[1]) : 1;
    items.push(makeItem(description.slice(0, 80), quantity, amount, page, items.length));
    if (items.length >= 8) break;
  }
  return items;
}
