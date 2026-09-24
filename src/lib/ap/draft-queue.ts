import type { ExtractedField } from "./types";
import { PROFILE_FIELDS, type ProfileField, type VendorMaster } from "./vendor-master";
import {
  BUSINESS_REGISTRATION_LABEL_FALLBACK,
  businessRegistrationLabel,
  registrationCountry,
} from "./business-registration";

export type QueueKind = "blocking" | "warning" | "amber" | "profile-gap";

export type QueueField = ExtractedField | "currency" | "department";

export type QueueItem = {
  key: string;
  kind: QueueKind;
  /** Invoice field to focus/edit; undefined for profile gaps (focus the profile card). */
  field?: QueueField | undefined;
  /** Profile field for profile-gap items. */
  profileField?: ProfileField | undefined;
  label: string;
  message: string;
};

export const PROFILE_GAP_LABEL: Record<ProfileField, string> = {
  name: "Vendor name",
  email: "Vendor email",
  address: "Address",
  iban: "IBAN",
  vatNumber: "BTW number",
  // The country table decides the real label (see `gapLabel`); this is only the
  // fallback for a vendor whose identifiers do not name a country.
  businessRegistrationNumber: BUSINESS_REGISTRATION_LABEL_FALLBACK,
};

/**
 * The label for a missing vendor field. The registration number is the one field
 * whose name is country-scoped, so it follows the vendor's own identifiers: a
 * Dutch vendor is asked for a KVK number, a French one for a SIREN / SIRET.
 */
function gapLabel(field: ProfileField, vendor: VendorMaster): string {
  if (field !== "businessRegistrationNumber") return PROFILE_GAP_LABEL[field];
  return businessRegistrationLabel(registrationCountry(vendor.vatNumber, vendor.iban));
}

/** Maps blocking/warning issue codes to the invoice field they concern. */
const FIELD_BY_ISSUE_CODE: Record<string, QueueField> = {
  missing_vendor: "vendor",
  missing_invoice_number: "invoiceNumber",
  missing_issue_date: "issueDate",
  invalid_issue_date: "issueDate",
  missing_due_date: "dueDate",
  invalid_due_date: "dueDate",
  missing_total: "total",
  invalid_total: "total",
  line_total_mismatch: "total",
  missing_currency: "currency",
  invalid_currency: "currency",
  missing_coding: "department",
};

export type ValidationIssueLike = { code: string; message: string; severity: "error" | "warning" };

export function buildQueue(args: {
  blockingIssues: ValidationIssueLike[];
  warningIssues: ValidationIssueLike[];
  amberFields: Array<{ field: ExtractedField; label: string }>;
  crossCheckOk: boolean;
  crossCheckDetail?: string | undefined;
  vendor: VendorMaster;
}): QueueItem[] {
  const items: QueueItem[] = [];
  const covered = new Set<string>();

  const pushIssue = (kind: "blocking" | "warning", issue: ValidationIssueLike) => {
    const field = FIELD_BY_ISSUE_CODE[issue.code];
    if (field) covered.add(`field:${field}`);
    items.push({
      key: `${kind}:${issue.code}`,
      kind,
      field,
      label: field ? field : issue.code,
      message: issue.message,
    });
  };

  for (const issue of args.blockingIssues) pushIssue("blocking", issue);

  if (!args.crossCheckOk && !covered.has("field:total")) {
    items.push({
      key: "blocking:cross-check",
      kind: "blocking",
      field: "total",
      label: "total",
      message: args.crossCheckDetail ?? "Line items do not add up to the total.",
    });
    covered.add("field:total");
  }

  for (const issue of args.warningIssues) pushIssue("warning", issue);

  for (const { field, label } of args.amberFields) {
    if (covered.has(`field:${field}`)) continue;
    covered.add(`field:${field}`);
    items.push({
      key: `amber:${field}`,
      kind: "amber",
      field,
      label,
      message: "Check this value against the document.",
    });
  }

  for (const f of PROFILE_FIELDS) {
    const value = f === "businessRegistrationNumber"
      ? args.vendor.businessRegistrationNumber ?? args.vendor.kvkNumber
      : args.vendor[f];
    if (value !== undefined && value.trim() !== "") continue;
    items.push({
      key: `profile-gap:${f}`,
      kind: "profile-gap",
      profileField: f,
      label: gapLabel(f, args.vendor),
      message: `${gapLabel(f, args.vendor)} is missing from the vendor profile.`,
    });
  }

  return items;
}
