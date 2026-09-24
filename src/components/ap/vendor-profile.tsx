/**
 * VendorProfile — the vendor profile card on the invoice detail page:
 * circular logo (master record logo or initials fallback), vendor name,
 * billing email, and a three-dots menu (edit vendor details, change vendor,
 * view vendor). Vendor details live in the store's vendor master records;
 * when no record exists the email/logo are derived from the name.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MoreVertical, Pencil, Repeat, UserSearch } from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ZoneCheckChip } from "./zone-check-chip";
import { cn } from "@/lib/utils";
import type { ZoneCheckResult } from "@/lib/ap/types";
import { useAp } from "@/lib/ap/store";
import type { VendorMaster } from "@/lib/ap/vendor-master";

/** Stable two-letter initials for the circular logo. */
export function initialsOf(vendor: string): string {
  const parts = vendor.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const DEPARTMENT_TONES: Record<string, string> = {
  Engineering: "bg-primary/15 text-accent-foreground",
  Finance: "bg-primary/20 text-accent-foreground",
  Marketing: "bg-warning/15 text-warning-foreground",
  Operations: "bg-success/15 text-success-foreground",
  Sales: "bg-warning/20 text-warning-foreground",
  People: "bg-secondary text-foreground",
};

/** Deterministic fallback tone for vendors without a department. */
export function logoTone(vendor: string): string {
  const tones = [
    "bg-primary/15 text-accent-foreground",
    "bg-success/15 text-success-foreground",
    "bg-warning/15 text-warning-foreground",
    "bg-secondary text-foreground",
  ];
  let hash = 0;
  for (const ch of vendor) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return tones[Math.abs(hash) % tones.length]!;
}

/** Keep the vendor circle tied to the department that owns the relationship. */
export function departmentLogoTone(department: string | undefined, vendor?: string): string {
  return (department && DEPARTMENT_TONES[department]) || logoTone(vendor ?? "unknown");
}

/** Billing email: the master record's email, or a derived fallback. */
export function vendorEmail(vendor: string, record?: VendorMaster): string {
  if (record?.email) return record.email;
  return `billing@${vendor.toLowerCase().replace(/[^a-z]+/g, "")}.com`;
}

/** Circular vendor logo from the master record, or initials fallback. */
export function VendorLogo({
  vendor,
  department,
  className = "size-11 text-sm",
}: {
  vendor: string;
  /** Explicit department while a profile is being edited. */
  department?: string | undefined;
  /** Tailwind size + text classes, e.g. "size-8 text-xs". */
  className?: string;
}) {
  const { vendors } = useAp();
  const record = vendors[vendor];
  const logoUrl = record?.logoUrl;
  const resolvedDepartment = department ?? record?.department;
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        aria-hidden
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        departmentLogoTone(resolvedDepartment, vendor),
        className,
      )}
    >
      {initialsOf(vendor)}
    </div>
  );
}

export function VendorProfile({
  vendor,
  sourcePage,
  showPage,
  zoneCheck,
  onChange,
}: {
  vendor: string;
  sourcePage?: number | undefined;
  showPage?: boolean | undefined;
  zoneCheck?: ZoneCheckResult | undefined;
  /** Absent on a frozen record: the two items that would patch the invoice's
   *  vendor (or re-key the master the invoice points at) go with it. */
  onChange?: ((value: string) => void) | undefined;
}) {
  const { vendors, upsertVendor } = useAp();
  const record = vendors[vendor];
  const knownVendors = useMemo(
    () => [...new Set([...Object.keys(vendors), vendor].filter(Boolean))],
    [vendors, vendor],
  );
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex items-center gap-3 sm:col-span-2">
      <VendorLogo vendor={vendor} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">{vendor || "Unknown vendor"}</p>
          <span className="inline-flex shrink-0 items-center gap-1.5">
            {showPage && sourcePage !== undefined ? (
              <span className="font-mono text-xs text-muted-foreground">p.{sourcePage}</span>
            ) : null}
            <ZoneCheckChip result={zoneCheck} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="size-6" aria-label="Vendor actions">
                  <MoreVertical className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {onChange ? (
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil className="size-3.5" /> Edit vendor details
                  </DropdownMenuItem>
                ) : null}
                {onChange ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Repeat className="size-3.5" /> Change vendor
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-64 overflow-auto">
                      {knownVendors
                        .filter((name) => name !== vendor)
                        .map((name) => (
                          <DropdownMenuItem key={name} onSelect={() => onChange(name)}>
                            {name}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : null}
                <DropdownMenuItem asChild>
                  <Link to="/vendors">
                    <UserSearch className="size-3.5" /> View vendor
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{vendorEmail(vendor, record)}</p>
      </div>

      <EditVendorDialog
        open={editing}
        vendor={vendor}
        record={record}
        onClose={() => setEditing(false)}
        onSave={(next) => {
          // Renaming re-keys the master record and renames the invoice's vendor.
          if (next.name !== vendor && onChange) onChange(next.name);
          upsertVendor(next);
          setEditing(false);
          toast.success("We saved the vendor details");
        }}
      />
    </div>
  );
}

/** Edit dialog for the vendor master record: name, email and logo. */
function EditVendorDialog({
  open,
  vendor,
  record,
  onClose,
  onSave,
}: {
  open: boolean;
  vendor: string;
  record: VendorMaster | undefined;
  onClose: () => void;
  onSave: (vendor: VendorMaster) => void;
}) {
  const [name, setName] = useState(vendor);
  const [email, setEmail] = useState(record?.email ?? vendorEmail(vendor, record));
  const [logoUrl, setLogoUrl] = useState<string | undefined>(record?.logoUrl);

  // Reset local state when opening for a (possibly different) vendor.
  const key = `${open}:${vendor}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setName(vendor);
    setEmail(record?.email ?? vendorEmail(vendor, record));
    setLogoUrl(record?.logoUrl);
  }

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setLogoUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit vendor details</DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt="" aria-hidden className="size-12 rounded-full object-cover" />
            ) : (
              <div
                aria-hidden
                className={`flex size-12 items-center justify-center rounded-full text-sm font-semibold ${departmentLogoTone(record?.department, name)}`}
              >
                {initialsOf(name)}
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <Label className="text-xs text-muted-foreground" htmlFor="vendor-logo">
                Logo
              </Label>
              <input
                id="vendor-logo"
                type="file"
                accept="image/*"
                className="block w-full text-xs text-muted-foreground file:mr-2 file:rounded-sm file:border-0 file:bg-muted file:px-3 file:py-2 file:text-xs"
                onChange={(event) => pickLogo(event.target.files?.[0])}
              />
            </div>
          </div>
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-muted-foreground">Name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-muted-foreground">Email</span>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="billing@vendor.com"
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({
                name: name.trim() || vendor,
                email: email.trim(),
                logoUrl,
                updatedAt: new Date().toISOString(),
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
