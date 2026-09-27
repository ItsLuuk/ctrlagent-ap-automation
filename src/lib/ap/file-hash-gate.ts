/**
 * File hash gate — remembering which file hashes ingest has already seen.
 *
 * This is the persistence half of the gate: a localStorage set of SHA-256 hex
 * digests. The hashing itself is domain work and lives in `file-hash.ts`, so
 * the OCR pipeline (which only needs the digest) never imports a storage
 * module — the Dependency Rule points one way, inward.
 */

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
 * Records a newly seen file hash into the persistent set.
 */
export function recordFileHash(fileHash: string): void {
  const hashes = readKnownHashes();
  hashes.add(fileHash);
  writeKnownHashes(hashes);
}

/** Clears the ingest memory when the workspace is reset. */
export function clearKnownHashes(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(HASH_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}
