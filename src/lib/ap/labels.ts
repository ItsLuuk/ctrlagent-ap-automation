import type { ExtractedField } from "./types";

export type DocumentLocale = "NL" | "EN" | "DE" | "FR" | "ES";

/** Ordered labels: Dutch is intentionally first to preserve existing matches. */
export const FIELD_LABELS: Readonly<Record<ExtractedField, Readonly<Record<DocumentLocale, readonly string[]>>>> = {
  vendor: { NL: ["factuur van", "leverancier", "afzender", "verkoper"], EN: ["from", "supplier", "vendor"], DE: ["von", "lieferant"], FR: ["fournisseur", "vendeur"], ES: ["proveedor", "vendedor"] },
  invoiceNumber: { NL: ["factuurnummer", "factuur nr", "factuurnr"], EN: ["invoice number", "invoice no", "invoice #"], DE: ["rechnungsnummer", "rechnung nr"], FR: ["numéro de facture", "no facture"], ES: ["número de factura", "no factura"] },
  issueDate: { NL: ["factuurdatum", "datum factuur", "leveringsdatum", "datum"], EN: ["invoice date", "date of issue", "issued", "date"], DE: ["rechnungsdatum", "ausstellungsdatum", "datum"], FR: ["date de facture", "date d'émission", "date"], ES: ["fecha de factura", "fecha de emisión", "fecha"] },
  dueDate: { NL: ["vervaldatum", "uiterste betaaldatum", "betalingsdatum", "te betalen voor"], EN: ["due date", "payment due", "due"], DE: ["fälligkeitsdatum", "zahlbar bis"], FR: ["date d'échéance", "à payer avant"], ES: ["fecha de vencimiento", "vencimiento"] },
  subtotal: { NL: ["subtotaal", "netto bedrag", "totaal excl"], EN: ["subtotal", "sub total", "net"], DE: ["zwischensumme", "netto"], FR: ["sous-total", "hors taxe", "net"], ES: ["subtotal", "base imponible", "neto"] },
  tax: { NL: ["btw-bedrag", "btw bedrag", "omzetbelasting", "btw"], EN: ["tax", "vat", "gst"], DE: ["steuer", "mwst", "umsatzsteuer"], FR: ["tva", "taxe"], ES: ["iva", "impuesto"] },
  total: { NL: ["te betalen", "totaalbedrag", "eindtotaal"], EN: ["amount due", "total due", "grand total"], DE: ["gesamtbetrag", "zu zahlen", "gesamt"], FR: ["total à payer", "montant dû", "total"], ES: ["total a pagar", "importe total", "total"] },
  address: { NL: ["adres", "vestigingsadres"], EN: ["address"], DE: ["adresse"], FR: ["adresse"], ES: ["dirección"] },
  vendorEmail: { NL: ["facturatie", "leverancier email"], EN: ["billing", "email", "contact"], DE: ["rechnung email", "email"], FR: ["email", "courriel"], ES: ["correo", "email"] },
  iban: { NL: ["iban", "bankrekening", "rekeningnummer"], EN: ["iban", "bank account"], DE: ["iban", "bankverbindung"], FR: ["iban", "coordonnées bancaires"], ES: ["iban", "cuenta bancaria"] },
  vatNumber: { NL: ["btw-nummer", "btw identificatienummer"], EN: ["vat number", "vat id", "tax id"], DE: ["ust-idnr", "umsatzsteuer-id"], FR: ["numéro de tva", "tva"], ES: ["nif", "iva", "número de iva"] },
  businessRegistrationNumber: { NL: ["kvk", "kamer van koophandel"], EN: ["company registration", "companies house", "coc"], DE: ["handelsregister", "hrb", "hra"], FR: ["siren", "siret"], ES: ["registro mercantil", "cif"] },
};

export function labelsFor(field: ExtractedField, locale: DocumentLocale = "NL"): string[] {
  const groups = FIELD_LABELS[field];
  if (!groups) return [];
  return [...(groups.NL ?? []), ...(groups[locale] ?? [])];
}

export const EXPECTED_VAT_RATES: Readonly<Record<DocumentLocale, readonly number[]>> = {
  NL: [21, 9, 0],
  EN: [20, 5, 0],
  DE: [19, 7, 0],
  FR: [20, 10, 5.5, 2.1, 0],
  ES: [21, 10, 4, 0],
};

/** Validation hint only; callers must not reject a document on rate alone. */
export function isExpectedVatRate(rate: number, locale: DocumentLocale): boolean {
  return EXPECTED_VAT_RATES[locale].includes(rate);
}

export function detectDocumentLocale(text: string): DocumentLocale {
  const upper = text.toUpperCase();
  const scores: Record<DocumentLocale, number> = { NL: 0, EN: 0, DE: 0, FR: 0, ES: 0 };
  const cues: Array<[DocumentLocale, RegExp]> = [
    ["NL", /\b(?:factuur|btw|totaal|leverancier|vervaldatum|kvk)\b/gi],
    ["EN", /\b(?:invoice|subtotal|total due|supplier|tax|due date)\b/gi],
    ["DE", /\b(?:rechnung|gesamtbetrag|mwst|lieferant|fällig)\b/gi],
    ["FR", /\b(?:facture|sous-total|fournisseur|tva|échéance)\b/gi],
    ["ES", /\b(?:factura|subtotal|proveedor|iva|vencimiento)\b/gi],
  ];
  for (const [locale, cue] of cues) scores[locale] = (upper.match(cue) ?? []).length;
  const iban = text.match(/\b([A-Z]{2})\d{2}/i)?.[1]?.toUpperCase();
  if (iban === "NL") scores.NL += 3;
  if (iban === "DE") scores.DE += 3;
  if (iban === "FR") scores.FR += 3;
  if (iban === "ES") scores.ES += 3;
  const best = (Object.entries(scores) as [DocumentLocale, number][]).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : "NL";
}
