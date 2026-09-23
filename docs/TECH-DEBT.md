# Technical Debt

## Debt Ledger

| Item | Location | Type | Risk | Effort | Priority | Status |
|---|---|---|---|---|---|---|
| Native picker and filesystem drop lack physical desktop characterization on this host | `src/components/ap/upload-dialog.tsx` | Test gap / environment | High: the final user path is not executable in local validation | Medium | P0 | open |
| Source-file persistence has no isolated transaction tests | `src/lib/ap/file-store.ts` | Test gap | High: preview and recovery depend on durable source bytes | Small | P0 | open |
| Upload dialog owns picker, drop, processing, failure, retry, and manual-review orchestration | `src/components/ap/upload-dialog.tsx` | Coupling / readability | Medium: changes can break several entry paths | Medium | P1 | ledgered for Phase 2 |
| Background job failures and retries lack deterministic test fixtures | `src/lib/ap/upload-jobs.tsx` | Test gap | High: queued invoices can become misleading states | Medium | P0 | open |
| Route-state rendering is covered indirectly through one E2E flow | `src/routes/invoices.$id.tsx` | Test gap | Medium: partial invoice data could regress into a crash | Small | P1 | open |
| Full `store.tsx` lint has existing formatting errors and a Fast Refresh warning | `src/lib/ap/store.tsx` | Tooling debt | Low: noisy quality signal; not upload behavior | Small | P2 | existing |
| Physical Tauri build is blocked by Windows linker resolution | Local build environment | Environment debt | High: native acceptance cannot run here | Medium | P0 | blocked |

## Sprout / Wrap Register

| Boundary | Current seam | Next safe move | Status |
|---|---|---|---|
| Tauri native file input | `filesFromNativePaths` converts paths to browser `File` objects | Characterize path read errors and supported file types | sprout |
| IndexedDB source storage | `saveFile` / `loadFileUrl` | Add isolated transaction tests before changing storage behavior | wrap |
| PDF.js worker | `pdf-worker?worker` import through `ocr.ts` | Keep worker startup behind the existing PDF library seam | wrapped |
| Background extraction | `enqueue` / `runOne` in `upload-jobs.tsx` | Add deterministic job fixtures before refactoring | sprout |
| Failure communication | `src/lib/ap/processing-errors.ts` | Characterization coverage now pins stage, storage, worker, and legacy-message behavior | wrapped |

## Smell Inventory

Phase 1 records only confirmed safety-net gaps. Readability and refactoring smells are deliberately deferred until the gate is green.

| Smell | Location | Refactoring / fix | Status |
|---|---|---|---|
| Large orchestration function | `src/components/ap/upload-dialog.tsx` | Phase 2 readability audit; consider Extract Method only after characterization | deferred |
| Broad integration surface | `src/lib/ap/upload-jobs.tsx` | Phase 3 named refactoring after job tests exist | deferred |

## Adopted Conventions

- Characterize first; do not silently fix discovered quirks in a safety-net pass.
- Prefer assertions about durable state and user-visible outcomes over implementation details.
- Every upload failure must include operation/stage context and a recovery direction.
- Structural refactors and behavior changes remain separate and independently verified.
- The app shell owns the store providers: they live in each root's `shellComponent`, above every match, so the crash and not-found screens render inside the shell. Moving them into the route component strands those two screens — they show the app chrome, and the chrome needs the store.
- One screen per state, shared by both roots (web and desktop): `src/components/ap/route-fallback.tsx`. "Go home" is a router `Link`, never an anchor — the desktop build serves the app from `/tauri.html`, where `href="/"` leaves the window.

## Debt Budget & Broken-Windows Policy

Not yet adopted; this is a Phase 6 decision. Until then, P0 safety gaps may be addressed, while unrelated cleanup remains out of scope for the upload journey.
