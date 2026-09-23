/**
 * PDF.js worker bootstrap. The worker runs in its own JavaScript realm, so
 * the main-thread polyfill (pdfjs-polyfill.ts) does not reach it — pdfjs-dist
 * v6 calls `Uint8Array.prototype.toHex` during fingerprinting and crashes in
 * engines without the new typed-array helpers. Importing the polyfill here
 * patches the worker realm before pdf.js's worker code runs.
 */
import "./pdfjs-polyfill";
import "pdfjs-dist/build/pdf.worker.min.mjs";
