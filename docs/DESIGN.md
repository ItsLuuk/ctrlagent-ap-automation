# Design System

## Design Direction

Foundry should feel calm, precise, and trustworthy while finance teams move quickly through invoice work. The signature moment is a clear, reversible handoff: the user always knows what was approved, what is ready for bookkeeping, and that Foundry has not sent a payment.

## Typography

Existing product typography and numeric formatting are retained. Monospace, right-aligned tabular values support amount comparison; labels remain concise and concrete.

## Tokens

- Spacing scale: 4 / 8 / 16 / 24 / 32 / 48 / 64.
- Within an action group use 8px gaps; use 16px between state proof and action controls; use 24px between major sections.
- Palette: existing semantic tokens; color is reserved for attention, success, and blocked states.
- Use existing `bg-card`, `bg-muted`, `border-border`, success, warning, and destructive tokens. Do not add a new palette for the handoff pass.
- Shadows: restrained; sticky action surfaces use border and translucency rather than heavy elevation.
- Shape: retain the current rounded-card language; no new gradients or decorative shadows.

## Components

| Component | Decision | Status |
|---|---|---|
| Approval decision bar | One dominant next action; handoff proof appears beside the action after preparation | Approved |
| Queue tabs | Rename “Approved” to “Ready for bookkeeping handoff” when the handoff flow ships | Proposed |
| Handoff export | Keep bulk export in the queue; add per-invoice export to the handoff state | Proposed |
| Handoff empty state | Explain the prerequisite instead of hiding the action silently | Backlog |
| Handoff safeguard | Hide or disable handoff actions until the invoice is eligible; keep feedback concise for blocked actions | Approved |
| Handoff confirmation | Confirm the handoff action because it is a consequential workflow boundary | Approved |
| Handoff microinteraction | Use the full approve → confirm preparation → prepared proof → export sequence; keep success and failure persistent in the decision bar | Approved specification |
| Invoice decision bar hierarchy | Approve is the only filled primary action; Query and Reject are secondary; handoff proof is a compact row above the controls | Approved |
| Queue stat hierarchy | Only `Needs your judgment` and `Ready for bookkeeping handoff` carry accent emphasis | Proposed |

## UX Audit Findings

| Issue | Heuristic | Severity (0-4) | Fix | Status |
|---|---|---:|---|---|
| The handoff is split across two screens and two concepts: approve → mark ready → return to queue → export | Visibility of system status; recognition over recall | 4 | Make the handoff state explicit: after approval, show one clear “Prepare bookkeeping handoff” action; after preparation, show “Export CSV” and the exact next destination. | Proposed |
| “Mark ready for external handoff” does not say what the user receives or where it goes | Match between system and real-world workflows | 4 | Replace with “Prepare bookkeeping handoff” plus: “Creates a CSV for your bookkeeping import. Foundry sends no payment.” | Proposed |
| The queue calls scheduled records “Approved,” while the detail screen calls them “ready for external handoff” | Consistency and standards | 3 | Use “Ready for bookkeeping handoff” everywhere in user-facing copy. Keep `scheduled` internal-only. | Proposed |
| There is no per-invoice handoff/export action after approval | Efficiency; user control | 3 | Add “Export this invoice” to the handoff state while keeping bulk export in the queue. | Proposed |
| Handoff proof is hidden inside collapsed “Record details” | Help users recognize status and outcomes | 3 | Keep the audit trail collapsed, but surface the latest handoff result and “No payment sent” in the decision bar. | Proposed |
| Query and Reject sit beside Approve with similar visual weight | Consistency; error prevention | 2 | Make Approve dominant and group Query/Reject as secondary review outcomes. | Approved for first visual pass |
| Bulk export disappears without an empty-state explanation | Help and documentation | 2 | Explain that invoices must be approved and prepared before export. | Backlog |
| Invalid handoff actions are available until the state machine rejects them | Norman gulf: execution | 3 | Hide or disable handoff actions until the invoice is eligible; show a concise prerequisite beside the action when context requires it. | Approved |
| A refused transition is communicated only through a toast | Norman gulf: evaluation | 3 | Keep the toast for immediacy and add a persistent status line beside the action until resolved. | Proposed |
| Re-open does not preview what becomes editable again | Norman gulf: evaluation | 2 | Explain: “Returns this invoice to For approval and makes its fields editable again.” | Proposed |
| The reason dialog uses the generic label “Reason” | Norman gulf: execution | 2 | Use action-specific labels: “Question for the processor,” “Reason for rejection,” and “Reason for re-opening.” | Proposed |
| Approve, Query, and Reject have similar button weight | One primary action per screen | 3 | Keep Approve as the filled primary action; use outline/ghost treatments for Query and Reject. | Approved |
| Handoff status is buried behind lifecycle language | Scan before read | 4 | Give the handoff state a named action area in the decision bar and use a 16px vertical gap between state proof and action controls. | Approved |
| Queue `Approved` tile does not visually match `Ready for bookkeeping handoff` | Consistency | 3 | Rename and align the tile with the handoff state; use the same border/background treatment as success states. | Proposed |
| Queue tabs and stat cards use similar visual emphasis | Grouping by task | 2 | Keep the active queue tab filled; reduce inactive tab contrast and avoid giving every stat card equal visual weight. | Backlog |
| Handoff detail is only a paragraph in the action bar | Progressive disclosure | 3 | Add a compact proof row above the action controls: state, artifact, and “No payment sent.” | Proposed |
| The system uses multiple surface backgrounds and border shades | Systematic tokens | 2 | Consolidate handoff surfaces to existing `bg-card`, `bg-muted`, `border-border`, and semantic success/warning tokens; do not add a new palette yet. | Proposed |
| Queue summary has five stat cards on wide screens | Density and scanability | 2 | Preserve the grid, but make `Needs your judgment` and `Ready for bookkeeping handoff` the only accent-bearing tiles. | Backlog |

## Grayscale Hierarchy Review

- The document/comparison structure reads clearly before color.
- The decision bar is consistently placed and easy to find.
- The queue scan order is coherent: metrics → queue heading → tabs → records.
- The weak point is the handoff state: the next action is not visually dominant and lifecycle language competes with the actual user task.
- The approved first pass stays within existing tokens and prioritizes the invoice decision bar.

## Trunk Test

| Screen | What app is this? | Main options | Result |
|---|---|---|---|
| Work queue | Invoice operations queue | Needs you, In flight, Later, History | Passes the “where am I?” test, but Later mixes several lifecycle states. |
| Invoice review | Compare extracted invoice data and decide | Approve, Query, Reject, Review next issue | Mostly passes; the post-approval next step is not visible before approval. |
| External handoff | Prepare approved invoices for bookkeeping | Prepare handoff, Export CSV | Fails the “what happens next?” test because the current flow requires returning to the queue for export. |

## Error Copy

| Current message | What / why / how check | Proposed message |
|---|---|---|
| `This can't move forward until the flagged rows are fixed.` | What and why, but not how | `Approval is blocked by 2 flagged rows. Open Review next issue to fix the first one.` |
| `Nothing changed — the invoice is exactly as you left it.` | What, but no recovery | `Nothing changed. Fix the flagged rows, then try again; your current values are safe.` |
| `Your role can't take this step.` | What, but no why/how | `Your role cannot prepare this handoff. Ask Treasury to complete this step.` |
| `This handoff marker is recorded. Foundry has not sent a payment.` | Clear outcome, but no next step | `Handoff prepared. Export the CSV for your bookkeeping import — Foundry has not sent a payment.` |
| `Ready for external handoff` | Internal lifecycle language | `Ready for bookkeeping handoff` |

## Microinteraction Inventory

| Interaction | Trigger/Rules/Feedback/Loops | Fix | Status |
|---|---|---|---|
| Approve invoice | Trigger: click Approve. Rule: one click when valid. Feedback: status changes to ready for handoff with next action visible. Loop: Re-open remains available with a reason. | Add explicit handoff next step and proof after approval. | Proposed |
| Prepare bookkeeping handoff | Trigger: click Prepare bookkeeping handoff. Rule: only approved records are eligible. Feedback: confirmation, prepared state, export action, and no-payment statement. Loop: re-prepare or re-open with a reason. | Replace ambiguous release copy, constrain invalid actions, and expose the resulting state. | Approved |
| Export CSV | Trigger: click Export CSV. Feedback: downloaded filename/count and “No payment was sent.” Loop: export again without changing source data. | Surface per-invoice and bulk results clearly. | Proposed |
| Re-open approved record | Trigger: click Re-open. Rule: reason required. Feedback: record returns to approval and audit trail records why. Loop: approval can happen again. | Explain that fields become editable again and use a reason-specific label. | Proposed |

## Phase 5 Microinteraction Model

This audit is based on internal product observation, not usability testing or customer evidence. The first polish scope is the complete handoff chain because it is the named approval-to-handoff leak; recovery actions and global input responsiveness remain separate follow-ups.

| Stage | Trigger | Rules | Feedback | Loop / modes |
|---|---|---|---|---|
| Approved, not prepared | Choose **Prepare bookkeeping handoff** | Only an eligible approved invoice may prepare; preparation never implies payment | Give immediate pressed feedback. If real work exceeds 100 ms, disable duplicate activation and show **Preparing…** with `aria-busy`. | Cancel before confirmation leaves the approved state unchanged. Do not add artificial latency to the current synchronous transition. |
| Confirmation | Confirm preparation | State the artifact and boundary: **Creates a CSV for your bookkeeping import. Foundry sends no payment.** | Keep a focused dialog; its confirm action is **Prepare handoff**. | Escape and Cancel make no change. |
| Prepared success | The transition is accepted | Derive prepared state from the audit marker, not a transient flag | In the decision bar persistently show prepared state, artifact, invoice count, **No payment sent**, and **Export this invoice**. | A toast is supplementary. Re-open remains available with a reason. |
| Prepared failure | The transition is refused | Preserve the prior record state; do not show optimistic success | Persist a destructive status beside the action with the state-machine reason and retry path. | The user may retry or leave through Re-open. |
| CSV export | Choose **Export this invoice** or bulk **Export CSV** | Include only eligible, non-sample records | Give button press feedback, then show **Download started**, filename, and record count. | Re-export is safe and does not mutate the invoice; keep the receipt for the current queue session. |
| No eligible records | Export has no valid target | Do not expose a dead enabled action | Show **Prepare an approved invoice before export**. | Point to the valid next state. |

### Feedback Timing

- **0–100 ms:** pressed feedback; synchronous actions do not flash a spinner.
- **100–300 ms:** show a pending label and prevent duplicate clicks only when actual work takes this long.
- **Over 300 ms:** show spinner/progress plus a persistent status.
- Communicate success and failure with text and icons, not color alone; announce status changes through `aria-live="polite"`.
- Limit motion to a subtle press/fade and respect reduced-motion preferences.
- Return focus predictably after confirmation.

### Signature Moment

**Handoff prepared** passes the removal test. Without it, users must infer what preparation produced, where the file goes, and whether a payment was sent. Its value is product-specific proof rather than decorative animation.

### Phase 5 Non-goals

No artificial latency, decorative animation, new palette, global button refactor, or claim that a desktop download completed before the operating system confirms it.

## Phase 8 Performance Audit

This is an internal code-and-test audit, not a production performance study. The live preview does not expose the current Foundry Tauri surface, so startup timings must be collected from the production desktop build.

### Findings

| Area | Evidence | Assessment | Priority |
|---|---|---|---|
| Startup | The shell always mounts `UploadDialog`, which statically imports the OCR/VLM extraction graph. The shell also starts the vision runtime and model prewarm after mount. | The empty inbox may pay extraction and model-startup cost before upload intent. | High |
| Initial bundle | The Tauri UI build produces roughly 989 kB main JS, 430 kB PDF code, and 1.17 MB PDF worker assets. | Large assets are a code/build signal, not a measured cold-start time. | High |
| Text-layer extraction | Pages are processed sequentially because the VLM path is considered the bottleneck. | Text-layer pages may be paying scanned-document serialization costs; measure before changing scheduling. | Medium |
| File ingest | `computeFileHash` reads the file into an `ArrayBuffer`; PDF loading reads the file again. | Large files may pay duplicate I/O and memory cost. | Medium |
| Background extraction | Local VLM jobs are capped at two concurrent jobs. | The cap protects the model but may increase batch queue wait; measure with realistic batches. | Medium |
| Approval | State transitions are synchronous and state-machine guarded. | Compute is unlikely to be the handoff bottleneck; visible feedback matters more. | Low |
| CSV handoff | CSV generation is synchronous, sorts eligible invoices, builds a Blob, and starts a download. | Establish 1/50/500-invoice baselines before optimizing; no measured queue-size problem yet. | Low until measured |

### Measurement protocol

Record p50 and p95 on a reference Windows machine using the production Tauri build:

- Cold start → first usable inbox.
- Cold start → upload control ready.
- Upload intent → quick-phase start.
- Quick-phase start → first persisted invoice row.
- Quick-phase start → template-hit result.
- Background job start → review-ready result.
- Approval → visible handoff state.
- CSV click → download start at 1, 50, and 500 approved invoices.

Record file size, page count, text-layer versus scanned document, template hit versus novel vendor, and model availability. Do not log invoice contents or personal data.

### Approved priority

1. Instrument the real Tauri path.
2. Defer heavy extraction initialization until upload intent or an idle boundary.
3. Reuse the upload byte buffer for hashing and PDF parsing.
4. Split text-layer and scanned-page scheduling only if measurements show a safe win.
5. Establish realistic handoff baselines before changing CSV generation.

The existing `speed-benchmark.test.ts` contains theoretical estimates rather than observed timings. Its current run reports 16 passing checks and one filename-expectation failure (`unknown.pdf` received where `unknown` was expected); that failure is recorded as test debt, not a performance result. The CSV and state-machine suites pass 56 tests.

### Performance non-goals

No speculative micro-optimization, artificial timeout, reduced extraction quality, removed duplicate protection, or payment-automation change.

## Phase 9 Product Review

The final review narrows the product to one trusted golden path: **PDF → review → approve → prepare bookkeeping handoff → export CSV**. The product should make the human feel more certain, not more dependent on the system.

- **Focus:** one next action and one complete AP loop before adjacent breadth.
- **User love:** calm confidence through visible provenance, explicit exceptions, and reversible decisions.
- **Product courage:** keep local processing, human approval, and the no-payment boundary even when they limit the appearance of autonomy.
- **Simplicity:** a first-time operator should understand what Foundry does, what happened, what needs judgment, and what handoff means in under a minute.
- **Evidence:** customer comprehension, production timing, and proof for outcome claims remain prerequisites for expansion.

The full review and evidence gates live in `docs/PRODUCT.md`; the first-use experiment is EXP-011.
