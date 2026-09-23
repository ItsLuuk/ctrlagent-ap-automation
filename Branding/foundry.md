# Foundry — Design System

> Single source of truth for how **Foundry (the AP application)** looks, speaks, and behaves.
> **[DESIGN.md](DESIGN.md) is the main brand document** — this file records the Ledgerflow
> app adaptation. When a component decision is ambiguous for marketing/brand surfaces,
> resolve it against DESIGN.md first; for in-app screens, resolve against the notes below.
> Colors and tokens live in `src/styles.css` (Tailwind v4 `@theme`); this file
> explains the _why_ and the _rules_.
> Voice & tone details: [brand-voice.md](brand-voice.md).
> Contrast, focus, keyboard and motion requirements: [accessibility.md](accessibility.md).

---

## 1. Branding

- **Product name:** Foundry — always one word, capital F. Never "Foundry AP",
  "foundry" in prose, or an abbreviation. (Renamed from Ledgerflow.)
- **Logo:** the wordmark is set in Open Sauce One, semibold. No
  icon lockup yet; if one is added it must work in light, dark, and midnight.
- **Tagline / framing:** "the calm back office." Foundry reads invoices,
  learns vendor layouts, and moves bills toward payment — the brand promise is
  that the boring part of finance becomes quiet.
- **Voice of the product in UI copy:** [brand-voice.md](brand-voice.md) governs —
  first person plural when the system acts ("we confirmed"), second person when
  asking ("check the amber fields"). Never blame the user; never say "error
  occurred" without saying what to do next.
- **Domain vocabulary:** we say _invoice_, _vendor_, _template_, _draft_,
  _approval_, _payment run_, _exception_. We do not say _bill_, _supplier_,
  _script_, or _AI magic_. One term per concept, always.

## 2. Personality

Foundry is a **precise, calm accountant** — not a hype startup, not an
enterprise mainframe. Type is Open Sauce One throughout (self-hosted,
400/500/600/700); hierarchy comes from size, weight, and tracking — never a
second family, never tracked-out uppercase labels.

| Trait          | Means in practice                                                     | Never                                  |
| -------------- | --------------------------------------------------------------------- | -------------------------------------- |
| Calm           | Neutral surfaces, generous whitespace, no full-screen color floods    | Alarms, pulsing red banners, confetti  |
| Precise        | Money and dates in Open Sauce One with `tabular-nums`                 | Proportional digits in amounts         |
| Honest         | Confidence shown as data (ConfidenceChip), never hidden               | Fake certainty, spinner without status |
| Frugal         | One confirmation click where zero is safe (no double-confirm dialogs) | Redundant confirmation modals          |
| Warm but brief | Toasts celebrate one sentence max; helper text ≤ 2 lines              | Marketing copy inside workflows        |
| Accountable    | Every edit is logged; the audit trail is surfaced, not buried         | Silent data mutation                   |

## 3. Strategic value objective

Every screen must push one of these three value narratives:

1. **Touchless extraction.** Known vendors extract in ~1 second. The draft
   screen's job is to make the _rare_ manual touch fast: fields are always
   editable, one click confirms.
2. **Trust through learning.** Confirming a draft teaches the system. We show
   the learning loop honestly (training wheels, template drift, confidence)
   because the strategic moat is the per-vendor template store.
3. **Fast, safe payment.** The payment handoff exists to move money with zero
   surprises: risk flags are acknowledged, not ignored; SoD and approval state
   are always visible.

**Litmus test:** if a proposed UI element does not reduce touches, increase
trust, or speed a safe payment — cut it.

## 4. UI elements

Layout & structure

- **App shell:** fixed left sidebar (`Shell`), content max width unconstrained,
  sections stack as cards (§5).
- **Page header pattern:** `text-2xl font-semibold tracking-tight` h1 with a
  `size-5` lucide icon, one-line `text-sm text-muted-foreground` subtitle.
- **Section headers:** `SectionHeader` — borderless strip, `text-[19px]
font-semibold` normal-case title (nav-title role). No tracked-out uppercase labels anywhere.

Typography

- **Everything:** Open Sauce One (self-hosted, 400/500/600/700).
  **Financial values:** `.font-mono` with `tabular-nums` — mandatory for
  amounts, invoice numbers, dates in tables, confidence values.
- Scale: `text-2xl` page title · `text-[17px]` card titles · `text-sm` body ·
  `text-xs` labels/meta · `text-[10px]` only for inline chips, never paragraphs.

Controls

- **Buttons:** all `9999px` pills. `default` = Action Blue `#0071e3` fill,
  hover `brightness-110` — one primary action per screen region; `outline` =
  secondary; `ghost` = tertiary/icon. Never two filled buttons side by side.
- **Fields:** always editable where safe (no pencil toggles); 12px radius,
  Steel outline, blue focus ring. Placeholder text states the mapping hint
  ("click the value in the document"). A field that suppresses its focus ring
  must render a replacement state ([accessibility.md](accessibility.md) §2).
- **Dates:** `Calendar` in a `Popover` (`DraftDatePicker` pattern) — never the
  bare native `type="date"` input for user-facing pickers.
- **Status:** `StatusBadge` for pipeline state, `ConfidenceChip` for
  extraction confidence, `ZoneCheckChip` for template cross-checks. Semantic
  color (success/warning/destructive) always travels with its `-foreground`
  pair.
- **Phase-scoped validation:** `validateInvoiceForConfirmation(inv, scope)`.
  Draft confirms vendor/header only — `line_total_mismatch` warns at confirm
  (lines can't be edited there) and errors at approve, where the editable
  `LineItemsList` + reconciliation live. Draft shows a quiet status line,
  never a blocking card.
- **Vendor identity:** `VendorLogo` (master record logo, initials fallback) +
  `vendorEmail` — reuse it; never invent a new avatar treatment.
- **Feedback:** `sonner` toasts; success toasts state the outcome and the
  learning benefit in ≤ 2 sentences. Every correction on the review screen
  writes an audit entry naming the field **and the person who changed it**
  (the acting role for that screen, never a hardcoded default) — nothing
  changes silently.

### The review screen (`For approval`)

A review screen has **one question**: does what the document says match what we
already hold? Four parts, in this order:

1. **Verdict strip** (`ApprovalVerdictStrip`) — one sentence built by
   `buildApprovalVerdict` in `src/lib/ap/approval.ts`, and nothing else. Red when
   something blocks approval, a plain card in every other case: "nothing blocks
   approval" is good news and never wears the warning weight. No counts (the
   sentence already carries the number), no scroll button (the flagged rows are
   marked where they are, and the blocked case acts from the decision bar), and
   no second bar — the read-confidence line is the strip's second line, not a
   strip of its own. It runs while that question is open (Draft, For approval):
   a record that has been decided states the decision instead
   (`DecisionNotice` — who, when, the reason, read out of the trail), because a
   verdict about approving a rejected or already-approved record asks a question
   it has already answered.
2. **Two-column compare** — the document (pinned, `lg:sticky lg:top-2`) beside
   **one** compare list (`ApprovalCompare`). The document is the reference, so it
   stays visible while the list scrolls; pointing at a row highlights its region
   and brings it into view (no smooth scroll under
   `prefers-reduced-motion`).
3. **Record details** — how we read it, the pipeline facts and the audit trail,
   in one collapsed disclosure. Never on screen by default: they answer a
   different question than the one the screen is for.
4. **Decision bar** (`ApprovalDecisionBar`) — pinned to the bottom of the
   viewport (`sticky bottom-0`), carrying the page's action for _every_ status
   (Approve/Query/Reject, Submit for approval, Mark ready for external handoff,
   Reopen as draft). No field sits on the bar: a reason is asked for in a dialog
   at the moment it is required — `query` and `reject` are the steps the state
   machine marks `requiresReason` — and Approve, which needs none, stays one
   click. One action surface per screen, and it
   speaks only for its own controls: a blocked action says so beside the button
   that stays disabled, and never repeats the verdict sentence or the number in
   it — the strip is where that number is said, once.

**Removal is a header action, never a decision-bar one.** `ReviewHeader`
renders `RemoveFromQueue` beside the status capsule, and the control appears
only where the state machine's `archive` rule allows it — Vendor profile, Draft,
Rejected. It is deliberately absent from For approval: a destructive button next
to Approve is a slip away from discarding a record someone signed off.

Nothing is removed by destroying it. Status becomes `archived` (the internal
name; the surface says **Removed**), the record leaves the queue for the
inbox's **Removed** list with its audit trail and its file intact, and it can be
put back where it was — from the toast's Undo, or from Restore in that list. So
there is no confirmation dialog: a confirmation guards an irreversible action,
and this one is reversible. A record wearing `Duplicate risk` reads **Remove
duplicate** and names the twin it matched, in the toast and in the audit note —
the wording and the tag come from the same rule (`duplicatePeer`) and cannot
disagree. **Removed** is not History: History holds invoices that were
completed, Removed holds records you took out of the queue.

**Compare rows.** A row is `label · on the document · what we hold · verdict`:

| Field   | Value                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------- |
| Left    | the value we read, with `p.N`, `ConfidenceChip` and `ZoneCheckChip`                                     |
| Right   | the vendor master record, the PO line, our arithmetic, or `Required before approval` for a header field |
| Verdict | `Pill` — `matches` / `needs a look` / `blocks approval`, or `noted` / `flagged` for evidence rows       |
| Detail  | one plain sentence, only when the row needs a look                                                      |

**Rows block approval only when the state machine refuses the transition.**
`buildApprovalVerdict` derives its blocking rows from
`validateInvoiceForConfirmation(inv, "approve")` and carries the issue code on
the row, so the verdict and the Approve button cannot disagree — the test
`src/lib/ap/approval.test.ts` pins that. Checks we invent (a vendor-record gap, a
IBAN whose own check digits fail, a duplicate-risk flag) are `attention`: worth a
person's eye, never a gate we made up.

**Matching rows collapse; exceptions expand.** A group with anything to look at
hides its matching rows behind `{n} rows match ✓ — expand` and shows the
attention ones first. A group where everything matches shows its rows: that _is_
proof the comparison ran.

The line items and coding stay editable while the content can still change hands
(Draft, For approval) — under the Lines group behind `Correct the line items`,
and inline in the Coding group. Past approval the record is read-only: the same
block is labelled `Show the line items` and holds the amounts and the rows as
facts — no inputs, no `Add item`.

That rule is enforced where it counts, not only where it is drawn: the store
refuses any patch to a frozen record (`isFrozen`), so no screen, job or console
call can change a field an approver signed. The way back is an event — `Re-open`
from approval, `Reopen as draft` from rejection, `Restore` from Removed — each
of which writes who and why into the trail.

Motion

- `transition-colors` on hover states, `duration-300` on step circles,
  `animate-pulse` only for in-progress pipeline connectors. Nothing else moves.
- Every one of those loops needs a `prefers-reduced-motion` variant, and motion
  never carries meaning on its own ([accessibility.md](accessibility.md) §4).

## 5. Cards & widgets

Every app screen is built from four containers: a **card**, a **banner**, a
**chip**, or a **table row**. If a surface needs a new box, it is one of these
with different content — never a new pattern.

### Taxonomy

| Component                     | Job                                                                                     | Radius                                     | Padding                                |
| ----------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| `Section`                     | the standard card wrapper around one group of content                                   | `rounded-lg` (16px)                        | body `p-4`; `p-5` when it holds a form |
| `SectionHeader`               | the card's header strip — 19px/600 title, `text-xs` hint right, optional action         | —                                          | `px-4 py-3`                            |
| `Stat`                        | **the KPI widget** — one number answering one question                                  | see below                                  | `p-5`                                  |
| `InfoBanner`                  | page-level explanation or warning above the content                                     | `rounded-lg`                               | `p-3`                                  |
| `Pill` / `Badge` / chips      | status and metadata at 10–12px                                                          | pill, or 3px left border                   | `px-1.5 py-0.5`                        |
| `EmptyState`                  | the zero-state of a list or queue                                                       | `rounded-xl` + **dashed** hairline         | `p-12`                                 |
| `EmptyState variant="inline"` | the quiet empty **body** of a card that stays because it has a header or totals         | none — it is the body                      | `px-4 py-8`                            |
| Floating surface              | popovers, dropdowns, the dynamic island — anything over the page                        | `rounded-xl` (20px) + hairline             | `p-2`                                  |
| Compare row                   | one line of a review comparison: the document value beside what we hold, then a verdict | none — it is a `ListItem`                  | `px-4 py-3`                            |
| Pinned action bar             | the review screen's decision, always in reach at the viewport bottom                    | none — a full-width strip, hairline on top | `px-6 py-3`                            |

**Radii:** the app uses the Tailwind scale — `rounded-lg` (16px) for cards,
`rounded-xl` (20px) for empty states and KPI tiles, 12px inputs, pill controls.
The named tokens in [design/spacing-shapes.md](design/spacing-shapes.md)
(`--radius-card` 28px, `--radius-float` 20px, `--radius-card-sm` 16px) describe the
marketing surfaces; they carry the same values under different names, so don't
reach for them in the app.

### Padding scale

| Value       | Use                                         |
| ----------- | ------------------------------------------- |
| `p-3`       | banner body                                 |
| `p-4`       | default card body, list rows                |
| `p-5`       | roomy card body — settings forms, KPI tiles |
| `p-12`      | empty state                                 |
| `px-4 py-3` | header strip                                |

`p-6`, `p-8` and `p-10` are not in the scale. Converge them to the nearest value
above rather than letting a third density appear.

### Anatomy

1. Optional header strip (`SectionHeader`), then body, then an optional footer
   split off with `border-t border-border`. The strip carries the same hairline
   beneath it (`border-b border-border`) so the header reads as separate from the
   body; it may sit on a Silk band (`bg-muted/40`) when it heads a table.
2. A card never nests inside a card. A second level of grouping is a Silk band
   (`bg-muted/40`) or a hairline divider inside the existing card.
3. A card holds one subject. Two unrelated subjects are two cards.
4. Two densities of empty state, no third: the **card** variant replaces the
   whole container (dashed hairline, `p-12`, title + the trigger sentence that
   says what makes it fill in), and the **inline** variant is the quiet body of a
   card that stays because it has a header or totals. Spacing above either one
   belongs to the page, not to the component.

### When a card needs a hairline

Measured tonal separation between `--card` and `--background`:

| Mode       | Card vs canvas                     | Verdict               |
| ---------- | ---------------------------------- | --------------------- |
| Light      | `#ffffff` vs `#ffffff` = **1.000** | no separation at all  |
| Dark Stage | `#1d1d1f` vs `#000000` = **1.248** | subtle, and enough    |
| Midnight   | `#05010d` vs `#0d0021` = **1.022** | effectively invisible |

A card is separated by **exactly one** of these, in order of preference:

1. **A Silk band behind it** — `--muted` `#f5f5f7` on light, worth 1.089 against the
   canvas and read as a section boundary.
2. **A 1px `--border` hairline** — `#d2d2d7` on light, `rgba(255,255,255,0.08)` in
   Midnight. Dashed is this hairline's empty-state variant, nothing else.
3. **Nothing** — legal **only on Dark Stage**, where the card's own 1.248 delta
   carries it.

Never both a band and a hairline. Never a shadow: app surfaces stay flat
([design/spacing-shapes.md](design/spacing-shapes.md)). A white card on a white
canvas with no hairline is not "flat by default", it is invisible.

A **floating** surface (popover, dropdown, island) is the one case that sits over
content instead of on the canvas, so it takes the hairline as well — never a
shadow. The dynamic island is the one dark chrome: `bg-sidebar` on light, where
the page is white, and `dark:bg-card` on Dark Stage, where the card's own 1.248
delta against black carries it.

### The KPI widget (`Stat`)

One widget, four rules:

- **Anatomy is always label / value / hint**, in that order — a hint is required
  unless the label carries the unit.
- **Label** `text-xs font-medium text-muted-foreground` · **value**
  `font-mono text-2xl font-semibold tabular-nums` · **hint** `text-xs text-muted-foreground`.
  Mono with tabular numerals is mandatory for money and counts — never proportional
  digits (§2 Personality). The value stays at `text-2xl`: it must **not** outrank
  the page title, which is also `text-2xl` (`PageHeader`).
- **Spacing:** `mt-3` label→value, `mt-2` value→hint.
- **Band:** `grid gap-3 sm:grid-cols-2 lg:grid-cols-4`, tiles in the same order as
  the narrative reads. At most one tile per band may take the accent wash
  (`bg-primary/10`) — the metric that needs action. Never a second chromatic fill.

**Card grids** are allowed in the app for _equal-weight records_ only (the vendor
and template lists). A dashboard of mixed content — a metric, a chart and a list —
never becomes three cards.

### Converged

Each row was a real divergence; the code now ships the rules above.

| Where                                                                         | Was                                                                                                              | Now                                                      |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `index.tsx` KPI band                                                          | a local `Stat` on `.ios-card-flat` at `text-3xl`, and a separate `MetricCard` at `p-4`/`text-sm`                 | the band calls the shared `Stat` — one widget, one scale |
| `primitives.tsx` `Stat`                                                       | no hint, `text-sm` value                                                                                         | label / value / hint, `text-2xl` mono                    |
| `invoices.$id.tsx`                                                            | a second `SectionHeader` defined in the route, 12px titles                                                       | one `SectionHeader` from `primitives.tsx`                |
| 21 ad-hoc card containers                                                     | `rounded-xl bg-card` with no hairline on the white canvas                                                        | `rounded-lg` + `border border-border` (`Section`)        |
| `payments`, `invoices.$id`, `vendors`, `templates`, `exceptions` empty states | three densities — plain `p-12`, dashed with `mt-8` baked in, a bare `p-10`                                       | one `EmptyState`, two documented variants                |
| `line-items-list.tsx`                                                         | its own 14px-circle empty block inside the Line items card                                                       | `EmptyState variant="inline"`                            |
| `styles.css`                                                                  | `.ios-card`, `.ios-card-flat`, `.ios-island`, `.ios-metric`, `.ios-progress`, `.ios-progress-fill`, `.ios-badge` | deleted; the island is `bg-sidebar` / `dark:bg-card`     |

**Still open:** `PageHeader` exists twice — `page-header.tsx` (`icon`/`actions`, used by
the routes) and `primitives.tsx` (`backLink`/`controls`, used by settings). One of
them should absorb the other; the KPI rule that the value stays at `text-2xl` is
relative to that `h1`, so the two implementations are coupled.

The inline sub-strips (`px-4 py-2.5`, `text-xs` title + counter) inside
`draft-mapper`, `line-items-editor`, `vendor-profile-card` and `invoices.$id`
are the _second_ tier — a header for a table or sub-panel within a
card, not a card header. They are deliberately not `SectionHeader`; if a third
variant of them appears, give the tier a name instead of another inline class
string.

## 6. Colors

All colors are Foundry hex tokens in `src/styles.css` — never raw Tailwind
palette classes (`bg-emerald-500` is a bug).

| Token                 | Light                            | Role                                                                                                                                          |
| --------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `background`          | `#ffffff`                        | App canvas — white                                                                                                                            |
| `card` / `popover`    | `#ffffff`                        | Surfaces                                                                                                                                      |
| `foreground`          | `#1d1d1f` Ink                    | Primary text                                                                                                                                  |
| `primary`             | `#0071e3`                        | The single filled CTA color + focus ring                                                                                                      |
| `muted` / `secondary` | `#f5f5f7` Silk                   | Alternate bands and secondary surfaces                                                                                                        |
| `muted-foreground`    | `#6e6e73` Slate                  | Secondary text on light                                                                                                                       |
| `accent`              | `#e8f1fd`                        | Light-blue highlight wash, never a fill                                                                                                       |
| `success`             | `#34c759`                        | Category/display use only (≥24px on light — 2.22 as small text). Verified signaling = ink `✓` + foreground words, never green text            |
| `warning`             | `#f7be00`                        | Download + display use. Small attention text = foreground words + Foundry Orange accents; `warning-foreground` where amber-ink text is needed |
| `destructive`         | `#d92d20`                        | Alert Red — functional status only                                                                                                            |
| `info`                | `#0071e3`                        | Neutral informational accents                                                                                                                 |
| `border`              | `#d2d2d7` Hairline               | 1px dividers and control outlines                                                                                                             |
| `input`               | `#86868b` Steel                  | Control outlines                                                                                                                              |
| `foundry-orange`      | `#f56900`                        | Category eyebrows, launch labels — text only                                                                                                  |
| `foundry-link`        | `#0066cc` light / `#2997ff` dark | Text links only, never fills                                                                                                                  |

Rules

1. **One filled chromatic button per viewport.** Action Blue fill only.
   Orange/amber/green never fill buttons.
2. **Category color at body scale only.** Orange/green/magenta/violet/teal
   appear as text or 1–3px left-border accents — never backgrounds.
3. **Alert Red is reserved.** Cancellations, critical delays, blocking
   validation — never decorative.
4. **Three surface modes.** Light gallery (default) · Dark Stage (`#000` /
   `#1d1d1f`, Steel secondary) · Midnight (`#0d0021` / `#05010d`).
   Same meaning per token in every mode.
5. **Flat by default.** Elevation from surface contrast and hairlines;
   shadows only on floating UI.
6. **Status without hue.** Verified = ink `✓` + foreground words; needs-attention
   = foreground words + Foundry Orange text (≥16px) or 3px left border; blocked =
   Alert Red. Green/amber hues never carry small-text meaning on light (2.22/1.70).

## Implementation status

Foundry adaptation applied: Action Blue `#0071e3` primary, pill buttons
(`9999px`, brightness-110 hover), 16px small cards / 20px floating cards /
12px inputs, Steel hairlines, tabular numerals on `.font-mono`, semantic
success/warning/destructive tokens (no raw palette classes), normal-case
19px card titles, bare-text pills with 3px left-border status badges, Silk
surfaces, Light / Dark Stage / Midnight modes (switch in Settings), and
self-hosted Open Sauce One (400/500/600/700).
Draft owns vendor/header (Subtotal + Tax paired); approval owns line-item
content checking with a blocking reconciliation gate.

Remaining product work is tracked in [archive/rework-plan.md](archive/rework-plan.md) (Volt-era, history only), especially saved
inbox views, dedicated vendor workspace, richer approval evidence, controlled
payment review, template learning metrics, and mobile navigation.

Accessibility is specified in [accessibility.md](accessibility.md) — contrast minimums,
focus visibility, keyboard and reduced motion — together with the verified list of
places the current code misses them. That list is the apply-first work, ahead of the
items above.

## Known debt (apply-first list)

1. ~~Vendor identity reuse~~ ✅ `VendorLogo` / `VendorProfile` everywhere.
2. ~~Standardize page headers~~ ✅ `PageHeader` component used by every route.
3. ~~Brand palette and typography~~ ✅ Foundry tokens, Open Sauce One, and
   blue pill primary actions applied globally.
4. ~~Dark + midnight modes~~ ✅ `.dark` (Dark Stage) and `.midnight` token
   sets with a Settings switch.
5. `text-[10px]` audit — chips only; promote any paragraph-scale uses to
   `text-xs`.
