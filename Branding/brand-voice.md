# Foundry — Brand Voice & Personality

> **Scope:** who Foundry is, how it speaks, and how it shows up in words and imagery.
> **This file does not define design tokens.** Colors → [DESIGN.md](DESIGN.md) + [design/colors.md](design/colors.md). Type → [design/typography.md](design/typography.md). In-app UI rules → [foundry.md](foundry.md).

*Autonomous finance operations for growing businesses*

## 1. Brand Foundation

### Brand Essence
> **"Your finance team, promoted."**

The system is the executor. The human is the manager. Foundry is the interface between them.

### Positioning Statement
For growing businesses drowning in invoice processing, Foundry is the autonomous finance operations platform that learns every vendor and compounds in accuracy — unlike legacy accounting software that merely digitizes manual work, or modern tools that automate without transparency. Because every decision is explainable and the hands-off rate visibly improves every month, our customers go from a team of executors to one person managing the system.

### Brand Pillars

| Pillar | What it means | How it shows up |
|---|---|---|
| **Compounding accuracy** | Gets measurably better every month | The rising hands-off chart as hero asset |
| **Radical transparency** | Every decision traceable to source | "Click any number, see where it came from" |
| **Autonomous, not reckless** | Full speed with full controls | Exception-first UX; never silently fails |
| **Human at the top** | People manage, systems execute | Tone that talks *to* a manager, not a clerk |

### Tagline

**"You manage. It executes."**

Candidates that lost the cut (kept for campaigns that need a softer register):
- "The work does itself."
- "Finance that gets smarter every month."

## 2. Brand Personality

Foundry has one personality expressed on two surfaces. The traits below are the *brand*; the in-app trait table in [foundry.md](foundry.md) §Personality is how they land inside the product. If a trait seems to conflict, the underlying value wins — they are the same person.

| Trait | Means | Never |
|---|---|---|
| **Confident, not arrogant** | We say "90% of invoices need zero human touch" with a chart behind it, not an exclamation point | Hype, superlatives, exclamation marks |
| **Precise, not pedantic** | Finance people hate fluff. Every claim is measurable | Vague adjectives, hedging, jargon walls |
| **Ambitious, but grounded** | We're building the future, but we talk about month one results | "Revolutionary", "disrupting", sci-fi framing |
| **Calm, not exciting** | Money software should lower your heart rate | Urgency theater, countdowns, alarms |
| **Honest about uncertainty** | Confidence is shown as a number, doubt is shown as a question | Fake certainty, hidden failure states |

## 3. Voice & Tone

| Situation | Do | Don't |
|---|---|---|
| Explaining autonomy | "The system handles the routine. You handle the judgment." | "Revolutionary AI-powered transformation!" |
| Talking about errors | "When we're unsure, we ask — never guess silently." | "99.9% accurate!!!" |
| Describing the future | "In month six, you'll wonder what changed. That's the point." | "Disrupting finance forever" |
| Onboarding | "Your first invoice teaches us. Every one after that teaches us less." | Long feature lists |
| Success moments | "This vendor is now fully automated. You won't see them again unless something's wrong." | Confetti and gamification clichés |
| Nothing to show yet | "Nothing needs your judgment." + "Failed syncs and held invoices will appear here with a next action." | "No data available." |
| Partial failure | "PDF preview failed to render — the extracted fields below are unaffected." | "Something went wrong." |

**Grammar & mechanics**
- First person plural when the system acts ("we confirmed", "we flagged"); second person when asking ("check the amber fields").
- Present tense, active voice. Short sentences win ties.
- Numbers as numerals with currency, always: "€2,340.00", never "over two thousand euros".
- No exclamation points anywhere in product or marketing copy.

### Before / after — real product strings

Rewrites of strings that ship in the app (file references included). The "before" is the generic SaaS-speak version of the same moment — the reflex to avoid.

**1. Upload succeeded** · `src/components/ap/upload-dialog.tsx`
- ❌ Before: "🎉 Upload complete! Your invoice has been successfully processed by our AI!"
- ✅ After (shipped): "Invoice captured" + "{vendor} — review the extracted fields before submitting."
- Why: names the outcome in a plain verb, then asks the manager to do the one thing only they can do. No celebration, no AI framing.

**2. Document couldn't be read** · `src/components/ap/upload-dialog.tsx`, `src/lib/ap/upload-jobs.tsx`
- ❌ Before: "Error: An unexpected error occurred while processing your document (E-422)."
- ✅ After (shipped): "We couldn't read this document" + a "Review manually" path that opens the invoice for manual entry.
- Why: owns the failure in first person, no blame, and every dead end comes with a next step.

**3. Payment release blocked** · `src/routes/payments.tsx`
- ❌ Before: "Cannot release payment! Please acknowledge all risk flags before proceeding."
- ✅ After (shipped): "2 invoices still have unacknowledged risk flags — expand the flagged rows first."
- Why: states the concrete count and the exact action; no exclamation point, no pleading.

**4. Background processing** · `src/components/ap/upload-dialog.tsx`
- ❌ Before: "Your document is being processed by our revolutionary AI engine. Sit tight!"
- ✅ After (shipped): "Processing in the background" + "{file.name} — we'll notify you when fields are ready to review."
- Why: sets an expectation and keeps it honest. The system is not the hero; the ready-to-review moment is.

**5. Sync result** · `src/routes/exceptions.tsx`
- ❌ Before: "Sync successful ✅"
- ✅ After (shipped): "{vendor}: local sync simulation completed — no ERP record was created"
- Why: "successful" claims more than happened. Transparency about what did *not* occur is the trust pillar, not a caveat.

**6. Stage label** · `src/components/ap/processing-badge.tsx`
- ❌ Before: "Performing OCR + NLP pipeline inference"
- ✅ After (shipped): "Matching vendor template" / "Finalizing"
- Why: user-facing stages describe what's happening to *their invoice*, not our architecture. Jargon like "Layout OCR" is acceptable only in dev-facing logs, not labels.

### Before / after — empty states

Every queue, table and list has a zero state. It is not a gap to apologise for or a chance to celebrate — it is the calm default, and often the product's best proof: "Nothing needs your judgment" means the system is doing its job.

**7. Exception queue empty** · `src/routes/exceptions.tsx`
- ❌ Before: "No data available. There are no items to display."
- ✅ After (shipped): "Nothing needs your judgment." + "Failed syncs and held invoices will appear here with a next action."
- Why: turns an empty table into a status report, then names the trigger that would fill it — so the user knows the emptiness is real and not a loading bug.

**8. Invoice inbox, first run** · `src/routes/index.tsx`
- ❌ Before: "You don't have any invoices yet! Get started by clicking the button above."
- ✅ After (shipped): "Nothing needs your attention." + "Upload an invoice and Foundry will handle the routine extraction."
- Why: no exclamation point, no pointing at a button that describes itself. The second line states what the system does, not what the user forgot to do.

**9. Vendors list empty** · `src/routes/vendors.tsx`
- ❌ Before: "No vendors found."
- ✅ After (shipped): "No vendors yet" + "Vendors appear here as soon as an invoice is uploaded or paid."
- Why: names the condition that creates the first row. "Yet" carries the optimism; no adjective needed.

**Rules for empty states**
- Say what *will* appear here and what makes it appear — never just "No data".
- Empty is not an error and not a win. No apology, no confetti, no emoji.
- One action at most, and only if the user can take it right now (`Add first item`, `Back to invoice inbox`).
- A table row's empty state may be one line ("Nothing has been completed yet."); a full-page one gets title + trigger + action.

### Before / after — error banners

An error banner is the most trust-sensitive string in the product. It is read twice: once by someone worried about what broke, once by an auditor months later.

**10. Low-confidence fields** · `src/routes/invoices.$id.tsx`
- ❌ Before: "Warning: some fields may be inaccurate. Please review the document."
- ✅ After (shipped): "9 fields read with low confidence — check the highlighted values against the document."
- Why: a count and a location turn "may be inaccurate" into a work list the user can actually finish.

**11. Partial failure — preview broke, data didn't** · `src/components/ap/draft-mapper.tsx`
- ❌ Before: "PDF preview failed. Something went wrong."
- ✅ After (shipped): "PDF preview failed to render — the extracted fields below are unaffected." / "Document preview unavailable — mapping overlay needs a supported file type. Fields can still be confirmed from the list."
- Why: states the blast radius. Naming what still works is what stops a preview bug from reading like data loss.

**12. Blocked progress** · `src/components/ap/draft-mapper.tsx`
- ❌ Before: "Validation failed. Cannot submit the invoice."
- ✅ After (shipped): "3 issues must be fixed" + one line per issue + button `Review next issue` (falls back to "Confirm invoice" once clear)
- Why: a count, a specific cause, and a button that walks the user to the first problem instead of telling them they're stuck.

**Rules for error banners**
- First person plural for what we tried — "we couldn't read this document", "we held 2 invoices". Never "Invalid input", never "Failed."
- Always state the blast radius — what still works alongside what doesn't.
- Every banner ends in an action, or an explicit statement that none is needed. "Contact support" without a route to it is a dead end dressed as an action.
- When the system has no cause to show, it says so instead of inventing one: "The sync failed without a reason — retry it, then report the problem."
- Count and locate: "3 issues must be fixed", "expand the flagged rows first". Never "some fields" or "a problem".
- No error codes, no "Oops", no emoji, no apology theater. An explanation and a next step replace the apology.
- Reversible and informational situations are amber and say what is preserved: "This vendor already has a template (v4). Confirming updates it — the previous version stays in the audit trail." Red stays functional status — a blocked action or a failed state — never a nudge ([design/colors.md](design/colors.md)).

## 4. Domain Vocabulary

One term per concept. Consistency is the brand. Every row was checked against the strings that ship — where this table and the product disagreed, the product's term won and the outliers were fixed in code.

The table is enforced, not just documented: `src/lib/ap/vocabulary.ts` holds the same synonyms in `BANNED_SYNONYMS` and its guard test fails the suite when user-facing copy uses one. Change a term here and in that module in the same commit.

| We say | We never say | Ships as |
|---|---|---|
| invoice | bill | "Invoice inbox", "Upload an invoice" |
| vendor | supplier, payee, merchant | "Vendor templates", "Vendor email" |
| template | script, macro, rule | "Matching vendor template" |
| draft | pending item, work in progress | status `Draft` |
| approval | sign-off, authorization | "For approval", "Not allowed for your role" |
| handoff | payment run, batch payment, disbursement | "Ready for handoff", "Mark ready for external handoff" |
| exception | anomaly, incident | "Exceptions", "exception queue is clean" |
| issue | blocker, validation failure | "3 issues must be fixed", "Review next issue" |
| confidence | score, AI certainty, accuracy | "Low confidence — check against the document" |
| coding | categorization, class, tagging | "Coding", "Choose a GL account or department" |
| queue | backlog, worklist | "Work queue", "leave the queue" |

**Invoice vs document.** The uploaded file is a *document* ("we couldn't read this document", "check against the document"); the record it becomes is an *invoice*. Two words, two things — the distinction is what lets an error be about the file without sounding like it is about the money.

**Exception vs issue.** An *exception* is a queue entry — a sync failed, an invoice is held, a purchase order is missing. An *issue* is what blocks confirming one draft — a missing total, an unverified field. The queue is where exceptions wait; the draft screen counts issues.

**Problem** is reserved for the user reporting trouble with their own document (`Report problem`). It never describes something Foundry failed at — that is "we couldn't read this document".

**Error** is never a label. Name what failed: "sync failed", "we couldn't read this document". The same goes for "Oops" and every exclamation point.

We do not say *AI magic*, *smart*, *intelligent*, or *seamless*. If the system did something, name the thing it did.

**This table governs copy, not code.** Identifiers may use other words on purpose: the ERP sync kind is literally `"bill"` (`SyncKind`, `syncState.bill`) because that is the ERP's vocabulary, and extraction patterns must match "supplier"/"leverancier" to find the vendor at all. Grep hits in types, comments, prompts or regexes are not violations — only strings a user can read.

**Internal names that never surface.** `scheduled` displays as "Ready for handoff"; `zone`/`ZONE_*` displays as field positions; pipeline stages (`layout ocr`, `ai reading`) display as "Reading page layout" / "Reading document" via `STAGE_LABEL` in `src/lib/ap/types.ts`. **How the invoice was read** says what happened to the document — "Read from this vendor's template", "Read from the document text" — never the engine behind it (`Vision model`, `AI vision`, `Text reader`). If an identifier reaches the screen unmapped, that is a bug, not a vocabulary choice.

## 5. Imagery Direction

- **People as *managers*** — one person, calm, in control, often with the product visible. Never rows of clerks doing data entry. Never stock-photo handshakes.
- **The system visualized** — abstract, precise, technical. Thin line-work on light surfaces with a single accent element showing "the flow completing itself." Architectural drawings, not sci-fi AI brains.
- **Data as hero** — charts showing the hands-off rate rising over time, rendered in the brand palette, are brand assets. Use them as proof, not decoration.
- **Avoid** — robot imagery, glowing neural networks, "money flying," generic office stock.

## 6. Do's & Don'ts — Language Quick Reference

✅ **Do**
- Speak in measurable, confident, human-first language
- Lead with the metric ("DPO down 40%"), follow with the mechanism
- Name what the system did in plain verbs: "matched", "learned", "flagged", "paid"
- Let charts carry claims — a number with a source beats any adjective
- Give every empty state a trigger sentence and every error a next step (see the before/after sections above)
- Use the canonical term from §4, including the distinction between an *exception* (waits in the queue) and an *issue* (blocks one draft)

❌ **Don't**
- Use exclamation points, "revolutionary", "game-changing", "seamless"
- Personify the system beyond "we" — it is not your "AI colleague" with feelings
- Use robot/AI-brain clichés in imagery
- Ship "No data available.", "Something went wrong.", "Invalid input.", or an error code as the whole message
- Invent a second word for a concept that already has one — "payment run" for handoff, "score" for confidence, "supplier" for vendor
- Train users that the brand accent means "look here!" in one context and "everything's fine" in another (color = status, strictly)
