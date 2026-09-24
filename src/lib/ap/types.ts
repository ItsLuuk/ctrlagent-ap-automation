import { BUSINESS_REGISTRATION_LABEL_FALLBACK } from "./business-registration";

export type InvoiceStatus =
  | "vendor_profile"
  | "draft"
  | "review"
  | "scheduled"
  | "rejected"
  | "paid"
  | "archived"
  | "processing"
  | "failed";

/** Statuses that participate in the bill inbox pipeline; processing/failed are
 *  transient and never make it into the audit history badge order. */
export const STATUS_ORDER: InvoiceStatus[] = ["vendor_profile", "draft", "review", "scheduled"];

/**
 * The stages whose next step is a person's, not the machine's: a first-time
 * vendor to pin, a draft to confirm, an approval to give, a failed read to look
 * at. `processing` is the machine mid-read and `scheduled` is already approved,
 * so neither is on this list.
 *
 * One list, one number. The inbox's "Needs your judgment" tile and the sentence
 * above the queue both count it, which is why they cannot disagree about how
 * much is waiting on the operator — the old count was approvals only, so the
 * accented tile read 0 while a draft and a first-time vendor were waiting.
 */
export const AWAITING_PERSON: InvoiceStatus[] = ["vendor_profile", "draft", "review", "failed"];

/** The inbox opens here: every stage whose next step is a person's. Same set
 *  as AWAITING_PERSON — the name reads correctly at tab/filter call sites. */
export const NEEDS_YOU = AWAITING_PERSON;

/** The machine mid-read: nothing for a person to do until it lands or fails. */
export const IN_FLIGHT: InvoiceStatus[] = ["processing"];

/** Waiting on handoff or already settled — real, but not today's work. */
export const LATER: InvoiceStatus[] = ["scheduled", "rejected", "paid", "archived"];

export type Bucket = "needsYou" | "inFlight" | "later";

/** Exhaustive by type: adding an InvoiceStatus without a bucket is a compile error. */
export const BUCKET_BY_STATUS: Record<InvoiceStatus, Bucket> = {
  vendor_profile: "needsYou",
  draft: "needsYou",
  review: "needsYou",
  failed: "needsYou",
  processing: "inFlight",
  scheduled: "later",
  rejected: "later",
  paid: "later",
  archived: "later",
};

/**
 * Statuses where the approval question is still open, so a verdict about
 * approving the record belongs on the screen. A draft can still be submitted
 * and a review can still be approved; every other status has had that decision
 * made and recorded, and states the decision instead — the strip used to run on
 * all of them, so an approved record read "1 issue must be fixed before this can
 * be approved".
 */
export const APPROVAL_AHEAD: InvoiceStatus[] = ["draft", "review"];

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  vendor_profile: "Vendor profile",
  draft: "Draft",
  review: "For approval",
  scheduled: "Ready for external handoff",
  rejected: "Rejected",
  paid: "Historical completion",
  archived: "Removed",
  processing: "Processing",
  failed: "Needs attention",
};

export type LineItem = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  glAccount: string;
  department: string;
  page?: number | undefined;
};

export type AuditEntry = {
  id: string;
  at: string;
  actor: string;
  action: string;
  note?: string | undefined;
};

export type ExtractedField =
  | "vendor"
  | "invoiceNumber"
  | "issueDate"
  | "dueDate"
  | "subtotal"
  | "tax"
  | "total"
  | "address"
  | "vendorEmail"
  | "iban"
  | "vatNumber"
  | "businessRegistrationNumber";

export type ZoneField = ExtractedField;

/** Normalized 0..1 rectangle anchored to a document image. */
export type Zone = { x: number; y: number; w: number; h: number };

export type ZoneMap = Partial<Record<ZoneField, Zone>>;

/** Reusable field anchors for one vendor; latest save wins per field. */
/**
 * Per-field positional rule stored for a vendor. Regions are normalized
 * (0..1 of page width/height) so a template survives small layout drift.
 * `regex` is optional — when present, it is applied to the OCR text in the
 * region after the anchor is found.
 */
export type AnchorSpec = {
  /** Loose substring to find on the page (case-insensitive). */
  anchor: string;
  /** Normalized rectangle around the value (relative to anchor text). */
  region: { x0: number; y0: number; x1: number; y1: number };
  /** Optional regex applied to the OCR text inside the region. */
  regex?: string | undefined;
  /** Value type for the field; defaults to "string". */
  type?: "string" | "number" | "decimal" | "date" | undefined;
  /** Optional date format hint (strftime-style) for "date" fields. */
  format?: string | undefined;
};

/**
 * Vendor template is the learned extraction schema for one vendor. It carries
 * the vendor fingerprint + lightweight embedding used by cosine matching, the
 * per-field anchors, and a monotonically increasing version so we can roll back
 * if a new revision regresses on this vendor.
 */
export type VendorTemplate = {
  vendor_fingerprint: string;
  vendor_key: string;
  embedding: number[];
  version: number;
  fields: Partial<Record<ZoneField, AnchorSpec>>;
  /** Optional learned repeating-structure block for line items. */
  line_items?: LineItemsSpec | undefined;
  /** Training wheels: when > 0, template-path invoices hold at Draft for
   *  explicit confirmation and the count decrements on each confirm. */
  confirmNextCount?: number | undefined;
  /** Why the template was created — set when a human confirmed mappings. */
  origin?: "learned" | "confirmed" | "drift-update" | undefined;
  updatedAt: string;
};

/**
 * Learned line-item extraction: a table region plus per-column anchors, saved
 * from the mapping screen's line-item sub-mode. Columns map a header anchor to
 * a known line-item field; rows are parsed from the region at apply time.
 */
export type LineItemsSpec = {
  /** Normalized table region (0..1 of the page). */
  region: { x0: number; y0: number; x1: number; y1: number };
  /** Column definitions: anchor header text + which field it feeds. */
  columns: Array<{
    anchor: string;
    field: "description" | "quantity" | "unitPrice" | "amount" | "ignore";
    /** Horizontal band (normalized 0..1 within the region) for this column. */
    band: { x0: number; y0: number; x1: number; y1: number };
    type?: "string" | "number" | undefined;
  }>;
  /** Skip rows whose text matches Subtotal/Tax/Total patterns. */
  excludeTotalRows?: boolean | undefined;
  /** Merge wrapped description lines into the row above. */
  mergeMultiLine?: boolean | undefined;
};

/** Set when the template path extracted a field into a drift-flagged invoice. */
export type DriftInfo = {
  /** Fields the stored template could not read on this invoice. */
  missing: ZoneField[];
  /** How each drifted field's value was recovered. */
  recoveredBy: Partial<Record<ZoneField, "vlm" | "ocr-fallback">>;
  /** Template version that drifted (for the update-mode diff). */
  templateVersion: number | undefined;
  detectedAt: string;
};

/** Legacy shape carried by old `upsertTemplate` callers; new code uses VendorTemplate. */
export type LegacyVendorTemplate = { fields: ZoneMap; updatedAt: string };

export type ZoneCheckResult = { field: ZoneField; ai: string; ocr: string; match: boolean };

/**
 * Cross-source agreement for one field: two independent readers (the vision /
 * template path and the regex text scan) either agree, disagree, or one of them
 * had nothing to say. A disagreement keeps the value but pins its confidence
 * below the review threshold.
 */
export type CrossCheckOutcome = "agree" | "disagree" | "unverified";
export type CrossCheck = Partial<Record<ExtractedField, CrossCheckOutcome>>;

/**
 * Cached page payload kept on an Invoice so the template learner can derive
 * anchors without re-running OCR. Compact form of the words array.
 */
export type LearnPayload = {
  pages: Array<{
    pageNumber: number;
    words: Array<{ text: string; x: number; y: number; w: number; h: number; confidence: number }>;
  }>;
};

/** Per-job processing state. Lives on `Invoice.processing` while a job is in
 *  flight or has failed and not yet been retried. Removed on completion. */
export type ProcessingState = {
  /** Job stage label shown in the badge / toast. */
  stage:
    | "queued"
    | "preprocessing"
    | "matching vendor"
    | "ai reading"
    | "finalizing";
  /** 0..1 progress within the current stage. */
  progress: number;
  /** True once we've handed off to the background job and the modal is closed. */
  background: boolean;
  /** Human-readable failure reason when status === "failed". */
  error?: string | undefined;
  /** Raw pipeline stage at which the failure occurred, retained for diagnostics. */
  errorStage?: string | undefined;
  /** When the job started (ISO). */
  startedAt: string;
};

/**
 * Bounding box for a single OCR word. Coordinates are normalized 0..1 against
 * the source image so they survive any preview size.
 */
export type OcrWord = {
  text: string;
  /** Normalized left. */
  x: number;
  /** Normalized top. */
  y: number;
  /** Normalized width. */
  w: number;
  /** Normalized height. */
  h: number;
  /** OCR-reported confidence for this word, 0..1. */
  confidence: number;
};

/**
 * Engine result carries the extraction outcome plus enough trace metadata to
 * audit and learn. `path` is what the UI surfaces on the Draft screen and what
 * drives the audit log.
 */
export type TemplateEngineResult = {
  fields: Partial<Record<ZoneField, string | number>>;
  confidence: Partial<Record<ZoneField, number>>;
  fieldSources: Partial<Record<ZoneField, number>>;
  /** How this invoice was read. */
  path: "template" | "vlm" | "ocr-fallback";
  /** Which template matched (fingerprint) when path === "template". */
  templateFingerprint?: string | undefined;
  /** Engine/model label when path === "vlm". */
  model?: string | undefined;
};

/** Fields that carry a draggable anchor in Code-zones mode, in display order. */
export const ZONE_FIELDS: ExtractedField[] = [
  "vendor",
  "invoiceNumber",
  "issueDate",
  "dueDate",
  "subtotal",
  "tax",
  "total",
];

export const ZONE_LABEL: Record<ExtractedField, string> = {
  vendor: "Vendor",
  invoiceNumber: "Invoice no.",
  issueDate: "Issue date",
  dueDate: "Due date",
  subtotal: "Subtotal",
  tax: "Tax",
  total: "Total",
  address: "Address",
  vendorEmail: "Vendor email",
  iban: "IBAN",
  vatNumber: "BTW number",
  // One field, country-scoped name: the label module owns the country table, and
  // this map has no country to read. Hardcoding "KVK number" here labelled a
  // French vendor's SIREN as a KVK number.
  businessRegistrationNumber: BUSINESS_REGISTRATION_LABEL_FALLBACK,
};

/**
 * User-facing labels for pipeline stages. The extractor emits internal stage
 * names; anything a user can read goes through this map so architecture never
 * leaks into a label.
 */
export const STAGE_LABEL: Record<string, string> = {
  queued: "Queued",
  preprocessing: "Preparing document",
  "matching vendor": "Matching vendor template",
  "template hit": "Matched a known vendor",
  "ai reading": "Reading document",
  "ai reading document": "Reading document",
  "reading document": "Reading document",
  "text extraction": "Reading the document text",
  "recovering missing fields": "Recovering missing fields",
  finalizing: "Finalizing",
};

/** Maps a raw pipeline stage to its user-facing label (raw string if unknown). */
export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage.toLowerCase()] ?? stage;
}

export type OcrPageMethod = "text-layer" | "none";

/** How the document text was obtained overall. */
export type OcrMethod = "text-layer" | "none";

/** Per-page extraction metadata (text itself lives in the combined `ocrText`). */
export type OcrPage = {
  pageNumber: number;
  charCount: number;
  confidence: number;
  method: OcrPageMethod;
};

export type Invoice = {
  id: string;
  vendor: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  /** Supplier identity details read from the invoice (kept separate from the vendor master). */
  address?: string | undefined;
  vendorEmail?: string | undefined;
  iban?: string | undefined;
  vatNumber?: string | undefined;
  businessRegistrationNumber?: string | undefined;
  status: InvoiceStatus;
  /** The status this record held before it was removed from the queue — where
   *  Restore puts it back. Only set while a record is out of the queue. */
  archivedFrom?: InvoiceStatus | undefined;
  /** Linked purchase order (set at draft via suggestion or manual pick). */
  poId?: string | undefined;
  lineItems: LineItem[];
  glAccount: string;
  department: string;
  memo: string;
  tags: string[];
  confidence: Partial<Record<ExtractedField, number>>;
  audit: AuditEntry[];
  /** The invoice text states the amount was already paid (e.g. "reeds betaald"). */
  prepaid?: boolean | undefined;
  /** Snippet from the document showing the prepaid phrasing, for the approval UI. */
  prepaidPhrase?: string | undefined;
  source: "sample" | "upload";
  engine?: "gemma" | "template" | undefined;
  /** Template fingerprint the engine matched, when engine === "template". */
  templateFingerprint?: string | undefined;
  /** Per-field trace: which engine produced each value. */
  fieldPath?: Partial<Record<ExtractedField, "template" | "vlm" | "ocr-fallback">> | undefined;
  /** Cached page payloads used to learn the vendor template. Kept only when
   *  the engine that produced this invoice was VLM or OCR (i.e. novel). */
  learnPayload?: LearnPayload | undefined;
  fileName?: string | undefined;
  fileType?: string | undefined;
  fileUrl?: string | undefined;
  ocrText?: string | undefined;
  pageCount?: number | undefined;
  ocrMethod?: OcrMethod | undefined;
  ocrPages?: OcrPage[] | undefined;
  /** Which page each field was found on (1-based). */
  fieldSources?: Partial<Record<ExtractedField, number>> | undefined;
  /** Anchors the reviewer drew on this invoice's image (saved per-vendor too). */
  zones?: ZoneMap | undefined;
  /** Transient processing state — set on creation while the VLM job runs. */
  processing?: ProcessingState | undefined;
  /** Crop-OCR vs AI comparison from the vendor template, if one matched. */
  zoneCheck?: ZoneCheckResult[] | undefined;
  /** Cross-source agreement between the primary reader and the text scan. */
  crossCheck?: CrossCheck | undefined;
  /** Set when the template path missed fields on a known vendor — the draft
   *  screen uses this to offer the template update flow. */
  templateDrift?: DriftInfo | undefined;
  /** True while a template-path extraction is held at Draft for confirmation
   *  (training-wheels mode, per the vendor template's confirmNextCount). */
  templateHold?: boolean | undefined;
  createdAt: string;
};

export const PREDEFINED_TAGS = [
  "Urgent",
  "Late",
  "First-time vendor",
  "High value",
  "Needs receipt",
  "Duplicate risk",
  "International",
  "Recurring",
] as const;

export type InvoiceTag = (typeof PREDEFINED_TAGS)[number];

export const TAG_TONES: Record<InvoiceTag, { border: string; accent: string }> = {
  Urgent: { border: "border-destructive", accent: "text-destructive" },
  Late: { border: "border-destructive", accent: "text-destructive" },
  "First-time vendor": { border: "border-foundry-orange", accent: "text-foundry-orange" },
  "High value": { border: "border-foundry-orange", accent: "text-foundry-orange" },
  "Needs receipt": { border: "border-foundry-orange", accent: "text-foundry-orange" },
  "Duplicate risk": { border: "border-destructive", accent: "text-destructive" },
  International: { border: "border-steel", accent: "text-muted-foreground" },
  Recurring: { border: "border-border", accent: "text-muted-foreground" },
};

export const GL_ACCOUNTS = [
  "6010 · Software & SaaS",
  "6020 · Professional services",
  "6030 · Marketing",
  "6040 · Travel & entertainment",
  "6050 · Office & facilities",
  "6060 · Hardware & equipment",
];

export const DEPARTMENTS = ["Engineering", "Finance", "Marketing", "Operations", "Sales", "People"];

/** Supported ISO 4217 currencies for the focused invoice workflow. */
export const CURRENCY_OPTIONS = [
  { code: "EUR", label: "EUR · Euro" },
  { code: "USD", label: "USD · US dollar" },
  { code: "GBP", label: "GBP · British pound" },
  { code: "CAD", label: "CAD · Canadian dollar" },
  { code: "AUD", label: "AUD · Australian dollar" },
  { code: "CHF", label: "CHF · Swiss franc" },
  { code: "JPY", label: "JPY · Japanese yen" },
] as const;

export const uid = () => Math.random().toString(36).slice(2, 10);

export const money = (value: number, currency = "EUR") => {
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "EUR";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: safeCurrency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
};

/**
 * Audit-trail timestamp: "Sep 23, 9:14 AM". One definition, so a decision and
 * the trail entry that recorded it read the same wherever the app quotes one.
 */
export const shortDateTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export const shortDate = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

/**
 * The user's own business profile. Used to filter out customer/bill-to data
 * during extraction — everything matching this profile is NOT the vendor.
 */
export type BusinessProfile = {
  /** Trading name / legal name of the user's business. */
  name: string;
  /** Street address (e.g. "Industrieweg 42, 1012 AB Amsterdam"). */
  address: string;
  /** Email address. */
  email: string;
  /** Dutch IBAN or international IBAN. */
  iban: string;
  /** BTW / VAT identification number. */
  vatNumber: string;
  /** Legacy Dutch name for the business registration number. */
  kvkNumber?: string;
  /** Generic country-neutral business registration number. */
  businessRegistrationNumber?: string;
};

export const EMPTY_BUSINESS_PROFILE: BusinessProfile = {
  name: "",
  address: "",
  email: "",
  iban: "",
  vatNumber: "",
  kvkNumber: "",
  businessRegistrationNumber: "",
};
