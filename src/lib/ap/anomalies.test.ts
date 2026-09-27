import { describe, expect, it } from "bun:test";
import { scanVendorAnomalies, type AnomalyFinding, type AnomalyKind } from "./anomalies";
import type { Invoice } from "./types";

let seq = 0;
function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  seq += 1;
  return {
    id: `inv-${seq}`,
    vendor: "Acme B.V.",
    invoiceNumber: `2026-${String(1000 + seq)}`,
    issueDate: "2026-01-15",
    dueDate: "2026-02-14",
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
    createdAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

/** Steady monthly invoices: one on the 15th, payable 30 days later. */
function history(count: number, overrides: Partial<Invoice> = {}, vendor = "Acme B.V."): Invoice[] {
  return Array.from({ length: count }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    const issue = new Date(Date.UTC(2026, index, 15));
    const due = new Date(issue.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    return makeInvoice({
      vendor,
      invoiceNumber: `2026-01${month}`,
      issueDate: issue.toISOString().slice(0, 10),
      dueDate: due,
      total: 1000,
      createdAt: issue.toISOString(),
      ...overrides,
    });
  });
}

function kinds(findings: AnomalyFinding[], invoiceId: string): AnomalyKind[] {
  return findings.filter((entry) => entry.invoiceId === invoiceId).map((entry) => entry.kind);
}

describe("amount outliers", () => {
  it("flags a total that is nothing like this vendor's", () => {
    const past = history(6);
    const candidate = makeInvoice({
      invoiceNumber: "2026-0107",
      issueDate: "2026-07-15",
      dueDate: "2026-08-14",
      total: 9000,
      createdAt: "2026-07-15T00:00:00.000Z",
    });

    const findings = scanVendorAnomalies([candidate], [...past, candidate]);

    expect(kinds(findings, candidate.id)).toContain("amount_outlier");
    const finding = findings.find((entry) => entry.kind === "amount_outlier")!;
    expect(finding.severity).toBe("high");
    expect(finding.detail).toContain("9.0×");
    expect(finding.baseline.sampleSize).toBe(6);
  });

  it("leaves an ordinary variation alone", () => {
    const past = history(6);
    const candidate = makeInvoice({
      invoiceNumber: "2026-0107",
      issueDate: "2026-07-15",
      dueDate: "2026-08-14",
      total: 1250,
      createdAt: "2026-07-15T00:00:00.000Z",
    });

    const findings = scanVendorAnomalies([candidate], [...past, candidate]);

    expect(kinds(findings, candidate.id)).not.toContain("amount_outlier");
  });
});

describe("invoice number gaps", () => {
  it("names the numbers that never arrived", () => {
    const past = history(6);
    const candidate = makeInvoice({
      invoiceNumber: "2026-0111",
      issueDate: "2026-07-15",
      dueDate: "2026-08-14",
      total: 1000,
      createdAt: "2026-07-15T00:00:00.000Z",
    });

    const findings = scanVendorAnomalies([candidate], [...past, candidate]);
    const finding = findings.find((entry) => entry.kind === "number_gap");

    expect(finding?.severity).toBe("warn");
    expect(finding?.detail).toContain("2026-0107");
    expect(finding?.detail).toContain("2026-0110");
  });

  it("says nothing about the next number in the series", () => {
    const past = history(6);
    const candidate = makeInvoice({
      invoiceNumber: "2026-0107",
      issueDate: "2026-07-15",
      dueDate: "2026-08-14",
      total: 1000,
      createdAt: "2026-07-15T00:00:00.000Z",
    });

    expect(
      kinds(scanVendorAnomalies([candidate], [...past, candidate]), candidate.id),
    ).not.toContain("number_gap");
  });

  it("flags a number that arrived behind the vendor's latest", () => {
    const past = history(6);
    const candidate = makeInvoice({
      invoiceNumber: "2026-0103",
      issueDate: "2026-07-15",
      dueDate: "2026-08-14",
      total: 1000,
      createdAt: "2026-07-15T00:00:00.000Z",
    });

    const finding = scanVendorAnomalies([candidate], [...past, candidate]).find(
      (entry) => entry.kind === "number_gap",
    );

    expect(finding?.detail).toContain("behind this vendor's latest");
  });
});

describe("timing changes", () => {
  it("flags payment terms that moved against this vendor's habit", () => {
    const past = history(6);
    const candidate = makeInvoice({
      invoiceNumber: "2026-0107",
      issueDate: "2026-07-15",
      dueDate: "2026-07-25",
      total: 1000,
      createdAt: "2026-07-15T00:00:00.000Z",
    });

    const finding = scanVendorAnomalies([candidate], [...past, candidate]).find(
      (entry) => entry.kind === "timing_change",
    );

    expect(finding?.severity).toBe("high");
    expect(finding?.detail).toContain("30 days");
  });

  it("flags a catch-up invoice that arrives long after the usual rhythm", () => {
    const past = history(6);
    const candidate = makeInvoice({
      invoiceNumber: "2026-0107",
      issueDate: "2026-11-15",
      dueDate: "2026-12-14",
      total: 1000,
      createdAt: "2026-11-15T00:00:00.000Z",
    });

    const finding = scanVendorAnomalies([candidate], [...past, candidate]).find(
      (entry) => entry.kind === "timing_change",
    );

    expect(finding?.severity).toBe("warn");
    expect(finding?.detail).toContain("catch-up");
  });

  it("says nothing when the invoice lands on the usual day", () => {
    const past = history(6);
    const candidate = makeInvoice({
      invoiceNumber: "2026-0107",
      issueDate: "2026-07-15",
      dueDate: "2026-08-14",
      total: 1000,
      createdAt: "2026-07-15T00:00:00.000Z",
    });

    expect(
      kinds(scanVendorAnomalies([candidate], [...past, candidate]), candidate.id),
    ).not.toContain("timing_change");
  });
});

describe("duplicates the baseline accounts for", () => {
  /** A vendor whose standing charge is re-sent by the portal. */
  function resendCorpus(): { past: Invoice[]; original: Invoice; resend: Invoice } {
    const past = history(6, { total: 500 });
    const original = makeInvoice({
      invoiceNumber: "2026-0107",
      issueDate: "2026-07-15",
      dueDate: "2026-08-14",
      total: 500,
      createdAt: "2026-07-15T00:00:00.000Z",
    });
    const resend = makeInvoice({
      invoiceNumber: "2026-0107",
      issueDate: "2026-08-14",
      dueDate: "2026-09-13",
      total: 500,
      createdAt: "2026-08-14T00:00:00.000Z",
    });
    return { past, original, resend };
  }

  it("explains a re-sent invoice as the vendor's standing charge", () => {
    const { past, original, resend } = resendCorpus();
    const corpus = [...past, original, resend];

    const finding = scanVendorAnomalies([resend], corpus).find(
      (entry) => entry.kind === "benign_duplicate",
    );

    expect(finding?.severity).toBe("info");
    expect(finding?.detail).toContain("standing charge");
  });

  it("stays quiet when the duplicate is not the vendor's usual amount", () => {
    const { past, original, resend } = resendCorpus();
    const odd = { ...resend, total: 3800 };

    const findings = scanVendorAnomalies([odd], [...past, original, odd]);

    expect(kinds(findings, odd.id)).not.toContain("benign_duplicate");
  });
});

describe("round amounts", () => {
  it("flags a round total for a vendor whose history is not round", () => {
    const past = history(6, { total: 1234 });
    const candidate = makeInvoice({
      invoiceNumber: "2026-0107",
      issueDate: "2026-07-15",
      dueDate: "2026-08-14",
      total: 1500,
      createdAt: "2026-07-15T00:00:00.000Z",
    });

    const finding = scanVendorAnomalies([candidate], [...past, candidate]).find(
      (entry) => entry.kind === "round_amount",
    );

    expect(finding?.severity).toBe("warn");
    expect(finding?.detail).toContain("0%");
  });

  it("leaves a round total alone for a vendor whose invoices are usually round", () => {
    const past = history(6, { total: 1200 });
    const candidate = makeInvoice({
      invoiceNumber: "2026-0107",
      issueDate: "2026-07-15",
      dueDate: "2026-08-14",
      total: 3000,
      createdAt: "2026-07-15T00:00:00.000Z",
    });

    expect(
      kinds(scanVendorAnomalies([candidate], [...past, candidate]), candidate.id),
    ).not.toContain("round_amount");
  });
});

describe("what the scan refuses to do", () => {
  it("stays silent until a vendor has enough invoices to have a habit", () => {
    const past = history(3);
    const candidate = makeInvoice({
      invoiceNumber: "2026-0199",
      issueDate: "2026-04-15",
      dueDate: "2026-04-25",
      total: 9000,
      createdAt: "2026-04-15T00:00:00.000Z",
    });

    expect(scanVendorAnomalies([candidate], [...past, candidate])).toEqual([]);
  });

  it("reports only on the invoices it was asked about", () => {
    const past = history(6);
    const outlier = makeInvoice({
      invoiceNumber: "2026-0107",
      issueDate: "2026-07-15",
      dueDate: "2026-08-14",
      total: 9000,
      createdAt: "2026-07-15T00:00:00.000Z",
    });
    const corpus = [...past, outlier];

    expect(scanVendorAnomalies([], corpus)).toEqual([]);
    expect(scanVendorAnomalies([outlier], corpus).length).toBeGreaterThan(0);
  });

  it("orders the worst finding first", () => {
    const past = history(6, { total: 1234 });
    const candidate = makeInvoice({
      invoiceNumber: "2026-0199",
      issueDate: "2026-09-15",
      dueDate: "2026-09-25",
      total: 15000,
      createdAt: "2026-09-15T00:00:00.000Z",
    });

    const findings = scanVendorAnomalies([candidate], [...past, candidate]);

    expect(findings[0]?.severity).toBe("high");
  });

  it("keeps each vendor's history to itself", () => {
    const past = history(6, {}, "Acme B.V.");
    const candidate = makeInvoice({
      vendor: "Beta B.V.",
      invoiceNumber: "2026-0199",
      issueDate: "2026-09-15",
      dueDate: "2026-10-14",
      total: 15000,
      createdAt: "2026-09-15T00:00:00.000Z",
    });

    expect(scanVendorAnomalies([candidate], [...past, candidate])).toEqual([]);
  });
});
