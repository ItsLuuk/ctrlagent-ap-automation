/**
 * The compounding, made visible.
 *
 * Every vendor template Foundry learns is an asset nobody ever sees: the work
 * saved shows up as a shorter worklist, not as a number. That makes the
 * product's strongest habit invisible exactly where it would be worth
 * something, so this counts it in the only terms that are honest — invoices the
 * saved template read without a person going back to fix the fields, against
 * the ones that stopped for a person.
 */
import { countOf } from "../vocabulary";
import { resolveVendorKey } from "../vendor-master";
import type { Invoice } from "../types";

export type TrackRecord = {
  /** Invoices this vendor's template read without a person correcting it. */
  read: number;
  /** Invoices from this vendor that stopped for a person. */
  needed: number;
};

/**
 * Statuses that mean the reading was good enough for the invoice to move on
 * without anyone going back to the fields. `processing` is excluded because the
 * machine has not finished, and `rejected` because a person decided against
 * the invoice rather than through it.
 */
const READ_CLEANLY: Invoice["status"][] = ["review", "scheduled", "paid", "archived"];
const NEEDED_A_PERSON: Invoice["status"][] = ["vendor_profile", "draft", "failed"];

/**
 * How this vendor has gone so far, counting their other invoices.
 *
 * "Read automatically" is claimed only where the saved template produced the
 * values (`engine === "template"`) and the invoice went on without being sent
 * back to a draft. Anything a person typed into does not count, because the
 * number's whole job is to be true at the moment someone is deciding whether
 * to trust the next one.
 */
export function vendorTrackRecord(invoices: readonly Invoice[], current: Invoice): TrackRecord {
  const key = resolveVendorKey(current);
  const record: TrackRecord = { read: 0, needed: 0 };
  for (const other of invoices) {
    if (other.id === current.id) continue;
    if (resolveVendorKey(other) !== key) continue;
    if (other.engine === "template" && READ_CLEANLY.includes(other.status)) record.read += 1;
    else if (NEEDED_A_PERSON.includes(other.status)) record.needed += 1;
  }
  return record;
}

/**
 * The compounding, in one sentence. Null until there is something to compound:
 * a first invoice has no history, and "0 invoices read automatically" is not
 * a reward.
 */
export function trackRecordLine(record: TrackRecord): string | null {
  if (record.read === 0) return null;
  return `${countOf(record.read, "invoice")} read automatically. This one needed you.`;
}
