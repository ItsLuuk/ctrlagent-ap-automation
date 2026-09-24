# Experiments

## Experiment Cards

### EXP-001 — Make handoff trust visible

- Hypothesis: We believe users will trust and complete the bookkeeping handoff more often if approval, preparation, and export are explicit in one flow, because users currently cannot tell what “ready for external handoff” means or what artifact they receive.
- Type: smoke test
- Primary metric & threshold (pre-committed): At least 80% of observed test users can identify the next handoff action and correctly state that Foundry does not send payment after one pass.
- Guardrail metric: No increase in accidental approvals, re-opens, or exports of records that are not ready for handoff.
- Decision rule (pivot / persevere / iterate): Persevere if the threshold passes; iterate copy and hierarchy if users understand the action but not the destination; pivot if users still leave the flow to find export.
- Result & verdict: Not run.

### EXP-002 — Prevent invalid handoff actions

- Hypothesis: We believe users will make fewer wrong-state handoff attempts if ineligible actions are constrained before they are clicked, because the current state machine rejects invalid moves after the user has already chosen an action.
- Type: smoke test
- Primary metric & threshold (pre-committed): 100% of tested ineligible states show no enabled handoff action, and testers can name the prerequisite without triggering an error.
- Guardrail metric: No eligible invoice loses access to a valid handoff action.
- Decision rule (pivot / persevere / iterate): Persevere if constraints prevent wrong-state attempts without hiding the next valid step; iterate if users cannot discover why an action is unavailable; pivot if role or lifecycle variations make the constraint misleading.
- Result & verdict: Not run.

### EXP-003 — Make the handoff action dominant

- Hypothesis: We believe users will find the next handoff step faster when the decision bar gives the handoff state its own compact proof row and keeps Approve as the only filled primary action, because the current action group gives several outcomes similar visual weight.
- Type: smoke test
- Primary metric & threshold (pre-committed): At least 85% of observed test users identify the next valid action within 5 seconds on a grayscale rendering of the invoice decision bar.
- Guardrail metric: No decrease in correct Query/Reject selection when those actions remain available.
- Decision rule (pivot / persevere / iterate): Persevere if the action is found quickly and alternate outcomes remain discoverable; iterate spacing or labels if the action is found but its consequence is unclear; pivot if visual dominance causes users to approve without reading the comparison.
- Result & verdict: Not run.

### EXP-004 — Make the prepared handoff feel trustworthy

- Hypothesis: We believe users will complete the bookkeeping handoff with greater confidence when preparation uses a consequence-stating confirmation and the accepted state persistently shows the artifact, destination, and no-payment boundary, because the current flow reports a lifecycle marker and a transient toast rather than proof of what the user receives.
- Type: smoke test
- Primary metric & threshold (pre-committed): At least 80% of observed test users can identify the produced artifact, its destination, and that Foundry sends no payment after one pass through prepare → prepared proof → export.
- Guardrail metric: No increase in re-opens, duplicate preparation attempts, or exports of ineligible or sample records.
- Decision rule (pivot / persevere / iterate): Persevere if the comprehension threshold passes; iterate the proof or copy if users understand preparation but cannot find export; pivot if confirmation adds hesitation without improving trust or correct next-step selection.
- Result & verdict: Not run.

### EXP-005 — Make the AP promise concrete

- Hypothesis: We believe an end-to-end AP promise supported by visible workflow proof will help finance users understand Foundry faster and trust it more than the current “local-first invoice reading” statement, because the current statement leads with document reading rather than the completed PDF-to-bookkeeping job.
- Type: message test / smoke test
- Primary metric & threshold (pre-committed): At least 80% of observed testers can identify what Foundry automates, what artifact it produces, where invoice data is processed, and that Foundry does not send payment after one pass.
- Guardrail metric: No increase in testers believing Foundry approves or pays invoices without human review.
- Decision rule (pivot / persevere / iterate): Persevere if comprehension and trust pass; iterate the proof sequence if the promise is understood but not believed; pivot if “without the cloud” distracts from the AP outcome.
- Test surfaces: README promise/intro and the empty-inbox first-run copy.
- Internal dry run: One internal reviewer, no hints, answered the four pre-committed questions after one pass. The copy exposed: AP automation from PDF to bookkeeping-ready; review-ready payable records and bookkeeping-ready CSVs; local processing without cloud AI calls; and human approval with no payment execution. All four comprehension checks passed (4/4), and the no-autonomous-payment guardrail passed.
- Limitation: This is an internal desk check, not customer evidence; there is no comparison group and the live preview did not expose the Foundry first-run screen.
- Result & verdict: Internal dry run passed; EXP-005 remains **awaiting target-user validation** before applying the 80% threshold.

### EXP-006 — Instrument the real Tauri path

- Hypothesis: Stage-level marks will reveal whether startup or extraction is the dominant delay; current tests and theoretical benchmarks cannot answer that.
- Type: performance instrumentation
- Primary metric & threshold (pre-committed): Produce p50/p95 traces for cold start → usable inbox, upload intent → quick phase, quick phase → persisted row, background start → review-ready, and approval → visible handoff state across at least three representative runs.
- Guardrail metric: Instrumentation does not block rendering, persist invoice contents or personal data, or add meaningful startup work.
- Decision rule (pivot / persevere / iterate): Persevere if traces identify a stable bottleneck; iterate instrumentation if stage boundaries are ambiguous; pivot if the desktop build cannot be measured in the release environment.
- Result & verdict: Not run.

### EXP-007 — Defer heavy extraction initialization

- Hypothesis: Lazy-loading OCR/VLM and starting vision warm-up only after upload intent or an idle boundary will reduce time to usable inbox without materially delaying the first upload.
- Type: performance experiment
- Primary metric & threshold (pre-committed): At least 15% improvement in cold-start p95 or initial main-chunk parse cost, with no more than 10% regression in upload-intent → quick-phase p95.
- Guardrail metric: The empty inbox remains interactive, upload errors remain explainable, and model work never blocks navigation.
- Decision rule (pivot / persevere / iterate): Persevere if startup improves without first-upload regression; iterate the warm-up boundary if first upload regresses; pivot if deferred loading introduces unacceptable setup or error complexity.
- Result & verdict: Not run.

### EXP-008 — Reuse the upload byte buffer

- Hypothesis: Reading the file once for hashing and PDF parsing will reduce large-file I/O and memory pressure without changing duplicate detection.
- Type: performance experiment
- Primary metric & threshold (pre-committed): One full-file read per upload path, with identical hash, duplicate, extraction, and persistence outputs.
- Guardrail metric: No hash, duplicate, or source-file persistence regression.
- Decision rule (pivot / persevere / iterate): Persevere if read count and memory improve with identical outputs; iterate the buffer lifetime if large-file memory regresses; pivot if PDF APIs require incompatible ownership.
- Result & verdict: Not run.

### EXP-009 — Split text-layer and scanned-page scheduling

- Hypothesis: Text-layer pages can use bounded concurrency while scanned/VLM pages remain serialized, improving multi-page text invoices without overloading the local model.
- Type: performance experiment
- Primary metric & threshold (pre-committed): At least 20% p95 improvement for multi-page text-layer fixtures, with scanned-document p95 and extraction accuracy unchanged within 2%.
- Guardrail metric: No increase in timeouts, out-of-order progress, or model contention.
- Decision rule (pivot / persevere / iterate): Persevere if text-layer latency improves without scanned-path regression; iterate concurrency limits if contention appears; pivot if accuracy or progress ordering is unstable.
- Result & verdict: Not run.

### EXP-010 — Measure handoff at realistic queue size

- Hypothesis: Synchronous CSV generation is acceptable at the product’s target volume; measurement will prevent optimizing a non-problem.
- Type: performance benchmark
- Primary metric & threshold (pre-committed): Establish p50/p95 for 1, 50, and 500 approved invoices and verify download start remains responsive on the reference machine.
- Guardrail metric: No sample/ineligible records, duplicate rows, or lost audit state.
- Decision rule (pivot / persevere / iterate): Persevere if the current path meets the measured budget; iterate generation if larger queues block interaction; pivot only if measurement shows a different handoff bottleneck.
- Result & verdict: Not run.

### EXP-011 — Golden-path first-use

- Hypothesis: A single, explicit upload → review → approve → prepare → export path will increase successful first completion and trust more than exposing the broader AP surface, because the current product story spans competing lifecycle terms and adjacent capabilities.
- Type: usability / onboarding smoke test
- Primary metric & threshold (pre-committed): At least 80% of target finance users complete the golden path without assistance and can answer the four simplicity questions: what Foundry does, what happened, what needs judgment, and what handoff means.
- Guardrail metric: No increase in approval errors, missed exceptions, duplicate preparation, or payment-boundary confusion.
- Decision rule (pivot / persevere / iterate): Persevere if completion and comprehension pass; iterate the path if users finish but cannot explain it; stop adding breadth until the path is trusted.
- Result & verdict: Not run.

## Experiment Backlog

| Idea | ICE (impact/confidence/ease) | Status |
|---|---|---|
| Replace “Mark ready for external handoff” with “Prepare bookkeeping handoff” and explain the CSV/no-payment boundary | 9/8/9 | Queued from EXP-001 |
| Show the next handoff action and latest handoff proof in the invoice decision bar | 9/8/7 | Queued from EXP-001 |
| Give handoff proof a compact row above the decision controls with a 16px gap | 8/8/8 | Queued from EXP-003 |
| Keep Approve as the only filled primary action; subordinate Query and Reject | 8/8/9 | Queued from EXP-003 |
| Constrain invalid handoff actions until the invoice is eligible | 9/9/8 | Queued from EXP-002 |
| Keep blocked transition feedback persistent beside the action, not toast-only | 8/8/7 | Queued from EXP-002 |
| Standardize “Ready for bookkeeping handoff” across queue and detail surfaces | 7/9/9 | Queued |
| Add per-invoice “Export this invoice” after preparation | 8/7/6 | Queued |
| Add a bulk-export empty state that explains the prerequisite | 5/8/9 | Backlog |
| Use action-specific labels for required reasons | 6/8/9 | Queued from EXP-002 |
| Reduce equal visual weight across queue tabs and stat cards | 5/7/7 | Backlog |
| Add confirmation and persistent prepared proof to the handoff action chain | 9/8/7 | Queued from EXP-004 |
| Show press, pending, duplicate-click prevention, and persistent refusal states without artificial latency | 8/8/8 | Queued from EXP-004 |
| Report “Download started” with filename and count instead of claiming an OS save completed | 8/9/9 | Queued from EXP-004 |
| Add a persistent prerequisite for export when no invoice is eligible | 6/8/9 | Queued from EXP-004 |
| Test the end-to-end “PDF to bookkeeping-ready” promise against the current local-first statement | 9/8/8 | Queued from EXP-005 |
| Put provenance, exceptions, approval, and CSV proof directly beneath the core promise | 8/8/7 | Queued from EXP-005 |
| Replace outcome language that implies autonomous payment or fraud prevention with explicit human-approval and no-payment boundaries | 9/9/9 | Queued from EXP-005 |
| Add privacy-safe performance marks for startup, quick phase, background extraction, and handoff | 9/9/7 | Queued from EXP-006 |
| Lazy-load OCR/VLM and defer vision warm-up until upload intent or idle | 9/7/6 | Queued from EXP-007 |
| Reuse one file byte buffer for SHA-256 and PDF parsing | 8/8/6 | Queued from EXP-008 |
| Separate text-layer page concurrency from serialized scanned/VLM pages | 8/7/6 | Queued from EXP-009 |
| Benchmark CSV generation and download start at 1, 50, and 500 approved invoices | 7/9/8 | Queued from EXP-010 |
| Test a single guided golden path before expanding the AP surface | 10/8/6 | Queued from EXP-011 |
| Measure the four simplicity questions during first use | 9/9/7 | Queued from EXP-011 |
