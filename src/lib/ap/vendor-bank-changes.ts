import type { Actor } from "./state-machine";
import type { SodPolicy } from "./sod";
import type { VendorMaster } from "./vendor-master";

export type VendorBankChangeStatus = "pending" | "approved" | "rejected";

export type VendorBankChange = {
  id: string;
  vendor: string;
  previous: VendorMaster;
  proposed: VendorMaster;
  requester: string;
  requestedAt: string;
  status: VendorBankChangeStatus;
  decidedBy?: string | undefined;
  decidedAt?: string | undefined;
};

const sameBankDetails = (left: VendorMaster, right: VendorMaster): boolean =>
  (left.iban ?? "").trim().toUpperCase() === (right.iban ?? "").trim().toUpperCase();

/** Whether this write changes payment-routing details and therefore needs review. */
export function requiresVendorBankApproval(
  current: VendorMaster | undefined,
  proposed: VendorMaster,
  policy: SodPolicy,
): boolean {
  return Boolean(policy.bank_change_dual_control && current && !sameBankDetails(current, proposed));
}

export type VendorBankDecision =
  { ok: true; change: VendorBankChange } | { ok: false; message: string };

/** A request records intent; it never changes the live vendor record. */
export function requestVendorBankChange(input: {
  id: string;
  current: VendorMaster;
  proposed: VendorMaster;
  actor: Actor;
  now: string;
}): VendorBankChange {
  return {
    id: input.id,
    vendor: input.current.name,
    previous: input.current,
    proposed: input.proposed,
    requester: input.actor.name,
    requestedAt: input.now,
    status: "pending",
  };
}

/** Only a different person may complete the second control step. */
export function decideVendorBankChange(
  change: VendorBankChange,
  actor: Actor,
  decision: "approved" | "rejected",
  now: string,
): VendorBankDecision {
  if (change.status !== "pending") {
    return { ok: false, message: "This bank-change request was already decided." };
  }
  if (change.requester === actor.name) {
    return {
      ok: false,
      message: `${actor.name} requested this bank change — a different person must approve it.`,
    };
  }
  return {
    ok: true,
    change: { ...change, status: decision, decidedBy: actor.name, decidedAt: now },
  };
}
