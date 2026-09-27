/**
 * Settings page — Business profile configuration.
 *
 * The business profile is used during invoice extraction to filter out
 * customer/bill-to data. Everything matching this profile is NOT the vendor.
 */
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check } from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Shell } from "@/components/ap/shell";
import { FlexPolicySettings } from "@/components/ap/flex-policy-settings";
import { SodSettings } from "@/components/ap/sod-settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAp } from "@/lib/app/store";
import { type BusinessProfile } from "@/lib/ap/types";
import { countOf } from "@/lib/ap/vocabulary";
import { buildCompliancePack, type ComplianceFramework } from "@/lib/ap/compliance";
import {
  Section,
  SectionHeader,
  FormField,
  InfoBanner,
  PageHeader,
  Pill,
} from "@/components/ap/primitives";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Foundry" },
      {
        name: "description",
        content:
          "Manage your company profile, entities, approval policies, compliance evidence, and local data.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const {
    businessProfile,
    setBusinessProfile,
    operatorDisplayName,
    setOperatorDisplayName,
    invoices,
    history,
    hasSampleData,
    loadSampleData,
    clearSampleData,
    clearAllData,
  } = useAp();
  const [draft, setDraft] = useState<BusinessProfile>({
    ...businessProfile,
    operatorName: operatorDisplayName,
  });
  const [saved, setSaved] = useState(false);

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(businessProfile);
  const hasName = draft.name.trim().length > 0;

  const handleSave = () => {
    setOperatorDisplayName(draft.operatorName ?? "");
    setBusinessProfile(draft);
    setSaved(true);
    toast.success("Business profile saved", {
      description: "Invoice extraction will now use this to filter out your own data.",
    });
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setDraft({
      operatorName: "",
      name: "",
      address: "",
      email: "",
      iban: "",
      vatNumber: "",
      businessRegistrationNumber: "",
    });
  };

  const handleLoadSampleData = () => {
    loadSampleData();
    toast.success("Sample data loaded", {
      description: "Demo records are labelled in the invoice inbox.",
    });
  };

  const handleClearSampleData = () => {
    clearSampleData();
    toast.success("Sample data removed", {
      description: "Everything you captured is still here.",
    });
  };

  const handleClearAll = () => {
    clearAllData();
    toast.success("All local data cleared", {
      description: "This device is back to a first run.",
    });
  };

  return (
    <Shell>
      <PageHeader
        backLink={
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Invoice inbox
          </Link>
        }
        title="Settings"
        subtitle="Company profile, entities, compliance, and local data."
      />

      <div className="mt-4">
        <InfoBanner variant="accent">
          When your business profile is filled in, the extraction engine ignores your own address,
          VAT number, IBAN, and email when scanning invoices. This means faster processing and fewer
          false matches on vendor fields.
        </InfoBanner>

        <div className="mt-6 grid items-start gap-6 xl:grid-cols-2">
          <div className="space-y-6 [&>*:first-child]:mt-0">
            <Section>
          <SectionHeader title="Company details" hint="Required fields marked with *" />
          <div className="space-y-5 p-5">
            <FormField
              label="Operator name"
              hint="Written to the audit trail and compared across duty-separated steps"
            >
              <Input
                value={draft.operatorName ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, operatorName: e.target.value }))}
                placeholder="Sam de Vries"
                className="h-10"
              />
            </FormField>

            <FormField label="Business name" hint="Legal or trading name" required>
              <Input
                value={draft.name}
                onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                placeholder="Acme B.V."
                className="h-10"
              />
            </FormField>

            <FormField label="Address" hint="Street + postal code + city">
              <Input
                value={draft.address}
                onChange={(e) => setDraft((p) => ({ ...p, address: e.target.value }))}
                placeholder="Industrieweg 42, 1012 AB Amsterdam"
                className="h-10"
              />
            </FormField>

            <FormField label="Email" hint="Business email address">
              <Input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft((p) => ({ ...p, email: e.target.value }))}
                placeholder="info@acme.nl"
                className="h-10"
              />
            </FormField>

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField label="IBAN" hint="Dutch or international" mono>
                <Input
                  value={draft.iban}
                  onChange={(e) => setDraft((p) => ({ ...p, iban: e.target.value.toUpperCase() }))}
                  placeholder="NL91ABNA0417164300"
                  className="h-10 font-mono"
                />
              </FormField>
              <FormField label="VAT / BTW number" hint="BTW-identificatienummer" mono>
                <Input
                  value={draft.vatNumber}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, vatNumber: e.target.value.toUpperCase() }))
                  }
                  placeholder="NL123456789B01"
                  className="h-10 font-mono"
                />
              </FormField>
            </div>

            <FormField
              label="Business registration number"
              hint="Country-dependent (KVK for NL, SIREN/SIRET for FR, etc.)"
              mono
            >
              <Input
                value={draft.businessRegistrationNumber}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    businessRegistrationNumber: e.target.value,
                  }))
                }
                placeholder="00000000"
                className="h-10 font-mono"
              />
            </FormField>
          </div>
        </Section>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleSave} disabled={!hasChanges || !hasName} className="gap-2">
                {saved ? (
                  <>
                    <Check className="size-4" /> Saved
                  </>
                ) : (
                  "Save profile"
                )}
              </Button>
              {hasChanges && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    setDraft({ ...businessProfile, operatorName: operatorDisplayName })
                  }
                >
                  Discard changes
                </Button>
              )}
              <Button
                variant="ghost"
                className="ml-auto text-muted-foreground"
                onClick={handleReset}
              >
                Clear profile fields
              </Button>
            </div>

            <SodSettings />
            <FlexPolicySettings />
          </div>

          <div className="space-y-6 [&>*:first-child]:mt-0">
            <ComplianceSettings />

            {hasName && (
              <Section>
            <SectionHeader title="Active profile" />
                <div className="p-4">
                  <p className="text-sm font-medium">{draft.name}</p>
                  {draft.address && (
                    <p className="text-xs text-muted-foreground">{draft.address}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {draft.vatNumber && <Pill mono>BTW {draft.vatNumber}</Pill>}
                    {draft.iban && <Pill mono>{draft.iban}</Pill>}
                    {draft.email && <Pill>{draft.email}</Pill>}
                  </div>
                </div>
              </Section>
            )}

        {/*
         * Data is a setting, not a default. Foundry opens empty: the demo
         * records used to be seeded on boot, which meant the first thing an
         * operator had to do was work out which of their invoices were real.
         */}
            <Section>
          <SectionHeader title="Data" hint="Stays on this device" />
          <div className="divide-y divide-border">
            <div className="flex flex-wrap items-start justify-between gap-3 p-5">
              <div>
                <p className="text-sm font-medium">Sample data</p>
                <p className="mt-1 max-w-md text-xs text-muted-foreground">
                  Loads a few demo invoices, one completed invoice and two purchase orders so you
                  can walk the whole flow without a real document. Demo records are labelled in the
                  inbox, and removing them never touches an invoice you captured.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadSampleData}
                  disabled={hasSampleData}
                >
                  Load sample data
                </Button>
                {hasSampleData && (
                  <Button variant="ghost" size="sm" onClick={handleClearSampleData}>
                    Remove sample data
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-start justify-between gap-3 p-5">
              <div>
                <p className="text-sm font-medium">Clear all data</p>
                <p className="mt-1 max-w-md text-xs text-muted-foreground">
                  Deletes every invoice, template, source file, purchase order, and no-PO policy
                  on this device. There is no server copy to restore from.
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    Clear all data
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear all data?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes {countOf(invoices.length + history.length, "invoice")} and every
                      template, source file, purchase order, and no-PO policy on this device. It
                      cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep my data</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClearAll}>Clear everything</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
              </div>
            </Section>
          </div>
        </div>
      </div>
    </Shell>
  );
}


function downloadCompliancePack(pack: ReturnType<typeof buildCompliancePack>): void {
  const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `foundry-compliance-pack-${pack.generatedAt.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ComplianceSettings() {
  const {
    entities,
    invoices,
    history,
    removed,
    operatorDisplayName,
    complianceFrameworks,
    setComplianceFrameworks,
    dataResidency,
    setDataResidency,
  } = useAp();
  const frameworks: ComplianceFramework[] = ["SOC 2", "ISO 27001"];
  const auditEvents = [...invoices, ...history, ...removed].reduce(
    (count, invoice) => count + invoice.audit.length,
    0,
  );
  const evidencePack = buildCompliancePack({
    workspace: entities[0]?.name || "Foundry workspace",
    frameworks: complianceFrameworks,
    residency: dataResidency,
    entityJurisdictions: entities.map((entity) => entity.jurisdiction),
    auditEvents,
    operatorName: operatorDisplayName,
  });
  const openItems = evidencePack.evidence.filter(
    (evidence) => evidence.state === "needs-attention",
  );
  const selectedFrameworks = frameworks.filter((framework) =>
    complianceFrameworks.includes(framework),
  );

  function toggleFramework(framework: ComplianceFramework) {
    setComplianceFrameworks(
      complianceFrameworks.includes(framework)
        ? complianceFrameworks.filter((item) => item !== framework)
        : [...complianceFrameworks, framework],
    );
  }

  return (
    <Section className="mt-6">
      <SectionHeader
        title="Customer evidence"
        hint="Choose a standard, then download the proof."
      />
      <div className="space-y-5 p-5">
        <div>
          <p className="text-sm font-medium">1. Choose a standard</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Select one or both.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {frameworks.map((framework) => {
              const isSelected = complianceFrameworks.includes(framework);
              return (
                <Button
                  key={framework}
                  type="button"
                  size="sm"
                  variant={isSelected ? "secondary" : "outline"}
                  aria-pressed={isSelected}
                  onClick={() => toggleFramework(framework)}
                >
                  {isSelected && <Check className="size-4" />}
                  {framework}
                </Button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">2. Confirm the data boundary</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This choice is recorded in the export.
          </p>
          <Select
            value={dataResidency}
            onValueChange={(value) => setDataResidency(value as "device-only" | "eu-only")}
          >
            <SelectTrigger className="mt-3 h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="device-only">This device only</SelectItem>
              <SelectItem value="eu-only">EU entities only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="border-t border-border pt-5">
          <p className="text-sm font-medium">
            {openItems.length === 0
              ? "Ready to share"
              : `${openItems.length} item${openItems.length === 1 ? "" : "s"} need attention`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {openItems.length === 0
              ? `${evidencePack.evidence.length} checks · ${auditEvents} audit events`
              : openItems.map((item) => item.label).join(" · ")}
          </p>
          <Button
            type="button"
            className="mt-3"
            disabled={selectedFrameworks.length === 0}
            onClick={() => downloadCompliancePack(evidencePack)}
          >
            {selectedFrameworks.length === 0
              ? "Choose a standard to continue"
              : `Download ${selectedFrameworks.join(" + ")} evidence`}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Evidence for review—not a certification.
          </p>
        </div>
      </div>
    </Section>
  );
}
