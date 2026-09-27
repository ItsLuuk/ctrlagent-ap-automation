/**
 * Vendor profile store — one canonical per-vendor document.
 *
 * Consolidates zones, field patterns, and identity aliases (names, IBAN, VAT,
 * KvK) into a single profile per vendor. Confirm is the authoritative write;
 * ingest auto-learn is a provisional cache. Review corrections at confirm time
 * refine the profile (origin "reviewed"), and no corrections promote auto →
 * reviewed (cheap, honest audit story).
 *
 * Version history is retained so a fat-fingered correction poisoning a stable
 * profile is one revert away. The floor check at match time is the remaining
 * safety net.
 *
 * UBL invoices refine identity only (no words, no zones). Derived fields
 * (due-date-from-terms, fieldSources deleted) are never learnable.
 *
 * Vendor-name corrections update identity aliases, not zone specs.
 */

import type {
  AnchorSpec,
  Invoice,
  OcrWord,
  VendorProfile,
  VendorProfileVersion,
  VendorTemplate,
  ZoneField,
} from "./types";
import { buildTemplateFromInvoice } from "./ocr";
import { locateValue, specForLocation, type ValueLocation } from "./mapping";
import { resolveVendorKey } from "./vendor-master";

// Re-exported so the many callers that already reach for it through the store
// keep working. The rule itself lives in `vendor-master.ts`, with the domain
// core: it is a naming rule about a vendor, not a storage detail, and the use
// cases that count a vendor's track record need it without reaching for
// persistence.
export { resolveVendorKey };
import { fingerprintOf } from "./fingerprint";

const STORAGE_KEY = "ap-automation-vendor-profiles-v1";
const TEMPLATE_STORAGE_KEY = "ap-automation-vendor-templates-v2";
const TEMPLATE_EMBED_KEY = "ap-automation-vendor-embeddings-v1";

type TemplateStore = Record<string, VendorTemplate>;
type EmbedIndex = Record<string, { vendor_key: string; embedding: number[]; fingerprint: string }>;

type Store = Record<string, VendorProfile>;
let memoryStore: Store = {};

function readStore(): Store {
  if (typeof localStorage === "undefined") return memoryStore;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return memoryStore;
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : memoryStore;
  } catch {
    return memoryStore;
  }
}

function writeStore(store: Store): void {
  memoryStore = store;
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage full or unavailable */
  }
}

/** Reads all profiles — exposed for the vendor profile UI / debug surface. */
export function readAllProfiles(): Store {
  return readStore();
}

/** Wipes everything (used by clear-all-data in the store). */
export function clearProfiles(): void {
  writeStore({});
  clearTemplates();
}

/**
 * Auto-learn: provisional template from an unreviewed invoice.
 *
 * Fires at ingest time (store.tsx addInvoice). The profile is stored with
 * origin "auto" — it's a cache, not a confirmed profile. At confirm time it
 * either gets refined (corrections → origin "reviewed") or promoted
 * (no corrections → origin "reviewed", cheap and honest).
 *
 * Only fields with provenance "exact" or "read" are learned — derived or
 * manual fields are not reliable enough to teach the profile.
 */
export function autoLearnProfile(invoice: Invoice): VendorProfile | undefined {
  const learned = buildTemplateFromInvoice(invoice);
  if (!learned) return undefined;
  const vendorKey = resolveVendorKey(invoice);
  const store = readStore();
  const prev = store[vendorKey];
  const profile: VendorProfile = {
    vendor_key: vendorKey,
    aliases: prev?.aliases ?? [invoice.vendor],
    fields: learned.fields,
    version: (prev?.version ?? 0) + 1,
    origin: "auto",
    updatedAt: new Date().toISOString(),
    history: prev?.history ?? [],
  };
  // Retain the previous version in history (newest first).
  if (prev) {
    profile.history = [
      {
        version: prev.version,
        fields: prev.fields,
        line_items: prev.line_items,
        origin: prev.origin,
        updatedAt: prev.updatedAt,
      },
      ...prev.history,
    ].slice(0, 20); // Cap history at 20 versions
  }
  store[vendorKey] = profile;
  writeStore(store);
  return profile;
}

/**
 * Confirm-time write: the authoritative profile update.
 *
 * Two paths:
 * 1. Corrections were made → refine the profile from the corrected values
 *    (origin "reviewed"). Only corrected fields with anchorable zones in
 *    learnPayload get re-derived; the rest keep their existing spec.
 * 2. No corrections → promote auto → reviewed (cheap, honest audit story).
 *
 * Either way, the profile version bumps and the previous version is retained
 * in history (one revert away).
 */
export function confirmProfile(
  invoice: Invoice,
  corrections: Partial<Record<ZoneField, string | number>>,
): VendorProfile | undefined {
  const vendorKey = resolveVendorKey(invoice);
  const store = readStore();
  const prev = store[vendorKey];
  if (!prev) return undefined;

  // Determine which fields were corrected.
  const correctedFields = new Set(
    Object.keys(corrections).filter((f) => {
      const field = f as ZoneField;
      const corrected = corrections[field];
      const original = invoice[field];
      // A correction means the value changed.
      if (corrected === undefined || original === undefined) return false;
      return String(corrected) !== String(original);
    }),
  );

  // If there are corrections, try to re-derive specs from learnPayload.
  let newFields = { ...prev.fields };
  if (correctedFields.size > 0 && invoice.learnPayload) {
    const words = invoice.learnPayload.pages[0]?.words ?? [];
    if (words.length > 0) {
      for (const rawField of correctedFields) {
        const field = rawField as ZoneField;
        const correctedValue = corrections[field];
        if (correctedValue === undefined) continue;
        // Try to find the corrected value's zone in learnPayload.
        // This uses the same matcher as suggestZone — with money/date
        // normalization so "1.234,56" matches stored 1234.56.
        const spec = deriveSpecFromValue(words, field, correctedValue);
        if (spec) {
          newFields[field] = spec;
        }
        // If not anchorable, keep the old spec — this is the honest
        // boundary: the loop repairs zone misses, not OCR misreads.
      }
    }
  }

  // Vendor-name corrections update identity aliases, not zone specs.
  let aliases = prev.aliases;
  if (corrections.vendor !== undefined) {
    const newVendor = String(corrections.vendor);
    if (!aliases.some((a) => a.toLowerCase() === newVendor.toLowerCase())) {
      aliases = [newVendor, ...aliases].slice(0, 20);
    }
  }

  const profile: VendorProfile = {
    vendor_key: vendorKey,
    aliases,
    fields: newFields,
    line_items: prev.line_items,
    version: prev.version + 1,
    origin: correctedFields.size > 0 ? "reviewed" : "reviewed",
    updatedAt: new Date().toISOString(),
    history: [
      {
        version: prev.version,
        fields: prev.fields,
        line_items: prev.line_items,
        origin: prev.origin,
        updatedAt: prev.updatedAt,
      },
      ...prev.history,
    ].slice(0, 20),
  };
  store[vendorKey] = profile;
  writeStore(store);
  return profile;
}

/**
 * Reverts a profile to a previous version. One revert away from a fat-fingered
 * correction poisoning a stable profile.
 */
export function revertProfile(vendorKey: string, targetVersion: number): VendorProfile | undefined {
  const store = readStore();
  const prev = store[vendorKey];
  if (!prev) return undefined;
  const target = prev.history.find((v) => v.version === targetVersion);
  if (!target) return undefined;
  const profile: VendorProfile = {
    ...prev,
    version: target.version,
    fields: target.fields,
    line_items: target.line_items,
    origin: target.origin,
    updatedAt: target.updatedAt,
    history: [
      {
        version: prev.version,
        fields: prev.fields,
        line_items: prev.line_items,
        origin: prev.origin,
        updatedAt: prev.updatedAt,
      },
      ...prev.history,
    ].slice(0, 20),
  };
  store[vendorKey] = profile;
  writeStore(store);
  return profile;
}

/**
 * What learning a typed value did, or why it could not. Every branch is a
 * thing the person has to be told plainly: we found it, we found it twice,
 * it isn't on the page, or there is no label to remember it by.
 */
export type LearnOutcome =
  | { status: "learned"; zone: ValueLocation["zone"]; words: ValueLocation["words"] }
  | { status: "ambiguous"; options: ValueLocation[] }
  | { status: "absent" }
  | { status: "no-anchor" }
  | { status: "no-words" };

/**
 * Remembers where a value lives on this vendor's invoices.
 *
 * The person supplied the value; this finds its text on the page and writes the
 * template that will read it next time. One match is an answer. Several are
 * returned as a question. None is remembered as an absence, so the same field
 * is not asked for again on every future invoice.
 */
export function learnFieldFromValue(
  invoice: Invoice,
  field: ZoneField,
  value: string | number,
  chosen?: ValueLocation,
): LearnOutcome {
  const words = invoice.learnPayload?.pages[0]?.words;
  if (!words || words.length === 0) return { status: "no-words" };
  const locations = locateValue(words, field, value);
  if (locations.length === 0) {
    markFieldAbsent(invoice, field);
    return { status: "absent" };
  }
  const location = chosen ?? (locations.length === 1 ? locations[0] : undefined);
  if (!location) return { status: "ambiguous", options: locations };
  const spec = specForLocation(words, field, location);
  if (!spec) return { status: "no-anchor" };
  writeSpec(invoice, field, spec);
  return { status: "learned", zone: location.zone, words: location.words };
}

/**
 * Records that this vendor does not print this field. The spec is dropped at
 * the same time: a box for something the page never carries is a box that
 * fails on every read, and a failing spec is what the absence is replacing.
 */
export function markFieldAbsent(invoice: Invoice, field: ZoneField): void {
  const vendorKey = resolveVendorKey(invoice);
  const store = readStore();
  const prev = store[vendorKey];
  const profile: VendorProfile = {
    ...(prev ?? emptyProfile(vendorKey, invoice.vendor)),
    fields: withoutField(prev?.fields, field),
    absentFields: [...new Set([...(prev?.absentFields ?? []), field])],
    version: (prev?.version ?? 0) + 1,
    origin: "reviewed",
    updatedAt: new Date().toISOString(),
    history: versionHistory(prev),
  };
  store[vendorKey] = profile;
  writeStore(store);
}

function emptyProfile(vendorKey: string, vendorName: string): VendorProfile {
  return {
    vendor_key: vendorKey,
    aliases: vendorName ? [vendorName] : [],
    fields: {},
    version: 0,
    origin: "auto",
    updatedAt: new Date().toISOString(),
    history: [],
  };
}

function withoutField(
  fields: VendorProfile["fields"] | undefined,
  field: ZoneField,
): VendorProfile["fields"] {
  if (!fields) return {};
  if (!(field in fields)) return fields;
  const next = { ...fields };
  delete next[field];
  return next;
}

function versionHistory(prev: VendorProfile | undefined): VendorProfileVersion[] {
  if (!prev) return [];
  return [
    {
      version: prev.version,
      fields: prev.fields,
      absentFields: prev.absentFields,
      line_items: prev.line_items,
      origin: prev.origin,
      updatedAt: prev.updatedAt,
    },
    ...prev.history,
  ].slice(0, 20);
}

/** Writes one learned spec, clearing any absence recorded for that field. */
function writeSpec(invoice: Invoice, field: ZoneField, spec: AnchorSpec): void {
  const vendorKey = resolveVendorKey(invoice);
  const store = readStore();
  const prev = store[vendorKey];
  const profile: VendorProfile = {
    ...(prev ?? emptyProfile(vendorKey, invoice.vendor)),
    fields: { ...(prev?.fields ?? {}), [field]: spec },
    absentFields: (prev?.absentFields ?? []).filter((absent) => absent !== field),
    version: (prev?.version ?? 0) + 1,
    origin: "reviewed",
    updatedAt: new Date().toISOString(),
    history: versionHistory(prev),
  };
  store[vendorKey] = profile;
  writeStore(store);
}

/**
 * Derives an AnchorSpec from a corrected value, using the same field-aware
 * matcher the "find it on the page" path uses: "14-03-2026" is the date
 * "2026-03-14" and "1.234,56" is the amount 1234.56.
 *
 * Returns undefined when the value cannot be anchored — an OCR misread, or a
 * page with no label to remember it by. The old spec is then kept as-is: the
 * loop repairs zone misses, not misreads, and it never invents a box.
 */
function deriveSpecFromValue(
  words: OcrWord[],
  field: ZoneField,
  value: string | number,
): AnchorSpec | undefined {
  const locations = locateValue(words, field, value);
  if (locations.length === 0) return undefined;
  return specForLocation(words, field, locations[0]!);
}

  // Find the nearest anchor label.

let templateCache: TemplateStore | undefined;
let embedCache: EmbedIndex | undefined;

function readTemplateStore(): TemplateStore {
  if (typeof localStorage === "undefined") return templateCache ?? {};
  try {
    const parsed = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) ?? "{}") as TemplateStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readEmbedIndex(): EmbedIndex {
  if (typeof localStorage === "undefined") return embedCache ?? {};
  try {
    const parsed = JSON.parse(localStorage.getItem(TEMPLATE_EMBED_KEY) ?? "{}") as EmbedIndex;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeJson(key: string, value: unknown): void {
  if (key === TEMPLATE_STORAGE_KEY) templateCache = value as TemplateStore;
  if (key === TEMPLATE_EMBED_KEY) embedCache = value as EmbedIndex;
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable */
  }
}

/** Persist the legacy template-shaped projection next to the canonical profile. */
export function upsertTemplate(template: VendorTemplate): void {
  const store = readTemplateStore();
  const previous = store[template.vendor_key];
  const next = {
    ...template,
    version: Math.max(template.version, (previous?.version ?? 0) + 1),
  };
  store[template.vendor_key] = next;
  writeJson(TEMPLATE_STORAGE_KEY, store);
  const index = readEmbedIndex();
  const fingerprint = next.vendor_fingerprint || fingerprintOf(next.vendor_key);
  index[fingerprint] = {
    vendor_key: next.vendor_key,
    embedding: next.embedding,
    fingerprint,
  };
  writeJson(TEMPLATE_EMBED_KEY, index);
}
export function readAllTemplates(): TemplateStore {
  return readTemplateStore();
}

export function clearTemplates(): void {
  templateCache = undefined;
  embedCache = undefined;
  writeJson(TEMPLATE_STORAGE_KEY, {});
  writeJson(TEMPLATE_EMBED_KEY, {});
}
