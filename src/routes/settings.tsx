/**
 * Settings page — Business profile configuration.
 *
 * The business profile is used during invoice extraction to filter out
 * customer/bill-to data. Everything matching this profile is NOT the vendor.
 */
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Building2 } from "@/components/icons";
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
import { useAp } from "@/lib/ap/store";
import type { BusinessProfile } from "@/lib/ap/types";
import { countOf } from "@/lib/ap/vocabulary";
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
        content: "Configure your business profile to improve invoice extraction.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const {
    businessProfile,
    setBusinessProfile,
    invoices,
    history,
    hasSampleData,
    loadSampleData,
    clearSampleData,
    clearAllData,
  } = useAp();
  const [draft, setDraft] = useState<BusinessProfile>({ ...businessProfile });
  const [saved, setSaved] = useState(false);

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(businessProfile);
  const hasName = draft.name.trim().length > 0;

  const handleSave = () => {
    setBusinessProfile(draft);
    setSaved(true);
    toast.success("Business profile saved", {
      description: "Invoice extraction will now use this to filter out your own data.",
    });
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setDraft({
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
        title="Business Profile"
        subtitle="Your company details — used to filter out your own data during extraction"
      />

      <div className="mt-4 max-w-2xl">
        <InfoBanner variant="accent">
          When your business profile is filled in, the extraction engine ignores your own address,
          VAT number, IBAN, and email when scanning invoices. This means faster processing and fewer
          false matches on vendor fields.
        </InfoBanner>

        <Section className="mt-6">
          <SectionHeader title="Company details" hint="Required fields marked with *" />
          <div className="space-y-5 p-5">
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

        <div className="mt-6 flex items-center gap-3">
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
            <Button variant="ghost" onClick={() => setDraft({ ...businessProfile })}>
              Discard changes
            </Button>
          )}
          <Button variant="ghost" className="ml-auto text-muted-foreground" onClick={handleReset}>
            Clear profile fields
          </Button>
        </div>

        {hasName && (
          <Section className="mt-6">
            <SectionHeader title="Active profile" />
            <div className="p-4">
              <p className="text-sm font-medium">{draft.name}</p>
              {draft.address && <p className="text-xs text-muted-foreground">{draft.address}</p>}
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
        <Section className="mt-8">
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
                  Deletes every invoice, template, source file and purchase order on this device.
                  There is no server copy to restore from.
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
                      template, source file and purchase order on this device. It cannot be undone.
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
    </Shell>
  );
}
