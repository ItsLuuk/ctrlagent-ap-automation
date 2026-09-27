import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormField, InfoBanner, Section, SectionHeader } from "@/components/ap/primitives";
import { useAp } from "@/lib/app/store";
import type { FlexContract, FlexRule } from "@/lib/ap/flex-matching";

const EMPTY_RULE = {
  name: "",
  vendor: "",
  department: "",
  minAmount: "",
  maxAmount: "",
  requiresReceipt: false,
  missingReceiptSeverity: "attention" as "attention" | "blocking",
};
const EMPTY_CONTRACT = {
  name: "",
  vendor: "",
  department: "",
  maxAmount: "",
  validFrom: "",
  validTo: "",
  requiresReceipt: false,
  missingReceiptSeverity: "attention" as "attention" | "blocking",
};
const EMPTY_RECEIPT = { vendor: "", invoiceNumber: "", total: "", receivedAt: "" };

const optionalText = (value: string): string | undefined => value.trim() || undefined;
const optionalNumber = (value: string): number | undefined => {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
};

function PolicyList({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-border border-t border-border">{children}</div>;
}

function PolicyRow({
  title,
  detail,
  active,
  onActiveChange,
  onRemove,
}: {
  title: string;
  detail: string;
  active?: boolean;
  onActiveChange?: (active: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      {onActiveChange ? (
        <Checkbox
          checked={active ?? false}
          aria-label={`${active ? "Disable" : "Enable"} ${title}`}
          onCheckedChange={(checked) => onActiveChange(checked === true)}
          className="mt-0.5"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

export function FlexPolicySettings() {
  const {
    flexRules,
    flexContracts,
    flexReceipts,
    saveFlexRule,
    saveFlexContract,
    saveFlexReceipt,
    removeFlexPolicy,
    removeFlexReceipt,
  } = useAp();
  const [rule, setRule] = useState({ ...EMPTY_RULE });
  const [contract, setContract] = useState({ ...EMPTY_CONTRACT });
  const [receipt, setReceipt] = useState({ ...EMPTY_RECEIPT });

  const addRule = () => {
    if (!rule.name.trim()) return;
    saveFlexRule({
      name: rule.name.trim(),
      vendor: optionalText(rule.vendor),
      department: optionalText(rule.department),
      minAmount: optionalNumber(rule.minAmount),
      maxAmount: optionalNumber(rule.maxAmount),
      requiresReceipt: rule.requiresReceipt,
      missingReceiptSeverity: rule.missingReceiptSeverity,
      active: true,
    });
    setRule({ ...EMPTY_RULE });
    toast.success("No-PO rule added");
  };

  const addContract = () => {
    if (!contract.name.trim() || !contract.vendor.trim()) return;
    saveFlexContract({
      name: contract.name.trim(),
      vendor: contract.vendor.trim(),
      department: optionalText(contract.department),
      maxAmount: optionalNumber(contract.maxAmount),
      validFrom: optionalText(contract.validFrom),
      validTo: optionalText(contract.validTo),
      requiresReceipt: contract.requiresReceipt,
      missingReceiptSeverity: contract.missingReceiptSeverity,
      active: true,
    });
    setContract({ ...EMPTY_CONTRACT });
    toast.success("Contract added");
  };

  const addReceipt = () => {
    const total = optionalNumber(receipt.total);
    if (!receipt.vendor.trim() || total === undefined || !receipt.receivedAt) return;
    saveFlexReceipt({
      vendor: receipt.vendor.trim(),
      invoiceNumber: optionalText(receipt.invoiceNumber),
      total,
      receivedAt: new Date(`${receipt.receivedAt}T12:00:00`).toISOString(),
    });
    setReceipt({ ...EMPTY_RECEIPT });
    toast.success("Receipt evidence added");
  };

  return (
    <Section className="mt-8">
      <SectionHeader
        title="No-PO approval"
        hint="Allow contracts, receipt evidence, or configurable rules to approve spend without a purchase order"
      />
      <div className="p-5">
        <InfoBanner variant="accent">
          A matching invoice is eligible for approval. Contracts are checked first, then receipt
          evidence, then rules. Department is used as the category dimension on your invoices.
        </InfoBanner>
      </div>

      <div className="border-t border-border p-5">
        <p className="text-sm font-medium">Threshold rule</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Combine vendor, department, and amount limits. Leave a field empty to allow any value.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormField label="Rule name">
            <Input
              value={rule.name}
              onChange={(event) => setRule((value) => ({ ...value, name: event.target.value }))}
              placeholder="Facilities under €1,500"
            />
          </FormField>
          <FormField label="Vendor" hint="Optional">
            <Input
              value={rule.vendor}
              onChange={(event) => setRule((value) => ({ ...value, vendor: event.target.value }))}
              placeholder="Any vendor"
            />
          </FormField>
          <FormField label="Department / category" hint="Optional">
            <Input
              value={rule.department}
              onChange={(event) =>
                setRule((value) => ({ ...value, department: event.target.value }))
              }
              placeholder="Any department"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Minimum amount" hint="Optional">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={rule.minAmount}
                onChange={(event) =>
                  setRule((value) => ({ ...value, minAmount: event.target.value }))
                }
                placeholder="0"
              />
            </FormField>
            <FormField label="Maximum amount" hint="Optional">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={rule.maxAmount}
                onChange={(event) =>
                  setRule((value) => ({ ...value, maxAmount: event.target.value }))
                }
                placeholder="No limit"
              />
            </FormField>
          </div>
        </div>
        <ReceiptRequirement
          checked={rule.requiresReceipt}
          severity={rule.missingReceiptSeverity}
          onCheckedChange={(checked) =>
            setRule((value) => ({ ...value, requiresReceipt: checked }))
          }
          onSeverityChange={(missingReceiptSeverity) =>
            setRule((value) => ({ ...value, missingReceiptSeverity }))
          }
        />
        <Button className="mt-4" size="sm" onClick={addRule} disabled={!rule.name.trim()}>
          Add rule
        </Button>
      </div>

      {flexRules.length > 0 ? (
        <PolicyList>
          {flexRules.map((item) => (
            <PolicyRow
              key={item.id}
              title={item.name}
              detail={ruleDetail(item)}
              active={item.active}
              onActiveChange={(active) => saveFlexRule({ ...item, active })}
              onRemove={() => removeFlexPolicy("rule", item.id)}
            />
          ))}
        </PolicyList>
      ) : null}

      <div className="border-t border-border p-5">
        <p className="text-sm font-medium">Contract</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Match a vendor within optional dates, department, and amount limits.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormField label="Contract name">
            <Input
              value={contract.name}
              onChange={(event) => setContract((value) => ({ ...value, name: event.target.value }))}
              placeholder="Facilities agreement"
            />
          </FormField>
          <FormField label="Vendor" required>
            <Input
              value={contract.vendor}
              onChange={(event) =>
                setContract((value) => ({ ...value, vendor: event.target.value }))
              }
              placeholder="Acme Facilities B.V."
            />
          </FormField>
          <FormField label="Department / category" hint="Optional">
            <Input
              value={contract.department}
              onChange={(event) =>
                setContract((value) => ({ ...value, department: event.target.value }))
              }
              placeholder="Any department"
            />
          </FormField>
          <FormField label="Maximum amount" hint="Optional">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={contract.maxAmount}
              onChange={(event) =>
                setContract((value) => ({ ...value, maxAmount: event.target.value }))
              }
              placeholder="No limit"
            />
          </FormField>
          <FormField label="Valid from" hint="Optional">
            <Input
              type="date"
              value={contract.validFrom}
              onChange={(event) =>
                setContract((value) => ({ ...value, validFrom: event.target.value }))
              }
            />
          </FormField>
          <FormField label="Valid to" hint="Optional">
            <Input
              type="date"
              value={contract.validTo}
              onChange={(event) =>
                setContract((value) => ({ ...value, validTo: event.target.value }))
              }
            />
          </FormField>
        </div>
        <ReceiptRequirement
          checked={contract.requiresReceipt}
          severity={contract.missingReceiptSeverity}
          onCheckedChange={(checked) =>
            setContract((value) => ({ ...value, requiresReceipt: checked }))
          }
          onSeverityChange={(missingReceiptSeverity) =>
            setContract((value) => ({ ...value, missingReceiptSeverity }))
          }
        />
        <Button
          className="mt-4"
          size="sm"
          onClick={addContract}
          disabled={!contract.name.trim() || !contract.vendor.trim()}
        >
          Add contract
        </Button>
      </div>

      {flexContracts.length > 0 ? (
        <PolicyList>
          {flexContracts.map((item) => (
            <PolicyRow
              key={item.id}
              title={item.name}
              detail={contractDetail(item)}
              active={item.active}
              onActiveChange={(active) => saveFlexContract({ ...item, active })}
              onRemove={() => removeFlexPolicy("contract", item.id)}
            />
          ))}
        </PolicyList>
      ) : null}

      <div className="border-t border-border p-5">
        <p className="text-sm font-medium">Receipt evidence</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Match an existing receipt by vendor, optional invoice number, and exact amount.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormField label="Vendor" required>
            <Input
              value={receipt.vendor}
              onChange={(event) =>
                setReceipt((value) => ({ ...value, vendor: event.target.value }))
              }
              placeholder="Acme Facilities B.V."
            />
          </FormField>
          <FormField label="Invoice number" hint="Optional">
            <Input
              value={receipt.invoiceNumber}
              onChange={(event) =>
                setReceipt((value) => ({ ...value, invoiceNumber: event.target.value }))
              }
              placeholder="Any number"
            />
          </FormField>
          <FormField label="Receipt amount" required>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={receipt.total}
              onChange={(event) => setReceipt((value) => ({ ...value, total: event.target.value }))}
              placeholder="0.00"
            />
          </FormField>
          <FormField label="Received on" required>
            <Input
              type="date"
              value={receipt.receivedAt}
              onChange={(event) =>
                setReceipt((value) => ({ ...value, receivedAt: event.target.value }))
              }
            />
          </FormField>
        </div>
        <Button
          className="mt-4"
          size="sm"
          onClick={addReceipt}
          disabled={!receipt.vendor.trim() || !receipt.total || !receipt.receivedAt}
        >
          Add receipt
        </Button>
      </div>

      {flexReceipts.length > 0 ? (
        <PolicyList>
          {flexReceipts.map((item) => (
            <PolicyRow
              key={item.id}
              title={`${item.vendor} · ${item.total.toFixed(2)}`}
              detail={`${item.invoiceNumber || "Any invoice number"} · received ${item.receivedAt.slice(0, 10)}`}
              onRemove={() => removeFlexReceipt(item.id)}
            />
          ))}
        </PolicyList>
      ) : null}
    </Section>
  );
}

function ReceiptRequirement({
  checked,
  severity,
  onCheckedChange,
  onSeverityChange,
}: {
  checked: boolean;
  severity: "attention" | "blocking";
  onCheckedChange: (checked: boolean) => void;
  onSeverityChange: (severity: "attention" | "blocking") => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
        Require matching receipt evidence
      </label>
      {checked ? (
        <Select
          value={severity}
          onValueChange={(value) => onSeverityChange(value as "attention" | "blocking")}
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="attention">Needs review</SelectItem>
            <SelectItem value="blocking">Blocks approval</SelectItem>
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}

function ruleDetail(rule: FlexRule): string {
  return [
    rule.vendor || "Any vendor",
    rule.department || "Any department",
    rule.minAmount === undefined && rule.maxAmount === undefined
      ? "Any amount"
      : `${rule.minAmount ?? 0}–${rule.maxAmount ?? "no maximum"}`,
    rule.requiresReceipt ? "Receipt required" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function contractDetail(contract: FlexContract): string {
  return [
    contract.vendor,
    contract.department || "Any department",
    contract.maxAmount === undefined ? "Any amount" : `Up to ${contract.maxAmount}`,
    contract.validFrom || contract.validTo
      ? `${contract.validFrom || "Any date"} to ${contract.validTo || "Any date"}`
      : "No date limits",
    contract.requiresReceipt ? "Receipt required" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
