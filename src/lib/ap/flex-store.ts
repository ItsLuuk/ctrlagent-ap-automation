import { uid, type Invoice } from "./types";
import type { FlexContract, FlexReceipt, FlexRule } from "./flex-matching";

const RULES_KEY = "ap-automation-flex-rules-v1";
const CONTRACTS_KEY = "ap-automation-flex-contracts-v1";
const RECEIPTS_KEY = "ap-automation-flex-receipts-v1";

function readArray<T>(key: string): T[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeArray<T>(key: string, values: T[]): T[] {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    /* storage full or unavailable */
  }
  return values;
}

export const readFlexRules = (): FlexRule[] => readArray<FlexRule>(RULES_KEY);
export const readFlexContracts = (): FlexContract[] => readArray<FlexContract>(CONTRACTS_KEY);
export const readFlexReceipts = (): FlexReceipt[] => readArray<FlexReceipt>(RECEIPTS_KEY);

export function saveFlexRule(rule: Omit<FlexRule, "id"> & { id?: string }): FlexRule[] {
  const nextRule: FlexRule = { ...rule, id: rule.id ?? uid() };
  const rules = readFlexRules();
  const index = rules.findIndex((candidate) => candidate.id === nextRule.id);
  if (index === -1) rules.push(nextRule);
  else rules[index] = nextRule;
  return writeArray(RULES_KEY, rules);
}

export function saveFlexContract(
  contract: Omit<FlexContract, "id"> & { id?: string },
): FlexContract[] {
  const nextContract: FlexContract = { ...contract, id: contract.id ?? uid() };
  const contracts = readFlexContracts();
  const index = contracts.findIndex((candidate) => candidate.id === nextContract.id);
  if (index === -1) contracts.push(nextContract);
  else contracts[index] = nextContract;
  return writeArray(CONTRACTS_KEY, contracts);
}

export function saveFlexReceipt(receipt: Omit<FlexReceipt, "id"> & { id?: string }): FlexReceipt[] {
  const nextReceipt: FlexReceipt = { ...receipt, id: receipt.id ?? uid() };
  const receipts = readFlexReceipts();
  const index = receipts.findIndex((candidate) => candidate.id === nextReceipt.id);
  if (index === -1) receipts.push(nextReceipt);
  else receipts[index] = nextReceipt;
  return writeArray(RECEIPTS_KEY, receipts);
}

export function removeFlexReceipt(id: string): void {
  writeArray(
    RECEIPTS_KEY,
    readFlexReceipts().filter((receipt) => receipt.id !== id),
  );
}

export function removeFlexPolicy(kind: "rule" | "contract", id: string): void {
  if (kind === "rule") {
    writeArray(
      RULES_KEY,
      readFlexRules().filter((rule) => rule.id !== id),
    );
    return;
  }
  writeArray(
    CONTRACTS_KEY,
    readFlexContracts().filter((contract) => contract.id !== id),
  );
}

export function clearFlexPolicies(): void {
  if (typeof localStorage === "undefined") return;
  for (const key of [RULES_KEY, CONTRACTS_KEY, RECEIPTS_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }
}

export function flexReceiptForInvoice(invoice: Invoice): FlexReceipt | undefined {
  return readFlexReceipts().find(
    (receipt) =>
      receipt.vendor.trim().toLowerCase() === invoice.vendor.trim().toLowerCase() &&
      (receipt.invoiceNumber === undefined ||
        receipt.invoiceNumber.trim().toLowerCase() ===
          invoice.invoiceNumber.trim().toLowerCase()) &&
      Math.abs(receipt.total - invoice.total) <= 0.02,
  );
}
