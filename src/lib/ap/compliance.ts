export type ComplianceFramework = "SOC 2" | "ISO 27001";
export type DataResidency = "device-only" | "eu-only";
export type EvidenceState = "ready" | "needs-attention" | "not-configured";

export type ComplianceEvidence = {
  id: string;
  label: string;
  detail: string;
  state: EvidenceState;
};

export type CompliancePack = {
  generatedAt: string;
  workspace: string;
  frameworks: ComplianceFramework[];
  residency: DataResidency;
  residencyLabel: string;
  evidence: ComplianceEvidence[];
  disclaimer: string;
};

export const DEFAULT_RESIDENCY: DataResidency = "device-only";

const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

export function isEuJurisdiction(jurisdiction: string): boolean {
  return EU_COUNTRIES.has(jurisdiction.trim().toUpperCase());
}

export function residencyAllowsJurisdiction(residency: DataResidency, jurisdiction: string): boolean {
  return residency === "device-only" || isEuJurisdiction(jurisdiction);
}

export function normalizeResidency(value: unknown): DataResidency {
  return value === "eu-only" ? "eu-only" : DEFAULT_RESIDENCY;
}

export function evidenceFor(
  frameworks: ComplianceFramework[],
  residency: DataResidency,
  input: { entityJurisdictions: string[]; auditEvents: number; operatorName: string },
): ComplianceEvidence[] {
  const nonEu = input.entityJurisdictions.filter((country) => !isEuJurisdiction(country));
  const residencyReady = residency === "device-only" || nonEu.length === 0;
  const identityReady = input.operatorName.trim().length > 0;
  const auditReady = input.auditEvents > 0;
  return [
    {
      id: "access",
      label: "Operator identity recorded",
      detail: "Named operator is attached to workspace actions.",
      state: identityReady ? "ready" : "needs-attention",
    },
    {
      id: "audit",
      label: "Audit evidence available",
      detail: "Invoice and settings changes are retained in the local audit trail.",
      state: auditReady ? "ready" : "needs-attention",
    },
    {
      id: "residency",
      label: residency === "eu-only" ? "EU-only processing guardrail" : "Device-only processing",
      detail:
        residency === "eu-only"
          ? nonEu.length === 0
            ? "All configured entities are in EU jurisdictions."
            : `Move or remove non-EU entities: ${nonEu.join(", ")}.`
          : "Workspace data remains on this device; no remote processing region is selected.",
      state: residencyReady ? "ready" : "needs-attention",
    },
    ...(frameworks.includes("SOC 2")
      ? [{
          id: "soc2",
          label: "SOC 2 control mapping",
          detail: "Readiness evidence for CC6 logical access, CC7 monitoring, and CC8 change management.",
          state: "ready" as const,
        }]
      : []),
    ...(frameworks.includes("ISO 27001")
      ? [{
          id: "iso",
          label: "ISO 27001 control mapping",
          detail: "Readiness evidence for Annex A organizational, people, physical, and technology controls.",
          state: "ready" as const,
        }]
      : []),
  ];
}

export function buildCompliancePack(input: {
  generatedAt?: string;
  workspace: string;
  frameworks: ComplianceFramework[];
  residency: DataResidency;
  entityJurisdictions: string[];
  auditEvents: number;
  operatorName: string;
}): CompliancePack {
  const residency = normalizeResidency(input.residency);
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    workspace: input.workspace,
    frameworks: input.frameworks,
    residency,
    residencyLabel: residency === "eu-only" ? "EU jurisdictions only" : "This device only",
    evidence: evidenceFor(input.frameworks, residency, input),
    disclaimer:
      "Readiness evidence, not a certification. An independent assessor must verify the controls and issue any SOC 2 or ISO 27001 attestation.",
  };
}

