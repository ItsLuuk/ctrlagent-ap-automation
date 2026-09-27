import { describe, expect, it } from "bun:test";
import {
  buildCompliancePack,
  evidenceFor,
  isEuJurisdiction,
  normalizeResidency,
  residencyAllowsJurisdiction,
} from "./compliance";

describe("compliance residency", () => {
  it("recognizes EU jurisdictions and rejects non-EU entities in EU-only mode", () => {
    expect(isEuJurisdiction("de")).toBe(true);
    expect(residencyAllowsJurisdiction("eu-only", "DE")).toBe(true);
    expect(residencyAllowsJurisdiction("eu-only", "US")).toBe(false);
    expect(residencyAllowsJurisdiction("device-only", "US")).toBe(true);
  });

  it("normalizes unknown persisted values to device-only", () => {
    expect(normalizeResidency("eu-only")).toBe("eu-only");
    expect(normalizeResidency("remote-us")).toBe("device-only");
    expect(normalizeResidency(null)).toBe("device-only");
  });
});

describe("compliance packs", () => {
  it("marks missing operator and audit evidence honestly", () => {
    const evidence = evidenceFor(["SOC 2"], "device-only", {
      entityJurisdictions: ["NL"],
      auditEvents: 0,
      operatorName: "",
    });
    expect(evidence.find((item) => item.id === "audit")?.state).toBe("needs-attention");
    expect(evidence.find((item) => item.id === "access")?.state).toBe("needs-attention");
    expect(evidence.find((item) => item.id === "residency")?.state).toBe("ready");
  });

  it("flags non-EU entities when EU-only processing is selected", () => {
    const pack = buildCompliancePack({
      workspace: "Acme EU",
      frameworks: ["SOC 2", "ISO 27001"],
      residency: "eu-only",
      entityJurisdictions: ["NL", "US"],
      auditEvents: 12,
      operatorName: "Sam",
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(pack.evidence.find((item) => item.id === "residency")?.state).toBe("needs-attention");
    expect(pack.evidence.find((item) => item.id === "soc2")).toBeDefined();
    expect(pack.evidence.find((item) => item.id === "iso")).toBeDefined();
    expect(pack.disclaimer).toContain("not a certification");
  });
});
