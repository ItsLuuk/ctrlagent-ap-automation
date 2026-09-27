# Testing Strategy

## Test Strategy

The first safety net is a behavior-oriented characterization suite for the Tauri upload journey. Tests should pin what users can observe, not internal implementation details.

### Required acceptance flow

`native picker or drop → progress → invoice row → extracted fields → valid review route`

### Test layers

| Layer | Purpose | Current command / harness |
|---|---|---|
| Pure extraction | Pin field parsing and OCR fallback behavior without a UI | `bun test ./src/lib/ap/ocr.test.ts` |
| Browser-capable bundle | Exercise PDF.js worker startup, IndexedDB, persistence, and routing | `bun run test:e2e tests/e2e/superdoos-upload.spec.ts` |
| Tauri frontend build | Ensure the desktop bundle resolves native and PDF worker imports | `npm run build:tauri` |
| Native desktop runtime | Exercise actual OS picker and Tauri filesystem drag/drop | Blocked locally by the MSVC linker; must run on a configured Windows build host |

### Rules

- Characterization tests pin current behavior; they do not silently repair quirks.
- A discovered bug is recorded in `TECH-DEBT.md` with risk and follow-up status.
- Structural changes are not allowed until the Phase 1 map is green.
- Tests must assert durable outcomes: persisted source file, invoice state, stage/reason, and route—not only transient toasts.

## Safety Net Map

| Module | Pinned behaviors | Test files / command | Gaps |
|---|---|---|---|
| `src/components/ap/upload-dialog.tsx` | Picker/drop enters one processing pipeline; progress appears; failures retain actionable details; successful source persistence precedes background queueing | `tests/e2e/superdoos-upload.spec.ts`; add focused component characterization if needed | Actual native OS picker and filesystem drop are not executable on this host. |
| `src/lib/ap/file-store.ts` | Uploaded source is durable before success; reload can rehydrate a preview URL; cleanup does not crash boot | Superdoos E2E IndexedDB assertions | No isolated file-store unit suite yet. |
| `src/lib/ap/ocr.ts` / PDF.js | PDF worker initializes; text-layer and OCR fallback produce fields; runtime does not import Node-only modules | `src/lib/ap/ocr.test.ts`; Superdoos E2E | Physical Tauri worker execution still needs a configured desktop host. |
| `src/lib/app/upload-jobs.tsx` | Processing rows remain valid and transition to review or persistent failure | Superdoos E2E route/state assertions | Background VLM failure and retry need a deterministic fixture. |
| `src/routes/invoices.$id.tsx` | Processing, failed, and ready invoices each render a safe route | Superdoos E2E | Dedicated route-state tests are not yet isolated. |
| `src/lib/ap/processing-errors.ts` | Stage-specific, human-readable reasons replace generic failure messages | Superdoos E2E regression checks; add unit cases for error categories | Error-category unit coverage is incomplete. |
| `src/lib/ap/csv-export.ts` | Export set is approved-only and never demo data (one shared predicate for button, toast, and file); BOM + CRLF + fixed header; RFC 4180 escaping and spreadsheet formula guard; two-decimal dot money; ISO dates; PO number resolution; deterministic sort | `src/lib/ap/csv-export.test.ts` (10); `tests/e2e/csv-export.spec.ts` (click → download → file contents → toast) | Download behavior inside the packaged WebView2 window is unverified until the native host runs (MSVC gate). |

## Characterization Backlog

- [ ] Add isolated `file-store` tests for successful save, unavailable IndexedDB, and failed transaction.
- [ ] Add deterministic processing-job tests for success, failure, retry, and queue ordering.
- [ ] Add route-state tests for `processing`, `failed`, and `draft` invoices.
- [ ] Run the native picker/drop acceptance flow on a Windows host with a working MSVC linker.
- [ ] Add a committed sanitized PDF fixture so CI does not rely on a Downloads path.

## Evidence Log

- Superdoos Playwright regression: passing.
- OCR suite: 36 passing.
- Processing-error characterization suite: 5 passing; combined focused result: 41 passing.
- Tauri frontend bundle: passing.
- CSV export unit suite: 10 passing.
- CSV export Playwright regression (first-run opt-in → export → file contents): passing.
- Full unit suite: 445 passing across 30 files.
- Physical Tauri executable: not yet run on this host because Rust resolves Git's `link.exe` instead of the MSVC linker.
