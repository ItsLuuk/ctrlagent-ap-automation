import { z } from "zod";
import {
  uid,
  GL_ACCOUNTS,
  DEPARTMENTS,
  type ExtractedField,
  type LineItem,
  type Provenance,
} from "../ap/types";
import { collectVatCandidates, resolveSupplierVatNumber } from "../ap/ocr";
import type { ExtractedFields, VatCandidate } from "../ap/ocr";
import { moneyToNumber, dueDateFromPaymentTerms, detectPrepaid } from "../ap/zones";

/** Locally-installed vision models, best first. */
export const VISION_MODELS = ["gemma3:4b-it-qat", "ornith-1.5:9b"];

/** User's explicit localStorage override wins; else auto order (best first). */
export function imageExtractModelOrder(): string[] {
  try {
    const saved = localStorage.getItem("gemma-model");
    if (saved) return [saved];
  } catch {
    /* unavailable or blocked local storage */
  }
  return [...VISION_MODELS];
}

/** Vision input is downscaled to this many pixels on the long edge to cut inference time. */
const VISION_MAX_EDGE = 768;
/** JPEG quality for the downscaled vision input. */
const JPEG_QUALITY = 0.8;

/** Ollama model used for vision extraction. Swappable (e.g. ornith) without code changes elsewhere. */
export const DEFAULT_GEMMA_MODEL = "gemma3:4b-it-qat";

const OLLAMA_HOSTS = ["http://127.0.0.1:11434", "http://localhost:11434"];

/** Ollama host Foundry speaks the model protocol against. User override
 *  lives in localStorage under `ollama-base`; the default is the standard
 *  localhost origin. This is the #1 support issue: the desktop WebView talking
 *  to localhost will not reach an Ollama that only listens on a custom address —
 *  verify with `curl http://127.0.0.1:11434/api/version` from the same
 *  machine and set the host in Settings → Vision model → Ollama host. */
export function ollamaBase(): string {
  try {
    const saved = localStorage.getItem("ollama-base");
    if (saved) return saved;
  } catch {
    /* unavailable or blocked local storage */
  }
  return OLLAMA_HOSTS[0]!;
}

export function gemmaModel(): string {
  try {
    const saved = localStorage.getItem("gemma-model");
    if (saved) return saved;
  } catch {
    /* unavailable or blocked local storage */
  }
  return DEFAULT_GEMMA_MODEL;
}

/**
 * Keeps the vision model resident in memory so uploads skip the 8s+ model
 * reload and cold (CPU) prefill. Ollama's default evicts after 5 min idle.
 */
const KEEP_ALIVE = -1;

/** Background warm-up: loads the model + warms the GPU graph so the first
 *  upload reaches its first token in under a second instead of ~16s. */
export async function prewarmVisionModel(): Promise<void> {
  try {
    await fetch(`${ollamaBase()}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: gemmaModel(),
        prompt: "ready",
        stream: false,
        keep_alive: KEEP_ALIVE,
        options: { num_ctx: 1024 },
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    /* warm-up is best-effort; extraction still works */
  }
}

export const GEMMA_PROMPT = `Extract structured data from this Dutch invoice (factuur) image.
Respond with ONLY a single JSON object, no markdown fences, no commentary.
Schema:
{
  "vendor": string | null,
  "address": string | null,
  "vendorEmail": string | null,
  "iban": string | null,
  "vatNumber": string | null,
  "businessRegistrationNumber": string | null,
  "invoiceNumber": string | null,
  "issueDate": "YYYY-MM-DD" | null,
  "dueDate": "YYYY-MM-DD" | null,
  "subtotal": number | null,
  "tax": number | null,
  "total": number | null,
  "currency": string | null,
  "lineItems": [{ "description": string, "quantity": number, "unitPrice": number, "amount": number }]
}
Field extraction rules (any-language invoice — default assumption is Dutch unless the document is clearly otherwise):
- vendor: The supplier/company name (leverancier/afzender/éditeur/fournisseur), usually near the logo at the top. NOT the customer (ontvanger/afnemer). Dutch legal forms: B.V., N.V., V.O.F., Stichting, Eenmanszaak, C.V.
- address: Supplier's postal address. Dutch: Street + number, 4-digit postal code + 2 letters + city (e.g. Keizersgracht 123, 1012 AB Amsterdam). May include Postbus.
- vendorEmail: Supplier's email, often near phone/website contact block.
- iban: Supplier's bank IBAN. Dutch: NL + 2 check digits + 4 letters + 10 digits (e.g. NL91ABNA0417164300). Remove spaces.
- vatNumber: The SUPPLIER's VAT / tax identification number. Dutch: NL + 9 digits + B + 2 digits (e.g. NL123456789B01). Other EU states keep their printed country prefix and structure (DE + 9 digits, BE0 + 9 digits, FR + 2 chars + 9 digits, etc.) — never re-prefix a foreign number with NL. Remove punctuation. Footer block next to IBAN/email — never the customer's VAT number.
- businessRegistrationNumber: The SUPPLIER's business registration number — the local identifier for the legal entity. For the Netherlands that is the KVK (Kamer van Koophandel) number, 7-8 digits (e.g. 73408441). For France use the SIREN (9 digits) or SIRET (14 digits) when labelled as such; for Germany the Handelsregisternummer (HRB/HRA + digits); for the UK the Companies House registration number (CRN); for Belgium the KBO/BCE number; for Finland the Y-tunnus. Digits only; strip spaces/dashes. Usually in the footer block next to the supplier's IBAN/VAT/email — never the customer's number from the bill-to block. When the document is not obviously Dutch and no business-registration label is visible, output null rather than guessing.
- invoiceNumber: Factuurnummer/facture/numéro de facture. Not a purchase order (inkoopnummer/commande) or VAT number.
- issueDate: Factuurdatum/date de facture. Dutch dates are day-first: 04-03-2026 = 4 March 2026. Output YYYY-MM-DD.
- dueDate: Vervaldatum/date d'échéance. Same date rules. If no explicit due date is printed but payment terms are (e.g. "14 dagen", "Net 30"), output null — the pipeline derives it from the issue date.
- subtotal: Subtotaal/hors taxe. Dutch: '.' = thousands, ',' = decimals (1.452,00 = 1452.00).
- tax: BTW-bedrag/TVA. Common rates: 21%, 9%, 0%.
- total: Totaalbedrag/à payer (incl. BTW/TVA).
- currency: Almost always EUR.
- lineItems: Actual goods/services only from the regels/lignes section. Never include subtotal/BTW/total rows.
Rules:
- Dutch dates: day-month-year. 04-03-2026 = 4 March 2026.
- Dutch amounts: 1.452,00 = 1452.00. Output plain numbers with '.' decimals.
- Use null for anything not visible or ambiguous. Never invent values.`;

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

const gemmaPageSchema = z.object({
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

export type GemmaPage = z.infer<typeof gemmaPageSchema>;

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

export function parseGemmaPage(raw: string): GemmaPage | null {
  try {
    const parsed = gemmaPageSchema.safeParse(JSON.parse(cleanModelJson(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type MergedGemma = {
  vendor: { value: string; page: number } | undefined;
  address: { value: string; page: number } | undefined;
  vendorEmail: { value: string; page: number } | undefined;
  iban: { value: string; page: number } | undefined;
  vatNumber: { value: string; page: number } | undefined;
  /** Every valid VAT candidate observed by the VLM, before arbitration. */
  vatCandidates: VatCandidate[];
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

/** First non-null value per field wins, except VAT which is arbitrated across
 *  all page candidates using supplier page anchors. Line items concatenate
 *  across pages. `pagesText` is the raw OCR text joined across all vision pages
 *  — passed through so `gemmaToFields` can derive the due date from payment
 *  terms when the VLM returned an empty `dueDate`. */
export function mergeGemmaPages(
  results: (GemmaPage | null)[],
  pagesText = "",
): MergedGemma {
  const merged: MergedGemma = {
    vendor: undefined,
    address: undefined,
    vendorEmail: undefined,
    iban: undefined,
    vatNumber: undefined,
    vatCandidates: [],
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
    if (r.vatNumber) {
      const pageCandidates = collectVatCandidates(r.vatNumber).map((candidate) => ({
        ...candidate,
        index: (page - 1) * 100000 + candidate.index,
        page,
        labelled: true,
      }));
      for (const candidate of pageCandidates) {
        if (!merged.vatCandidates.some((existing) => existing.page === candidate.page && existing.value === candidate.value))
          merged.vatCandidates.push(candidate);
      }
    }
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
  if (merged.vatCandidates.length > 0) {
    const selected = resolveSupplierVatNumber(merged.vatCandidates, {
      text: "",
      vendorEmail: merged.vendorEmail?.value,
      vendorEmailPage: merged.vendorEmail?.page,
      vendorIban: merged.iban?.value,
      vendorIbanPage: merged.iban?.page,
      businessRegistrationNumber: merged.businessRegistrationNumber?.value,
      businessRegistrationPage: merged.businessRegistrationNumber?.page,
    });
    if (selected) {
      merged.vatNumber = {
        value: selected.value,
        page: selected.page ?? merged.vatNumber?.page ?? 1,
      };
    }
  }
  return { ...merged, pagesText };
}

/** VLM reads — every field it found gets provenance "read".
 * The due date computed from payment terms gets "derived". */
export function gemmaToFields(merged: MergedGemma): ExtractedFields {
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
    typeof merged.issueDate?.value === "string"
      ? merged.issueDate.value
      : undefined;
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

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Reads an Ollama /api/chat stream (NDJSON); appends all content to text, emits tokens. */
async function readJsonStream(
  response: Response,
  onToken?: (text: string) => void,
): Promise<string> {
  if (!response.body) throw new Error("no stream body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as { message?: { content?: string } };
        const chunk = msg.message?.content ?? "";
        if (chunk) {
          text += chunk;
          onToken?.(chunk);
        }
      } catch {
        /* skip malformed line */
      }
    }
  }
  if (buffer.trim()) {
    try {
      const msg = JSON.parse(buffer.trim()) as { message?: { content?: string } };
      const chunk = msg.message?.content ?? "";
      if (chunk) {
        text += chunk;
        onToken?.(chunk);
      }
    } catch {
      /* ignore trailing partial line */
    }
  }
  return text;
}

/** Short-lived probe cache avoids paying localhost timeouts for every upload/job. */
let healthCache: { value: boolean; expiresAt: number } | undefined;
let healthProbe: Promise<boolean> | undefined;

/** True when an Ollama server answers on any known host. */
export async function gemmaHealthy(): Promise<boolean> {
  if (healthCache && healthCache.expiresAt > Date.now()) return healthCache.value;
  if (healthProbe) return healthProbe;
  healthProbe = probeGemmaHealthy();
  try {
    return await healthProbe;
  } finally {
    healthProbe = undefined;
  }
}

async function probeGemmaHealthy(): Promise<boolean> {
  const hosts: string[] = [];
  try {
    const saved = localStorage.getItem("ollama-base");
    if (saved) hosts.push(saved);
  } catch {
    /* ignore */
  }
  for (const h of OLLAMA_HOSTS) if (!hosts.includes(h)) hosts.push(h);
  for (const base of hosts) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      try {
        const r = await fetch(`${base}/api/version`, { signal: ctrl.signal });
        if (r.ok) {
          try {
            localStorage.setItem("ollama-base", base);
          } catch {
            /* ignore */
          }
          healthCache = { value: true, expiresAt: Date.now() + 30_000 };
          return true;
        }
      } finally {
        clearTimeout(t);
      }
    } catch {
      /* try next host */
    }
  }
  healthCache = { value: false, expiresAt: Date.now() + 10_000 };
  return false;
}

export type GemmaProgress = { stage: string; progress: number; page?: number; totalPages?: number };

export type VisionPageResult = {
  page: GemmaPage | null;
  model: string | undefined;
};

/**
 * Sends one page image to each model in order; first parseable result wins.
 * Returns the winning model name so callers can audit accurately.
 */
export async function extractPageWithVision(
  imageB64: string,
  page: number,
  totalPages: number,
  models: string[],
  onProgress?: (p: GemmaProgress) => void,
  onToken?: (text: string) => void,
): Promise<VisionPageResult> {
  for (const [i, model] of models.entries()) {
    onProgress?.({
      stage: `AI reading page ${page} of ${totalPages} (${model}${i > 0 ? " retry" : ""})`,
      progress: 0.1 + 0.8 * ((page - 1) / totalPages),
      page,
      totalPages,
    });
    try {
      const r = await postJson(
        `${ollamaBase()}/api/chat`,
        {
          model,
          stream: true,
          format: "json",
          keep_alive: KEEP_ALIVE,
          options: { temperature: 0, num_ctx: 4096 },
          messages: [{ role: "user", content: GEMMA_PROMPT, images: [imageB64] }],
        },
        240000,
      );
      if (!r.ok) continue;
      const content = await readJsonStream(r, onToken);
      const parsed = content ? parseGemmaPage(content) : null;
      if (parsed) return { page: parsed, model };
    } catch {
      /* try next model */
    }
  }
  return { page: null, model: undefined };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      resolve(url.includes(",") ? url.split(",")[1]! : url);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/** Resizes an image blob so its long edge is at most VISION_MAX_EDGE, re-encoded as JPEG. */
export async function downscaleToJpeg(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, VISION_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const jpeg = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  canvas.width = canvas.height = 0;
  return jpeg ?? blob;
}
