/**
 * File hashing — the pure half of the ingest gate.
 *
 * SHA-256 of the original File bytes, computed uniformly at addInvoice before
 * any type branching (including preview-only and UBL paths). Full hash only —
 * sampling was rejected: crypto.subtle.digest is hardware-accelerated and a
 * 10 MB PDF hashes in single-digit milliseconds; sampling saves nothing and
 * creates a second behavior class.
 *
 * Kept free of `localStorage` on purpose: the OCR pipeline hashes bytes as
 * domain work, while *remembering* which hashes were seen is the adapter's
 * job (`file-hash-gate.ts`). Persistence and hashing change for different
 * reasons, so they are different modules.
 *
 * Yield expectation (inverted from the naïve claim): byte hash catches
 * forward-as-attachment re-uploads. It misses portal re-downloads, re-prints,
 * and print-to-PDF-from-email-preview — all common in month two. The business
 * key (step 3) is the load-bearing layer; the hash is the trivial layer.
 */

import type { Invoice } from "./types";

/** SHA-256 of the original uploaded bytes, hex-encoded. Empty string = not computed. */
export type FileHash = string;

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
 * anything — just reports what it found. Pure: the caller supplies the records.
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
