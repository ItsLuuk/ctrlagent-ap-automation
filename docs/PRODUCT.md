# Foundry — Product Review

## North Star

> **Foundry turns a PDF invoice into a trustworthy, bookkeeping-ready record while keeping the human in control.**

The product is not an autonomous AP company. It handles the routine work of extraction, reconciliation, approval context, and bookkeeping handoff while preserving human judgment and an explicit no-payment boundary.

## The Golden Path

1. Capture a PDF or image locally.
2. See extracted fields beside their source regions.
3. Resolve only the exceptions that need judgment.
4. Approve the record.
5. Prepare the bookkeeping handoff.
6. Export a CSV for the user’s bookkeeping tool.
7. Keep the artifact, reason, and audit trail with the record.

This path is the next product milestone. It is more valuable than adding adjacent AP capabilities before this loop is trusted and repeatable.

## Product Principles

- **One next action:** every state names the safest next step.
- **Evidence over assertion:** show where a value came from and what remains uncertain.
- **Control without ceremony:** preserve human approval, re-open, remove, and restore without making routine work heavy.
- **Local by architecture:** privacy is a product behavior, not a marketing claim.
- **No silent completion:** processing, failure, export, and payment boundaries stay explicit.
- **Depth before breadth:** improve the golden path before adding adjacent AP capabilities.

## What the Product Is For

When invoices arrive, a finance operator should be able to turn documents into defensible payable records without manually rekeying routine data, losing the source of a value, or sending invoice data to a cloud service. The user approves the record and decides what happens next; Foundry does not send a payment.

This is a product hypothesis grounded in internal product observation. Target-finance-user validation is still required.

## What to Keep

- Local invoice processing and storage.
- Field provenance and document comparison.
- Explicit exceptions and blocked states.
- Human approval and reasoned re-open.
- Approved-only CSV handoff.
- A calm queue organized around what needs judgment.

## What to Cut or Subordinate

- “Fully automated AP” as an unqualified headline; the shipped product does not execute payments or remove human approval.
- Payment, ERP-sync, and enterprise-workflow breadth until the golden path is proven.
- Competing lifecycle vocabulary across queue and detail surfaces.
- Secondary queue metrics and navigation that compete with the one next action.
- Accuracy, time-saving, and fraud-prevention claims without published evidence.

## The Love Test

Users should feel more certain after using Foundry, not more dependent on it. The desired feeling is calm confidence: routine work moves forward, uncertainty is visible, and the user can defend the record later.

The product earns affection by being legible and reversible, not by sounding more autonomous.

## The Courage Test

Foundry’s boldest choice is refusing to trade away invoice data, human judgment, or the payment boundary to look more automated. That choice should be defended with evidence, not louder claims.

The product should say plainly what it does not do. A trustworthy boundary is more valuable than an impressive but ambiguous promise.

## The Simplicity Test

A first-time operator should be able to answer four questions in under a minute:

1. What does Foundry do?
2. What happened to this invoice?
3. What needs my judgment?
4. What happens when I hand it off?

If the product cannot answer those questions on one screen and one next action, more capability will not rescue it.

## Evidence Gates Before Expanding

- At least one target-finance-user validation of the golden path.
- Handoff and no-payment comprehension equivalent to EXP-001/EXP-004.
- Target-user comparison of the new promise against the prior local-first statement in EXP-005.
- Production Tauri timing baseline from EXP-006.
- Published or demonstrable proof for any accuracy, speed, privacy, or fraud-related outcome claim.

## Final Recommendation

**Focus, simplify, and prove the golden path.** Do not expand the AP surface until a finance user can complete, understand, and trust the first loop enough to repeat it.
