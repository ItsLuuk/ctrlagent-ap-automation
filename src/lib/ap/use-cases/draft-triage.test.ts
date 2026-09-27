import { describe, expect, it } from "bun:test";
import { draftTriage, notableFor, type FieldAttention, type NotableContext } from "./draft-triage";
import type { DraftAssignment, DraftAssignments, MappingProposal } from "../mapping-proposals";
import { MAPPING_FIELDS, ZONE_FIELDS, type Invoice, type Provenance, type Zone } from "../types";

/** Every zone field read exactly: the state a reviewed draft is in. */
const exactProvenance = Object.fromEntries(ZONE_FIELDS.map((field) => [field, "exact"])) as Partial<
  Record<(typeof ZONE_FIELDS)[number], Provenance>
>;

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
  glAccount: "6020",
  department: "Finance",
  memo: "",
  tags: [],
  audit: [],
  source: "upload",
  createdAt: "2026-01-20T00:00:00.000Z",
  provenance: exactProvenance,
};

const zone: Zone = { x: 0.1, y: 0.2, w: 0.2, h: 0.03 };

const noAssignments = Object.fromEntries(
  MAPPING_FIELDS.map((field) => [field, undefined]),
) as DraftAssignments;

/** One field carrying a proposed source region, ready to merge into a map. */
function proposalFor(
  field: (typeof MAPPING_FIELDS)[number],
  source: MappingProposal["source"] = "label",
): DraftAssignment {
  const proposal: MappingProposal = { field, zone, confidence: 0.9, source, reason: "Matched" };
  return { field, zone, proposal };
}

const withProposal = (
  field: (typeof MAPPING_FIELDS)[number],
  source?: MappingProposal["source"],
): DraftAssignments => ({ ...noAssignments, [field]: proposalFor(field, source) });

describe("draftTriage", () => {
  it("calls a read draft with nothing left to review verified", () => {
    const triage = draftTriage({ invoice, assignments: noAssignments });

    expect(triage.blockingIssues).toEqual([]);
    expect(Object.values(triage.statuses).every((status) => status === "green")).toBe(true);
    expect(triage.allFieldsVerified).toBe(true);
    expect(triage.mappedCount).toBe(0);
    expect(triage.proposalCount).toBe(0);
  });

  it("treats an unreviewed critical proposal as work, even when the value reads exact", () => {
    const triage = draftTriage({ invoice, assignments: withProposal("total") });

    expect(triage.statuses.total).toBe("amber");
    expect(triage.unconfirmedCriticalFields).toEqual(["total"]);
    expect(triage.unconfirmedProposalCount).toBe(1);
    expect(triage.proposalCount).toBe(1);
    expect(triage.allFieldsVerified).toBe(false);
    expect(triage.order[0]).toBe("total");
  });

  it("clears the block once the reviewer accepts the proposed region", () => {
    const triage = draftTriage({
      invoice,
      assignments: withProposal("total"),
      confirmedMappings: { total: true },
    });

    expect(triage.statuses.total).toBe("green");
    expect(triage.unconfirmedCriticalFields).toEqual([]);
    expect(triage.allFieldsVerified).toBe(true);
  });

  it("never asks for a second look at a region that came from a trusted template", () => {
    const triage = draftTriage({ invoice, assignments: withProposal("total", "saved") });

    expect(triage.unconfirmedCriticalFields).toEqual([]);
    expect(triage.proposalCount).toBe(0);
    expect(triage.allFieldsVerified).toBe(true);
  });

  it("does not ask for review of a hand-drawn box", () => {
    const triage = draftTriage({
      invoice,
      assignments: { ...noAssignments, tax: { field: "tax", zone } },
    });

    expect(triage.mappedCount).toBe(1);
    expect(triage.pendingRoutineProposalCount).toBe(0);
    expect(triage.allFieldsVerified).toBe(true);
  });

  it("counts routine proposals for bulk accept but never a critical one", () => {
    const triage = draftTriage({
      invoice,
      assignments: {
        ...noAssignments,
        vendor: proposalFor("vendor"),
        dueDate: proposalFor("dueDate"),
      },
    });

    expect(triage.unconfirmedCriticalFields).toEqual(["vendor"]);
    expect(triage.pendingRoutineProposalCount).toBe(1);
    expect(triage.proposalCount).toBe(2);
  });

  it("puts a field the AI and the OCR text disagree on into the work order", () => {
    const triage = draftTriage({
      invoice: {
        ...invoice,
        zoneCheck: [{ field: "total", ai: "1210", ocr: "1.310", match: false }],
      },
      assignments: noAssignments,
    });

    expect(triage.statuses.total).toBe("amber");
    expect(triage.order[0]).toBe("total");
    expect(triage.allFieldsVerified).toBe(false);
  });

  it("keeps a draft with a blocking validation issue unverified", () => {
    const triage = draftTriage({
      invoice: { ...invoice, vendor: "" },
      assignments: noAssignments,
    });

    expect(triage.blockingIssues[0]?.code).toBe("missing_vendor");
    expect(triage.allFieldsVerified).toBe(false);
  });

  it("leaves the identity fields out of the worklist until it is told to profile", () => {
    const triage = draftTriage({
      invoice: { ...invoice, status: "vendor_profile" },
      assignments: noAssignments,
    });

    expect(triage.order).not.toContain("iban");
    expect(triage.order).not.toContain("address");
  });

  it("puts an unmapped identity value in the profiling worklist as work", () => {
    const triage = draftTriage({
      invoice: { ...invoice, status: "vendor_profile", address: "Ravelijnstraat 40" },
      assignments: noAssignments,
      includeIdentity: true,
    });

    // Nothing on this invoice carries a registration number, so it is work.
    expect(triage.statuses.businessRegistrationNumber).toBe("amber");
    expect(triage.statuses.iban).toBe("amber");
    expect(triage.order).toContain("iban");
    // The values that were read off the document are not.
    expect(triage.statuses.address).toBe("green");
    expect(triage.allFieldsVerified).toBe(false);
  });

  it("never bulk-accepts an identity proposal while profiling", () => {
    const assignments: DraftAssignments = {
      ...noAssignments,
      address: proposalFor("address", "identity"),
      total: proposalFor("total"),
    };
    const triage = draftTriage({
      invoice: { ...invoice, status: "vendor_profile", address: "Ravelijnstraat 40" },
      assignments,
      includeIdentity: true,
    });

    // A bank detail and a registration number carry forward to every future
    // invoice, so they are looked at one by one.
    expect(triage.statuses.address).toBe("amber");
    expect(triage.pendingRoutineProposalCount).toBe(0);

    const accepted = draftTriage({
      invoice: { ...invoice, status: "vendor_profile", address: "Ravelijnstraat 40" },
      assignments,
      confirmedMappings: { address: true },
      includeIdentity: true,
    });
    expect(accepted.statuses.address).toBe("green");
  });
});

describe("draftTriage attention", () => {
  const allProposed = Object.fromEntries(
    ZONE_FIELDS.map((field) => [field, { field, zone }]),
  ) as DraftAssignments;

  it("is empty once every field is read, boxed and exact", () => {
    const triage = draftTriage({ invoice, assignments: allProposed });
    expect(triage.attention).toEqual([]);
  });

  it("puts a field nothing was read for first, and says why", () => {
    const triage = draftTriage({
      invoice: { ...invoice, invoiceNumber: "" },
      assignments: allProposed,
    });
    expect(triage.attention[0]).toEqual({ field: "invoiceNumber", reason: "empty" });
  });

  it("names a value the page has no box for", () => {
    const assignments = { ...allProposed, total: undefined } as DraftAssignments;
    const triage = draftTriage({ invoice, assignments });
    expect(triage.attention).toContainEqual({ field: "total", reason: "no-box" });
  });

  it("names a proposed region nobody has agreed with", () => {
    const assignments = { ...allProposed, total: proposalFor("total") } as DraftAssignments;
    const triage = draftTriage({ invoice, assignments });
    expect(triage.attention).toContainEqual({ field: "total", reason: "unconfirmed" });
  });

  it("names a low-confidence reading even when it is boxed and agreed", () => {
    const triage = draftTriage({
      invoice: { ...invoice, confidence: { total: 0.4 } },
      assignments: allProposed,
    });
    expect(triage.attention).toContainEqual({ field: "total", reason: "unverified" });
  });

  it("does not put a reading on the worklist for being a high confidence", () => {
    const triage = draftTriage({
      invoice: { ...invoice, confidence: { total: 0.98 } },
      assignments: allProposed,
    });
    expect(triage.attention).toEqual([]);
  });

  it("trusts the page over the value when they disagree", () => {
    const triage = draftTriage({
      invoice: {
        ...invoice,
        zoneCheck: [{ field: "total", ai: "1210.00", ocr: "1,210.00", match: false }],
      },
      assignments: allProposed,
    });
    expect(triage.attention).toContainEqual({ field: "total", reason: "unverified" });
  });

  it("never asks again for a field this vendor does not print", () => {
    const triage = draftTriage({
      invoice: { ...invoice, dueDate: "" },
      assignments: allProposed,
      absentFields: ["dueDate"],
    });
    expect(triage.attention.map((item) => item.field)).not.toContain("dueDate");
  });

  it("puts the vendor identity on the same worklist while profiling", () => {
    const triage = draftTriage({
      invoice: { ...invoice, vendorEmail: "" },
      assignments: noAssignments,
      includeIdentity: true,
    });
    expect(triage.attention).toContainEqual({ field: "vendorEmail", reason: "empty" });
  });
});

describe("draftTriage settleable", () => {
  it("offers a routine proposal the machine is certain about", () => {
    // Tax: read exactly, no confidence complaint, not a critical field.
    const assignments = { ...noAssignments, tax: proposalFor("tax") } as DraftAssignments;
    const triage = draftTriage({ invoice, assignments });
    expect(triage.settleable).toContain("tax");
    expect(triage.attention.map((item) => item.field)).not.toContain("tax");
  });

  it("never offers a critical field, however sure the reading is", () => {
    const assignments = { ...noAssignments, total: proposalFor("total") } as DraftAssignments;
    const triage = draftTriage({ invoice, assignments });
    expect(triage.settleable).not.toContain("total");
    expect(triage.attention).toContainEqual({ field: "total", reason: "unconfirmed" });
  });

  it("never offers a field the reading of is doubtful", () => {
    const assignments = { ...noAssignments, tax: proposalFor("tax") } as DraftAssignments;
    const triage = draftTriage({
      invoice: { ...invoice, confidence: { tax: 0.3 } },
      assignments,
    });
    expect(triage.settleable).not.toContain("tax");
    expect(triage.attention).toContainEqual({ field: "tax", reason: "unverified" });
  });

  it("never offers a field with nothing to agree", () => {
    expect(draftTriage({ invoice, assignments: noAssignments }).settleable).toEqual([]);
  });

  it("leaves a settled invoice with nothing to do either way", () => {
    const allProposed = Object.fromEntries(
      ZONE_FIELDS.map((field) => [field, { field, zone }]),
    ) as DraftAssignments;
    const triage = draftTriage({ invoice, assignments: allProposed });
    expect(triage.attention).toEqual([]);
    expect(triage.settleable).toEqual([]);
  });
});

const routine: NotableContext = {
  profiling: false,
  hasTemplate: true,
  attention: [],
  totalsOk: true,
};

const at = (field: FieldAttention["field"], reason: FieldAttention["reason"]): FieldAttention => ({
  field,
  reason,
});

describe("notableFor", () => {
  it("says nothing when nothing about this invoice is unusual", () => {
    expect(notableFor(invoice, routine)).toEqual([]);
  });

  it("names a drifted layout ahead of anything else", () => {
    const notable = notableFor(
      { ...invoice, templateDrift: { missing: ["tax"], recoveredBy: {}, templateVersion: 2, detectedAt: "" } },
      { ...routine, attention: [at("tax", "empty")] },
    );

    expect(notable[0]).toBe("Layout changed since the last one");
  });

  it("marks a first invoice as a first invoice", () => {
    expect(notableFor(invoice, { ...routine, profiling: true, hasTemplate: false })).toEqual([
      "First invoice from this vendor",
    ]);
  });

  it("says a known vendor has no template rather than calling them new", () => {
    expect(notableFor(invoice, { ...routine, hasTemplate: false })).toEqual([
      "No saved template for this vendor",
    ]);
  });

  it("counts what nothing could read", () => {
    const notable = notableFor(invoice, {
      ...routine,
      attention: [at("tax", "empty"), at("total", "empty")],
    });

    expect(notable).toEqual(["2 fields nothing could read"]);
  });

  it("separates doubtful readings from unreadable ones", () => {
    const notable = notableFor(invoice, {
      ...routine,
      attention: [at("tax", "unverified"), at("total", "no-box")],
    });

    expect(notable).toEqual([
      "1 field we are not sure about",
      "1 field we cannot point to",
    ]);
  });

  it("names a total that will not reconcile", () => {
    expect(notableFor(invoice, { ...routine, totalsOk: false })).toEqual([
      "Line items do not add up to the total",
    ]);
  });

  it("stops at three so the header stays skimmable", () => {
    const notable = notableFor(
      { ...invoice, templateDrift: { missing: [], recoveredBy: {}, templateVersion: 1, detectedAt: "" } },
      {
        profiling: true,
        hasTemplate: false,
        totalsOk: false,
        attention: [at("tax", "empty"), at("total", "unverified"), at("dueDate", "no-box")],
      },
    );

    expect(notable).toHaveLength(3);
  });
});
