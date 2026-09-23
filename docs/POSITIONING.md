# Foundry — Positioning

Source: April Dunford *Obviously Awesome* canvas + Blue Ocean review (September 2026).
Review score: **4/10** — the architecture commits to a differentiated story, but until this file
nothing was written down, and two of the five critical components are unvalidated hypotheses.
Once the validation tasks below land, re-score (target 9–10).

Evidence rule used throughout: ✅ = verified in shipped code/product · ⚠️ = hypothesis, not yet
validated with a customer · ❌ = missing. A hypothesis stays ⚠️ until an interview or a published
number confirms it.

## Positioning statement (draft)

> For small finance teams who can't send supplier data to yet another cloud, Foundry reads
> invoices entirely on your own machine — and learns every vendor's layout.

## The canvas

| Component | Answer | Evidence |
|---|---|---|
| **Competitive alternatives** | ① Manual keying into Dutch bookkeeping tools (e-Boekhouden, Moneybird, Exact) ② Emailing PDFs to the external accountant ③ Cloud AP automation (Stampli, Dext/Hubdoc, Yuki) ④ Do nothing — a folder of PDFs | ⚠️ no customer interviews yet |
| **Unique attributes** | ① Documents never leave the machine — Tauri desktop, tesseract.js OCR, local vision model, IndexedDB/Tauri-FS, zero cloud AI calls ② Per-vendor layout templates learned locally (~1s re-extraction, drift detection) ③ Every extracted field shown beside the page region it came from | ✅ verified in code — no server dependency in the bundle |
| **Value themes** | ① **Privacy** — IBANs, VAT numbers and supplier data never reach a third party ② **Speed + zero per-document cost** ③ **Control** — human confirms every field with visual provenance and an audit trail | ✅ derived from attributes; theme ① is the one incumbents structurally cannot copy while remaining SaaS |
| **Best-fit customers** | Solo bookkeepers / owner-operators of Dutch SMBs; ~50–500 invoices/month; privacy-conscious; no dedicated AP department | ⚠️ identifiable, unvalidated |
| **Market category** | Subcategory: **local-first invoice processing** — inside the AP-automation frame, with shifted evaluation criteria (see Category decision) | Decision recorded below |
| **Relevant trends** | EU data-sovereignty anxiety; rising per-document cloud-AI pricing; on-device AI finally viable | Tailwind only — never the headline |
| **Positioning statement** | See above | draft |
| **Key proof points** | Internal only: Dutch-invoice benchmark suite (`src/lib/ap/eval` / `dutch-invoice-benchmark.test.ts`), the Playwright-verified Superdoos journey, in-product field provenance | ❌ nothing published — largest gap |
| **Sales narrative** | Problem (AP keying is dead time) → old way (cloud tools ship financial data away) → new way (on-device reading) → proof | draft — cannot finish until proof points are public |
| **Messaging** | Not yet written; must derive from this canvas. The README is still stock boilerplate. | ❌ open (task 7) |

## Category decision

**Chosen: subcategory — "local-first invoice processing"**, positioned inside the existing
AP-automation frame.

| Option | Verdict | Why |
|---|---|---|
| Head-to-head ("the best AP automation tool") | Rejected | Buyers inherit every cloud assumption — integration breadth, enterprise scale, SOC/ISO checkboxes — where Foundry deliberately offers less |
| **Subcategory ("local-first")** | **Chosen** | Buyers understand the frame instantly (it is still invoice processing) while the evaluation criteria shift to what Foundry wins outright: privacy, offline operation, zero per-document cost |
| New category | Rejected | Education tax with no resources to pay it; nobody searches for a category they cannot name |

Test applied: *do prospects get it in the first 30 seconds?* The statement passes — "reads
invoices entirely on your own machine" needs no explanation; "privacy-first AP platform" would.

Why the category holds up under competition (value-cost break): Foundry's cost structure
(Tauri + local models — no servers, no per-page AI fees) *funds* its differentiation, and every
divergent factor is structural rather than policy — an incumbent cannot copy "never leaves the
machine" without ceasing to be SaaS. ERRC summary: **eliminate** cloud upload, per-invoice fees,
payment rail · **reduce** integration breadth, enterprise scale, multi-role workflow · **raise**
field provenance, local template learning, failure transparency · **create** on-device reading,
offline operation, zero marginal cost.

**The strategic bet, stated once:** privacy is the wedge, template-learning is the moat, desktop
is the delivery mechanism. Every roadmap decision serves that sentence or gets cut.

## Open validation tasks

Ordered by what unblocks the most. Tasks 1–3 gate any pricing or heavy feature work.

| # | Task | Why it blocks | Status |
|---|---|---|---|
| 1 | **10–15 customer interviews** across the three tiers of non-customers; bullseye = cloud-AP refusers (Tier 2), who already made the privacy decision Foundry is built for | Best-fit customer, competitive alternatives and value themes are all ⚠️ — the canvas rests on them | open |
| 2 | **Publish the Dutch-invoice accuracy benchmark** that already exists as a test suite | Proof gap #1; answers "is local AI as accurate as cloud?" — the second adoption hurdle | open |
| 3 | **Verifiable privacy claim**: network-isolation demo (full flow with the network off, zero outbound calls) | Turns the core claim from marketing into evidence no competitor can show | open |
| 4 | **Kill the manual Ollama install** — bundle the model or one-click first-run setup | Adoption hurdle #1: setup friction is the Tier-2 conversion blocker | open |
| 5 | **Last-mile export** — bookkeeping-tool-friendly CSV at minimum, so the job ends finished instead of at a handoff marker | Tier 1 will not convert while the flow stops short of their tool | ✅ done — `csv-export.ts` (approved-only, demo-safe) + Export CSV on the Approved tile |
| 6 | **Strategic pricing** — price against the buyer's alternatives (manual-keying hours, cloud per-invoice fees), not against Foundry's costs | Blue Ocean sequence gate 2; undecidable before tasks 1–2 produce evidence | open |
| 7 | **Write the messaging layer** (README, first-run copy, release notes) from this canvas | The system image must match this file; today it matches nothing | open |
| 8 | **Re-score this canvas** in the next positioning review | 4/10 → target 9–10 once tasks 1–3 land | scheduled |

## House rules

- New screen, feature, or line of copy must serve the positioning statement or be cut.
- Trends are tailwind, never the headline.
- No claim ships without an ✅ evidence source; anything else is marked ⚠️ in this file.
- Changes to the unique attributes (what leaves the machine, what is learned locally, what
  provenance is shown) update this file in the same change.
