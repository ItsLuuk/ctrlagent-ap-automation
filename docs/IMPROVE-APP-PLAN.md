# Improve App Plan

## Context
Improve-app intake started 2026-09-24 for Foundry, a Windows desktop Tauri application that turns supplier invoices into review-ready payable records.

The user-defined job is: **to fully automate the AP workflow so finance teams can move faster, catch fraud, and never miss an invoice.**

Initial evidence is internal product observation rather than customer research, support data, or funnel analytics. The highest-leak flow identified at intake is **approval to handoff**. The experience problem to front-load is **interaction feedback** in that flow. There are no current in-app upsell, trial, or promotional surfaces. The primary platform is Windows desktop.

## Phase Status
| Phase | Skill | Status | Artifact | Date |
|---|---|---|---|---|
| 1 | jobs-to-be-done | done | CUSTOMER.md | 2026-09-24 |
| 2 | ux-heuristics | done | DESIGN.md, EXPERIMENTS.md | 2026-09-24 |
| 3 | design-everyday-things | done | DESIGN.md, EXPERIMENTS.md | 2026-09-24 |
| 4 | refactoring-ui | done | DESIGN.md, EXPERIMENTS.md | 2026-09-24 |
| 5 | microinteractions | done | DESIGN.md, EXPERIMENTS.md | 2026-09-24 |
| 6 | made-to-stick | done | POSITIONING.md, EXPERIMENTS.md | 2026-09-24 |
| 7 | influence-psychology | skipped: no in-app upsell, trial, or promotional surfaces at intake | POSITIONING.md, EXPERIMENTS.md | 2026-09-24 |
| 8 | high-perf-browser | done | DESIGN.md, EXPERIMENTS.md | 2026-09-24 |
| 9 | steve-jobs-design-review | done | PRODUCT.md, DESIGN.md, EXPERIMENTS.md | 2026-09-24 |

Statuses: pending · in-progress · awaiting-evidence · done · deferred: <reason> · skipped: <reason>

## Key Decisions
| Date | Phase | Decision | Rationale |
|---|---|---|---|
| 2026-09-24 | Intake | Anchor the journey on fully automating AP while protecting against missed invoices and fraud. | This is the user's stated job; it is broader than OCR alone and makes approval-to-handoff reliability the first product outcome to examine. |
| 2026-09-24 | Intake | Front-load interaction feedback around approval to handoff. | The user identified feedback as the roughest experience area, and the named leak is the handoff boundary. |
| 2026-09-24 | Intake | Optimize Windows desktop first. | The shipped product is a Tauri desktop application. |
| 2026-09-24 | Intake | Use internal observations as the initial evidence base. | No customer interviews, recordings, support tickets, or analytics were provided; later phases must label assumptions explicitly. |
| 2026-09-24 | Intake | Start from current product reality before expanding the positioning document. | The existing POSITIONING.md is useful context, but this journey should validate the job and UX against the shipped flow first. |
| 2026-09-24 | Phase 1 | Approved the job statement: when invoices arrive, turn them into trustworthy payable records automatically so the team can move quickly without missing an invoice or approving fraud. | The user selected the fully automate AP framing. |
| 2026-09-24 | Phase 1 | Functional reliability is the most underdelivered dimension; calm confidence and defensible approval are the emotional and social outcomes. | Functional work prevents omissions and fraud; the other dimensions make the outcome trustworthy in daily use. |
| 2026-09-24 | Phase 1 | Treat the approval-to-handoff leak as both Big Hire and Little Hire, with the first audit focused on repeated use. | First-use trust and repeated handoff reliability are both part of the job, but the user identified the recurring boundary as the roughest flow. |
| 2026-09-24 | Phase 2 | Fix the two severity-4 handoff issues first: make the handoff action explicit and explain what it produces. | These are the highest-severity findings in the approval-to-handoff audit. |
| 2026-09-24 | Phase 2 | Make EXP-001 a trust-and-proof test rather than a completion test. | The user selected trust and proof as the first experiment focus; success requires users to understand the next action and the no-payment boundary. |
| 2026-09-24 | Phase 3 | Constrain invalid handoff actions until the invoice is eligible. | The user selected constraints over explanatory disabled actions; this prevents wrong-state attempts before the state machine has to reject them. |
| 2026-09-24 | Phase 3 | Keep a confirmation for handoff actions, while re-open remains reversible with a reason. | The user selected confirmation for the consequential handoff boundary; low-risk recovery remains available through the existing re-open path. |
| 2026-09-24 | Phase 4 | Keep the visual pass within the current design tokens. | The user selected current tokens; hierarchy, spacing, and action emphasis should improve before any new palette is introduced. |
| 2026-09-24 | Phase 4 | Prioritize the invoice decision bar in the first visual pass. | The handoff state and its next action are the clearest place to improve the approval-to-handoff experience without broad queue churn. |
| 2026-09-24 | Phase 4 | Entered Phase 4 using the fallback Refactoring UI brief. | The phase skill package is not available in the connected skill set; the audit uses grayscale hierarchy, spacing scale, one-primary-action checks, and token decisions. |
| 2026-09-24 | Phase 5 | Entered Phase 5 using the fallback microinteraction brief. | The phase skill package is not available in the connected skill set; the audit maps triggers, rules, feedback, and loops, then selects one signature moment through the removal test. |
| 2026-09-24 | Phase 5 | Polish the full handoff chain first: approve, confirm preparation, show prepared proof, and export. | The handoff is the named leak and the roughest feedback area; a coherent state sequence is more valuable than applying isolated animation across unrelated actions. |
| 2026-09-24 | Phase 5 | Use “Handoff prepared” as the signature microinteraction. | The moment carries product-specific proof of the artifact, its destination, and the no-payment boundary; removing it would force users to infer the result and weaken trust. |
| 2026-09-24 | Phase 5 | Approved the handoff interaction model and EXP-004 specification. | The approved model uses immediate feedback for synchronous work, persistent success/failure, confirmation, accessible status, and download-started language without claiming an OS save completed. |
| 2026-09-24 | Phase 6 | Entered Phase 6 using the fallback Made to Stick brief. | The phase skill package is not available in the connected skill set; the audit uses simplicity, unexpected specificity, concrete language, credibility, emotion, and stories while preserving the evidence rules. |
| 2026-09-24 | Phase 6 | Lead with the end-to-end promise: automate AP from PDF to bookkeeping-ready without sending invoice data to the cloud. | The approved job is the complete AP workflow, not document reading alone; local processing is the differentiator and proof, not the entire story. |
| 2026-09-24 | Phase 6 | Use visible workflow proof as the first credibility anchor. | Field provenance, exceptions, approval, and CSV handoff are visible in the product; customer outcomes and published benchmarks remain unvalidated. |
| 2026-09-24 | Phase 6 | Approved the positioning message and EXP-005 specification. | The message is simple, concrete, and memorable without claiming autonomous payment, fraud prevention, or unmeasured time savings. |
| 2026-09-24 | Phase 8 | Entered Phase 8 using the fallback high-performance audit brief. | The phase skill package is not available in the connected skill set; the audit covers critical rendering, startup, extraction, and handoff latency while separating measurements from hypotheses. |
| 2026-09-24 | Phase 8 | Prioritize startup, beginning with instrumentation before changing extraction architecture. | The shell eagerly mounts the upload/OCR graph and starts vision warm-up after mount; this is the clearest startup risk, but the current speed tests are theoretical rather than observed. |
| 2026-09-24 | Phase 8 | Approved EXP-006 through EXP-010 and the measurement protocol. | The plan measures cold start, quick extraction, background completion, and handoff at realistic queue sizes before accepting performance trade-offs. |
| 2026-09-24 | Phase 9 | Entered Phase 9 using the fallback Steve Jobs-style product review brief. | The phase skill package is not available in the connected skill set; the review tests focus, user love, product courage, simplicity, and whether the story earns the next milestone. |
| 2026-09-24 | Phase 9 | Anchor the product on the trusted golden path: PDF → review → approve → prepare bookkeeping handoff → export CSV. | One complete, explainable loop is more valuable than broader AP surface area before trust and repeat use are proven. |
| 2026-09-24 | Phase 9 | Keep human control, local processing, and the no-payment boundary as product strengths. | These choices create calm confidence and are more credible than claiming autonomous payment or fraud prevention. |
| 2026-09-24 | Phase 9 | Approved PRODUCT.md, the final review in DESIGN.md, and EXP-011. | The final recommendation is focus, simplify, and prove the golden path; customer evidence and production measurements remain expansion gates. |

## Next Actions
- [x] Enter Phase 1 and write the product job, three job dimensions, and competing alternatives in `docs/CUSTOMER.md` (owner: product/UX, due: complete 2026-09-24).
- [x] Audit the approval-to-handoff flow before changing UI or copy (owner: product/UX, due: complete 2026-09-24).
- [ ] Run EXP-003 as a grayscale decision-bar hierarchy test after the visual changes (owner: product/UX, due: after implementation).
- [ ] Implement the approved handoff interaction model, then run EXP-004 to test artifact comprehension and the no-payment boundary (owner: product/UX, due: after implementation approval).
- [ ] Audit press, pending, and duplicate-click states for re-open, remove, and restore as a separate recovery-actions pass (owner: product/UX, due: after Phase 5).
- [x] Implement the approved promise in the README, first-run copy, and release notes (owner: product/marketing, due: complete 2026-09-24).
- [x] Run the EXP-005 internal dry run against the README and first-run copy (owner: product/marketing, due: complete 2026-09-24; 4/4 comprehension checks and guardrail passed; not customer evidence).
- [ ] Run EXP-005 with target finance users and compare the new promise with the prior local-first statement (owner: product/marketing, due: after recruiting testers).
- [ ] Run EXP-006 to instrument the production Tauri startup, quick extraction, background completion, and handoff path (owner: engineering, due: before EXP-007).
- [ ] Run EXP-007 only after EXP-006 establishes a cold-start and first-upload baseline (owner: engineering, due: after instrumentation).
- [ ] Establish EXP-010 handoff baselines at 1, 50, and 500 approved invoices (owner: engineering, due: after baseline instrumentation).
- [ ] Run EXP-011 with target finance users before expanding the AP surface (owner: product/UX, due: after recruiting testers).
