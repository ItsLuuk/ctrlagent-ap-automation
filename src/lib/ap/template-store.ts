/**
 * Local app template store. Persists VendorTemplate per-vendor in
 * localStorage so the next invoice from that vendor skips the VLM pass.
 *
 * The store is keyed by `vendor_key` (the human vendor name, for display)
 * with a side-table of `vendor_fingerprint` -> vendor_key so we can match on
 * fingerprint before the human name has stabilized.
 */
import type { VendorTemplate } from "./types";
import { cosine, fingerprintOf } from "./fingerprint";

const STORAGE_KEY = "ap-automation-vendor-templates-v2";
const EMBED_KEY = "ap-automation-vendor-embeddings-v1";

type Store = Record<string, VendorTemplate>;
type EmbedIndex = Record<string, { vendor_key: string; embedding: number[]; fingerprint: string }>;

function readStore(): Store {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
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
  const store = readStore();
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
  const store = readStore();
  const prev = store[template.vendor_key];
  store[template.vendor_key] = {
    ...template,
    version: (prev?.version ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
  const idx = readEmbedIndex();
  idx[template.vendor_fingerprint] = {
    vendor_key: template.vendor_key,
    embedding: template.embedding,
    fingerprint: template.vendor_fingerprint,
  };
  writeEmbedIndex(idx);
}

/** Reads the raw store — exposed for the templates UI / debug surface. */
export function readAllTemplates(): Store {
  return readStore();
}

/** Wipes everything (used by clear-all-data in the store). */
export function clearTemplates(): void {
  writeStore({});
  writeEmbedIndex({});
}
