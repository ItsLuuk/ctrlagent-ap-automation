import type {
  AuditChange,
  AuditEntry,
  ExtractedField,
  FieldEvidence,
  Invoice,
  Zone,
} from "./types";

const EVIDENCE_FIELDS: ExtractedField[] = [
  "vendor",
  "invoiceNumber",
  "issueDate",
  "dueDate",
  "subtotal",
  "tax",
  "total",
  "address",
  "vendorEmail",
  "iban",
  "vatNumber",
  "businessRegistrationNumber",
];

const hashText = (value: string): string => {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
};

const valueOf = (invoice: Invoice, field: ExtractedField): string | number => {
  const value = invoice[field];
  return typeof value === "string" || typeof value === "number" ? value : "";
};

export function fieldEvidence(invoice: Invoice): Partial<Record<ExtractedField, FieldEvidence>> {
  return Object.fromEntries(
    EVIDENCE_FIELDS.filter((field) => invoice[field] !== undefined && invoice[field] !== "").map(
      (field) => [
        field,
        {
          value: valueOf(invoice, field),
          ...(invoice.fieldSources?.[field] !== undefined
            ? { page: invoice.fieldSources[field] }
            : {}),
          ...(invoice.zones?.[field] ? { region: invoice.zones[field] as Zone } : {}),
          ...(invoice.confidence?.[field] !== undefined
            ? { confidence: invoice.confidence[field] }
            : {}),
          ...(invoice.provenance?.[field] ? { provenance: invoice.provenance[field] } : {}),
        },
      ],
    ),
  );
}

export type AppendAuditInput = {
  actor: string;
  action: string;
  note?: string | undefined;
  changes?: Record<string, AuditChange> | undefined;
  at?: string | undefined;
  id?: string | undefined;
};

const entryPayload = (entry: AuditEntry, previousHash: string): string =>
  JSON.stringify({
    previousHash,
    actor: entry.actor,
    action: entry.action,
    at: entry.at,
    note: entry.note ?? null,
    changes: entry.changes ?? null,
  });

/** Appends one event and links it to the previous event hash. */
export function appendAudit(invoice: Invoice, input: AppendAuditInput): Invoice {
  const previousHash = invoice.audit[invoice.audit.length - 1]?.hash ?? "GENESIS";
  const entry: AuditEntry = {
    id: input.id ?? `audit-${invoice.id}-${invoice.audit.length + 1}`,
    at: input.at ?? new Date().toISOString(),
    actor: input.actor,
    action: input.action,
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.changes !== undefined ? { changes: input.changes } : {}),
    previousHash,
  };
  return {
    ...invoice,
    audit: [...invoice.audit, { ...entry, hash: hashText(entryPayload(entry, previousHash)) }],
  };
}

export function verifyAuditTrail(invoice: Pick<Invoice, "audit">): {
  valid: boolean;
  checked: number;
  legacy: number;
} {
  let previousHash = "GENESIS";
  let checked = 0;
  let legacy = 0;
  for (const entry of invoice.audit) {
    if (!entry.hash) {
      legacy += 1;
      previousHash = "GENESIS";
      continue;
    }
    if (entry.previousHash !== previousHash || entry.hash !== hashText(entryPayload(entry, previousHash))) {
      return { valid: false, checked, legacy };
    }
    previousHash = entry.hash;
    checked += 1;
  }
  return { valid: true, checked, legacy };
}

export function changesForPatch(
  invoice: Invoice,
  patch: Partial<Invoice>,
): Record<string, AuditChange> {
  const changes: Record<string, AuditChange> = {};
  for (const [key, after] of Object.entries(patch)) {
    if (key === "audit" || key === "tags" || key === "fieldEvidence") continue;
    const before = (invoice as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes[key] = {
        before: typeof before === "string" || typeof before === "number" || typeof before === "boolean" ? before : before == null ? null : undefined,
        after: typeof after === "string" || typeof after === "number" || typeof after === "boolean" ? after : after == null ? null : undefined,
      };
    }
  }
  return changes;
}
