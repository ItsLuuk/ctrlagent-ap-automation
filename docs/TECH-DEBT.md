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
| Repository-wide Prettier/CRLF noise obscures real lint failures | `.prettierrc`, `.prettierignore`, `eslint.config.js`, missing `.gitattributes` | Tooling debt | Medium: makes quality checks unusable and risks accidental broad rewrites | Medium | P1 | planned — see cleanup plan below |

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

## Focused CRLF and Prettier Cleanup Plan

### Goal

Make lint and formatting checks actionable without changing application behavior or mixing mechanical cleanup with feature work.

### Root-cause inventory

- Git's index is predominantly LF, but many working-tree files are CRLF; no `.gitattributes` policy currently defines the checkout contract.
- `.prettierrc` does not set `endOfLine`, so Prettier defaults to LF and reports CRLF files as formatting failures.
- `eslint.config.js` ignores build/data directories but still lints archived compiled files such as `docs/removed-screens/*.compiled.mjs`.
- `bun run format` runs `prettier --write .`, which is too broad for a dirty shared checkout and can rewrite unrelated feature work.
- The current shared checkout contains extensive unrelated modifications. This cleanup must run in a dedicated worktree or after ownership is coordinated; do not normalize files in place here.

### Scope boundaries

**In scope:** tracked source/configuration files that are intentionally maintained: TypeScript, TSX, JavaScript, MJS, JSON, Markdown, and the Tauri/Vite configuration.

**Out of scope:** `node_modules`, build output, `.output`, `.tanstack`, `.tmp`, `corpus`, `Dataset`, `test-results`, bundled models/runtime files, PDFs, DOCX files, and archived compiled snapshots under `docs/removed-screens/`.

**Never combine with:** OCR behavior changes, router changes, UI feature edits, dependency upgrades, or broad refactors.

### Safe execution sequence

1. **Choose a clean execution context.** Use a dedicated worktree from the agreed base or wait until the current feature changes are owned and checkpointed. Record the starting commit and changed-file list.
2. **Adopt one line-ending policy.** Add `.gitattributes` with LF for text source/docs, and explicit CRLF only for Windows batch scripts if required. Do not run `git add --renormalize .` in the shared dirty checkout.
3. **Make lint scope explicit.** Add `endOfLine: "lf"` to `.prettierrc`; add archived compiled files and other generated/data paths to `.prettierignore`; add only the archived generated-file patterns to ESLint ignores. Do not ignore real `src`, `tests`, or `scripts` files to make lint pass.
4. **Normalize in batches.** Run Prettier only against the explicitly scoped source globs, in small groups: config/scripts, tests, `src`, then docs. Review each batch with `git diff --check` and `git diff --ignore-space-at-eol`.
5. **Separate formatting from real lint errors.** After line-ending noise is removed, run ESLint and classify remaining errors as import/type-aware rules, React rules, or Prettier layout issues. Fix only errors in files already owned by the cleanup change; record unrelated failures as debt.
6. **Verify behavior boundaries.** Run the focused unit suites and the Tauri UI build after formatting. Formatting must not alter imports, route paths, state transitions, OCR prompts, or user-facing copy.
7. **Review the final diff.** Confirm that non-whitespace changes are intentional, generated files are absent, and the diff contains no feature work. Require a separate review before any commit.

### Expected checks

```sh
bunx prettier --check <explicitly scoped globs>
bun run lint
bun test <focused suites>
bun run build:tauri
git diff --check
git diff --ignore-space-at-eol --stat
```

`bun run format` should not be used as the first cleanup command. If it is retained, its ignore rules and scope must be updated first and run only in the dedicated cleanup worktree.

### Done criteria

- A fresh checkout has the documented line-ending behavior.
- Prettier check passes for maintained source files.
- ESLint output contains no CRLF-only noise.
- Generated/archive files are excluded by explicit, documented patterns.
- Focused tests and the Tauri UI build pass.
- The cleanup diff contains formatting/configuration changes only; no feature or dependency changes are bundled.
