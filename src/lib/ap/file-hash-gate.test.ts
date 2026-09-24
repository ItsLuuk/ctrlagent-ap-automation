/**
 * Unit tests for the file hash gate.
 *
 * Deterministic: byte-identical uploads are caught; content-identical-but-
 * re-printed PDFs (different bytes) are not caught by the hash — that's the
 * correct boundary, and it's what the business-key layer (step 3) covers.
 */

import { describe, expect, it } from "bun:test";
import {
  checkFileHash,
  computeFileHash,
  readKnownHashes,
  recordFileHash,
} from "./file-hash-gate";
import type { Invoice } from "./types";

const HASH_KEY = "ap-automation-file-hashes-v1";

function clearHashStore(): void {
  try {
    localStorage.removeItem(HASH_KEY);
  } catch {
    /* ignore */
  }
}

/** A minimal invoice stub carrying a persisted fileHash. */
function stubInvoice(
  id: string,
  fileHash: string,
  source: Invoice["source"] = "upload",
): Invoice {
  return {
    id,
    vendor: "Acme B.V.",
    invoiceNumber: "2026-001",
    issueDate: "2026-04-01",
    dueDate: "2026-05-01",
    currency: "EUR",
    subtotal: 100,
    tax: 21,
    total: 121,
    status: "draft",
    lineItems: [],
    glAccount: "",
    department: "",
    memo: "",
    tags: [],
    confidence: {},
    audit: [],
    source,
    fileHash,
  };
}

describe("computeFileHash", () => {
  it("produces a stable 64-char hex digest for the same bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const fileA = new File([bytes], "a.bin", { type: "application/octet-stream" });
    const fileB = new File([bytes], "b.bin", { type: "application/octet-stream" });
    const hashA = await computeFileHash(fileA);
    const hashB = await computeFileHash(fileB);
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different digests for different bytes", async () => {
    const fileA = new File([new Uint8Array([1])], "a.bin", {
      type: "application/octet-stream",
    });
    const fileB = new File([new Uint8Array([2])], "b.bin", {
      type: "application/octet-stream",
    });
    expect(await computeFileHash(fileA)).not.toBe(await computeFileHash(fileB));
  });
});

describe("checkFileHash", () => {
  it("returns ok for a brand-new file hash", async () => {
    clearHashStore();
    const bytes = new Uint8Array([99]);
    const file = new File([bytes], "new.pdf", { type: "application/pdf" });
    const existingHash = await computeFileHash(file);
    // Persist the wrong hash so the new file is genuinely new.
    const existing = [stubInvoice("inv-1", "totally-different-hash")];
    const result = await checkFileHash(file, existing);
    expect(result.ok).toBe(true);
    expect((result as { ok: true }).fileHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("detects a byte-identical duplicate among existing upload invoices", async () => {
    clearHashStore();
    const bytes = new TextEncoder().encode("invoice content");
    const file = new File([bytes], "dup.pdf", { type: "application/pdf" });
    // First ingestion: the invoice is persisted with its computed hash.
    const persistedHash = await computeFileHash(file);
    const existing = [stubInvoice("inv-1", persistedHash)];
    // Second upload of the same bytes: should be flagged as a duplicate.
    const result = await checkFileHash(file, existing);
    expect(result.ok).toBe(false);
    expect((result as { ok: false }).duplicate).toBe(true);
    expect((result as { duplicate: true }).existingId).toBe("inv-1");
  });

  it("does not flag a sample-data invoice as a duplicate of an upload", async () => {
    clearHashStore();
    const bytes = new TextEncoder().encode("sample");
    const file = new File([bytes], "sample.pdf", { type: "application/pdf" });
    const existingHash = await computeFileHash(file);
    const existing = [stubInvoice("inv-1", existingHash, "sample")];
    const result = await checkFileHash(file, existing);
    // Same bytes, different source — the gate only flags upload-vs-upload.
    expect(result.ok).toBe(true);
  });

  it("does not flag a re-printed PDF (different bytes) as a hash duplicate", async () => {
    clearHashStore();
    // Simulates print-to-PDF: same logical content, different bytes.
    const fileA = new File(
      [new Uint8Array([1, 2, 3])],
      "original.pdf",
      { type: "application/pdf" },
    );
    const fileB = new File(
      [new Uint8Array([4, 5, 6])],
      "reprint.pdf",
      { type: "application/pdf" },
    );
    const existingHash = await computeFileHash(fileA);
    const existing = [stubInvoice("inv-1", existingHash)];
    const result = await checkFileHash(fileB, existing);
    // Different bytes — hash gate passes; business-key layer covers this case.
    expect(result.ok).toBe(true);
  });
});

describe("recordFileHash", () => {
  it("persists a new hash into the known set", () => {
    if (typeof localStorage === "undefined") return; // skip in non-browser env
    clearHashStore();
    const before = readKnownHashes();
    expect(before.size).toBe(0);
    recordFileHash("abc123");
    const after = readKnownHashes();
    expect(after.has("abc123")).toBe(true);
    clearHashStore();
  });

  it("deduplicates when the same hash is recorded twice", () => {
    if (typeof localStorage === "undefined") return; // skip in non-browser env
    clearHashStore();
    recordFileHash("dup-hash");
    recordFileHash("dup-hash");
    expect(readKnownHashes().size).toBe(1);
    clearHashStore();
  });
});
