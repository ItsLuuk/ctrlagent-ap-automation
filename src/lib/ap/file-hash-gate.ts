/**
 * File hash gate — duplicate detection at ingest.
 *
 * SHA-256 of the original File bytes, computed uniformly at addInvoice before
 * any type branching (including preview-only and UBL paths). Full hash only —
 * sampling was rejected: crypto.subtle.digest is hardware-accelerated and a
 * 10 MB PDF hashes in single-digit milliseconds; sampling saves nothing and
 * creates a second behavior class.
 *
 * Yield expectation (inverted from the naïve claim): byte hash catches
 * forward-as-attachment re-uploads. It misses portal re-downloads, re-prints,
 * and print-to-PDF-from-email-preview — all common in month two. The business
 * key (step 3) is the load-bearing layer; the hash is the trivial layer.
 */

import type { Invoice } from "./types";

/** SHA-256 of the original uploaded bytes, hex-encoded. Empty string = not computed. */
export type FileHash = string;

const HASH_STORAGE_KEY = "ap-automation-file-hashes-v1";

/** Reads the set of known file hashes from localStorage. */
export function readKnownHashes(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(HASH_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

/** Persists a hash set back to localStorage. */
export function writeKnownHashes(hashes: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(HASH_STORAGE_KEY, JSON.stringify([...hashes]));
  } catch {
    /* storage full or unavailable */
  }
}

/**
 * Computes SHA-256 of a File's bytes. Synchronous wrapper around crypto.subtle
 * via a microtask — the caller (addInvoice) already runs async, so this is
 * awaited at the top of the ingest path before any type branching.
 */
export async function computeFileHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const hex = [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex;
}

/**
 * Result of the hash gate check at ingest.
 *
 * When `duplicate` is true, the caller should soft-flag the duplicate, deep-link
 * to `existingId`, and offer an "import anyway" escape — but not silently create
 * a second draft.
 */
export type HashGateResult =
  | { ok: true; fileHash: string }
  | { ok: false; duplicate: true; fileHash: string; existingId: string };

/**
 * Checks whether a file hash matches an already-seen invoice. Does not create
 * anything — just reports what it found.
 */
export async function checkFileHash(
  file: File,
  existing: Invoice[],
): Promise<HashGateResult> {
  const fileHash = await computeFileHash(file);
  const match = existing.find(
    (inv) => inv.fileHash === fileHash && inv.source === "upload",
  );
  if (match) {
    return { ok: false, duplicate: true, fileHash, existingId: match.id };
  }
  return { ok: true, fileHash };
}

/**
 * Records a newly seen file hash into the persistent set.
 */
export function recordFileHash(fileHash: string): void {
  const hashes = readKnownHashes();
  hashes.add(fileHash);
  writeKnownHashes(hashes);
}
