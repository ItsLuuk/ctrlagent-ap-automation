import { useEffect, useMemo, useRef, useState, type FocusEventHandler } from "react";
import { Link } from "@tanstack/react-router";
import { IBAN_SHAPE, ibanChecksumValid, normalizeIban } from "@/lib/ap/iban";
import {
  BadgeCheck,
  ChevronRight,
  ClipboardPaste,
  MoreVertical,
  Pencil,
  Save,
  AlertTriangle,
  UserSearch,
} from "@/components/icons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  DEPARTMENTS,
  profileCompleteness,
  type ProfileField,
  type VendorMaster,
} from "@/lib/ap/vendor-master";
import { useAp } from "@/lib/ap/store";
import { VendorLogo, vendorEmail } from "./vendor-profile";
import { Section } from "./primitives";

/* ─── IBAN catalogue ─────────────────────────────────────────────── */

type IbanCountry = {
  code: string;
  name: string;
  length: number;
  bankLen: number;
  bankLabel: string;
  bankPlaceholder: string;
};

const IBAN_COUNTRIES: IbanCountry[] = [
  {
    code: "NL",
    name: "Netherlands",
    length: 18,
    bankLen: 4,
    bankLabel: "Bank",
    bankPlaceholder: "INGB",
  },
  {
    code: "BE",
    name: "Belgium",
    length: 16,
    bankLen: 3,
    bankLabel: "Bank",
    bankPlaceholder: "001",
  },
  {
    code: "DE",
    name: "Germany",
    length: 22,
    bankLen: 8,
    bankLabel: "BLZ",
    bankPlaceholder: "10070000",
  },
  {
    code: "FR",
    name: "France",
    length: 27,
    bankLen: 5,
    bankLabel: "Bank",
    bankPlaceholder: "20041",
  },
  { code: "ES", name: "Spain", length: 24, bankLen: 4, bankLabel: "Bank", bankPlaceholder: "0049" },
  {
    code: "IT",
    name: "Italy",
    length: 27,
    bankLen: 5,
    bankLabel: "Bank",
    bankPlaceholder: "02008",
  },
  {
    code: "GB",
    name: "United Kingdom",
    length: 22,
    bankLen: 4,
    bankLabel: "Bank",
    bankPlaceholder: "BARC",
  },
  {
    code: "IE",
    name: "Ireland",
    length: 22,
    bankLen: 4,
    bankLabel: "Bank",
    bankPlaceholder: "AIBK",
  },
  {
    code: "AT",
    name: "Austria",
    length: 20,
    bankLen: 5,
    bankLabel: "Bank",
    bankPlaceholder: "12000",
  },
  {
    code: "PT",
    name: "Portugal",
    length: 25,
    bankLen: 4,
    bankLabel: "Bank",
    bankPlaceholder: "0007",
  },
  {
    code: "LU",
    name: "Luxembourg",
    length: 20,
    bankLen: 3,
    bankLabel: "Bank",
    bankPlaceholder: "001",
  },
  {
    code: "CH",
    name: "Switzerland",
    length: 21,
    bankLen: 5,
    bankLabel: "Bank",
    bankPlaceholder: "00762",
  },
];

const BANKS_BY_COUNTRY: Record<string, Array<{ code: string; name: string }>> = {
  NL: [
    { code: "ABNA", name: "ABN AMRO" },
    { code: "INGB", name: "ING" },
    { code: "RABO", name: "Rabobank" },
    { code: "SNSB", name: "SNS Bank" },
    { code: "ASNB", name: "ASN Bank" },
    { code: "TRIO", name: "Triodos" },
    { code: "KNAB", name: "Knab" },
    { code: "BUNQ", name: "bunq" },
    { code: "REVO", name: "Revolut" },
    { code: "DEUT", name: "Deutsche Bank NL" },
    { code: "HAND", name: "Handelsbanken" },
    { code: "KASA", name: "KAS Bank" },
  ],
  DE: [
    { code: "10070000", name: "Deutsche Bank Berlin" },
    { code: "12030000", name: "DKB Berlin" },
    { code: "20041111", name: "Commerzbank Hamburg" },
    { code: "37040044", name: "Commerzbank Köln" },
    { code: "50010517", name: "ING-DiBa" },
    { code: "70020800", name: "HypoVereinsbank" },
    { code: "76026000", name: "Norisbank" },
    { code: "10010010", name: "Postbank Berlin" },
  ],
  BE: [
    { code: "001", name: "BNP Paribas Fortis" },
    { code: "068", name: "Belfius" },
    { code: "088", name: "ING Belgium" },
    { code: "103", name: "KBC" },
    { code: "363", name: "Bpost Bank" },
    { code: "539", name: "Argenta" },
  ],
  FR: [
    { code: "20041", name: "Banque Postale" },
    { code: "30002", name: "Crédit Lyonnais" },
    { code: "30004", name: "BNP Paribas" },
    { code: "10278", name: "Crédit Commercial" },
    { code: "18715", name: "Caisse d'Épargne" },
    { code: "30066", name: "Société Générale" },
  ],
  ES: [
    { code: "0049", name: "Santander" },
    { code: "0182", name: "BBVA" },
    { code: "2100", name: "CaixaBank" },
    { code: "0081", name: "Sabadell" },
    { code: "1465", name: "ING Spain" },
  ],
  IT: [
    { code: "02008", name: "UniCredit" },
    { code: "03002", name: "Intesa Sanpaolo" },
    { code: "01005", name: "BNL" },
    { code: "01030", name: "Monte dei Paschi" },
  ],
  GB: [
    { code: "BARC", name: "Barclays" },
    { code: "LOYD", name: "Lloyds" },
    { code: "HBUK", name: "HSBC UK" },
    { code: "NWBK", name: "NatWest" },
    { code: "MIDL", name: "HSBC (Midland)" },
    { code: "TSBS", name: "TSB" },
  ],
  IE: [
    { code: "AIBK", name: "AIB" },
    { code: "BOFI", name: "Bank of Ireland" },
    { code: "ULSB", name: "Ulster Bank" },
  ],
};

function splitIban(value: string | undefined) {
  const n = normalizeIban(value ?? "");
  const country = /^[A-Z]{2}/.test(n) ? n.slice(0, 2) : "";
  const check = n.length >= 4 ? n.slice(2, 4) : n.slice(2);
  const cfg = IBAN_COUNTRIES.find((c) => c.code === country);
  const bankLen = cfg?.bankLen ?? 4;
  const bban = n.length > 4 ? n.slice(4) : "";
  return {
    normalized: n,
    country,
    check,
    bank: bban.slice(0, bankLen),
    account: bban.slice(bankLen),
    cfg,
  };
}

function formatIban(normalized: string) {
  return normalized.replace(/(.{4})/g, "$1 ").trim();
}

/* ─── iOS-style structured IBAN field ────────────────────────────── */

function IbanField({
  value,
  onChange,
  inputRef,
  required,
}: {
  value: string;
  onChange: (full: string) => void;
  inputRef: (el: HTMLInputElement | null) => void;
  required?: boolean;
}) {
  const parts = useMemo(() => splitIban(value), [value]);
  const { country, check, bank, account, normalized, cfg } = parts;
  const expectedLen = cfg?.length;
  const bankList = (country && BANKS_BY_COUNTRY[country]) || null;
  const bankIsListed = bankList?.some((b) => b.code === bank) ?? false;
  const [bankCustom, setBankCustom] = useState(false);
  const showCustomBank = Boolean(bankList && (bankCustom || (bank !== "" && !bankIsListed)));
  const bankSelectValue = !bankList
    ? undefined
    : showCustomBank
      ? "custom"
      : bank === ""
        ? undefined
        : bank;

  const bankLen = cfg?.bankLen ?? 4;
  const bankInputMode =
    country === "NL" || country === "GB" || country === "IE" ? "text" : "numeric";

  const reassemble = (next: {
    country?: string;
    check?: string;
    bank?: string;
    account?: string;
  }) => {
    const c = (next.country ?? country)
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 2);
    const k = (next.check ?? check).replace(/\D/g, "").slice(0, 2);
    const b = (next.bank ?? bank)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, bankLen);
    const a = (next.account ?? account)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 24);
    onChange(`${c}${k}${b}${a}`);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    const pasted = normalizeIban(text);
    if (IBAN_SHAPE.test(pasted)) {
      e.preventDefault();
      onChange(pasted);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const pasted = normalizeIban(text);
      if (IBAN_SHAPE.test(pasted)) onChange(pasted);
    } catch {
      /* clipboard unavailable — user can paste manually */
    }
  };

  const validity = useMemo(() => {
    if (!normalized)
      return { tone: "idle" as const, message: "Paste a full IBAN or build it below." };
    if (!/^[A-Z]{2}/.test(normalized) || !cfg)
      return { tone: "warn" as const, message: "Pick the country code first." };
    if (expectedLen && normalized.length !== expectedLen)
      return {
        tone: "warn" as const,
        message: `Expects ${expectedLen} characters — now ${normalized.length}.`,
      };
    if (!/^\d{2}$/.test(check))
      return { tone: "warn" as const, message: "Enter the 2 check digits." };
    if (!ibanChecksumValid(normalized))
      return {
        tone: "error" as const,
        message: "These check digits don't match — re-read the IBAN.",
      };
    return { tone: "ok" as const, message: `Valid ${country} IBAN.` };
  }, [normalized, cfg, expectedLen, check, country]);

  const iosInput =
    "h-11 rounded-sm bg-background text-sm shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow,transform] duration-200 ease-out-expo focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring/50 active:scale-[0.995]";

  return (
    <div onPaste={handlePaste}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="block text-xs font-medium text-muted-foreground">
          IBAN
          {required ? (
            <>
              <span aria-hidden className="ml-0.5 text-warning-foreground">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          ) : null}
        </span>
        <div className="flex items-center gap-1.5">
          {validity.tone === "ok" ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
              <BadgeCheck className="size-3" /> Valid
            </span>
          ) : validity.tone !== "idle" ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
              <AlertTriangle className="size-3 text-warning-foreground" /> Check
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 rounded-full px-2 text-xs text-primary"
            onClick={pasteFromClipboard}
            title="Paste IBAN from clipboard"
          >
            <ClipboardPaste className="size-3.5" /> Paste
          </Button>
        </div>
      </div>

      {/* iOS grouped card — single row: country · check · bank · account */}
      <div className="rounded-xl border border-border/60 bg-secondary/30 p-2 transition-colors duration-200 ease-out-expo">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select
            {...(country ? { value: country } : {})}
            onValueChange={(v) => reassemble({ country: v })}
          >
            <SelectTrigger
              data-profile-field="iban"
              aria-label="IBAN country code"
              title={cfg ? `${country} — ${cfg.name}` : "Country code"}
              className={`${iosInput} w-full font-mono font-semibold uppercase sm:w-[104px] sm:shrink-0`}
            >
              <span className="truncate">
                {country || <span className="text-muted-foreground">NL</span>}
              </span>
            </SelectTrigger>
            <SelectContent>
              {IBAN_COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            ref={inputRef}
            data-profile-field="iban"
            aria-label="IBAN check digits"
            inputMode="numeric"
            maxLength={2}
            placeholder="95"
            className={`${iosInput} w-full text-center font-mono tracking-widest sm:w-[64px] sm:shrink-0`}
            value={check}
            onChange={(e) => reassemble({ check: e.target.value })}
          />
          {bankList && !showCustomBank ? (
            <Select
              {...(bankSelectValue ? { value: bankSelectValue } : {})}
              onValueChange={(v) => {
                if (v === "custom") {
                  setBankCustom(true);
                  return;
                }
                setBankCustom(false);
                reassemble({ bank: v, account });
              }}
            >
              <SelectTrigger
                data-profile-field="iban"
                aria-label="IBAN bank code"
                title={bank || cfg?.bankPlaceholder || "Bank code"}
                className={`${iosInput} w-full font-mono font-semibold uppercase sm:min-w-0 sm:flex-1`}
              >
                <span className="truncate">
                  {bank || (
                    <span className="text-muted-foreground">{cfg?.bankPlaceholder ?? "RABO"}</span>
                  )}
                </span>
              </SelectTrigger>
              <SelectContent>
                {bankList.map((b) => (
                  <SelectItem key={b.code} value={b.code}>
                    {b.code} · {b.name}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Other…</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Input
              data-profile-field="iban"
              aria-label="IBAN bank code"
              inputMode={bankInputMode}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={bankLen}
              placeholder={cfg?.bankPlaceholder ?? "RABO"}
              className={`${iosInput} w-full font-mono font-semibold uppercase sm:min-w-0 sm:flex-1`}
              // Always the segment of the IBAN the field is part of. Blanking it
              // while custom mode was on left the bank box empty next to a
              // complete, valid IBAN and a readout that still showed the code.
              value={bank}
              onChange={(e) => {
                setBankCustom(true);
                reassemble({ bank: e.target.value });
              }}
              onBlur={(e) => {
                if (!e.target.value) setBankCustom(false);
              }}
            />
          )}
          <Input
            data-profile-field="iban"
            aria-label="IBAN account number"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="0123456789"
            className={`${iosInput} w-full font-mono uppercase tracking-wide sm:min-w-0 sm:flex-[2]`}
            value={account}
            onChange={(e) => reassemble({ account: e.target.value })}
          />
        </div>

        {normalized && (
          <p className="mt-2 truncate rounded-xl bg-background/70 px-3 py-2 font-mono text-xs tracking-wider text-muted-foreground">
            {formatIban(normalized)}
          </p>
        )}
      </div>
      <p
        className={
          validity.tone === "error"
            ? "mt-1.5 text-xs text-destructive"
            : validity.tone === "ok"
              ? "mt-1.5 text-xs text-foreground"
              : "mt-1.5 text-xs text-muted-foreground"
        }
        role="status"
      >
        {validity.message}
        {expectedLen && normalized ? ` (${normalized.length}/${expectedLen})` : ""}
      </p>
    </div>
  );
}

/**
 * Dual-mode vendor profile card:
 * - **New vendor** (no store record): editable fields — name + email
 *   side by side, address, structured IBAN, BTW number + KVK number.
 * - **Known vendor** (has store record): slim card with circle logo, name, email,
 *   and a three-dots menu (edit details, change vendor, view vendor).
 *
 * Clicking the slim card or the "Edit vendor details" menu item switches to
 * edit mode so the reviewer can update any field.
 */
export function VendorProfileCard({
  vendor,
  onChange,
  onSave,
  saveLabel = "Save changes",
  saving = false,
  focusField,
  onFocusDone,
  requiredFields,
  onFocusCapture,
  onBlurCapture,
}: {
  vendor: VendorMaster;
  onChange: (field: ProfileField, value: string) => void;
  /** Persist the edited profile. Rendered as the card's primary footer action. */
  onSave?: (() => void) | undefined;
  saveLabel?: string | undefined;
  saving?: boolean | undefined;
  focusField: ProfileField | null;
  onFocusDone: () => void;
  /** Fields the current phase gates on — marked with a required asterisk. */
  requiredFields?: readonly ProfileField[];
  /** Capture-phase focus delegation from the registration screen (document highlight). */
  onFocusCapture?: FocusEventHandler<HTMLDivElement>;
  onBlurCapture?: FocusEventHandler<HTMLDivElement>;
}) {
  const required = (field: ProfileField) => requiredFields?.includes(field) ?? false;
  const requiredMark = (field: ProfileField) =>
    required(field) ? (
      <>
        <span aria-hidden className="ml-0.5 text-warning-foreground">
          *
        </span>
        <span className="sr-only"> (required)</span>
      </>
    ) : null;
  const { vendors } = useAp();
  const record = vendors[vendor.name];
  const isKnown = Boolean(record && (record.email || record.logoUrl));
  const [expanded, setExpanded] = useState(!isKnown);
  const refs = useRef<Partial<Record<ProfileField, HTMLInputElement | null>>>({});

  // Collapse to slim card when vendor becomes known (e.g. after first confirm).
  useEffect(() => {
    if (isKnown && expanded) {
      // Don't auto-collapse while the user is actively editing
    }
  }, [isKnown, expanded]);

  useEffect(() => {
    if (!focusField) return;
    // Ensure we are in expanded mode so the input is visible
    setExpanded(true);
    // Small delay so the DOM renders the input before we focus it
    const id = requestAnimationFrame(() => {
      refs.current[focusField]?.focus();
      onFocusDone();
    });
    return () => cancelAnimationFrame(id);
  }, [focusField, onFocusDone]);

  // ─── Slim (known vendor) ──────────────────────────────────────────
  if (isKnown && !expanded) {
    return (
      <Section>
        <div className="flex items-center gap-3 px-4 py-3">
          <VendorLogo
            vendor={vendor.name}
            department={vendor.department}
            className="size-10 text-xs"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{vendor.name || "Unknown vendor"}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {vendorEmail(vendor.name, record)}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="size-7" aria-label="Vendor actions">
                <MoreVertical className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => setExpanded(true)}>
                <Pencil className="size-3.5" /> Edit vendor details
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/vendors">
                  <UserSearch className="size-3.5" /> View vendor
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Section>
    );
  }

  // ─── Expanded (new vendor or edit mode) ────────────────────────────
  const { filled, total } = profileCompleteness(vendor);

  const fieldLabel = "block text-xs font-medium text-muted-foreground";
  const fieldInput = "h-10 text-sm";

  return (
    <Section>
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-xs font-medium  text-muted-foreground">Vendor profile</p>
        <div className="flex items-center gap-2">
          <p className="font-mono text-xs text-muted-foreground">
            {filled}/{total}
          </p>
          {isKnown && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5"
              onClick={() => setExpanded(false)}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div
        className="space-y-3 px-4 py-3"
        onFocusCapture={onFocusCapture}
        onBlurCapture={onBlurCapture}
      >
        {/* 1 + 2 — name next to email */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className={fieldLabel}>Vendor name{requiredMark("name")}</span>
            <Input
              ref={(el) => {
                refs.current.name = el;
              }}
              data-profile-field="name"
              aria-required={required("name") || undefined}
              className={fieldInput}
              value={vendor.name ?? ""}
              placeholder="Vendor name"
              onChange={(e) => onChange("name", e.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className={fieldLabel}>Vendor email</span>
            <Input
              ref={(el) => {
                refs.current.email = el;
              }}
              data-profile-field="email"
              className={fieldInput}
              type="email"
              value={vendor.email ?? ""}
              placeholder="billing@vendor.com"
              onChange={(e) => onChange("email", e.target.value)}
            />
          </label>
        </div>

        {/* 3 — address */}
        <label className="block space-y-1.5">
          <span className={fieldLabel}>Address</span>
          <Input
            ref={(el) => {
              refs.current.address = el;
            }}
            data-profile-field="address"
            className={fieldInput}
            value={vendor.address ?? ""}
            placeholder="Street, city"
            onChange={(e) => onChange("address", e.target.value)}
          />
        </label>

        {/* 4 — structured IBAN */}
        {/* Department — per-vendor default (invoices from this vendor prefill
            Invoice.department on the vendor_profile -> draft transition). */}
        <label className="block space-y-1.5">
          <span className={fieldLabel}>Department</span>
          <Select
            {...(vendor.department ? { value: vendor.department } : {})}
            onValueChange={(v) => onChange("department", v)}
          >
            <SelectTrigger
              data-profile-field="department"
              className={`${fieldInput} w-full`}
              aria-label="Department"
            >
              <span className="truncate">
                {vendor.department ?? (
                  <span className="text-muted-foreground">Pick a department</span>
                )}
              </span>
            </SelectTrigger>
            <SelectContent>
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <IbanField
          value={vendor.iban ?? ""}
          onChange={(full) => onChange("iban", full)}
          required={required("iban")}
          inputRef={(el) => {
            refs.current.iban = el;
          }}
        />

        {/* 5 + 6 — BTW next to KVK */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className={fieldLabel}>BTW / VAT number</span>
            <Input
              ref={(el) => {
                refs.current.vatNumber = el;
              }}
              data-profile-field="vatNumber"
              className={fieldInput}
              value={vendor.vatNumber ?? ""}
              placeholder="NL000000000B00"
              onChange={(e) => onChange("vatNumber", e.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className={fieldLabel}>
              Business registration number{requiredMark("businessRegistrationNumber")}
            </span>
            <Input
              ref={(el) => {
                refs.current.businessRegistrationNumber = el;
              }}
              data-profile-field="businessRegistrationNumber"
              aria-required={required("businessRegistrationNumber") || undefined}
              className={fieldInput}
              value={vendor.businessRegistrationNumber ?? ""}
              placeholder="00000000"
              onChange={(e) => onChange("businessRegistrationNumber", e.target.value)}
            />
          </label>
        </div>
        {onSave && (
          <div className="flex items-center justify-end border-t border-border px-4 py-3">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onSave();
                setExpanded(false);
              }}
              disabled={saving}
            >
              <Save className="size-3.5" />
              {saving ? "Saving…" : saveLabel}
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
