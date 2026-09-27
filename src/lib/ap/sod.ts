export const SOD_RULE_IDS = [
  "extractor_ne_approver",
  "approver_ne_releaser",
  "bank_change_dual_control",
] as const;

export type SodRuleId = (typeof SOD_RULE_IDS)[number];

export type SodPolicy = Record<SodRuleId, boolean>;

/** All controls are on: an enabled control is an enforcement boundary, not advice. */
export const DEFAULT_SOD_POLICY: SodPolicy = Object.freeze({
  extractor_ne_approver: true,
  approver_ne_releaser: true,
  bank_change_dual_control: true,
});

/** Accepts only known booleans so corrupted storage cannot silently disable a control. */
export function normalizeSodPolicy(value: unknown): SodPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_SOD_POLICY };
  const candidate = value as Partial<Record<SodRuleId, unknown>>;
  return {
    extractor_ne_approver:
      typeof candidate.extractor_ne_approver === "boolean"
        ? candidate.extractor_ne_approver
        : DEFAULT_SOD_POLICY.extractor_ne_approver,
    approver_ne_releaser:
      typeof candidate.approver_ne_releaser === "boolean"
        ? candidate.approver_ne_releaser
        : DEFAULT_SOD_POLICY.approver_ne_releaser,
    bank_change_dual_control:
      typeof candidate.bank_change_dual_control === "boolean"
        ? candidate.bank_change_dual_control
        : DEFAULT_SOD_POLICY.bank_change_dual_control,
  };
}
