export type LineItemDraft = {
  description: string;
  quantity: string;
  unitPrice: string;
};

export type ParsedLineItemEdit =
  | { ok: false }
  | {
      ok: true;
      description: string;
      quantity: number;
      unitPrice: number;
      amount: number;
    };

export function parseLineItemDraft(draft: LineItemDraft): ParsedLineItemEdit {
  const description = draft.description.trim();
  const quantity = Number(draft.quantity.replace(",", "."));
  const unitPrice = Number(draft.unitPrice.replace(",", "."));
  if (!description) return { ok: false };
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false };
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return { ok: false };
  const amount = quantity * unitPrice;
  if (!(amount > 0)) return { ok: false };
  return { ok: true, description, quantity, unitPrice, amount };
}
