/**
 * IndexedDB persistence for uploaded source files (Phase flow plan — Draft).
 *
 * Uploads previously stored an ephemeral `blob:` URL on the invoice, which
 * died on the next reload — so the store dropped `fileUrl` for uploads on
 * boot (store.tsx), and PDFs lost the mapping overlay's preview permanently.
 * This module stores the raw `File`/`Blob` in IndexedDB keyed by invoice id
 * and rehydrates a live blob URL when the UI needs a preview.
 *
 * Contract:
 *  - `saveFile(invoiceId, file)` at upload time (once, idempotent per id).
 *  - `loadFileUrl(invoiceId)` → object URL, cached per session; caller owns
 *    nothing (revocation happens on page unload, which is fine for blob URLs).
 *  - Upload persistence is strict: a successful upload must not be reported
 *    until its source file is durable. Read/cleanup operations remain best
 *    effort because they run during boot and demo reset.
 */

const DB_NAME = "ap-file-store";
const STORE = "files";
const VERSION = 1;

/** Session cache of already-created object URLs, so repeated renders
 *  (rasterizer hook, doc preview, line-items editor) share one URL. */
const urlCache = new Map<string, string>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

/** Persist the uploaded source file for an invoice. Idempotent per id —
 *  re-saving overwrites, which is what retry paths want. */
export async function saveFile(invoiceId: string, file: Blob): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(file, invoiceId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB put failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB put was aborted"));
    });
  } finally {
    db.close();
  }
}

/** Resolve a live object URL for the stored file, or undefined when missing
 *  (never uploaded, IndexedDB unavailable, or lookup failed). */
export async function loadFileUrl(invoiceId: string): Promise<string | undefined> {
  const cached = urlCache.get(invoiceId);
  if (cached) return cached;
  try {
    const db = await openDb();
    const file = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(invoiceId);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
    });
    db.close();
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    urlCache.set(invoiceId, url);
    return url;
  } catch (error) {
    console.warn("[file-store] could not load source file", invoiceId, error);
    return undefined;
  }
}

/** Wipe every stored file (demo reset). Also revokes session object URLs. */
export async function clearAllFiles(): Promise<void> {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed"));
    });
    db.close();
  } catch (error) {
    console.warn("[file-store] could not clear source files", error);
  }
}

/** Forget one invoice's file (call on invoice delete to avoid orphans). */
export async function deleteFile(invoiceId: string): Promise<void> {
  const cached = urlCache.get(invoiceId);
  if (cached) {
    URL.revokeObjectURL(cached);
    urlCache.delete(invoiceId);
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(invoiceId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
    });
    db.close();
  } catch (error) {
    console.warn("[file-store] could not delete source file", invoiceId, error);
  }
}
