/**
 * Structured-invoice XML sniffers and parsers.
 *
 * Decision (from spec review): two reader modules, not one — UBL and CII are
 * different root elements, different namespaces, different element names for
 * every field. The label names the reader, not the container, like every other
 * value in the engine enum (gemma, ocr, template).
 *
 * Container (standalone file vs PDF/A-3 attachment) is document-level metadata,
 * surfaced in audit notes and a future document-type badge — not in engine or
 * ocrMethod.
 *
 * Gates:
 *  - Sniff the first ~2 KB of bytes for the root element local name + namespace
 *    URI. Never trust MIME or extension.
 *  - Reject XML > ~5 MB before parsing.
 *  - DOMParser never throws — check for parsererror elements, namespace varies
 *    by WebView. Add a truncated-XML fixture so the silent-empty-doc path is
 *    exercised.
 *  - Namespace discipline: use getElementsByTagNameNS / localName matching.
 *    A querySelector("cbc\\:ID") approach breaks on valid documents that rename
 *    prefixes. Lock it with a fixture that renames cac:/cbc: to a:/b:.
 */

/** Upper bound on raw XML bytes before we refuse to parse. ~5 MB. */
const MAX_XML_BYTES = 5 * 1024 * 1024;

// ── UBL 2.x namespace URIs ──────────────────────────────────────────────

/** urn:oasis:names:specification:ubl:schema:xsd:Invoice-2 */
const UBL_INVOICE_NS = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";

// ── CII (UN/CEFACT Cross Industry Invoice) namespace URIs ───────────────

/** urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100 */
const CII_INVOICE_NS = "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100";

// ── Root element local names ────────────────────────────────────────────

const UBL_ROOT_LOCAL = "Invoice";
const CII_ROOT_LOCAL = "CrossIndustryInvoice";

// ── Sniffing ────────────────────────────────────────────────────────────

const SNIFF_CHUNK = 4096;

/**
 * Returns the root element's local name and namespace URI by sniffing the
 * first SNIFF_CHUNK bytes of `bytes`. Returns null when the bytes don't look
 * like UBL or CII XML (wrong root, wrong namespace, not XML at all).
 */
export function sniffStructuredRoot(bytes: Uint8Array | ArrayBuffer): { local: string; ns: string } | null {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (buf.length === 0 || buf.length > MAX_XML_BYTES) return null;

  // Must start with < (possibly after a UTF-8/UTF-16 BOM).
  const head = buf.slice(0, Math.min(buf.length, 4));
  if (head[0] !== 0x3c && !(head[0] === 0xfe && head[1] === 0xff) && !(head[0] === 0xff && head[1] === 0xfe) && !(head[0] === 0x00 && head[1] === 0x3c)) {
    return null;
  }

  // Decode enough of the document for the root element to be present.
  const text = decodeXmlSniffChunk(buf);
  if (!text) return null;

  const parsed = tryParseRootOnly(text);
  if (!parsed) return null;

  if (parsed.ns === UBL_INVOICE_NS && parsed.local === UBL_ROOT_LOCAL) {
    return { local: UBL_ROOT_LOCAL, ns: UBL_INVOICE_NS };
  }
  if (parsed.ns === CII_INVOICE_NS && parsed.local === CII_ROOT_LOCAL) {
    return { local: CII_ROOT_LOCAL, ns: CII_INVOICE_NS };
  }
  return null;
}

/**
 * Returns true when `bytes` looks like a standalone structured-invoice XML
 * document (UBL or CII). Used by the upload-gate branch; the same sniffing
 * logic is reused by the PDF-attachment scanner.
 */
export function isStructuredInvoice(bytes: Uint8Array | ArrayBuffer): boolean {
  return sniffStructuredRoot(bytes) != null;
}

/**
 * Decodes the sniff chunk as UTF-8 (or UTF-16LE/BE if BOM'd) and returns the
 * text, or null when decoding looks unsafe.
 */
function decodeXmlSniffChunk(buf: Uint8Array): string | null {
  // UTF-16 BOM
  if (buf.length >= 2) {
    if (buf[0] === 0xfe && buf[1] === 0xff) {
      // UTF-16BE
      const slice = buf.slice(0, Math.min(buf.length, SNIFF_CHUNK));
      return new TextDecoder("utf-16be").decode(slice);
    }
    if (buf[0] === 0xff && buf[1] === 0xfe) {
      // UTF-16LE
      const slice = buf.slice(0, Math.min(buf.length, SNIFF_CHUNK));
      return new TextDecoder("utf-16le").decode(slice);
    }
    if (buf[0] === 0x00 && buf[1] === 0x3c) {
      // UTF-16BE without BOM (unlikely but valid)
      const slice = buf.slice(0, Math.min(buf.length, SNIFF_CHUNK));
      return new TextDecoder("utf-16be").decode(slice);
    }
  }
  // UTF-8 (or ASCII) — decode the whole sniff chunk.
  const slice = buf.slice(0, Math.min(buf.length, SNIFF_CHUNK));
  return new TextDecoder("utf-8", { fatal: false }).decode(slice);
}

/**
 * Tries to extract the root element's local name + namespace URI from a
 * sniffed XML string. Returns null on malformed XML.
 */
function tryParseRootOnly(text: string): { local: string; ns: string } | null {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  if (hasParseError(doc)) return null;
  const root = doc.documentElement;
  if (!root) return null;
  return {
    local: root.localName,
    ns: root.namespaceURI ?? "",
  };
}

export function hasParseError(doc: Document): boolean {
  // DOMParser embeds a parsererror element; the namespace differs per WebView.
  const pw = doc.getElementsByTagNameNS("http://www.mozilla.org/xmldata", "parsererror");
  if (pw.length > 0) return true;
  const pe = doc.getElementsByTagName("parsererror");
  if (pe.length > 0) return true;
  // Firefox adds a <parsererror> in the SVG namespace sometimes; anything that
  // looks like a parse error element is an error.
  for (const el of doc.documentElement?.childNodes ?? []) {
    if (el.nodeType === 1 && (el as Element).localName === "parsererror") return true;
  }
  return false;
}

// ── Shared helpers ──────────────────────────────────────────────────────

/** Returns the first non-empty text of any child matching localName (any ns). */
export function firstText(el: Element | null, localName: string): string | undefined {
  const nodes = el?.getElementsByTagNameNS("*", localName) ?? [];
  for (const node of nodes) {
    const t = (node.textContent ?? "").trim();
    if (t) return t;
  }
  return undefined;
}

/** Like firstText but only in the given namespace. */
export function firstTextNs(el: Element | null, ns: string, localName: string): string | undefined {
  const nodes = el?.getElementsByTagNameNS(ns, localName) ?? [];
  for (const node of nodes) {
    const t = (node.textContent ?? "").trim();
    if (t) return t;
  }
  return undefined;
}

/** Returns the value of the `schemeID` attribute if present, else undefined. */
export function schemeId(el: Element | null): string | undefined {
  if (!el) return undefined;
  const v = el.getAttribute("schemeID");
  return v?.trim() || undefined;
}

/** Returns `true` when `raw` (a VAT identifier) starts with a recognised EU country code. */
export function hasEuVatCountryCode(raw: string): boolean {
  return /^[A-Z]{2}/.test(raw.trim().toUpperCase());
}

/** Normalises a VAT number: strips whitespace, upper-cases, keeps schemeID-free text. */
export function normalizeVatDisplay(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}
