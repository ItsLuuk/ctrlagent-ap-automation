/**
 * ERP sync layer (Phase Flow Plan §5).
 *
 * The ERP is a sync layer, not a screen. Rules implemented here:
 *  - Push late: export/sync is separate from approval and never implies payment.
 *  - Real integrations may return an external reference; local demo events never do.
 *  - Idempotency: pushes are keyed by (invoiceId, kind) — a retried sync
 *    never double-posts.
 *  - Sync failures are first-class exceptions: recorded on the invoice, they
 *    surface in the exception queue with a retry action.
 *
 * This module simulates the ERP (deterministic demo failures); swap
 * `pushToErp` for real API calls and everything else keeps working.
 */
import { uid, type Invoice } from "./types";

export type SyncKind = "bill" | "payment";

export type SyncEvent = {
  id: string;
  invoiceId: string;
  kind: SyncKind;
  status: "synced" | "failed";
  /** Demo events are local simulations and must never be presented as ERP sync. */
  mode?: "demo" | "real";
  /** External document reference, only trustworthy when mode === "real". */
  erpRef?: string | undefined;
  error?: string | undefined;
  at: string;
  attempt: number;
};

export type ErpRefs = {
  bill?: string | undefined;
  payment?: string | undefined;
};

const STORAGE_KEY = "ap-automation-sync-events-v1";

/** In-memory fallback when localStorage is unavailable (tests and non-app
 *  runtimes). Events are lost between sessions in that case, which is acceptable
 *  for demos. */
let memoryEvents: SyncEvent[] = [];

/** Idempotency key: (invoiceId, kind). One successful push per key, ever. */
export const syncKey = (invoiceId: string, kind: SyncKind): string => `${invoiceId}:${kind}`;

function readEvents(): SyncEvent[] {
  if (typeof localStorage === "undefined") return memoryEvents;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SyncEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEvents(events: SyncEvent[]): void {
  if (typeof localStorage === "undefined") {
    memoryEvents = events;
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    /* storage full */
  }
}

export function readAllSyncEvents(): SyncEvent[] {
  return readEvents();
}

export function clearSyncEvents(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Latest event for an invoice (both kinds). */
export function syncStateFor(invoiceId: string): {
  bill?: SyncEvent | undefined;
  payment?: SyncEvent | undefined;
} {
  const events = readEvents().filter((e) => e.invoiceId === invoiceId);
  const latest = (kind: SyncKind) =>
    events.filter((e) => e.kind === kind).sort((a, b) => b.at.localeCompare(a.at))[0];
  return { bill: latest("bill"), payment: latest("payment") };
}

/** Latest event per invoice, for the payment-run table's sync column. */
export function latestSyncByInvoice(): Record<string, SyncEvent> {
  const map: Record<string, SyncEvent> = {};
  for (const e of readEvents()) {
    const cur = map[e.invoiceId];
    if (!cur || e.at > cur.at) map[e.invoiceId] = e;
  }
  return map;
}

export function erpRefsFor(invoiceId: string): ErpRefs {
  const { bill, payment } = syncStateFor(invoiceId);
  return {
    bill: bill?.status === "synced" && bill.mode === "real" ? bill.erpRef : undefined,
    payment: payment?.status === "synced" && payment.mode === "real" ? payment.erpRef : undefined,
  };
}

/**
 * The simulated ERP endpoint. Deterministic: invoice numbers containing
 * "ERP-FAIL" (case-insensitive) fail — replicating the demo scenario where
 * a vendor's invoice hits a validation error in the ERP. Real integration
 * replaces only this function.
 */
function pushToErp(
  invoice: Invoice,
  kind: SyncKind,
): { ok: true; erpRef: string } | { ok: false; error: string } {
  if (invoice.invoiceNumber.toUpperCase().includes("ERP-FAIL")) {
    return {
      ok: false,
      error:
        kind === "bill"
          ? "The ERP rejected this invoice — the vendor account needs revalidation. Fix the vendor record, then retry the sync."
          : "The ERP rejected the payment — the period is closed. Schedule it for the next open period.",
    };
  }
  // Deterministic pseudo-refs from the invoice id so retries return the same ref.
  const hash = [...invoice.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
  const ref =
    kind === "bill"
      ? `NB-${1000 + (Math.abs(hash) % 9000)}`
      : `PAY-${100 + (Math.abs(hash) % 900)}`;
  return { ok: true, erpRef: ref };
}

export type SyncOutcome = SyncEvent;

// Kept explicit so switching to a real adapter is a deliberate code change.
const eventMode: SyncEvent["mode"] = "demo";

/**
 * Attempts a sync. Idempotent: if a successful event already exists for this
 * (invoiceId, kind), the stored event is returned without pushing again.
 */
export function attemptSync(invoice: Invoice, kind: SyncKind): SyncOutcome {
  const existing = syncStateFor(invoice.id)[kind];
  if (existing?.status === "synced") return existing;

  const priorAttempts = readEvents().filter(
    (e) => e.invoiceId === invoice.id && e.kind === kind,
  ).length;
  const result = pushToErp(invoice, kind);
  const event: SyncEvent = {
    id: uid(),
    invoiceId: invoice.id,
    kind,
    status: result.ok ? "synced" : "failed",
    mode: "demo",
    ...(result.ok
      ? eventMode === "real"
        ? { erpRef: result.erpRef }
        : {}
      : { error: result.error }),
    at: new Date().toISOString(),
    attempt: priorAttempts + 1,
  };
  const events = readEvents();
  events.push(event);
  writeEvents(events);
  return event;
}
