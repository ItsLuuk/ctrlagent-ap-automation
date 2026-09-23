/**
 * VendorProfileRegistration — the dedicated phase for first-time vendors.
 *
 * Shown when `invoice.status === "vendor_profile"`. The user pins the vendor's
 * identity (name, address, IBAN, VAT, KVK, business email, **department**), saves
 * the record to vendor-master, and transitions the invoice into Draft. Reject
 * routes to the rejected pile with a required reason.
 *
 * Spec: docs/superpowers/specs/2026-09-22-vendor-profile-registration-phase-design.md
 */
import { useMemo, useRef, useState, type FocusEvent } from "react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { BadgeCheck, Save, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DocPreview } from "./doc-preview";
import { ReviewHeader } from "./review-header";
import { Shell } from "./shell";
import { VendorProfileCard } from "./vendor-profile-card";
import { useAp } from "@/lib/ap/store";
import { TRANSITION_LABEL, type Actor } from "@/lib/ap/state-machine";
import type { Invoice, Zone, ZoneField } from "@/lib/ap/types";
import { isImageInvoice } from "@/lib/ap/file-type";
import { suggestZone } from "@/lib/ap/mapping";
import {
  profileCorrections,
  profileFieldLabel,
  PROFILE_ZONE_FIELD,
  REQUIRED_PROFILE_FIELDS,
  seedProfileFromInvoice,
  vendorProfileGapLabel,
  vendorProfileGaps,
  type ProfileField,
  type VendorMaster,
} from "@/lib/ap/vendor-master";

/**
 * Demo processor actor. Real auth is not in scope; the audit trail has to name
 * someone. The processor role is the only one allowed to confirm a profile
 * (state-machine TRANSITIONS rule).
 */
const PROCESSOR_ACTOR: Actor = { name: "Luuk Koppen", roles: ["processor"] };

export function VendorProfileRegistration({ invoice }: { invoice: Invoice }) {
  const { upsertVendor, updateInvoice, applyTransition, vendors } = useAp();
  const navigate = useNavigate();
  const storeRecord = vendors[invoice.vendor];
  const [profileDraft, setProfileDraft] = useState<VendorMaster>(
    () => storeRecord ?? seedProfileFromInvoice(invoice),
  );
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [profileFocus, setProfileFocus] = useState<ProfileField | null>(null);
  /** Profile as first seeded — the "before" side of the identity audit trail. */
  const seedRef = useRef(storeRecord ?? seedProfileFromInvoice(invoice));

  /** Profile field currently focused — drives the document highlight. */
  const [focusedProfileField, setFocusedProfileField] = useState<ProfileField | undefined>(
    undefined,
  );

  /** Nearest field-tagged control for a focus event endpoint, or undefined. */
  const fieldOf = (node: EventTarget | null): ProfileField | undefined => {
    if (!(node instanceof Element)) return undefined;
    const host = node.closest("[data-profile-field]") as HTMLElement | null;
    return (host?.dataset.profileField as ProfileField | undefined) ?? undefined;
  };

  /** One delegated pair on the form container — capture phase, covers every control. */
  const handleFocusCapture = (e: FocusEvent<HTMLDivElement>) => {
    setFocusedProfileField(fieldOf(e.target));
  };

  /** Blur guard: clear only when the next focus target's field differs (or is gone). */
  const handleBlurCapture = (e: FocusEvent<HTMLDivElement>) => {
    if (fieldOf(e.target) !== fieldOf(e.relatedTarget)) setFocusedProfileField(undefined);
  };

  const handleChange = (field: ProfileField, value: string) => {
    setProfileDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    // Registration gate: name + business registration (the identity pair) and
    // a checksum-valid IBAN (the payment route). Everything else is nudged by
    // the completeness meter, not blocked on.
    const gaps = vendorProfileGaps(profileDraft);
    if (gaps.length > 0) {
      const labels = gaps.map((field) => vendorProfileGapLabel(field, profileDraft));
      const list =
        labels.length > 1
          ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
          : labels[0];
      const ibanUnreadable = gaps.includes("iban") && (profileDraft.iban ?? "").trim() !== "";
      toast.error("Complete the required fields before saving", {
        description: ibanUnreadable
          ? `${list} — the IBAN check digits don't match the number, so re-read it from the document.`
          : `${list} must be filled in — they carry forward to every future invoice from this vendor.`,
      });
      const first = gaps[0];
      if (first) setProfileFocus(first);
      return;
    }
    setBusy(true);
    try {
      const finalRecord: VendorMaster = {
        ...profileDraft,
        // The draft screen's IBAN-field normalises to upper-case; do the same here.
        iban: profileDraft.iban?.toUpperCase(),
        vatNumber: profileDraft.vatNumber?.toUpperCase(),
        businessRegistrationNumber: profileDraft.businessRegistrationNumber?.trim(),
        // Trimmed so the profile meter reads "missing" rather than "filled
        // with whitespace" — profileCompleteness already treats "" as missing,
        // and `email` is a required string on VendorMaster.
        email: profileDraft.email.trim(),
        updatedAt: new Date().toISOString(),
      };
      // Identity corrections are audited like draft corrections: one entry per
      // changed field, naming the field and the person who changed it. The
      // seed was captured before any edit, so untouched extractions stay out
      // of the trail — only what the operator actually typed is recorded.
      for (const { field, from, to } of profileCorrections(seedRef.current, finalRecord)) {
        updateInvoice(
          invoice.id,
          {},
          `Corrected ${profileFieldLabel(field, finalRecord)} on vendor profile`,
          `was "${from || "empty"}" → "${to || "empty"}"`,
          PROCESSOR_ACTOR.name,
        );
      }
      upsertVendor(finalRecord);

      // Carry the per-vendor department into the invoice if the invoice didn't
      // already have one. The processor can still override it on Draft.
      if (finalRecord.department && !invoice.department) {
        updateInvoice(
          invoice.id,
          { department: finalRecord.department, vendor: finalRecord.name },
          "Vendor profile fields carried into invoice",
          `department default from profile: ${finalRecord.department}`,
          PROCESSOR_ACTOR.name,
        );
      } else if (finalRecord.name !== invoice.vendor) {
        // Carry the (possibly operator-corrected) name forward so the vendor
        // lookup on draft doesn't mismatch the record. The correction itself is
        // audited by the per-field trail above — this patch only keeps
        // lookups consistent, so it writes no audit entry of its own.
        updateInvoice(invoice.id, { vendor: finalRecord.name });
      }

      const result = applyTransition(invoice.id, {
        transition: "vendor-profile-confirmed",
        actor: PROCESSOR_ACTOR,
        note: `Profile saved for ${finalRecord.name}`,
      });
      if (!result.accepted) {
        toast.error("Couldn't move the invoice to Draft", {
          description: result.reason ?? "Try again — the audit log has more detail.",
        });
        return;
      }
      toast.success(`Saved ${finalRecord.name} as a known vendor`, {
        description: "The invoice is now in Draft for the rest of the review.",
      });
      // Stay on the same URL — the route re-renders into the Draft mapper
      // because status is no longer `vendor_profile`.
    } finally {
      setBusy(false);
    }
  };

  const handleReject = () => {
    if (!reason.trim()) {
      toast.error("Add a reason before rejecting", {
        description: "Reject requires a note for the audit trail.",
      });
      return;
    }
    setBusy(true);
    try {
      const result = applyTransition(invoice.id, {
        transition: "vendor-profile-rejected",
        actor: PROCESSOR_ACTOR,
        note: reason.trim(),
      });
      if (!result.accepted) {
        toast.error("Couldn't reject this invoice", {
          description: result.reason ?? "Try again.",
        });
        return;
      }
      toast.message("Invoice rejected", {
        description: `${TRANSITION_LABEL["vendor-profile-rejected"]}: ${reason.trim()}`,
      });
      navigate({ to: "/" });
    } finally {
      setBusy(false);
    }
  };

  /** Same predicate review uses — an uploaded image file (not PDF, not sample). */
  const isImage = Boolean(invoice.fileUrl && isImageInvoice(invoice.fileType, invoice.fileName));

  /** Where each profile field sits on the page, for focus → document jump. */
  const zones = useMemo(() => {
    const out: Partial<Record<ZoneField, Zone>> = {};
    if (!isImage) return out;
    for (const mapped of Object.values(PROFILE_ZONE_FIELD)) {
      if (!mapped) continue;
      const zone = invoice.zones?.[mapped] ?? suggestZone(invoice, mapped);
      if (zone) out[mapped] = zone;
    }
    return out;
  }, [invoice, isImage]);

  const zoneField = focusedProfileField ? PROFILE_ZONE_FIELD[focusedProfileField] : undefined;
  const highlight = zoneField ? zones[zoneField] : undefined;

  return (
    <Shell>
      <ReviewHeader invoice={invoice} />

      <div className="mt-5 rounded-xl border border-foundry-orange/40 bg-foundry-orange/5 p-4">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-foundry-orange">
          Vendor profile registration
        </p>
        <p className="mt-1 text-sm font-medium">
          First time seeing this vendor. Pin the identity, then move on to the invoice.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Fields below are seeded from extraction — check them against the document on the left.
          Anything missing or wrong, correct it here: it carries forward to every future invoice
          from this vendor.
        </p>
      </div>

      {/* The same two panes the review screen uses: the document pinned on the
          left, the fields being checked against it on the right. */}
      <div className="mt-5 grid gap-5 pb-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="self-start overflow-hidden rounded-lg border border-border bg-card lg:sticky lg:top-2">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <p className="text-xs font-medium text-muted-foreground">Document</p>
            <p className="truncate text-xs text-muted-foreground">
              {invoice.pageCount && invoice.pageCount > 1 ? `${invoice.pageCount} pages · ` : ""}
              {invoice.fileName ?? "sample invoice"}
            </p>
          </div>
          {/* The identity fields are extracted FROM this document — showing it
              is what lets the reviewer verify name, IBAN, and registration
              number against the source instead of trusting extraction blind. */}
          <DocPreview invoice={invoice} highlight={highlight} />
        </section>

        <div className="space-y-4">
          <VendorProfileCard
            vendor={profileDraft}
            onChange={handleChange}
            focusField={profileFocus}
            onFocusDone={() => setProfileFocus(null)}
            requiredFields={REQUIRED_PROFILE_FIELDS}
            onFocusCapture={handleFocusCapture}
            onBlurCapture={handleBlurCapture}
          />

          {rejectOpen ? (
            <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-destructive">
                Reject this invoice
              </p>
              <p className="mt-1 text-sm">
                Tell the team why. The reason is recorded on the audit log.
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. wrong vendor on the letterhead — this is for Acme Holding, not Acme BV"
                className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRejectOpen(false);
                    setReason("");
                  }}
                >
                  Cancel
                </Button>
                <Button size="sm" variant="destructive" onClick={handleReject} disabled={busy}>
                  <X className="size-3.5" /> Confirm reject
                </Button>
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSave} disabled={busy}>
                  <Save className="size-4" /> Save profile & open draft
                </Button>
                <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={busy}>
                  <BadgeCheck className="size-4" /> Reject this invoice
                </Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Saving writes the profile to vendor-master, moves the invoice into Draft, and
                carries the chosen department forward. Required: vendor name, business registration
                number, and a valid IBAN.
              </p>
            </section>
          )}
        </div>
      </div>
    </Shell>
  );
}
