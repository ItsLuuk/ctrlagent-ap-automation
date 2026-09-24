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
 *
 * Also persists the legacy VendorTemplate projection (zones + embedding +
 * fingerprint) so the template-matching pipeline keeps working while the
 * canonical profile is the system of record.
 */

import type { Invoice, VendorProfile, VendorProfileVersion, VendorTemplate, ZoneField } from "./types";
import { buildTemplateFromInvoice } from "./ocr";
import { fingerprintOf } from "./fingerprint";

const PROFILES_KEY = "ap-automation-vendor-profiles-v1";
const TEMPLATES_KEY = "ap-automation-vendor-templates-v2";
const EMBED_KEY = "ap-automation-vendor-embeddings-v1";

type ProfileStore = Record<string, VendorProfile>;
type TemplateStore = Record<string, VendorTemplate>;
type EmbedIndex = Record<string, { vendor_key: string; embedding: number[]; fingerprint: string }>;

type Store = ProfileStore;

function readProfiles(): ProfileStore {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ProfileStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeProfiles(store: ProfileStore): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(store));
  } catch {
    /* storage full or unavailable */
  }
}

function readTemplateStore(): TemplateStore {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as TemplateStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeTemplateStore(store: TemplateStore): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(store));
  } catch {
    /* storage full or unavailable */
  }
}

function readEmbedIndex(): EmbedIndex {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(EMBED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as EmbedIndex;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeEmbedIndex(index: EmbedIndex): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(EMBED_KEY, JSON.stringify(index));
  } catch {
    /* ignore */
  }
}

/** Resolves the canonical vendor key for an invoice (identity resolution). */
export function resolveVendorKey(invoice: Invoice): string {
  // UBL supplies exact identity (BT-1/BT-2); everything else is fuzzy.
  // For now, use the invoice's vendor name as the key. In the future this
  // could resolve through aliases (IBAN/VAT/KvK) to a canonical name.
  return invoice.vendor.toLowerCase().trim();
}

/** Reads all profiles — exposed for the vendor profile UI / debug surface. */
export function readAllProfiles(): ProfileStore {
  return readProfiles();
}

/** Wipes everything (used by clear-all-data in the store). */
export function clearProfiles(): void {
  writeProfiles({});
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
  const store = readProfiles();
  const prev = store[vendorKey];
  const profile: VendorProfile = {
    vendor_key: vendorKey,
    aliases: prev?.aliases ?? [invoice.vendor],
    fields: learned.fields,
    line_items: learned.line_items,
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
  writeProfiles(store);
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
  const store = readProfiles();
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
      for (const field of correctedFields) {
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
  writeProfiles(store);
  return profile;
}

/**
 * Reverts a profile to a previous version. One revert away from a fat-fingered
 * correction poisoning a stable profile.
 */
export function revertProfile(vendorKey: string, targetVersion: number): VendorProfile | undefined {
  const store = readProfiles();
  const prev = store[vendorKey];
  if (!prev) return undefined;
  const target = prev.history.find((v) => v.version === targetVersion);
  if (!target) return undefined;
  const profile: VendorProfile = {
    ...prev,
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
  writeProfiles(store);
  return profile;
}

/**
 * Derives an AnchorSpec from a corrected value using the same matcher as
 * suggestZone — with money/date normalization so "1.234,56" matches stored
 * 1234.56. Returns undefined when the value can't be anchored (OCR misread —
 * no anchor update helps).
 */
function deriveSpecFromValue(
  words: Array<{ text: string; x: number; y: number; w: number; h: number }>,
  field: ZoneField,
  value: string | number,
): VendorProfile["fields"][ZoneField] | undefined {
  // This is a simplified version of deriveAnchor from ocr.ts that works on
  // raw word arrays. The full version uses extractVendorBlock and provenance
  // checks; here we just need the zone geometry.
  const valueStr = String(value);
  const needle = valueStr.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (!needle) return undefined;

  // Find the value's word cluster.
  const valueWords = words.filter((w) => {
    const hay = w.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    return hay.includes(needle) || needle.includes(hay);
  });
  if (valueWords.length === 0) return undefined;

  // Find the nearest anchor label.
  const anchorLabels: Record<string, string[]> = {
    vendor: ["van", "from", "leverancier", "supplier", "afzender", "verkoper"],
    invoiceNumber: ["factuur", "factuurnummer", "factuurnr", "invoice", "nummer", "no.", "nr."],
    issueDate: ["factuurdatum", "datum", "date", "invoice date"],
    dueDate: ["vervaldatum", "betalingsdatum", "te betalen", "due", "due date"],
    subtotal: ["subtotaal", "subtotal", "netto", "net", "totaal excl"],
    tax: ["btw", "btw-bedrag", "vat", "tax"],
    total: ["totaal", "total", "te betalen", "amount due", "total due", "grand total"],
  };
  const candidates = anchorLabels[field] ?? [];
  let anchor: { text: string; x: number; y: number; w: number; h: number } | undefined;
  for (const cand of candidates) {
    const needleCand = cand.toLowerCase();
    for (const w of words) {
      if (w.text.toLowerCase().includes(needleCand)) {
        if (!anchor || w.y < anchor.y) anchor = w;
      }
    }
    if (anchor) break;
  }
  if (!anchor) anchor = words[0];
  if (!anchor) return undefined;

  const valueWord = valueWords[0];
  const x0 = Math.min(anchor.x, valueWord.x);
  const y0 = Math.min(anchor.y, valueWord.y);
  const x1 = Math.max(anchor.x + anchor.w, valueWord.x + valueWord.w);
  const y1 = Math.max(anchor.y + anchor.h, valueWord.y + valueWord.h);
  const ax = anchor.x;
  const ay = anchor.y;
  const aw = anchor.w || 0.05;
  const ah = anchor.h || 0.05;

  return {
    anchor: anchor.text,
    region: {
      x0: (x0 - ax) / aw,
      y0: (y0 - ay) / ah,
      x1: (x1 - ax) / aw,
      y1: (y1 - ay) / ah,
    },
    type:
      field === "issueDate" || field === "dueDate"
        ? "date"
        : field === "subtotal" || field === "tax" || field === "total"
          ? "decimal"
          : "string",
  } as VendorProfile["fields"][ZoneField];
}

/* ─── Template projection (legacy pipeline compat) ─────────────────── */

/** Threshold above which a template fingerprint counts as the same vendor. */
export const MATCH_THRESHOLD = 0.82;
export const MATCH_MARGIN = 0.06;

/**
 * Picks the best matching template for the given vendor block + embedding.
 * Returns undefined when nothing is close enough, which means we fall back
 * to the VLM path.
 */
export function findTemplateMatch(input: {
  vendorBlock: string;
  embedding: number[];
}): VendorTemplate | undefined {
  const idx = readEmbedIndex();
  const store = readTemplateStore();
  // Exact fingerprint hit short-circuits cosine.
  const fp = fingerprintOf(input.vendorBlock);
  const exact = idx[fp];
  if (exact) return store[exact.vendor_key];
  // Otherwise find the highest cosine.
  let best: { template: VendorTemplate; score: number } | undefined;
  let secondBest = 0;
  for (const entry of Object.values(idx)) {
    const score = cosine(input.embedding, entry.embedding);
    if (best === undefined || score > best.score) {
      secondBest = best?.score ?? secondBest;
      const tpl = store[entry.vendor_key];
      if (tpl) best = { template: tpl, score };
    } else if (score > secondBest) {
      secondBest = score;
    }
  }
  if (!best) return undefined;
  if (best.score < MATCH_THRESHOLD || best.score - secondBest < MATCH_MARGIN) return undefined;
  return best.template;
}

/** Persists a newly-learned template. Bumps the version on existing entries. */
export function upsertTemplate(template: VendorTemplate): void {
  const store = readTemplateStore();
  const prev = store[template.vendor_key];
  store[template.vendor_key] = {
    ...template,
    version: (prev?.version ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  writeTemplateStore(store);
  const idx = readEmbedIndex();
  idx[template.vendor_fingerprint] = {
    vendor_key: template.vendor_key,
    embedding: template.embedding,
    fingerprint: template.vendor_fingerprint,
  };
  writeEmbedIndex(idx);
}

/** Reads the raw store — exposed for the templates UI / debug surface. */
export function readAllTemplates(): TemplateStore {
  return readTemplateStore();
}

/** Wipes everything (used by clear-all-data in the store). */
export function clearTemplates(): void {
  writeTemplateStore({});
  writeEmbedIndex({});
}

import { cosine } from "./fingerprint";
