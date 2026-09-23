# Pipeline Progress UI Redesign — iOS Dock Style

Date: 2026-09-19
Reference: iOS dock widget with circular step indicators and progress bars
Status: Plan

## Problem Statement

The current `Pipeline` component renders three pill-shaped badges with thin connecting
lines. This design:
- Lacks visual hierarchy between steps
- Doesn't convey progress momentum
- Uses no icons (just numbers and text)
- Feels generic compared to premium iOS widget aesthetics
- Treats the rejected state as a tacked-on badge rather than integrated feedback

**Goal:** Redesign to match the Crumbl iOS dock widget aesthetic with circular step
indicators, thick progress bars, and status icons.

## Current Implementation

File: `src/components/ap/status.tsx` (lines 143-180)

```tsx
export function Pipeline({ status }: { status: InvoiceStatus }) {
  const current = STATUS_ORDER.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {STATUS_ORDER.map((s, i) => {
        const done = current > i;
        const active = current === i;
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
              active && "border-foreground bg-foreground text-background font-medium",
              done && "border-success/30 bg-success/10 text-success-foreground",
              !active && !done && "border-border bg-card text-muted-foreground",
            )}>
              {done ? <Check className="size-3" /> : <span className="font-mono text-[10px]">{i + 1}</span>}
              {STATUS_LABEL[s]}
            </span>
            {i < STATUS_ORDER.length - 1 && <span className="h-px w-3 bg-border" />}
          </li>
        );
      })}
      {status === "rejected" && (
        <li className="ml-1 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
          Rejected
        </li>
      )}
    </ol>
  );
}
```

**Used in:** `src/routes/invoices.$id.tsx:172`

## Target Design

### Visual Elements (from Crumbl reference)

```
┌─────────────────────────────────────────────┐
│  (✓) ━━━━━━━━━ (📝) ━━━━━━━━━ (💰)        │
│  Draft        For approval     For payment   │
└─────────────────────────────────────────────┘
```

| Element | Specification |
|---------|---------------|
| Container | `rounded-2xl bg-card border shadow-sm p-4` |
| Step circles | 32×32 `rounded-full`, icon inside |
| Progress bars | 6px tall, `rounded-full`, horizontal |
| Step labels | `text-xs text-muted-foreground`, below circles |
| Active glow | `shadow-[0_0_0_4px] shadow-accent/20` |

### Step States

| Status | Circle Style | Bar Style | Icon |
|--------|--------------|-----------|------|
| Draft | `bg-accent text-accent-foreground` | `bg-accent` (filled) | `FileText` |
| For approval | `bg-accent text-accent-foreground` | `bg-accent` (filled) | `Stamp` |
| For payment | `bg-accent text-accent-foreground` | N/A (terminal) | `CircleDollarSign` |
| Current | + `ring-2 ring-accent/30` | Pulsing fill | Step icon |
| Pending | `bg-muted text-muted-foreground` | `bg-border` (empty) | Muted icon |
| Rejected | `bg-destructive text-destructive` | N/A | `X` |
| Processing | Spinning `Loader2` | Pulsing `bg-accent/50` | None |

## Implementation

### New Component Structure

```tsx
// Step configuration — single source of truth
const PIPELINE_STEPS = [
  { key: "draft", label: "Draft", icon: FileText },
  { key: "review", label: "For approval", icon: Stamp },
  { key: "scheduled", label: "For payment", icon: CircleDollarSign },
] as const;

type PipelineStep = (typeof PIPELINE_STEPS)[number]["key"];

export function Pipeline({
  status,
  variant = "card",
}: {
  status: InvoiceStatus;
  variant?: "card" | "embedded";
}) {
  const currentStep = statusToStep(status);
  const isRejected = status === "rejected";
  const isProcessing = status === "processing";

  return (
    <div className={variant === "card" ? "rounded-2xl bg-card border p-4" : ""}>
      <div className="flex items-center gap-0">
        {PIPELINE_STEPS.map((step, index) => (
          <StepIndicator
            key={step.key}
            step={step}
            index={index}
            currentStep={currentStep}
            isRejected={isRejected}
            isProcessing={isProcessing}
          />
        ))}
      </div>
    </div>
  );
}

function StepIndicator({
  step,
  index,
  currentStep,
  isRejected,
  isProcessing,
}: {
  step: typeof PIPELINE_STEPS[number];
  index: number;
  currentStep: number;
  isRejected: boolean;
  isProcessing: boolean;
}) {
  const state = getStepState(index, currentStep, isRejected);
  const Icon = getStepIcon(step.icon, state, isProcessing);

  return (
    <div className="flex items-center">
      <div className="flex flex-col items-center">
        <div className={circleStyles(state)}>
          <Icon className="size-4" />
        </div>
        <span className={labelStyles(state)}>{step.label}</span>
      </div>
      {index < PIPELINE_STEPS.length - 1 && (
        <ProgressBar
          filled={index < currentStep}
          pulsing={index === currentStep}
        />
      )}
    </div>
  );
}
```

### Helper Functions

```tsx
function statusToStep(status: InvoiceStatus): number {
  if (status === "rejected") return STATUS_ORDER.indexOf("review");
  return STATUS_ORDER.indexOf(status);
}

function getStepState(
  index: number,
  current: number,
  isRejected: boolean
): "done" | "active" | "pending" {
  if (isRejected && index === current) return "active";
  if (index < current) return "done";
  if (index === current) return "active";
  return "pending";
}

function circleStyles(state: "done" | "active" | "pending"): string {
  return cn(
    "size-8 rounded-full flex items-center justify-center transition-all",
    state === "done" && "bg-accent text-accent-foreground",
    state === "active" && "bg-accent text-accent-foreground ring-4 ring-accent/20",
    state === "pending" && "bg-muted text-muted-foreground",
  );
}

function labelStyles(state: "done" | "active" | "pending"): string {
  return cn(
    "text-xs mt-1.5 whitespace-nowrap",
    state === "active" ? "text-foreground font-medium" : "text-muted-foreground",
  );
}
```

### Progress Bar Component

```tsx
function ProgressBar({
  filled,
  pulsing,
}: {
  filled: boolean;
  pulsing: boolean;
}) {
  return (
    <div className="mx-1 h-1.5 w-12 rounded-full bg-border overflow-hidden">
      <div
        className={cn(
          "h-full rounded-full transition-all duration-500",
          filled && "bg-accent",
          pulsing && "bg-accent/50 animate-pulse",
        )}
        style={{ width: filled ? "100%" : pulsing ? "50%" : "0%" }}
      />
    </div>
  );
}
```

## File Changes

### 1. `src/components/ap/status.tsx`

**Delete:** Old `Pipeline` function (lines 143-180)

**Add:**
- `PIPELINE_STEPS` constant
- `Pipeline` component (new implementation)
- `StepIndicator` component
- `ProgressBar` component
- `statusToStep`, `getStepState`, `circleStyles`, `labelStyles` helpers

**Keep:** All other exports (`StatusBadge`, `ConfidenceChip`, `EngineBadge`, `FieldPathChip`)

### 2. `src/routes/invoices.$id.tsx`

**No changes needed.** The call site `<Pipeline status={invoice.status} />` remains identical.

## Test Strategy

### Unit Tests (add to `src/components/ap/status.test.tsx`)

```tsx
describe("Pipeline", () => {
  it("renders all three steps", () => {
    render(<Pipeline status="draft" />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("For approval")).toBeInTheDocument();
    expect(screen.getByText("For payment")).toBeInTheDocument();
  });

  it("marks draft as active when status is draft", () => {
    render(<Pipeline status="draft" />);
    const draftStep = screen.getByText("Draft").closest("div");
    expect(draftStep).toHaveClass("bg-accent");
  });

  it("marks first two steps as done when status is scheduled", () => {
    render(<Pipeline status="scheduled" />);
    // Draft and For approval should have "done" styling
  });

  it("shows rejected state with destructive styling", () => {
    render(<Pipeline status="rejected" />);
    // Rejected step should have destructive colors
  });

  it("applies card variant styles by default", () => {
    render(<Pipeline status="draft" />);
    const container = screen.getByRole("list").parentElement;
    expect(container).toHaveClass("rounded-2xl", "bg-card");
  });

  it("applies embedded variant without container styles", () => {
    render(<Pipeline status="draft" variant="embedded" />);
    const container = screen.getByRole("list").parentElement;
    expect(container).not.toHaveClass("rounded-2xl");
  });
});
```

## Verification Checklist

- [ ] `bunx tsc --noEmit` — 0 errors
- [ ] `bun test` — all passing
- [ ] `bun run lint` — clean on touched files
- [ ] `bun run build` — green
- [ ] Visual: renders correctly in light mode
- [ ] Visual: renders correctly in dark mode
- [ ] Visual: all statuses display correctly (draft, review, scheduled, rejected, paid, processing, failed)
- [ ] Visual: responsive on mobile (< 640px)
- [ ] Accessibility: screen reader announces step states
