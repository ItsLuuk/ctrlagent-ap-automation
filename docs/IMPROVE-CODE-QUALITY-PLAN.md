# Improve Code Quality Plan

## Context

Foundry is a pre-production Tauri desktop app that turns uploaded invoices into reviewable payable records. The highest-risk failure is losing or misrepresenting an invoice during upload, PDF/OCR processing, local persistence, or review navigation.

- **Stack:** Tauri 2, React, Vite, TanStack Router, IndexedDB
- **Processing:** PDF.js, OCR fallback, local processing/model integrations
- **Current baseline:** existing OCR tests and the Superdoos Playwright regression
- **Usage:** pre-production / internal testing
- **Outbound dependencies:** local-only processing; no business-critical remote service is in scope for this pass

## Phase Status

| Phase | Status | Artifact | Scope / next action |
|---|---|---|---|
| 1. Safety net | awaiting-evidence | `docs/TESTING.md`, `docs/TECH-DEBT.md` | Browser bundle and pure processing behaviors are pinned; native desktop evidence is still blocked by the MSVC linker. **GATE.** |
| 2. Clean code | pending | `docs/TECH-DEBT.md` | Audit readability and error-handling smells after Phase 1 is green. |
| 3. Refactoring patterns | pending | `docs/TECH-DEBT.md` | Apply small behavior-preserving named refactorings. |
| 4. Deep modules | pending | `docs/TECH-DEBT.md` | Review only after Phases 1–3. |
| 5. Architecture boundary | pending | `docs/ARCHITECTURE.md` | Map framework/storage boundaries when this journey expands. |
| 6. Pragmatic habits | pending | `docs/TECH-DEBT.md` | Establish maintenance conventions. |
| 7. Production reliability | pending | `docs/RELIABILITY.md` | Audit release and integration resilience before launch. |
| 8. System sizing | pending | `docs/ARCHITECTURE.md`, `docs/RELIABILITY.md` | Size from real usage numbers. |
| 9. Data correctness | pending | `docs/ARCHITECTURE.md` | Revisit if shared or remote data/concurrency is introduced. |

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Starting module | Tauri upload pipeline | It is the active change point and joins native input, extraction, persistence, and routing. |
| Test baseline | Existing tests plus Superdoos E2E | The current regression already exercises the real Tauri frontend bundle path. |
| Characterization rule | Pin and ledger discovered quirks | Phase 1 must remain behavior-only; fixes belong in separately verified work. |
| Current scope | Phases 1–3 | Establish safety, readability, and small refactorings before broader architecture work. |
| Data boundary | Tauri + local IndexedDB | The current product is local-first and pre-production. |

## Phase 1 Gate

No structural refactoring may touch code outside the Safety Net Map until the pinned behaviors are covered and green. A discovered bug is recorded in the debt ledger rather than silently changed during characterization.

## Next Actions

- [ ] Add or confirm characterization coverage for each behavior in `docs/TESTING.md`.
- [ ] Record uncovered native-runtime behavior and the MSVC linker blocker.
- [x] Run the browser, OCR, and processing-error safety-net suites green.
- [ ] Run the native picker/drop acceptance flow on a configured Windows Tauri host.
- [ ] Present Phase 1 results before entering Phase 2.
