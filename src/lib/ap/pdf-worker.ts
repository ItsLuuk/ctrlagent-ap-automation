/**
 * PDF.js worker bootstrap.
 *
 * The worker runs in its own JavaScript realm, so the main-thread compatibility
 * polyfill does not reach it. Importing it here installs the typed-array and
 * Map helpers required by pdfjs-dist v6 before the worker code evaluates.
 */
import "./pdfjs-polyfill";
import "pdfjs-dist/build/pdf.worker.min.mjs";
