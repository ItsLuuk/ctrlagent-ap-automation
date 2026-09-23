# Ledgerflow Brand Rework Plan

> ⛔ SUPERSEDED & ARCHIVED — Volt/Forest-era plan. Do not apply.
> Truth now: [Branding/DESIGN.md](../DESIGN.md) (hub) + [Branding/design/](../design/principles.md)
> (Foundry topics) + [Branding/foundry.md](../foundry.md) (in-app rules).
> Kept for history only.

> Implementation status: Phases 0–2 are substantially implemented; later workflow
> enhancements remain planned. The source of truth is `Branding.md`; `DESIGN.md`
> records the implemented product design system and should be updated as each phase ships.

## Guiding objective

Make Ledgerflow feel like **the finance team, promoted**: the system executes routine
work, the human manages judgment, and every automated decision is measurable,
explainable, and safe.

## Non-negotiable brand rules

- Product name remains **Ledgerflow** in the application.
- Use **Forest** for primary ink, structural surfaces, navigation, and dark mode.
- Use **Volt** sparingly for primary actions, auto-verified states, active pipeline
  states, and the logo mark. Volt is a signal, not decoration.
- Use **Amber** only for review/exception states, **red** only for blocked or failed
  states, and **blue** only for neutral information.
- Use **Space Grotesk** for display headings and **Inter** for UI/body copy.
- Use **IBM Plex Mono** for amounts, dates, invoice numbers, and confidence values.
- Prefer measurable, calm copy: no hype, exclamation points, fake certainty, or
  unexplained automation claims.
- Reduce touches: fields should be directly editable, confirmations should be single
  action, and system uncertainty should lead to a useful next action.

---

## Phase 0 — Baseline and cleanup

### 0.1 Audit the current application

- Inventory every route, shared component, status chip, button variant, empty state,
  toast, dialog, table, and form control.
- Identify hard-coded colors, generic palette classes, inconsistent shadows, and
  one-off typography classes.
- Identify duplicate components for vendor identity, page headers, status, confidence,
  dates, monetary values, and primary actions.
- Capture representative light and dark screenshots for visual comparison.
- Confirm which features are demo-only versus intended product behavior.

### 0.2 Establish design tokens and primitives

- Add explicit brand tokens for Volt, Forest, warm surfaces, muted green text, borders,
  and semantic statuses.
- Add reusable primitives where repetition exists:
  - `PageHeader`
  - `VendorLogo` / `VendorProfile`
  - `MoneyValue`
  - `DateValue` / date picker
  - `StatusBadge`
  - `ConfidenceChip`
  - `EmptyState`
  - `PrimaryAction`
- Define a consistent card, table, dialog, input, and spacing vocabulary.
- Ensure dark mode is a true Forest/Volt theme rather than an independent blue-gray
  palette.

**Exit criteria:** all shared primitives use tokens, no critical route depends on raw
brand colors, and light/dark screenshots have consistent hierarchy.

---

## Phase 1 — Highest-impact visual rework

### 1.1 Shell and navigation

- Rework the shell as the brand anchor:
  - Volt mark + Forest wordmark pairing.
  - Clear active route state.
  - Navigation grouped around the operating loop: Inbox, Exceptions, Approvals,
    Payments, Vendors, Templates, Analytics, History.
  - Make demo/local status visible but visually subordinate.
- Add a first-class light/dark theme toggle and persist the preference.
- Improve responsive navigation for smaller screens.
- Replace generic user/avatar treatment with a calm manager identity pattern.

### 1.2 Page headers and page hierarchy

- Apply one header system to every route using icon, title, subtitle, and optional
  action.
- Make the primary action obvious per page and remove competing filled actions.
- Rewrite subtitles to communicate operational value, not feature descriptions.
- Use display typography for page titles and mono typography only for financial data.

### 1.3 Core surfaces

- Rework cards and tables to use Forest-derived text, warm surfaces, restrained
  borders, and minimal shadows.
- Increase whitespace around key decisions while keeping dense data tables efficient.
- Standardize row hover, selected, expanded, and disabled states.
- Make empty states actionable and calm: explain what happens next.
- Remove decorative color washes that do not communicate status.

### 1.4 Status and automation signals

- Make Volt consistently mean verified/automated.
- Make Amber consistently mean human review required.
- Make red consistently mean blocked/failed.
- Improve status labels so they explain the consequence and next action.
- Replace ambiguous spinners with processing labels and progress context.
- Show automation confidence and source traceability near the affected field.

**Exit criteria:** the first screen a user sees communicates “system executes, human
manages” within seconds, and the same status colors mean the same thing everywhere.

---

## Phase 2 — Feature and workflow rework

### 2.1 Bill inbox: manage exceptions, not data entry

- Reframe the inbox around work requiring judgment:
  - “Needs your attention” section first.
  - “Ready for approval” section second.
  - Automatically handled invoices collapsed or visually quiet.
- Add clear filters for status, confidence, vendor, due date, amount, and exception
  type.
- Add saved views such as “Today”, “Low confidence”, “Overdue”, and “First-time
  vendors”.
- Use vendor logos and confidence signals in every row.
- Make bulk actions safe and explicit, with an audit note for each affected invoice.

### 2.2 Draft extraction review

- Keep all extracted fields directly editable.
- Put issue date and due date together with the improved calendar picker.
- Show extraction source, confidence, and template agreement inline.
- Make the “map from document” interaction obvious but never block direct editing.
- Make the confirm action a single primary action with blocking issues surfaced above it.
- Rewrite training-wheel and template-drift copy around compounding accuracy:
  “This confirmation teaches Ledgerflow where this vendor puts the value.”
- Add a concise “what Ledgerflow learned” summary before confirmation.

### 2.3 Vendor master and vendor workspace

- Promote the vendor master record to a first-class domain object:
  - Name
  - Billing/contact email
  - Logo
  - Vendor aliases
  - Invoice count and spend
  - Automation rate
  - Last extraction confidence
  - Template version and drift history
- Add a dedicated vendor detail route.
- Allow vendor edits from the profile menu and vendor workspace.
- Cascade vendor renames safely to invoices, history, templates, and analytics.
- Add vendor-specific recent invoices, exceptions, and automation trend.
- Use the same `VendorProfile` and `VendorLogo` patterns everywhere.

### 2.4 Approval experience

- Make the approval card decision-led:
  - Vendor profile and amount at the top.
  - Match result and exceptions next.
  - Evidence/source links close to each concern.
  - Approve, query, and reject actions grouped by risk.
- Use Volt for the safe approve action, not for generic decoration.
- Add an explicit “why this is safe” summary for matched invoices.
- Make query/rejection reasons structured and auditable.
- Show segregation-of-duties and approval policy status before action.

### 2.5 Payment handoff

- Reframe the payment page as a controlled batch operation:
  - Batch total and vendor count at the top.
  - Risk and sync readiness before selection.
  - Clear “ready”, “held”, and “blocked” groupings.
- Add a pre-submit review step that is informative, not a redundant confirmation
  dialog.
- Use vendor identity consistently in payment rows.
- Make external payment connectivity status explicit and non-alarming when it is
  simply unavailable in the demo.
- Show an audit-ready handoff summary after simulation.

### 2.6 Exceptions

- Make the exceptions route the operational command center for uncertainty.
- Group by action: missing data, low confidence, PO mismatch, sync failure, template
  drift.
- Each exception row should state:
  - What is wrong
  - Why it matters
  - What the user can do
  - What will happen after the action
- Add “resolve and continue” actions where safe.
- Keep red reserved for genuinely blocked work; use Amber for reviewable work.

### 2.7 Vendor templates and learning loop

- Rename/template copy should emphasize learning and compounding accuracy.
- Show template confidence, version, last confirmed date, drift status, and invoices
  processed automatically.
- Add a visual “before vs after” learning summary.
- Make template rollback and drift recovery explicit.
- Show the hands-off rate as the primary success metric.

### 2.8 Analytics

- Make the rising hands-off rate the hero metric.
- Add metrics that support the brand promise:
  - Hands-off rate over time
  - First-pass extraction accuracy
  - Human touches per invoice
  - Exception rate
  - Approval cycle time
  - Vendor automation coverage
  - Payment readiness and sync health
- Use Volt only for improvement/automation lines; use Amber/red for exceptions and
  failures.
- Make every metric drillable to the invoices or vendors behind it.
- Replace generic chart decoration with clear proof-oriented annotations.

---

## Phase 3 — Copy and content rework

### 3.1 Product vocabulary

- Standardize on invoice, vendor, template, draft, approval, payment run, and
  exception.
- Remove inconsistent uses of bill, supplier, script, or vague AI terminology.
- Use “Ledgerflow” when the system acts and “you” when asking the manager to decide.

### 3.2 Copy pass across the application

- Replace technical or implementation-oriented text with user-facing operational
  language.
- Rewrite all toasts to state outcome + next implication in one or two sentences.
- Rewrite errors to state cause + recovery action.
- Remove exclamation points and hype terms.
- Ensure every automation claim is measurable or qualified.
- Make first-use and empty-state copy explain the compounding learning loop.

### 3.3 Marketing-facing product moments

- Add a restrained, proof-oriented automation summary to the inbox and analytics
  pages.
- Surface “This vendor is now automated” moments without gamification or confetti.
- Use the brand line “You manage. It executes.” only in appropriate onboarding or
  high-level product framing, not repeatedly in operational UI.

---

## Phase 4 — Accessibility, trust, and quality

- Verify Volt/Forest, Forest/Surface, warning, info, and destructive contrast in both
  themes.
- Never use Volt text on a light background without a high-contrast backing.
- Ensure status meaning is never conveyed by color alone; include labels/icons.
- Add keyboard and focus-state coverage for menus, calendars, dialogs, tables, and
  bulk actions.
- Ensure all vendor logos have useful empty/image-failure fallbacks.
- Add loading, error, and empty states to every route.
- Add tests for:
  - Vendor master persistence and rename behavior
  - Template drift and confirmation transitions
  - Bulk actions and audit entries
  - Payment risk gating
  - Theme token rendering where practical
- Run typecheck, build, lint, and route-level smoke checks after each phase.

---

## Recommended implementation order

1. Token and typography audit
2. Shell, navigation, and theme toggle
3. Shared page headers, cards, tables, fields, and status primitives
4. Bill inbox prioritization and filtering
5. Draft review and learning-loop copy
6. Vendor detail workspace and rename cascade
7. Approval card and payment handoff
8. Exceptions command center
9. Templates and analytics proof surfaces
10. Full copy pass
11. Accessibility and regression testing

## Current implementation status

### Implemented

- Global Volt/Forest semantic palette and dark-mode surfaces.
- Space Grotesk headings, Inter UI/body, and IBM Plex Mono financial values.
- Persisted light/dark theme toggle in the shell.
- Branded shell mark, expanded route navigation, and shared page headers.
- Inbox copy and ordering reframed around judgment-required work.
- Inbox rows now use shared vendor identity logos.
- Draft confirmation copy now explains what Ledgerflow learns.
- Analytics now presents the hands-off rate as the primary automation proof.
- Exceptions empty state and copy now emphasize next actions and human judgment.
- Vendor identity remains shared through `VendorLogo`/`VendorProfile`.

### Remaining

- Add mobile navigation for the expanded route set.
- Add saved inbox views and richer filtering.
- Build the dedicated vendor detail workspace and rename cascade.
- Add evidence summaries and policy visibility to approval.
- Add controlled payment batch review and stronger exception grouping.
- Add template learning metrics and hands-off trend visualization.
- Complete the application-wide copy, accessibility, and test passes.
- Resolve formatting debt reported by ESLint/Prettier before treating lint as green.

## Definition of done

The rework is complete when a new user can answer these questions without training:

1. What does Ledgerflow handle automatically?
2. What specifically needs my judgment right now?
3. Why should I trust this extracted value?
4. What did Ledgerflow learn from my confirmation?
5. What will happen if I approve or submit this payment?
6. Is the system measurably getting better over time?

The final application should feel calm, decisive, transparent, and unmistakably
Ledgerflow: **you manage; it executes.**
