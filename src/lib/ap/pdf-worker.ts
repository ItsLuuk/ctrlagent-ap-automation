/**
 * PDF.js worker bootstrap. The worker runs in its own JavaScript realm, so
 * the main-thread polyfill (pdfjs-polyfill.ts) does not reach it — pdfjs-dist
 * v6 calls `Uint8Array.prototype.toHex` during fingerprinting and crashes in
 * engines without the new typed-array helpers. Importing the polyfill here
 * patches the worker realm before pdf.js's worker code runs.
 *
 * Nothing else lives here: the worker is created and owned by pdfjs itself.
 * XFA is disabled at the document-construction site (use-pdf-page-image.ts),
 * and canvas dimensions are capped before any main-thread bitmap is allocated.
 */
import "./pdfjs-polyfill";
import "pdfjs-dist/build/pdf.worker.min.mjs";
