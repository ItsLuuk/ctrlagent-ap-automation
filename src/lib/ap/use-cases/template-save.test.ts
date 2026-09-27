import { describe, expect, it } from "bun:test";
import { TRAINING_WHEELS_CONFIRMATIONS, templateSaveGate } from "./template-save";
import {
  TEMPLATE_TRAINING_WHEELS,
  type DraftAssignments,
  type MappingProposal,
} from "../mapping-proposals";
import { MAPPING_FIELDS, type Invoice, type Zone } from "../types";

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
};

const zone: Zone = { x: 0.1, y: 0.2, w: 0.2, h: 0.03 };

const noAssignments = Object.fromEntries(
  MAPPING_FIELDS.map((field) => [field, undefined]),
) as DraftAssignments;

function proposed(
  field: (typeof MAPPING_FIELDS)[number],
  source: MappingProposal["source"] = "label",
): DraftAssignments {
  const proposal: MappingProposal = { field, zone, confidence: 0.9, source, reason: "Matched" };
  return { ...noAssignments, [field]: { field, zone, proposal } };
}

describe("templateSaveGate", () => {
  it("lets a reviewed, valid draft through", () => {
    expect(templateSaveGate({ invoice, assignments: noAssignments })).toEqual({ ok: true });
  });

  it("blocks on an unreviewed critical region and names the fields to look at", () => {
    const gate = templateSaveGate({ invoice, assignments: proposed("vendor") });

    if (gate.ok || gate.kind !== "unconfirmed-critical-mappings") {
      throw new Error(`expected an unreviewed-critical gate, got ${JSON.stringify(gate)}`);
    }
    expect(gate.fields).toEqual(["vendor"]);
    expect(gate.title).toBe("Confirm the critical mappings first");
    expect(gate.message).toContain("Vendor");
  });

  it("does not block on a region that came from a trusted template", () => {
    const gate = templateSaveGate({ invoice, assignments: proposed("vendor", "saved") });

    expect(gate).toEqual({ ok: true });
  });

  it("does not block on a critical region the reviewer already accepted", () => {
    const gate = templateSaveGate({
      invoice,
      assignments: proposed("vendor"),
      confirmedMappings: { vendor: true },
    });

    expect(gate).toEqual({ ok: true });
  });

  it("blocks on a validation error and passes the reviewer's own wording through", () => {
    const gate = templateSaveGate({
      invoice: { ...invoice, vendor: "" },
      assignments: noAssignments,
    });

    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.kind).toBe("blocking-issues");
    expect(gate.message).toBe("Vendor is required.");
  });

  it("asks for the critical review before it complains about values", () => {
    const gate = templateSaveGate({
      invoice: { ...invoice, vendor: "" },
      assignments: proposed("total"),
    });

    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.kind).toBe("unconfirmed-critical-mappings");
  });

  it("owns the training-wheel count a new template is saved with", () => {
    expect(TRAINING_WHEELS_CONFIRMATIONS).toBe(TEMPLATE_TRAINING_WHEELS);
    expect(TRAINING_WHEELS_CONFIRMATIONS).toBeGreaterThan(0);
  });
});
