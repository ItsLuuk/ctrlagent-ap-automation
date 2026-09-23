# Foundry — local-first invoice processing

> For small finance teams who can't send supplier data to yet another cloud, Foundry reads
> invoices entirely on your own machine — and learns every vendor's layout.

Foundry is a desktop app for capturing supplier invoices, extracting the fields, and carrying
each record from upload to payment preparation — with **no server, no account, and no cloud AI
call**. IBANs, VAT numbers and supplier data never leave the machine.

Capture invoices locally, confirm the data, approve the record, and prepare it for external
handoff. The system handles the routine; you handle the judgment.

## Why local-first

| | |
|---|---|
| **Privacy** | Documents are read on your machine — PDF text layer, on-device OCR, and optionally a local vision model on `localhost`. No supplier data reaches a third party, so there is no DPA to sign and nothing to breach. |
| **Zero marginal cost** | No per-invoice AI fees. Reading runs on your hardware, so cost doesn't scale with document count. |
| **Control** | Every extracted field is shown beside the page region it came from, each record carries a full audit trail with segregation of duties, and vendor layouts are learned locally for faster, drift-aware re-reads. |

## How it works

**Upload → wait → review.** Everything else lives behind the review screen.

1. **Capture** — drag-and-drop or the native file picker (desktop and browser).
2. **Preparing** — the source file is saved locally first, then read through a learned vendor
   template when one exists, otherwise from the document itself. Failures keep their exact
   stage and a human-readable reason, with retry and manual-review paths.
3. **Ready to review** — a new vendor pins a profile once (name, business registration and a
   valid IBAN are required), then each invoice moves through draft → approval → payment queue,
   where it is marked ready for external handoff.

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

## Getting started

Requirements: Node.js, [Bun](https://bun.sh) for unit tests, and the Rust/Tauri prerequisites
(MSVC C++ build tools on Windows) for the desktop window.

```sh
npm install
npm run dev        # browser
npm run tauri:dev  # desktop window
```

```sh
bun test           # unit tests (OCR, extraction, state machine, errors)
npm run test:e2e   # Playwright end-to-end, including the full upload regression
npm run lint       # eslint
```

## Documentation

- [`docs/POSITIONING.md`](docs/POSITIONING.md) — positioning canvas, category decision, and
  open validation tasks. **Source of truth for product decisions:** a new screen, feature, or
  line of copy serves the positioning statement or gets cut.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/TESTING.md`](docs/TESTING.md) ·
  [`docs/TECH-DEBT.md`](docs/TECH-DEBT.md) · [`docs/RELIABILITY.md`](docs/RELIABILITY.md)
- [`Branding/`](Branding) — design principles, type scale, and the voice rules every
  user-facing string follows

## Status

Pre-production, under active development. Claims in this README follow the evidence rule from
`docs/POSITIONING.md`: only what the code actually does.
