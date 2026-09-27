import { ShieldCheck } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { InfoBanner, Section, SectionHeader } from "@/components/ap/primitives";
import { useAp } from "@/lib/app/store";
import { SOD_RULE_IDS, type SodRuleId } from "@/lib/ap/sod";
import { toast } from "sonner";

const RULE_COPY: Record<SodRuleId, { title: string; description: string }> = {
  extractor_ne_approver: {
    title: "Extractor cannot approve",
    description: "The person who confirms extracted invoice fields cannot approve that invoice.",
  },
  approver_ne_releaser: {
    title: "Approver cannot release payment",
    description: "The person who approves an invoice cannot release it for payment.",
  },
  bank_change_dual_control: {
    title: "Vendor bank changes need two people",
    description: "A bank-detail change stays pending until a different person approves it.",
  },
};

export function SodSettings() {
  const { sodPolicy, setSodRule, vendorBankChanges, decideVendorBankChange } = useAp();
  const pending = vendorBankChanges.filter((change) => change.status === "pending");

  const decide = (id: string, decision: "approved" | "rejected") => {
    const result = decideVendorBankChange(id, decision);
    if (!result.accepted) {
      toast.error("This bank change is still blocked", { description: result.reason });
      return;
    }
    toast.success(
      decision === "approved" ? "Vendor bank change approved" : "Vendor bank change rejected",
    );
  };

  return (
    <Section className="mt-8">
      <SectionHeader title="Segregation of duties" hint="Enabled rules block the action" />
      <div className="divide-y divide-border">
        {SOD_RULE_IDS.map((rule) => (
          <div key={rule} className="flex items-start justify-between gap-5 p-5">
            <div>
              <p className="text-sm font-medium">{RULE_COPY[rule].title}</p>
              <p className="mt-1 max-w-lg text-xs text-muted-foreground">
                {RULE_COPY[rule].description}
              </p>
            </div>
            <Switch
              checked={sodPolicy[rule]}
              onCheckedChange={(enabled) => setSodRule(rule, enabled)}
              aria-label={RULE_COPY[rule].title}
            />
          </div>
        ))}
      </div>
      <div className="px-5 pb-5">
        <InfoBanner variant="accent">
          <ShieldCheck className="mr-2 inline size-4" />A single operator does not bypass an enabled
          control. To complete dual control on a shared device, the second person changes the
          operator name in the business profile before approving.
        </InfoBanner>
      </div>

      {pending.length > 0 ? (
        <div className="border-t border-border">
          <div className="p-5">
            <p className="text-sm font-medium">Pending bank changes</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The live vendor details stay unchanged until approval.
            </p>
          </div>
          <div className="divide-y divide-border">
            {pending.map((change) => (
              <div key={change.id} className="flex flex-wrap items-center gap-3 p-5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{change.vendor}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {change.previous.iban || "No IBAN"} → {change.proposed.iban || "No IBAN"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Requested by {change.requester}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => decide(change.id, "rejected")}>
                  Reject
                </Button>
                <Button size="sm" onClick={() => decide(change.id, "approved")}>
                  Approve
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Section>
  );
}
