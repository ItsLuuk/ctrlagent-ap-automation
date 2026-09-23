import { type Zone, type ZoneCheckResult, type ZoneField, type ZoneMap } from "./types";
import { compareZoneValue, formatZoneAi } from "./zones";

/** Extra crop margin around each zone, normalized units (2% each side). */
const ZONE_PAD = 0.02;

export type ZoneCheckFields = {
  vendor: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  tax: number;
  total: number;
  address?: string;
  vendorEmail?: string;
  iban?: string;
  vatNumber?: string;
  businessRegistrationNumber?: string;
  currency: string;
};

async function readZoneText(image: Blob, zone: Zone): Promise<string | undefined> {
  const bitmap = await createImageBitmap(image);
  try {
    const padX = ZONE_PAD * bitmap.width;
    const padY = ZONE_PAD * bitmap.height;
    const x = Math.max(0, Math.round(zone.x * bitmap.width - padX));
    const y = Math.max(0, Math.round(zone.y * bitmap.height - padY));
    const w = Math.max(1, Math.min(bitmap.width - x, Math.round(zone.w * bitmap.width + 2 * padX)));
    const h = Math.max(
      1,
      Math.min(bitmap.height - y, Math.round(zone.h * bitmap.height + 2 * padY)),
    );
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    canvas.width = canvas.height = 0;
    if (!blob) return undefined;
    const { default: Tesseract } = await import("tesseract.js");
    const result = await Tesseract.recognize(blob, "eng+nld");
    const text = (result.data.text ?? "").trim().replace(/\s+/g, " ");
    return text || undefined;
  } finally {
    bitmap.close();
  }
}

/**
 * Best-effort sanity pass: for each zoned field present, crop the image at the
 * anchor (+ padding), OCR it with Tesseract, and compare to the AI value.
 * Unmatched fields and failed reads are skipped silently.
 */
export async function runZoneCheck(
  image: Blob,
  fields: ZoneCheckFields,
  zones: ZoneMap,
): Promise<ZoneCheckResult[]> {
  const results: ZoneCheckResult[] = [];
  for (const [field, zone] of Object.entries(zones) as [ZoneField, Zone][]) {
    if (!zone) continue;
    const aiValue = fields[field];
    if (aiValue === "" || aiValue == null) continue;
    const ocrText = await readZoneText(image, zone).catch(() => undefined);
    if (!ocrText) continue;
    results.push({
      field,
      ai: formatZoneAi(field, aiValue, fields.currency),
      ocr: ocrText,
      match: compareZoneValue(field, aiValue, ocrText),
    });
  }
  return results;
}
