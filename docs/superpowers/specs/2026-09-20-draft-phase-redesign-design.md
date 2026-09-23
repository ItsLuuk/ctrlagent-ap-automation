# Draft Phase Redesign — Design Spec

Date: 2026-09-20. Status: approved by user. Approach A: exception queue + profile rail.

## Goal

Draft screen = extraction accuracy + vendor profile creation. Reviewer fixes flagged
exceptions only; system learns silently in background with visible feedback. No PO/ERP
matching on this screen (explicitly out of scope).

## Locked decisions

1. Mode: mostly automatic. System builds profile silently; reviewer fixes flagged
   exceptions only. No separate new-vendor vs known-vendor flow.
2. Vendor profile = master data only: vendor name, address, IBAN, VAT number,
   payment terms. No coding defaults, no layout data in the profile itself.
3. Learning visibility = feedback, not silent, not a separate teaching step. Inline
   confirmation per fix plus a session feed and health indicator.

## §1 Layout — three columns

- Left: document viewer, unchanged (A4 aspect, click-to-anchor assign mode stays).
  Source-region highlight on demand from queue items.
- Center: exception queue (see §2). Confirm bar pinned under it.
- Right rail: vendor profile card on top (§3), "learned this session" feed plus
  extraction health below (§4).
- Narrow screens stack top to bottom: queue, profile rail, document.

## §2 Exception queue (center column)

Queue item sources, in display order:

1. Blocking: unmapped required fields (no value), cross-check conflicts
   (line-items sum vs total mismatch).
2. Low-confidence reads (existing amber triage status, no new threshold).
3. Profile gaps: missing IBAN, VAT, payment terms, or address.

Each item shows: field label, editable value input, "show on document" control that
highlights the source region (and jumps to the page for multi-page docs), and
accept/correct affordance. Correcting a value auto-saves the anchor (existing
zone/template write path) and updates the profile when the field is profile data.

Resolution rule: fixing a value OR accepting a flagged value unchanged both clear
the item. Accepting unchanged = explicit verify.

Auto-verified (green) fields collapse into one line: "N fields verified
automatically", expandable to a read-only list. Empty queue state: "Nothing to
fix — review the profile and confirm below."

## §3 Vendor profile card (right rail, top)

Fields: vendor name, address, IBAN, VAT number, payment terms. Auto-filled from
extraction; every field editable inline. Missing fields also appear as profile-gap
items in the queue (§2) — single resolution clears both.

Completeness meter: x/5 fields filled. New vendors start low and self-complete as
extraction plus fixes land. Profile persists to vendor-master on confirm (single
write path; no partial persists before confirm).

## §4 Learning feed + extraction health (right rail, bottom)

- "Learned this session" feed: one entry per fix, e.g. "IBAN now reads from
  top-right box". Entries for accepts ("VAT confirmed — no change") are omitted to
  keep the feed to actual learning. Collapsible.
- Extraction health: anchors learned x/y fields, corrections count this session,
  template status new / learning / mature (derived from existing template store
  state: no template, training-wheels confirmNextCount > 0, else mature).

## §5 Confirm gate + edge cases

- Confirm enabled only when the queue is empty. Confirm persists anchors/zones to
  the template store and the profile to vendor-master, then advances the invoice
  draft → review through the existing canonical write path (store `advance`).
  Success toast summarizes: "Profile saved · N anchors learned".
- Unreadable documents (failed extraction): queue degrades to manual entry for the
  fields already flagged by existing validation (blocking issues); profile fields
  become manual entry too.
- Multi-page documents: "show on document" jumps to the field's page (existing
  PageStrip/fieldSources data).
- PO/ERP matching stays off the Draft screen. The existing PO-link row renders only
  in review status and is untouched.
- Existing behaviors kept: confidence chips, zone-check chips, line-items editor,
  cross-check line, low-confidence banner data (feeds the queue instead of a
  separate banner).

## Success criteria

- Corrections per invoice trending down per vendor (learning works).
- Vendor profile completeness % rising without dedicated profile effort.
- Time-to-confirm per draft decreasing for repeat vendors.

## Non-goals

PO matching, ERP sync UI, coding defaults (GL/department learning), approval logic,
bulk/vendor-list management.
