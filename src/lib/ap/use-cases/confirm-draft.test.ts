import { describe, expect, it } from "bun:test";
import {
  confirmDraft,
  persistDraftLineItemsSpec,
  type DraftAssignments,
  type DraftFields,
  type DraftPersistencePorts,
} from "./confirm-draft";
import { MAPPING_FIELDS, type Invoice, type LineItemsSpec, type VendorTemplate } from "../types";
import type { Actor } from "../state-machine";

/** Whoever is confirming: the use case is told, it never decides for itself. */
const operator: Actor = { name: "Sam de Vries", roles: ["processor"] };

const fields: DraftFields = {
  vendor: "Acme B.V.",
  invoiceNumber: "AC-42",
  issueDate: "2026-01-20",
  dueDate: "2026-02-19",
  subtotal: "1000",
  tax: "210",
  total: "1210",
  address: "",
  vendorEmail: "",
  iban: "",
  vatNumber: "",
  businessRegistrationNumber: "",
};

const emptyAssignments = Object.fromEntries(
  MAPPING_FIELDS.map((field) => [field, undefined]),
) as DraftAssignments;

const invoice: Invoice = {
  id: "invoice-1",
  vendor: "Acme B.V.",
  invoiceNumber: "AC-42",
  issueDate: "2026-01-20",
  dueDate: "2026-02-19",
  currency: "EUR",
  subtotal: 1000,
  tax: 210,
  total: 1210,
  status: "draft",
  lineItems: [],
  glAccount: "6020 · Professional services",
  department: "Finance",
  memo: "",
  tags: [],
  audit: [],
  source: "upload",
  createdAt: "2026-01-20T00:00:00.000Z",
};

const template: VendorTemplate = {
  vendor_fingerprint: "fingerprint",
  vendor_key: "acme b.v.",
  embedding: [],
  version: 1,
  fields: {},
  updatedAt: "2026-01-20T00:00:00.000Z",
};

function ports(overrides: Partial<DraftPersistencePorts> = {}) {
  const calls = {
    savedTemplates: [] as Parameters<DraftPersistencePorts["saveVendorTemplate"]>[0][],
    invoicePatches: [] as Array<{
      id: string;
      patch: Partial<Invoice>;
      auditAction: string | undefined;
      note: string | undefined;
    }>,
    transitions: [] as string[],
    heldVendors: [] as string[],
    vendors: [] as Parameters<DraftPersistencePorts["upsertVendor"]>[0][],
  };
  const base: DraftPersistencePorts = {
    saveVendorTemplate: (input) => calls.savedTemplates.push(input),
    updateInvoice: (id, patch, auditAction, note) => {
      calls.invoicePatches.push({ id, patch, auditAction, note });
      return { accepted: true };
    },
    applyTransition: (id) => {
      calls.transitions.push(id);
      return { accepted: true };
    },
    confirmTemplateExtraction: (vendor) => calls.heldVendors.push(vendor),
    upsertVendor: (vendor) => {
      calls.vendors.push(vendor);
      return { accepted: true };
    },
    ...overrides,
  };
  return { ports: base, calls };
}

describe("confirmDraft", () => {
  it("persists an invoice-only draft before applying the transition", () => {
    const { ports: storePorts, calls } = ports();
    const result = confirmDraft(
      {
        invoice: { ...invoice, templateHold: true },
        fields,
        assignments: emptyAssignments,
        words: [],
        actor: operator,
        profile: { name: "Acme B.V.", email: "billing@acme.test", updatedAt: "old" },
        profileUpdatedAt: "2026-01-21T00:00:00.000Z",
        learnedCount: 2,
      },
      storePorts,
    );

    expect(result).toEqual({
      ok: true,
      vendor: "Acme B.V.",
      templateAction: "none",
      profileSaved: true,
      learnedCount: 2,
    });
    expect(calls.savedTemplates).toHaveLength(0);
    expect(calls.invoicePatches[0]).toMatchObject({
      id: "invoice-1",
      auditAction: "Saved draft field values",
      patch: { total: 1210, templateHold: undefined },
    });
    expect(calls.heldVendors).toEqual(["Acme B.V."]);
    expect(calls.transitions).toEqual(["invoice-1"]);
    expect(calls.vendors[0]?.updatedAt).toBe("2026-01-21T00:00:00.000Z");
  });

  it("confirms from the profiling stage with the profiling transition", () => {
    const applied: string[] = [];
    const { ports: storePorts } = ports({
      applyTransition: (id, input) => {
        applied.push(input.transition);
        return { accepted: true };
      },
    });
    const result = confirmDraft(
      {
        invoice: { ...invoice, status: "vendor_profile" },
        fields,
        assignments: emptyAssignments,
        words: [],
        actor: operator,
        profile: { name: "Acme B.V.", email: "billing@acme.test", updatedAt: "old" },
      },
      storePorts,
    );

    expect(result).toMatchObject({ ok: true, profileSaved: true });
    // A first-time vendor is mapped and confirmed in one pass, so the invoice
    // never has to sit in Draft.
    expect(applied).toEqual(["confirm-from-profiling"]);
  });

  it("derives the vendor record from the mapped identity when profiling", () => {
    const { ports: storePorts, calls } = ports();
    const result = confirmDraft(
      {
        invoice: {
          ...invoice,
          status: "vendor_profile",
          vendor: "Acme B.V.",
          vendorEmail: "billing@acme.test",
          iban: "nl91 abna 0417 1643 00",
        },
        fields: { ...fields, vendor: "Acme B.V." },
        assignments: emptyAssignments,
        words: [],
        actor: operator,
      },
      storePorts,
    );

    expect(result).toMatchObject({ ok: true, profileSaved: true });
    expect(calls.vendors[0]).toMatchObject({
      name: "Acme B.V.",
      email: "billing@acme.test",
      // Case is normalised on the way into the record, not kept from the OCR.
      iban: "NL91ABNA0417164300",
    });
  });

  it("stops the confirm when the vendor record is refused", () => {
    const { ports: storePorts, calls } = ports({
      upsertVendor: () => ({
        accepted: false,
        reason: "Bank details are pending approval by a different person.",
      }),
    });
    const result = confirmDraft(
      {
        invoice: { ...invoice, status: "vendor_profile" },
        fields,
        assignments: emptyAssignments,
        words: [],
        actor: operator,
      },
      storePorts,
    );

    expect(result).toMatchObject({ ok: false, kind: "persistence-rejected" });
    if (!result.ok) {
      expect(result.message).toContain("pending approval");
    }
    // Nothing moved: a refused record must not leave the invoice in approval.
    expect(calls.transitions).toEqual([]);
  });

  it("saves learned anchors and zones before confirming a mapped draft", () => {
    const { ports: storePorts, calls } = ports();
    const assignments: DraftAssignments = {
      ...emptyAssignments,
      vendor: { field: "vendor", zone: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } },
    };
    const result = confirmDraft(
      {
        invoice,
        fields,
        assignments,
        words: [],
        actor: operator,
        existingTemplate: template,
      },
      storePorts,
    );

    expect(result).toMatchObject({ ok: true, templateAction: "updated" });
    expect(calls.savedTemplates[0]).toMatchObject({
      vendor: "Acme B.V.",
      invoiceId: "invoice-1",
      origin: "confirmed",
      zones: { vendor: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } },
    });
    expect(calls.invoicePatches[0]).toMatchObject({
      auditAction: "Template updated",
      patch: { zones: { vendor: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } } },
    });
  });

  it("blocks an unconfirmed critical proposal before writing a template", () => {
    const { ports: storePorts, calls } = ports();
    const assignments: DraftAssignments = {
      ...emptyAssignments,
      vendor: {
        field: "vendor",
        zone: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 },
        proposal: {
          field: "vendor",
          zone: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 },
          confidence: 0.96,
          source: "label",
          reason: "Matched the Van label",
        },
      },
    };
    const result = confirmDraft(
      { invoice, fields, assignments, words: [], actor: operator },
      storePorts,
    );

    expect(result).toMatchObject({ ok: false, kind: "blocked" });
    expect(calls.savedTemplates).toHaveLength(0);
    expect(calls.transitions).toHaveLength(0);
  });

  it("saves a first reviewed template with two training-wheel confirmations", () => {
    const { ports: storePorts, calls } = ports();
    const zone = { x: 0.1, y: 0.2, w: 0.3, h: 0.04 };
    const assignments: DraftAssignments = {
      ...emptyAssignments,
      vendor: {
        field: "vendor",
        zone,
        proposal: {
          field: "vendor",
          zone,
          confidence: 0.96,
          source: "label",
          reason: "Matched the Van label",
        },
      },
    };
    const result = confirmDraft(
      {
        invoice,
        fields,
        assignments,
        words: [],
        confirmedMappings: { vendor: true },
        actor: operator,
      },
      storePorts,
    );

    expect(result).toMatchObject({ ok: true, templateAction: "saved" });
    expect(calls.savedTemplates[0]).toMatchObject({ confirmNextCount: 2, origin: "confirmed" });
  });

  it("returns a blocked result without writing or transitioning", () => {
    const { ports: storePorts, calls } = ports();
    const result = confirmDraft(
      {
        invoice: { ...invoice, total: 0 },
        fields: { ...fields, total: "" },
        assignments: emptyAssignments,
        words: [],
        actor: operator,
      },
      storePorts,
    );

    expect(result).toMatchObject({ ok: false, kind: "blocked" });
    expect(calls.invoicePatches).toHaveLength(0);
    expect(calls.transitions).toHaveLength(0);
  });

  it("returns the transition reason to the adapter", () => {
    const { ports: storePorts } = ports({
      applyTransition: () => ({ accepted: false, reason: "Someone else already confirmed this." }),
    });
    const result = confirmDraft(
      { invoice, fields, assignments: emptyAssignments, words: [], actor: operator },
      storePorts,
    );

    expect(result).toEqual({
      ok: false,
      kind: "transition-rejected",
      message: "Someone else already confirmed this.",
    });
  });
});

const lineItems: LineItemsSpec = {
  region: { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.6 },
  columns: [
    { anchor: "Description", field: "description", band: { x0: 0, y0: 0, x1: 0.6, y1: 1 } },
    { anchor: "Amount", field: "amount", band: { x0: 0.6, y0: 0, x1: 1, y1: 1 } },
  ],
};

describe("persistDraftLineItemsSpec", () => {
  it("requires header mappings before saving a line-item block", () => {
    const { ports: storePorts, calls } = ports();
    const result = persistDraftLineItemsSpec(
      { invoice, vendor: "Acme B.V.", assignments: emptyAssignments, words: [], lineItems },
      storePorts,
    );

    expect(result).toMatchObject({ ok: false, kind: "missing-header-mappings" });
    expect(calls.savedTemplates).toHaveLength(0);
  });

  it("saves the line-item block with the mapped header template", () => {
    const { ports: storePorts, calls } = ports();
    const assignments: DraftAssignments = {
      ...emptyAssignments,
      vendor: { field: "vendor", zone: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } },
    };
    const result = persistDraftLineItemsSpec(
      { invoice, vendor: "Acme B.V.", assignments, words: [], lineItems },
      storePorts,
    );

    expect(result).toEqual({ ok: true });
    expect(calls.savedTemplates[0]).toMatchObject({
      vendor: "Acme B.V.",
      invoiceId: "invoice-1",
      lineItems,
    });
  });
});
