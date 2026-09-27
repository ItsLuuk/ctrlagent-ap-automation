import { describe, expect, it } from "bun:test";
import { appendAudit, changesForPatch, fieldEvidence, verifyAuditTrail } from "./audit-evidence";
import type { Invoice } from "./types";

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv-1",
    vendor: "Acme",
    invoiceNumber: "INV-1",
    issueDate: "2026-09-01",
    dueDate: "2026-10-01",
    currency: "EUR",
    subtotal: 100,
    tax: 21,
    total: 121,
    status: "draft",
    lineItems: [],
    glAccount: "6000",
    department: "Ops",
    memo: "",
    tags: [],
    confidence: { vendor: 0.94, total: 0.81 },
    provenance: { vendor: "read", total: "exact" },
    fieldSources: { vendor: 1, total: 1 },
    zones: { vendor: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 } },
    audit: [],
    source: "upload",
    createdAt: "2026-09-01T00:00:00Z",
    ...over,
  }) as Invoice;

describe("audit evidence", () => {
  it("captures the source region, page, confidence, and provenance for fields", () => {
    const evidence = fieldEvidence(invoice());
    expect(evidence.vendor).toEqual({
      value: "Acme",
      page: 1,
      region: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
      confidence: 0.94,
      provenance: "read",
    });
    expect(evidence.total?.confidence).toBe(0.81);
  });

  it("records before and after values for every changed field", () => {
    expect(changesForPatch(invoice(), { total: 125, department: "Finance" })).toEqual({
      total: { before: 121, after: 125 },
      department: { before: "Ops", after: "Finance" },
    });
  });

  it("links appended events into a verifiable hash chain", () => {
    const first = appendAudit(invoice(), { actor: "Ana", action: "Corrected total", changes: { total: { before: 121, after: 125 } } });
    const second = appendAudit(first, { actor: "Lee", action: "Approved", note: "Checked receipt" });
    const result = verifyAuditTrail(second);
    expect(result).toMatchObject({ valid: true, checked: 2, legacy: 0 });
    expect(second.audit[1]?.previousHash).toBe(second.audit[0]?.hash);
  });

  it("detects a changed historical event", () => {
    const first = appendAudit(invoice(), { actor: "Ana", action: "Corrected total" });
    const tampered = { ...first, audit: [{ ...first.audit[0]!, action: "Approved" }] };
    expect(verifyAuditTrail(tampered).valid).toBe(false);
  });
});
