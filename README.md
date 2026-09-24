# Foundry — local-first AP automation

> **Automate AP from PDF to bookkeeping-ready—without sending invoice data to the cloud.**

Foundry is a desktop app for turning incoming invoices into review-ready payable records and
bookkeeping-ready CSVs. It extracts fields locally, shows where each value came from, keeps
exceptions visible, and carries each record through human approval to handoff—with **no server,
no account, and no cloud AI call**. IBANs, VAT numbers and invoice data never leave the machine.

Capture invoices locally, confirm the data, approve the record, and prepare it for bookkeeping
handoff. The system handles the routine; you handle the judgment. Foundry never sends a payment.

## Why local-first

| | |
|---|---|
| **Privacy** | Documents are read on your machine — PDF text layer, on-device OCR, and optionally a local vision model on `localhost`. No supplier data reaches a third party, so there is no DPA to sign and nothing to breach. |
| **Zero marginal cost** | No per-invoice AI fees. Reading runs on your hardware, so cost doesn't scale with document count. |
| **Control** | Every extracted field is shown beside the page region it came from, each record carries a full audit trail with segregation of duties, and vendor layouts are learned locally for faster, drift-aware re-reads. |

## How it works

**PDF → review-ready payable record → bookkeeping-ready CSV.** Everything else lives behind the review screen.

1. **Capture** — drag-and-drop or the native file picker in the desktop app.
2. **Preparing** — the source file is saved locally first, then read through a learned vendor
   template when one exists, otherwise from the document itself. Failures keep their exact
   stage and a human-readable reason, with retry and manual-review paths.
3. **Ready to review** — a new vendor pins a profile once (name, business registration and a
   valid IBAN are required), then each invoice moves through draft → approval → handoff. Once a
   record is approved and prepared, export a CSV for your bookkeeping import. Foundry does not
   send a payment.

### What Foundry deliberately does not do

- **No cloud upload, no accounts** — there is no backend to send anything to.
- **No payment execution** — "ready for external handoff" is a marker; Foundry never moves money.
- **No per-invoice fees** — reading runs on your own machine.
- **No enterprise workflow surface** — one operator plus an audit trail, not multi-level
  approval theater.

## Built with

- **Shell:** Tauri 2 · React 19 · TypeScript · Tailwind CSS 4 · TanStack Router
- **Reading:** PDF.js text layer · tesseract.js OCR · optional local vision models via Ollama
  (calls `127.0.0.1` only; Tesseract is the fallback when unavailable)
- **Storage:** IndexedDB and the local filesystem — no backend, works offline
- **Ollama connectivity:** Foundry speaks the Ollama protocol to `http://127.0.0.1:11434`
  (or `http://localhost:11434`). The configured origin is stored in localStorage under
  the key `ollama-base`. If you run Ollama on a non-default host or port, set it once in
  **Settings → Vision model → Ollama host** and Foundry remembers it. This is the #1 support
  issue: the desktop app talking to `localhost` will not reach an Ollama instance that only listens
  on a custom address. Verify with `curl http://127.0.0.1:11434/api/version` from the same
  machine.

## Getting started

Requirements: Node.js, [Bun](https://bun.sh) for unit tests, and the Rust/Tauri prerequisites
(MSVC C++ build tools on Windows) for the desktop window.

```sh
bun run bootstrap:tauri  # install dependencies, clean stale processes, rebuild, and launch
bun run dev:tauri       # clean launch of the Tauri window (use this for app work)
bun run dev:vite         # browser-only Vite server for Playwright/preview
bun run tauri:dev:clean  # re-run the clean launch without installing dependencies
```

```sh
bun test                 # unit tests (OCR, extraction, state machine, errors)
bun run test:e2e         # Playwright end-to-end, including the full upload regression
bun run lint             # eslint
```

## Documentation

- [`docs/POSITIONING.md`](docs/POSITIONING.md) — positioning canvas, category decision, and
  open validation tasks. **Source of truth for product decisions:** a new screen, feature, or
  line of copy serves the positioning statement or gets cut.
- [`docs/RELEASE-NOTES.md`](docs/RELEASE-NOTES.md) — user-facing release messaging and scope.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/TESTING.md`](docs/TESTING.md) ·
  [`docs/TECH-DEBT.md`](docs/TECH-DEBT.md) · [`docs/RELIABILITY.md`](docs/RELIABILITY.md)
- [`Branding/`](Branding) — design principles, type scale, and the voice rules every
  user-facing string follows

## Status

Pre-production, under active development. Claims in this README follow the evidence rule from
`docs/POSITIONING.md`: only what the code actually does.
