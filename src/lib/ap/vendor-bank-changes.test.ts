import { describe, expect, it } from "bun:test";
import { DEFAULT_SOD_POLICY } from "./sod";
import {
  decideVendorBankChange,
  requestVendorBankChange,
  requiresVendorBankApproval,
} from "./vendor-bank-changes";
import type { Actor } from "./state-machine";
import type { VendorMaster } from "./vendor-master";

const current: VendorMaster = {
  name: "Acme",
  email: "ap@acme.test",
  iban: "NL91ABNA0417164300",
  updatedAt: "old",
};
const proposed: VendorMaster = { ...current, iban: "NL02ABNA0417164301", updatedAt: "new" };
const requester: Actor = { name: "Pat", roles: ["processor"] };
const approver: Actor = { name: "Amy", roles: ["approver"] };

describe("vendor bank-change dual control", () => {
  it("recognizes only an enabled IBAN change on an existing vendor", () => {
    expect(requiresVendorBankApproval(current, proposed, DEFAULT_SOD_POLICY)).toBe(true);
    expect(requiresVendorBankApproval(undefined, proposed, DEFAULT_SOD_POLICY)).toBe(false);
    expect(requiresVendorBankApproval(current, current, DEFAULT_SOD_POLICY)).toBe(false);
    expect(
      requiresVendorBankApproval(current, proposed, {
        ...DEFAULT_SOD_POLICY,
        bank_change_dual_control: false,
      }),
    ).toBe(false);
  });

  it("records the request without changing the live record", () => {
    const change = requestVendorBankChange({
      id: "request-1",
      current,
      proposed,
      actor: requester,
      now: "now",
    });
    expect(change.status).toBe("pending");
    expect(change.requester).toBe("Pat");
    expect(change.proposed.iban).not.toBe(current.iban);
    expect(current.iban).toBe("NL91ABNA0417164300");
  });

  it("rejects self-approval and accepts a different person's approval", () => {
    const change = requestVendorBankChange({
      id: "request-1",
      current,
      proposed,
      actor: requester,
      now: "now",
    });
    expect(decideVendorBankChange(change, requester, "approved", "later")).toEqual({
      ok: false,
      message: "Pat requested this bank change — a different person must approve it.",
    });
    const decided = decideVendorBankChange(change, approver, "approved", "later");
    expect(decided.ok).toBe(true);
    if (decided.ok) expect(decided.change.status).toBe("approved");
    expect(decideVendorBankChange(change, approver, "approved", "later").ok).toBe(true);
    if (decided.ok) {
      expect(
        decideVendorBankChange(
          decided.change,
          { ...approver, name: "Another" },
          "approved",
          "later",
        ).ok,
      ).toBe(false);
    }
  });
});
