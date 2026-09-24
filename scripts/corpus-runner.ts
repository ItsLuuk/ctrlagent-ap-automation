#!/usr/bin/env bun
/**
 * Corpus runner — headless deterministic extraction benchmark over real PDFs.
 *
 * Discovers PDFs under `corpus/`, scans each one's Producer/Creator metadata,
 * runs extractFieldsFromPages over the text layer, scores against the
 * expected.json sidecar for that producer folder, and writes a report.
 *
 * Three entrypoints (see package.json corpus:* scripts):
 *   corpus:scan   — metadata-only scan, prints the producer/creator table
 *   corpus:run    — full extract + score, prints report + writes corpus/report.json
 *   corpus:validate — validate every expected.json against corpus/schema.json
 *
 * Weighted toward text-layer PDFs. Image-only / scanned PDFs are still
 * enumerated and scored but reported separately so scan noise does not drown
 * the text-layer signal.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { PageRead } from "../src/lib/ap/ocr.ts";

// Dynamic imports — the static chain ocr.ts → template-apply.ts → layout-ocr
// is broken (layout-ocr.ts did not exist on disk). Now fixed, but we keep
// the dynamic import so the runner stays resilient to future module changes.
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const { extractFieldsFromPages } = await import("../src/lib/ap/ocr.ts");
const { scanProducer } = await import("../src/lib/ap/pdf-meta.ts");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CORPUS = join(ROOT, "corpus");
const SCHEMA_PATH = join(CORPUS, "schema.json");
const REPORT_PATH = join(CORPUS, "report.json");

// ---------------------------------------------------------------------------
// Text-layer harvest from a pdfjs page. Mirrors the golden-corpus test's
// getTextContent path so the corpus runner stays model-free and deterministic.
// ---------------------------------------------------------------------------
async function pageFromTextContent(page: any, pageNumber: number): Promise<PageRead> {
  let content: any = null;
  try {
    content = await page.getTextContent();
  } catch {
    return { pageNumber, text: "", words: [] };
  }
  const items = (content.items as unknown[]).filter(
    (item): item is { str: string; transform: number[] } =>
      item != null && typeof item === "object" && "str" in item &&
      typeof (item as any).str === "string" && (item as any).str.trim() !== ""
  );
  const words = items.map((item) => ({
    text: item.str.trim(),
    x: item.transform[4] ?? 0,
    y: item.transform[5] ?? 0,
    w: 0,
    h: 0,
    confidence: 1,
  }));
  const pageText = words.map((w) => w.text).join("").replace(/[ \t]+/g, " ").trim();
  return { pageNumber, text: pageText, words };
}

// ---------------------------------------------------------------------------
// Ground-truth sidecar shape (mirrors corpus/schema.json)
// ---------------------------------------------------------------------------
export type ExpectedEntry = {
  file: string;
  _skip?: boolean;
  _reason?: string;
  vendor?: string;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  currency?: string;
  iban?: string;
  vatNumber?: string;
  businessRegistrationNumber?: string;
  vendorEmail?: string;
  address?: string;
  lineItems?: Array<{
    description: string;
    quantity?: number;
    unitPrice?: number;
    amount: number;
  }>;
};

// ---------------------------------------------------------------------------
// Score one invoice against its sidecar
// ---------------------------------------------------------------------------
type FieldCompare = "correct" | "wrong" | "missing" | "unexpected" | "absent";

type Counts = { correct: number; wrong: number; missing: number; unexpected: number };

function scoreInvoice(
  expected: ExpectedEntry,
  got: ReturnType<typeof extractFieldsFromPages>,
): { outcomes: Record<string, FieldCompare>; counts: Counts } {
  const out: Record<string, FieldCompare> = {};
  const counts: Counts = { correct: 0, wrong: 0, missing: 0, unexpected: 0 };

  const present = (v: unknown) => v !== undefined && v !== null && v !== "";

  function check(key: string, gotVal: unknown, expVal: unknown, cmp: (a: unknown, b: unknown) => boolean) {
    const g = present(gotVal);
    const e = present(expVal);
    if (!e && !g) { out[key] = "absent"; return; }
    if (e && !g) { out[key] = "missing"; counts.missing++; return; }
    if (!e && g) { out[key] = "unexpected"; counts.unexpected++; return; }
    if (cmp(gotVal, expVal)) { out[key] = "correct"; counts.correct++; }
    else { out[key] = "wrong"; counts.wrong++; }
  }

  check("vendor", got.vendor, expected.vendor,
    (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase());
  check("invoiceNumber", got.invoiceNumber, expected.invoiceNumber,
    (a, b) => String(a).trim() === String(b).trim());
  check("issueDate", got.issueDate, expected.issueDate,
    (a, b) => String(a) === String(b));
  check("dueDate", got.dueDate, expected.dueDate,
    (a, b) => String(a) === String(b));
  check("currency", got.currency, expected.currency,
    (a, b) => String(a).trim().toUpperCase() === String(b).trim().toUpperCase());
  check("iban", got.iban, expected.iban,
    (a, b) => String(a).replace(/\s/g, "").toUpperCase() === String(b).replace(/\s/g, "").toUpperCase());
  check("vatNumber", got.vatNumber, expected.vatNumber,
    (a, b) => String(a) === String(b));
  check("businessRegistrationNumber", got.businessRegistrationNumber, expected.businessRegistrationNumber,
    (a, b) => String(a) === String(b));
  check("vendorEmail", got.vendorEmail, expected.vendorEmail,
    (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase());
  check("address", got.address, expected.address,
    (a, b) => String(a).trim() === String(b).trim());

  for (const f of ["subtotal", "tax", "total"] as const) {
    check(f, got[f], expected[f], (a, b) => {
      if (typeof a !== "number" || typeof b !== "number") return false;
      return Math.abs(a - b) <= 0.01;
    });
  }

  // Line items: order-insensitive, description + amount (cents)
  if (expected.lineItems !== undefined) {
    const gotItems = (got.lineItems ?? []).map((li) => ({
      description: li.description.trim(),
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      amount: li.amount,
    }));
    const expItems = expected.lineItems.map((li) => ({
      description: li.description.trim(),
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      amount: li.amount,
    }));
    if (gotItems.length === 0 && expItems.length === 0) {
      out["lineItems"] = "correct"; counts.correct++;
      return { outcomes: out, counts };
    }
    if (gotItems.length === 0 && expItems.length > 0) {
      out["lineItems"] = "missing"; counts.missing++;
      return { outcomes: out, counts };
    }
    if (gotItems.length > 0 && expItems.length === 0) {
      out["lineItems"] = "unexpected"; counts.unexpected++;
      return { outcomes: out, counts };
    }
    const remaining = new Map(expItems.map((e) => [e, false]));
    for (const g of gotItems) {
      for (const [e, used] of remaining) {
        if (used) continue;
        if (e.description === g.description && Math.abs(e.amount - g.amount) <= 0.01) {
          remaining.set(e, true);
          break;
        }
      }
    }
    const matched = [...remaining.values()].filter(Boolean).length;
    if (matched === expItems.length && gotItems.length === expItems.length) {
      out["lineItems"] = "correct"; counts.correct++;
    } else {
      out["lineItems"] = "wrong"; counts.wrong++;
    }
  } else {
    const gotItems = got.lineItems ?? [];
    if (gotItems.length === 0) { out["lineItems"] = "absent"; }
    else { out["lineItems"] = "unexpected"; counts.unexpected++; }
  }

  return { outcomes: out, counts };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
type Folder = {
  name: string;
  path: string;
  expected: ExpectedEntry[];
  pdfs: string[];
};

function discoverCorpus(): Folder[] {
  if (!statSync(CORPUS, { throwUnless: false })) {
    console.error(`corpus/ not found at ${CORPUS}`);
    console.error("Create it and drop PDFs + expected.json sidecars inside.");
    process.exit(1);
  }
  return readdirSync(CORPUS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "report.json" && d.name !== "schema.json")
    .map((d) => {
      const path = join(CORPUS, d.name);
      let expected: ExpectedEntry[] = [];
      try {
        expected = JSON.parse(readFileSync(join(path, "expected.json"), "utf-8"));
      } catch {
        // no sidecar yet — still list the PDFs
      }
      const pdfs = readdirSync(path).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
      return { name: d.name, path, expected, pdfs };
    });
}

// ---------------------------------------------------------------------------
// Scan phase — metadata only
// ---------------------------------------------------------------------------
type Meta = {
  file: string;
  producer: string | null;
  creator: string | null;
  method: "text-layer" | "image-only" | "mixed" | "none";
  pages: number;
  chars: number;
  words: number;
};

function toUint8Array(bytes: Buffer | Uint8Array): Uint8Array {
  if (bytes instanceof Uint8Array) {
    // Copy to ensure a pure Uint8Array (not a Buffer subclass).
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return new Uint8Array(bytes);
}

async function scanPdf(path: string, file: string): Promise<Meta> {
  const bytes = toUint8Array(readFileSync(join(path, file)));
  let doc: any = null;
  try {
    doc = await pdfjs.getDocument({ data: bytes, disableXfa: true }).promise;
  } catch (err) {
    console.error(`  scanPdf(${file}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return { file, producer: null, creator: null, method: "none", pages: 0, chars: 0, words: 0 };
  }
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info as any) ?? {};
    const producer = typeof info.Producer === "string" ? info.Producer : null;
    const creator = typeof info.Creator === "string" ? info.Creator : null;
    let chars = 0;
    let words = 0;
    let hasTextLayer = false;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      try {
        const pg = await pageFromTextContent(page, n);
        chars += pg.text.length;
        words += pg.words.length;
        if (pg.text.trim().length >= 120) hasTextLayer = true;
      } finally {
        page.cleanup();
      }
    }
    const method = hasTextLayer ? "text-layer" : chars > 0 ? "mixed" : "image-only";
    return { file, producer, creator, method, pages: doc.numPages, chars, words };
  } finally {
    doc.destroy?.();
  }
}

// ---------------------------------------------------------------------------
// Extraction phase — deterministic path
// ---------------------------------------------------------------------------
type Extraction = {
  file: string;
  producer: string | null;
  creator: string | null;
  method: Meta["method"];
  elapsedMs: number;
  fields: ReturnType<typeof extractFieldsFromPages>;
};

async function extractPdf(path: string, file: string): Promise<Extraction> {
  const t0 = performance.now();
  const bytes = toUint8Array(readFileSync(join(path, file)));
  let doc: any = null;
  try {
    doc = await pdfjs.getDocument({ data: bytes, disableXfa: true }).promise;
  } catch {
    return { file, producer: null, creator: null, method: "none", elapsedMs: 0, fields: extractFieldsFromPages([], file) };
  }
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info as any) ?? {};
    const producer = typeof info.Producer === "string" ? info.Producer : null;
    const creator = typeof info.Creator === "string" ? info.Creator : null;
    const pages: PageRead[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      try {
        pages.push(await pageFromTextContent(page, n));
      } finally {
        page.cleanup();
      }
    }
    const chars = pages.reduce((s, p) => s + p.text.length, 0);
    const method = chars >= 120 ? "text-layer" : chars > 0 ? "mixed" : "none";
    const fields = extractFieldsFromPages(pages, file);
    return { file, producer, creator, method, elapsedMs: performance.now() - t0, fields };
  } finally {
    doc.destroy?.();
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
type InvoiceReport = {
  file: string;
  producer: string | null;
  creator: string | null;
  method: Meta["method"];
  elapsedMs: number;
  skipped: boolean;
  skipReason?: string;
  counts: Counts;
  outcomes: Record<string, FieldCompare>;
  criticalMissing: string[];
  criticalOk: string[];
};

function buildReport(name: string, folder: Folder, scans: Map<string, Meta>, exts: Map<string, Extraction>) {
  const invoices: InvoiceReport[] = [];
  const counts: Counts = { correct: 0, wrong: 0, missing: 0, unexpected: 0 };
  let vlmSkipCount = 0;
  const methodCounts: Record<string, number> = {};
  const failureByField: Record<string, { missing: number; wrong: number }> = {};

  for (const entry of folder.expected) {
    const scan = scans.get(entry.file) ?? null;
    const ext = exts.get(entry.file) ?? null;
    if (entry._skip) {
      invoices.push({
        file: entry.file, producer: scan?.producer ?? null, creator: scan?.creator ?? null,
        method: scan?.method ?? "none", elapsedMs: ext?.elapsedMs ?? 0,
        skipped: true, skipReason: entry._reason ?? "no _reason given",
        counts: { correct: 0, wrong: 0, missing: 0, unexpected: 0 },
        outcomes: {}, criticalMissing: [], criticalOk: [],
      });
      continue;
    }
    const got = ext?.fields ?? extractFieldsFromPages([], entry.file);
    const { outcomes, counts: ic } = scoreInvoice(entry, got);
    for (const k of Object.keys(ic) as (keyof Counts)[]) {
      counts[k] += ic[k];
    }
    if (scan) methodCounts[scan.method] = (methodCounts[scan.method] ?? 0) + 1;
    const critical = ["vendor", "invoiceNumber", "issueDate", "total"] as const;
    const missing: string[] = [];
    const ok: string[] = [];
    for (const f of critical) {
      if (outcomes[f] === "correct") ok.push(f);
      else if (outcomes[f] === "missing" || outcomes[f] === "wrong") missing.push(f);
    }
    if (missing.length === 0) vlmSkipCount++;
    for (const [field, outcome] of Object.entries(outcomes)) {
      if (outcome === "missing") {
        failureByField[field] = failureByField[field] ?? { missing: 0, wrong: 0 };
        failureByField[field]!.missing++;
      } else if (outcome === "wrong") {
        failureByField[field] = failureByField[field] ?? { missing: 0, wrong: 0 };
        failureByField[field]!.wrong++;
      }
    }
    invoices.push({
      file: entry.file, producer: scan?.producer ?? null, creator: scan?.creator ?? null,
      method: scan?.method ?? (ext?.method ?? "none"), elapsedMs: ext?.elapsedMs ?? 0,
      skipped: false, skipReason: undefined, counts: ic, outcomes,
      criticalMissing: missing, criticalOk: ok,
    });
  }

  const scoredCount = invoices.filter((r) => !r.skipped).length;
  const pDen = counts.correct + counts.wrong + counts.unexpected;
  const rDen = counts.correct + counts.wrong + counts.missing;
  const precision = pDen === 0 ? 1 : counts.correct / pDen;
  const recall = rDen === 0 ? 1 : counts.correct / rDen;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const vlmSkipRate = scoredCount === 0 ? 0 : vlmSkipCount / scoredCount;

  return {
    producer: name,
    invoiceCount: folder.expected.length,
    scoredCount,
    skippedCount: invoices.filter((r) => r.skipped).length,
    methodCounts,
    counts,
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: Math.round(f1 * 1000) / 1000,
    vlmSkipRate: Math.round(vlmSkipRate * 1000) / 1000,
    vlmSkipCount,
    failureByField,
    invoices,
  };
}

// ---------------------------------------------------------------------------
// Entrypoints
// ---------------------------------------------------------------------------
async function runScan() {
  console.log("=== corpus:scan — metadata only ===\n");
  const folders = discoverCorpus();
  if (folders.length === 0) {
    console.log("No producer folders found in corpus/.");
    return;
  }
  const all: Array<{
    producer: string; file: string; producerMeta: string; creatorMeta: string;
    method: string; pages: number; chars: number; words: number;
  }> = [];
  for (const folder of folders) {
    console.log(`\n--- ${folder.name} ---`);
    for (const pdf of folder.pdfs) {
      const m = await scanPdf(folder.path, pdf);
      all.push({
        producer: folder.name, file: pdf,
        producerMeta: m.producer ?? "—", creatorMeta: m.creator ?? "—",
        method: m.method, pages: m.pages, chars: m.chars, words: m.words,
      });
      console.log(`  ${pdf}\n    producer=${m.producer ?? "—"}  creator=${m.creator ?? "—"}  method=${m.method}  pages=${m.pages}  chars=${m.chars}  words=${m.words}`);
    }
  }
  console.log("\n=== summary ===");
  console.log(`Folders: ${folders.map((f) => f.name).join(", ")}`);
  console.log(`PDFs: ${all.length}`);
  const textLayer = all.filter((r) => r.method === "text-layer").length;
  const imageOnly = all.filter((r) => r.method === "image-only").length;
  const mixed = all.filter((r) => r.method === "mixed").length;
  console.log(`text-layer: ${textLayer}  mixed: ${mixed}  image-only: ${imageOnly}`);
  console.log("\nProducer/creator signals seen:");
  const seen = new Map<string, number>();
  for (const r of all) {
    for (const k of [r.producerMeta, r.creatorMeta].filter(Boolean)) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}  (${n} invoice${n === 1 ? "" : "s"})`);
  }
}

async function runFull() {
  console.log("=== corpus:run — extract + score ===\n");
  const folders = discoverCorpus();
  if (folders.length === 0) {
    console.log("No producer folders found in corpus/.");
    return;
  }
  const allReports: ReturnType<typeof buildReport>[] = [];
  for (const folder of folders) {
    console.log(`--- ${folder.name} (${folder.pdfs.length} PDFs) ---`);
    const scans = new Map<string, Meta>();
    const exts = new Map<string, Extraction>();
    for (const pdf of folder.pdfs) {
      const scan = await scanPdf(folder.path, pdf);
      scans.set(pdf, scan);
      const ext = await extractPdf(folder.path, pdf);
      exts.set(pdf, ext);
      const entry = folder.expected.find((e) => e.file === pdf);
      if (entry?._skip) {
        console.log(`  ${pdf}: SKIP  producer=${scan.producer ?? "—"}  ${scan.method}`);
        continue;
      }
      const scored = scoreInvoice(entry ?? { file: pdf }, ext.fields);
      if (!scored) {
        console.error(`  ${pdf}: scoring failed`);
        continue;
      }
      const { counts } = scored;
      const ok = counts.correct;
      const critMiss = (["vendor", "invoiceNumber", "issueDate", "total"] as const)
        .filter((f) => {
          const outcome = scored.outcomes[f];
          return outcome === "missing" || outcome === "wrong";
        })
        .join(",");
      console.log(`  ${pdf}: ${ok}c ${counts.wrong}w ${counts.missing}m ${counts.unexpected}u` +
        (critMiss ? `  critical-miss=[${critMiss}]` : "") +
        `  producer=${scan.producer ?? "—"}  ${scan.method}  ${ext.elapsedMs.toFixed(0)}ms`);
    }
    const report = buildReport(folder.name, folder, scans, exts);
    allReports.push(report);
    console.log(`  => ${report.scoredCount} scored  P=${report.precision.toFixed(2)}  R=${report.recall.toFixed(2)}  F1=${report.f1.toFixed(2)}  VLM-skip=${report.vlmSkipRate.toFixed(2)}\n`);
  }
  const overallCounts: Counts = { correct: 0, wrong: 0, missing: 0, unexpected: 0 };
  for (const p of allReports) {
    overallCounts.correct += p.counts.correct;
    overallCounts.wrong += p.counts.wrong;
    overallCounts.missing += p.counts.missing;
    overallCounts.unexpected += p.counts.unexpected;
  }
  const pDen = overallCounts.correct + overallCounts.wrong + overallCounts.unexpected;
  const rDen = overallCounts.correct + overallCounts.wrong + overallCounts.missing;
  const precision = pDen === 0 ? 1 : overallCounts.correct / pDen;
  const recall = rDen === 0 ? 1 : overallCounts.correct / rDen;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  let totalVlmSkip = 0;
  for (const p of allReports) totalVlmSkip += p.vlmSkipCount;
  const scoredCount = allReports.reduce((s, p) => s + p.scoredCount, 0);
  const methodCounts: Record<string, number> = {};
  const failureByField: Record<string, { missing: number; wrong: number }> = {};
  for (const p of allReports) {
    for (const [m, n] of Object.entries(p.methodCounts)) methodCounts[m] = (methodCounts[m] ?? 0) + n;
    for (const [field, f] of Object.entries(p.failureByField)) {
      failureByField[field] = failureByField[field] ?? { missing: 0, wrong: 0 };
      failureByField[field]!.missing += f.missing;
      failureByField[field]!.wrong += f.wrong;
    }
  }
  const report = {
    runAt: new Date().toISOString(),
    corpusPath: CORPUS,
    producers: allReports,
    overall: {
      counts: overallCounts,
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000,
      vlmSkipRate: Math.round((totalVlmSkip / Math.max(scoredCount, 1)) * 1000) / 1000,
      vlmSkipCount: totalVlmSkip,
      scoredCount,
      methodCounts,
      failureByField,
    },
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log("=== overall ===");
  console.log(`Scored: ${scoredCount}  P=${report.overall.precision.toFixed(2)}  R=${report.overall.recall.toFixed(2)}  F1=${report.overall.f1.toFixed(2)}`);
  console.log(`VLM-skip: ${totalVlmSkip}/${scoredCount} = ${report.overall.vlmSkipRate.toFixed(2)}`);
  console.log(`Methods: ${JSON.stringify(methodCounts)}`);
  console.log("\nFailure taxonomy (missing / wrong by field):");
  for (const [field, f] of Object.entries(report.overall.failureByField).sort(
    (a, b) => (b[1].missing + b[1].wrong) - (a[1].missing + a[1].wrong),
  )) {
    console.log(`  ${field}: ${f.missing} missing, ${f.wrong} wrong`);
  }
  console.log(`\nReport written to ${REPORT_PATH}`);
}

function runValidate() {
  console.log("=== corpus:validate — sidecar schema check ===\n");
  let failed = false;
  for (const folder of discoverCorpus()) {
    const expectedPath = join(folder.path, "expected.json");
    let raw: string;
    try {
      raw = readFileSync(expectedPath, "utf-8");
    } catch {
      console.log(`${folder.name}: MISSING expected.json`);
      failed = true;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.log(`${folder.name}: MALFORMED JSON — ${err instanceof Error ? err.message : String(err)}`);
      failed = true;
      continue;
    }
    if (!Array.isArray(parsed)) {
      console.log(`${folder.name}: expected.json must be a JSON array`);
      failed = true;
      continue;
    }
    for (let i = 0; i < parsed.length; i++) {
      const entry = parsed[i] as Record<string, unknown>;
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        console.log(`${folder.name}[${i}]: entry must be an object`); failed = true; continue;
      }
      if (typeof entry.file !== "string" || !entry.file.toLowerCase().endsWith(".pdf")) {
        console.log(`${folder.name}[${i}]: "file" must be a .pdf filename`); failed = true;
      }
      if (entry._skip === true && typeof entry._reason !== "string") {
        console.log(`${folder.name}[${i}]: _skip:true requires a string _reason`); failed = true;
      }
      for (const numField of ["subtotal", "tax", "total"] as const) {
        if (entry[numField] !== undefined && typeof entry[numField] !== "number") {
          console.log(`${folder.name}[${i}]: ${numField} must be a number when present`); failed = true;
        }
      }
      for (const dateField of ["issueDate", "dueDate"] as const) {
        if (entry[dateField] !== undefined) {
          if (typeof entry[dateField] !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(entry[dateField] as string)) {
            console.log(`${folder.name}[${i}]: ${dateField} must be YYYY-MM-DD when present`); failed = true;
          }
        }
      }
      if (entry.currency !== undefined && (typeof entry.currency !== "string" || (entry.currency as string).length !== 3)) {
        console.log(`${folder.name}[${i}]: currency must be a 3-letter code when present`); failed = true;
      }
      if (entry.iban !== undefined) {
        if (typeof entry.iban !== "string" || (entry.iban as string).replace(/\s/g, "").length < 10) {
          console.log(`${folder.name}[${i}]: iban looks malformed (${JSON.stringify(entry.iban)})`); failed = true;
        }
      }
      if (entry.lineItems !== undefined) {
        if (!Array.isArray(entry.lineItems)) {
          console.log(`${folder.name}[${i}]: lineItems must be an array when present`); failed = true;
        } else {
          for (let j = 0; j < entry.lineItems.length; j++) {
            const li = entry.lineItems[j] as Record<string, unknown>;
            if (typeof li?.description !== "string" || li.description.trim().length === 0) {
              console.log(`${folder.name}[${i}].lineItems[${j}]: description required`); failed = true;
            }
            if (typeof li?.amount !== "number") {
              console.log(`${folder.name}[${i}].lineItems[${j}]: amount required and must be a number`); failed = true;
            }
          }
        }
      }
      const allowed = new Set([
        "file", "_skip", "_reason",
        "vendor", "invoiceNumber", "issueDate", "dueDate",
        "subtotal", "tax", "total", "currency",
        "iban", "vatNumber", "businessRegistrationNumber",
        "vendorEmail", "address", "lineItems",
      ]);
      for (const k of Object.keys(entry)) {
        if (!allowed.has(k)) {
          console.log(`${folder.name}[${i}]: unknown key "${k}" — not in schema`); failed = true;
        }
      }
    }
    const n = Array.isArray(parsed) ? parsed.length : 0;
    if (!failed || true) console.log(`${folder.name}: ${n} invoice${n === 1 ? "" : "s"} OK`);
  }
  if (failed) {
    console.log("\nValidation FAILED — fix the sidecars above.");
    process.exit(1);
  }
  console.log("\nAll sidecars valid.");
}

const command = process.argv[2] ?? "run";
if (command === "scan") await runScan();
else if (command === "run") await runFull();
else if (command === "validate") runValidate();
else {
  console.error(`Unknown command: ${command}`);
  console.error("Use: corpus:scan | corpus:run | corpus:validate");
  process.exit(1);
}
