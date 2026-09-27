/**
 * The vision port the domain owns — plus the pure page-reading logic behind
 * it.
 *
 * The OCR pipeline never talks to a model server. It asks for a
 * `VisionEngine`, and the outer layer supplies one: the app registers the
 * local Ollama/Gemma adapter from a composition root. That direction is the
 * point of the split. Before it, `ocr.ts` imported the adapter while the
 * adapter imported `ExtractedFields` back out of `ocr.ts` — an import cycle
 * that made both modules untestable apart.
 *
 * Parsing, merging and field derivation live here rather than in the adapter
 * because they are invoice rules (which page wins, how a printed amount is
 * read, which provenance a value earns), not transport.
 */
import { z } from "zod";
import {
  uid,
  GL_ACCOUNTS,
  DEPARTMENTS,
  type ExtractedField,
  type LineItem,
  type Provenance,
} from "./types";
import { moneyToNumber, dueDateFromPaymentTerms } from "./zones";

/** What an extraction produces — the shape every reader path returns. */
export type ExtractedFields = {
  vendor?: string | undefined;
  currency?: string | undefined;
  invoiceNumber?: string | undefined;
  issueDate?: string | undefined;
  dueDate?: string | undefined;
  subtotal?: number | undefined;
  tax?: number | undefined;
  total?: number | undefined;
  address?: string | undefined;
  vendorEmail?: string | undefined;
  iban?: string | undefined;
  vatNumber?: string | undefined;
  businessRegistrationNumber?: string | undefined;
  lineItems: LineItem[];
  provenance: Partial<Record<ExtractedField, Provenance>>;
  fieldSources: Partial<Record<ExtractedField, number>>;
  prepaid?: boolean;
  prepaidPhrase?: string;
};

export type VisionProgress = {
  stage: string;
  progress: number;
  page?: number | undefined;
  totalPages?: number | undefined;
};

/** One page of vision input, plus where the engine read it from. */
export type VisionPageRequest = {
  imageB64: string;
  page: number;
  totalPages: number;
  onProgress?: (progress: VisionProgress) => void;
  onToken?: (text: string) => void;
};

/** A parsed page, and the model that produced it (`undefined` when none did). */
export type VisionPageResult = {
  page: VisionPage | null;
  model: string | undefined;
};

/**
 * What the domain needs from a vision backend. Every member is I/O: parse,
 * merge and field derivation stay in the domain, so a test can answer
 * `extractPage` with a fixture instead of a model.
 */
export interface VisionEngine {
  /** Engine name, for audit notes and diagnostics. */
  readonly id: string;
  /** The model a vision read should be attributed to. */
  modelName(): string;
  /** Models to try, best first. */
  modelOrder(): string[];
  /** False when no backend answers — the pipeline then reads text only. */
  healthy(): Promise<boolean>;
  /** Page image → base64 payload, downscaled to what the backend expects. */
  encodePageImage(image: Blob): Promise<string>;
  extractPage(request: VisionPageRequest): Promise<VisionPageResult>;
}

let engine: VisionEngine | undefined;

/**
 * Composition-root seam. The app registers the real adapter at boot; whatever
 * never registers (a unit test of the text path) simply has no vision.
 */
export function setVisionEngine(next: VisionEngine | undefined): void {
  engine = next;
}

export function visionEngine(): VisionEngine | undefined {
  return engine;
}

/**
 * Coerces a model-emitted amount to a number. Models mostly return plain
 * numbers, but when they echo the printed text ("3.250,00", "€ 276,25") we
 * must read it the way the document does. Delegates to the shared money parser
 * so the VLM path, the OCR path, and the template path agree on one format.
 */
export function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = moneyToNumber(v);
    return n !== undefined && Number.isFinite(n) ? n : null;
  }
  return null;
}

const visionPageSchema = z.object({
  vendor: z.string().nullable().catch(null),
  address: z.string().nullable().catch(null),
  vendorEmail: z.string().email().nullable().catch(null),
  iban: z.string().nullable().catch(null),
  vatNumber: z.string().nullable().catch(null),
  businessRegistrationNumber: z.string().nullable().catch(null),
  invoiceNumber: z
    .unknown()
    .transform((v) => (typeof v === "string" ? v : v == null ? null : String(v)))
    .pipe(z.string().nullable().catch(null)),
  issueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .catch(null),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .catch(null),
  subtotal: z.unknown().transform(toNum),
  tax: z.unknown().transform(toNum),
  total: z.unknown().transform(toNum),
  currency: z.string().nullable().catch(null),
  lineItems: z
    .array(
      z.object({
        description: z.unknown(),
        quantity: z.unknown(),
        unitPrice: z.unknown(),
        amount: z.unknown(),
      }),
    )
    .catch([]),
});

export type VisionPage = z.infer<typeof visionPageSchema>;

/** Strips markdown fences and leading/trailing prose around the JSON payload. */
export function cleanModelJson(raw: string): string {
  let s = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return s;
}

export function parseVisionPage(raw: string): VisionPage | null {
  try {
    const parsed = visionPageSchema.safeParse(JSON.parse(cleanModelJson(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type MergedVision = {
  vendor: { value: string; page: number } | undefined;
  address: { value: string; page: number } | undefined;
  vendorEmail: { value: string; page: number } | undefined;
  iban: { value: string; page: number } | undefined;
  vatNumber: { value: string; page: number } | undefined;
  businessRegistrationNumber: { value: string; page: number } | undefined;
  invoiceNumber: { value: string; page: number } | undefined;
  issueDate: { value: string; page: number } | undefined;
  dueDate: { value: string; page: number } | undefined;
  subtotal: { value: number; page: number } | undefined;
  tax: { value: number; page: number } | undefined;
  total: { value: number; page: number } | undefined;
  currency: string | undefined;
  lineItems: LineItem[];
  /** Raw OCR text joined across all vision pages — used to derive the due date
   *  from payment terms when the VLM returned an empty dueDate. */
  pagesText: string;
};

/** First non-null value per field wins; line items concatenate across pages.
 *  `pagesText` is the raw OCR text joined across all vision pages — passed
 *  through so `visionPageToFields` can derive the due date from payment terms
 *  when the model returned an empty `dueDate`. */
export function mergeVisionPages(results: (VisionPage | null)[], pagesText = ""): MergedVision {
  const merged: MergedVision = {
    vendor: undefined,
    address: undefined,
    vendorEmail: undefined,
    iban: undefined,
    vatNumber: undefined,
    businessRegistrationNumber: undefined,
    invoiceNumber: undefined,
    issueDate: undefined,
    dueDate: undefined,
    subtotal: undefined,
    tax: undefined,
    total: undefined,
    currency: undefined,
    lineItems: [],
    pagesText,
  };
  results.forEach((r, i) => {
    if (!r) return;
    const page = i + 1;
    if (!merged.vendor && r.vendor) merged.vendor = { value: r.vendor, page };
    if (!merged.address && r.address) merged.address = { value: r.address, page };
    if (!merged.vendorEmail && r.vendorEmail) merged.vendorEmail = { value: r.vendorEmail, page };
    if (!merged.iban && r.iban) merged.iban = { value: r.iban, page };
    if (!merged.vatNumber && r.vatNumber) merged.vatNumber = { value: r.vatNumber, page };
    if (!merged.businessRegistrationNumber && r.businessRegistrationNumber)
      merged.businessRegistrationNumber = { value: r.businessRegistrationNumber, page };
    if (!merged.invoiceNumber && r.invoiceNumber)
      merged.invoiceNumber = { value: r.invoiceNumber, page };
    if (!merged.issueDate && r.issueDate) merged.issueDate = { value: r.issueDate, page };
    if (!merged.dueDate && r.dueDate) merged.dueDate = { value: r.dueDate, page };
    if (!merged.subtotal && r.subtotal != null) merged.subtotal = { value: r.subtotal, page };
    if (!merged.tax && r.tax != null) merged.tax = { value: r.tax, page };
    if (!merged.total && r.total != null) merged.total = { value: r.total, page };
    if (!merged.currency && r.currency) merged.currency = r.currency;
    for (const li of r.lineItems) {
      if (merged.lineItems.length >= 20) break;
      const description = (typeof li.description === "string" ? li.description : "").slice(0, 80);
      const amount = toNum(li.amount) ?? 0;
      if (!description || !(amount > 0)) continue;
      const quantity = toNum(li.quantity) ?? 1;
      const unitPrice = toNum(li.unitPrice) ?? (quantity > 0 ? amount / quantity : amount);
      merged.lineItems.push({
        id: uid(),
        description,
        quantity,
        unitPrice: Number(unitPrice.toFixed(2)),
        amount,
        glAccount: GL_ACCOUNTS[0]!,
        department: DEPARTMENTS[0]!,
        page,
      });
    }
  });
  return { ...merged, pagesText };
}

/** Vision reads — every field it found gets provenance "read".
 *  The due date computed from payment terms gets "derived". */
export function visionPageToFields(merged: MergedVision): ExtractedFields {
  const prov = (found: boolean): Provenance => (found ? "read" : "derived");

  const fieldSources: Partial<Record<ExtractedField, number>> = {};
  if (merged.vendor) fieldSources.vendor = merged.vendor.page;
  if (merged.address) fieldSources.address = merged.address.page;
  if (merged.vendorEmail) fieldSources.vendorEmail = merged.vendorEmail.page;
  if (merged.iban) fieldSources.iban = merged.iban.page;
  if (merged.vatNumber) fieldSources.vatNumber = merged.vatNumber.page;
  if (merged.businessRegistrationNumber)
    fieldSources.businessRegistrationNumber = merged.businessRegistrationNumber.page;
  if (merged.invoiceNumber) fieldSources.invoiceNumber = merged.invoiceNumber.page;
  if (merged.issueDate) fieldSources.issueDate = merged.issueDate.page;
  if (merged.dueDate) fieldSources.dueDate = merged.dueDate.page;
  if (merged.subtotal) fieldSources.subtotal = merged.subtotal.page;
  if (merged.tax) fieldSources.tax = merged.tax.page;
  if (merged.total) fieldSources.total = merged.total.page;

  const documentText = merged.pagesText;
  const issueDateStr =
    typeof merged.issueDate?.value === "string" ? merged.issueDate.value : undefined;
  const dueDateFromTerms =
    !merged.dueDate && issueDateStr
      ? dueDateFromPaymentTerms(documentText, issueDateStr)
      : undefined;

  if (dueDateFromTerms) {
    delete fieldSources.dueDate;
  }

  return {
    vendor: merged.vendor?.value,
    address: merged.address?.value,
    vendorEmail: merged.vendorEmail?.value,
    iban: merged.iban?.value,
    vatNumber: merged.vatNumber?.value,
    businessRegistrationNumber: merged.businessRegistrationNumber?.value,
    invoiceNumber: merged.invoiceNumber?.value,
    issueDate: merged.issueDate?.value,
    dueDate: merged.dueDate?.value ?? dueDateFromTerms ?? undefined,
    subtotal: merged.subtotal?.value,
    tax: merged.tax?.value,
    total: merged.total?.value,
    lineItems: merged.lineItems,
    currency: merged.currency,
    provenance: {
      vendor: prov(!!merged.vendor),
      address: prov(!!merged.address),
      vendorEmail: prov(!!merged.vendorEmail),
      iban: prov(!!merged.iban),
      vatNumber: prov(!!merged.vatNumber),
      businessRegistrationNumber: prov(!!merged.businessRegistrationNumber),
      invoiceNumber: prov(!!merged.invoiceNumber),
      issueDate: prov(!!merged.issueDate),
      dueDate: merged.dueDate ? "read" : dueDateFromTerms ? "derived" : "derived",
      subtotal: prov(!!merged.subtotal),
      tax: prov(!!merged.tax),
      total: prov(!!merged.total),
    },
    fieldSources,
  };
}
