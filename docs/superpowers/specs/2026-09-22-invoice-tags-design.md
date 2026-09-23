# Invoice Tag Redesign — Design Spec

Date: 2026-09-22 · Status: approved, pending implementation plan
Scope: visual redesign of system invoice tags (First-time vendor, Late, …).
Tag computation (`auto-tags.ts`), stored data, and `PREDEFINED_TAGS` are untouched.

## Problem

`TagBadge` renders filled chromatic pills (`bg-destructive`, `bg-[#1d4ed8]`,
oklch fills, `bg-success` fills, white 12px text). This violates
`Branding/foundry.md` §6: category color never fills backgrounds; status is
carried by foreground words + orange accents or a 3px left border; Alert Red
is reserved for functional status. It also splits the status language: inbox
rows show `StatusBadge` (bare-text, 3px border) next to `TagBadge` (solid
fills) for the same kind of information.

## Decision

Converge tags on the `Badge` language in `src/components/ap/primitives.tsx`
(bare-text strip, 3px left border, foreground words — the component the brand
rules describe; approach A, approved. Alternatives — a separate quiet chip,
keeping filled pills — rejected for splitting the system / breaking brand
rules). Note: `StatusBadge` in `status.tsx` is a filled pill and is NOT the
reference; tags converge on `Badge`, which is the `foundry.md` §5 "3px left
border" chip.

## Tone map

All colors are Foundry tokens from `src/styles.css`. Words are always
foreground ink; hue lives only in the 3px left border + optional icon.

| Tag | Border/accent | Judgment level |
|---|---|---|
| Late | `destructive` | blocked-class: overdue, Alert Red per brand rule 3 |
| Urgent | `destructive` | due ≤ 3 days, same red family as Late |
| Duplicate risk | `destructive` | money at risk; icon disambiguates from Late/Urgent |
| First-time vendor | Foundry Orange | attention: needs judgment, not blocked |
| High value | Foundry Orange | attention, not alarm |
| Needs receipt | Foundry Orange | compound of the two above; no icon |
| International | Steel border, `muted-foreground` words | pure info, faintest voice |
| Recurring | not rendered | absence of risk shows nothing; still computed + stored |

## Size and type

`text-xs font-medium text-foreground`, `border-l-[3px] py-0.5 pl-2 pr-1` —
same geometry as `Badge` in `primitives.tsx` (no pill background, no
rounding). Normal-case words, never uppercase. Table cells keep
`flex flex-wrap gap-1`.

## Icons

`size-3` lucide before the word, danger tags only, inheriting the border
tone: Late → `Clock`, Urgent → alarm-clock treatment, Duplicate risk →
duplicate/copy treatment (add missing glyphs to `icons/catalog.tsx` via the
existing `wrap()` pattern). Attention/info tags get no icon.

## Component and API changes

- `TagBadge({ tag, onRemove })` signature unchanged; returns `null` for
  `"Recurring"`.
- `TAG_COLORS` (fills) in `src/lib/ap/types.ts` replaced by `TAG_TONES`:
  per-tag border/text/icon classes, Foundry tokens only.
- No changes to `auto-tags.ts`, `PREDEFINED_TAGS`, or persisted invoices.
- Dark Stage + Midnight: same semantic tokens per mode; `text-xs` medium
  foreground words keep contrast; hue never carries meaning alone
  (border + word + icon triple, `Branding/accessibility.md`).
- Verification: inbox renders 7 visible tones correctly in all three modes;
  `tsc`, `eslint`, `build:tauri` green; no other `TAG_COLORS` consumers exist.

## Out of scope

Tag editing UI, tag filters, changing tag predicates/thresholds, touching
`StatusBadge`, marketing-surface pills.

---

# Addendum: Stage badges (2026-09-22, no-question brief)

`StatusBadge` (pipeline state: Draft, For approval, Ready for handoff,
Rejected, Paid, Processing, Needs attention) converges on the same `Badge`
geometry as tags: `inline-flex items-center gap-1.5 border-l-[3px] py-0.5
pl-2 pr-1 text-xs font-medium text-foreground`. Stage stays distinguishable
from tags by its dot indicator (every stage) and its own column — strip
shape shared, voice primary.

## Stage tone map

| Status | Border | Mark | Rationale |
|---|---|---|---|
| draft | `border-border` | dot `bg-muted-foreground` | not started, neutral |
| review | `border-foundry-orange` | dot `bg-foundry-orange` | needs judgment |
| scheduled | `border-info` | dot `bg-info` | approved, awaiting handoff (info blue) |
| paid | `border-border` | ink `Check` icon, no dot | verified = ink ✓ + foreground words |
| rejected | `border-destructive` | dot `bg-destructive` | blocked, Alert Red reserved use |
| failed | `border-destructive` | dot `bg-destructive` | blocked, Alert Red reserved use |
| processing | `border-info` | dot `bg-info animate-pulse` | in-flight; pulse allowed for in-progress indicators |

`STATUS_LABEL` unchanged. `statusColor()` (solid fills) deleted — its only
consumer is `StatusBadge`; replaced by `STATUS_TONES` in `src/lib/colors.ts`.
No predicate, stored-data, or route changes.
