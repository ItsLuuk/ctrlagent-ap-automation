/**
 * Row action: create the missing vendor master record without leaving the
 * review screen. Seeds from the invoice, gates on the same required fields
 * as VendorProfileRegistration, writes the vendor master plus a name-only
 * invoice sync when `draft.name !== invoice.vendor` (lookup consistency).
 *
 * Spec: docs/superpowers/specs/2026-09-23-vendor-no-record-create-design.md
 */
import { useState } from "react";
import { toast } from "sonner";
import { Save } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VendorProfileCard } from "./vendor-profile-card";
import { useAp } from "@/lib/app/store";
import type { Invoice } from "@/lib/ap/types";
import {
  REQUIRED_PROFILE_FIELDS,
  seedProfileFromInvoice,
  vendorProfileGapLabel,
  vendorProfileGaps,
  type ProfileField,
  type VendorMaster,
} from "@/lib/ap/vendor-master";

export function CreateVendorRecordButton({ invoice }: { invoice: Invoice }) {
  const { upsertVendor, updateInvoice } = useAp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<VendorMaster>(() => seedProfileFromInvoice(invoice));
  const [focusField, setFocusField] = useState<ProfileField | null>(null);
  const gaps = vendorProfileGaps(draft);

  const handleChange = (field: ProfileField, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    if (gaps.length > 0) {
      setFocusField(gaps[0]!);
      toast.error(`Still needed: ${vendorProfileGapLabel(gaps[0]!, draft)}`);
      return;
    }
    const record = { ...draft, updatedAt: new Date().toISOString() };
    upsertVendor(record);
    if (record.name !== invoice.vendor) {
      // Keep the row's lookup consistent with the new master key. Same as
      // registration: lookups only — no audit entry of its own.
      updateInvoice(invoice.id, { vendor: record.name });
    }
    toast.success(`Vendor record created for ${draft.name}`);
    setOpen(false);
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Create record
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto p-4">
          <DialogHeader>
            <DialogTitle>Create vendor record</DialogTitle>
            <DialogDescription>
              Seeded from this invoice. Required: vendor name, business registration number, and a
              valid IBAN.
            </DialogDescription>
          </DialogHeader>
          <VendorProfileCard
            vendor={draft}
            onChange={handleChange}
            focusField={focusField}
            onFocusDone={() => setFocusField(null)}
            requiredFields={REQUIRED_PROFILE_FIELDS}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={gaps.length > 0}>
              <Save className="size-4" /> Create record
            </Button>
            {gaps.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Required fields are missing — the profile can't be created until every field the vendor master needs has a value.
              </p>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
