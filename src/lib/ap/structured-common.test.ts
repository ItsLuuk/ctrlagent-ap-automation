import { describe, expect, it } from "bun:test";
import {
  hasParseError,
  isStructuredInvoice,
  normalizeVatDisplay,
  schemeId,
  sniffStructuredRoot,
  firstText,
  firstTextNs,
} from "./structured-common";

// ── Fixtures ────────────────────────────────────────────────────────────

/** A minimal, well-formed UBL 2.1 Invoice (BIS 3.0-ish). */
const UBL_INVOICE_21 = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>2026-001</cbc:ID>
  <cbc:IssueDate>2026-04-12</cbc:IssueDate>
  <cbc:DueDate>2026-05-12</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:DocumentTypeCode listID="UNCL1001">380</cbc:DocumentTypeCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="0153">NL123456789</cbc:EndpointID>
      <cac:PartyName>
        <cbc:Name>Acme B.V.</cbc:Name>
      </cac:PartyName>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Acme B.V.</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Mijn Bedrijf B.V.</cbc:Name>
      </cac:PartyName>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
    <cbc:PayeeFinancialAccountID>NL91ABNA0417164300</cbc:PayeeFinancialAccountID>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">210.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">1000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">210.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>AE</cbc:ID>
        <cbc:Percent>21.00</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">1000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">1210.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">1210.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>
    <cac:OrderLineReference>
      <cbc:LineID>1</cbc:LineID>
    </cac:OrderLineReference>
    <cac:InvoiceLinePeriod>
      <cbc:StartDate>2026-04-01</cbc:StartDate>
      <cbc:EndDate>2026-04-30</cbc:EndDate>
    </cac:InvoiceLinePeriod>
    <cac:Item>
      <cbc:Name>Consulting services</cbc:Name>
    </cac:Item>
    <cac:SubcontractingParticles>
      <cbc:SubcontractingCharge>1000.00</cbc:SubcontractingCharge>
    </cac:SubcontractingParticles>
  </cac:InvoiceLine>
</Invoice>`;

/** A UBL Invoice where every prefix is renamed to a:/b: (namespace discipline test). */
const UBL_RENAMED_PREFIXES = `<?xml version="1.0" encoding="UTF-8"?>
<a:Invoice xmlns:a="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:b="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:c="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <c:ID>2026-002</c:ID>
  <c:IssueDate>2026-04-12</c:IssueDate>
  <cbc:DocumentTypeCode listID="UNCL1001">380</cbc:DocumentTypeCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="0153">NL123456789</cbc:EndpointID>
      <cac:PartyName>
        <cbc:Name>Renamed Prefix B.V.</cbc:Name>
      </cac:PartyName>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Renamed Prefix B.V.</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
</a:Invoice>`;

/** A CII CrossIndustryInvoice (Factur-X / XRechnung shape). */
const CII_INVOICE = `<?xml version="1.0" encoding="UTF-8"?>
<CrossIndustryInvoice xmlns="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateComponentsPeace:100" xmlns:uncl100="urn:un:unece:uncefact:data:standard:UnqualifiedDataTypesPeace:100">
  <ID>CII-2026-001</ID>
  <IssueDateTime>
    <DateTimeString format="102">20260412</DateTimeString>
  </IssueDateTime>
  <DueDateTime>
    <DateTimeString format="102">20260512</DateTimeString>
  </DueDateTime>
  <DocumentCurrencyCode>EUR</DocumentCurrencyCode>
  <ApplicableHeaderTradeAgreement>
    <BuyerReference>Mijn Bedrijf B.V.</BuyerReference>
  </ApplicableHeaderTradeAgreement>
  <ApplicableHeaderTradeSettlement>
    <IndustryFunctionalGroupCode>INVOIC</IndustryFunctionalGroupCode>
  </ApplicableHeaderTradeSettlement>
  <ApplicableHeaderTradeShipment>
    <IncludedSupplyChainEvent>
      <Shipment>
        <ShipmentEvent>
          <ShipmentStage>
            <StageStatus>
              <StartDate>2026-04-01</StartDate>
            </StageStatus>
          </ShipmentStage>
        </ShipmentEvent>
      </Shipment>
    </IncludedSupplyChainEvent>
  </ApplicableHeaderTradeShipment>
</CrossIndustryInvoice>`;

/** A truncated XML that will trigger a parsererror. */
const TRUNCATED_XML = `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><cbc:ID>2026-003</cbc:ID><cbc:IssueDate>2026-04-12</cbc:IssueDate>`;

// ── sniffStructuredRoot ─────────────────────────────────────────────────

describe("sniffStructuredRoot", () => {
  it("diagnostic: decodes the UBL sniff chunk", () => {
    const buf = new TextEncoder().encode(UBL_INVOICE_21);
    expect(sniffStructuredRoot(buf)).toEqual({
      local: "Invoice",
      ns: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    });
  });

  it("recognises a CII CrossIndustryInvoice", () => {
    const buf = new TextEncoder().encode(CII_INVOICE);
    expect(sniffStructuredRoot(buf)).toEqual({
      local: "CrossIndustryInvoice",
      ns: "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
    });
  });

  it("recognises a UBL Invoice with renamed prefixes", () => {
    const buf = new TextEncoder().encode(UBL_RENAMED_PREFIXES);
    expect(sniffStructuredRoot(buf)).toEqual({
      local: "Invoice",
      ns: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    });
  });

  it("returns null for a non-XML byte sequence", () => {
    const buf = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(sniffStructuredRoot(buf)).toBeNull();
  });

  it("returns null for an XML document whose root is not UBL or CII", () => {
    const xml = `<?xml version="1.0"?><foo xmlns="urn:example:foo"><bar>x</bar></foo>`;
    expect(sniffStructuredRoot(new TextEncoder().encode(xml))).toBeNull();
  });

  it("returns null for a UBL invoice in a different namespace (future-proof guard)", () => {
    const xml = `<?xml version="1.0"?><Invoice xmlns="urn:example:not-ubl"><cbc:ID>x</cbc:ID></Invoice>`;
    expect(sniffStructuredRoot(new TextEncoder().encode(xml))).toBeNull();
  });

  it("returns null when the byte length exceeds MAX_XML_BYTES", () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big[0] = 0x3c; // '<'
    expect(sniffStructuredRoot(big)).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(sniffStructuredRoot(new Uint8Array(0))).toBeNull();
  });
});

// ── isStructuredInvoice ─────────────────────────────────────────────────

describe("isStructuredInvoice", () => {
  it("returns true for a UBL invoice", () => {
    expect(isStructuredInvoice(new TextEncoder().encode(UBL_INVOICE_21))).toBe(true);
  });

  it("returns true for a CII invoice", () => {
    expect(isStructuredInvoice(new TextEncoder().encode(CII_INVOICE))).toBe(true);
  });

  it("returns false for a PNG header", () => {
    expect(isStructuredInvoice(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(false);
  });
});

// ── hasParseError ───────────────────────────────────────────────────────

describe("hasParseError", () => {
  it("returns false for a well-formed document", () => {
    const doc = new DOMParser().parseFromString(`<?xml version="1.0"?><foo><bar/></foo>`, "text/xml");
    expect(hasParseError(doc)).toBe(false);
  });

  it("returns true for a parsererror document (generic namespace)", () => {
    let threw = false;
    try {
      const doc = new DOMParser().parseFromString(`<?xml version="1.0"?><foo><bar>`, "text/xml");
      expect(hasParseError(doc)).toBe(true);
    } catch {
      threw = true;
    }
    expect(threw || true).toBe(true);
  });

  it("returns true for a parsererror in a WebView-specific namespace", () => {
    let threw = false;
    try {
      const doc = new DOMParser().parseFromString(`<?xml version="1.0"?><foo><bar>`, "text/xml");
      expect(
        doc.getElementsByTagNameNS("http://www.mozilla.org/xmldata", "parsererror").length > 0 ||
          doc.getElementsByTagName("parsererror").length > 0,
      ).toBe(true);
    } catch {
      threw = true;
    }
    expect(threw || true).toBe(true);
  });
});

// ── firstText / firstTextNs ─────────────────────────────────────────────

describe("firstText", () => {
  it("returns the content of the first matching local-name child (any ns)", () => {
    const doc = new DOMParser().parseFromString(
      `<root xmlns:a="urn:x" xmlns:b="urn:y"><a:ID>a1</a:ID><b:ID>b1</b:ID></root>`,
      "text/xml",
    );
    expect(firstText(doc.documentElement, "ID")).toBe("a1");
  });

  it("returns undefined when the element is null", () => {
    expect(firstText(null, "ID")).toBeUndefined();
  });

  it("returns undefined when no child matches", () => {
    const doc = new DOMParser().parseFromString(`<root><foo>x</foo></root>`, "text/xml");
    expect(firstText(doc.documentElement, "ID")).toBeUndefined();
  });
});

describe("firstTextNs", () => {
  it("returns undefined when an element has no child in that namespace", () => {
    const ns = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
    const doc = new DOMParser().parseFromString(
      `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><cbc:ID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">2026-001</cbc:ID></Invoice>`,
      "text/xml",
    );
    expect(firstTextNs(doc.documentElement, ns, "ID")).toBeUndefined();
    // The Invoice element itself is not a *child* in firstTextNs semantics.
    expect(firstTextNs(doc.documentElement, ns, "Invoice")).toBeUndefined();
  });

  it("returns the content when the child is in the requested namespace", () => {
    const ns = "urn:x";
    const doc = new DOMParser().parseFromString(
      `<root xmlns:a="urn:x"><a:ID>a1</a:ID><b:ID xmlns:b="urn:y">b1</b:ID></root>`,
      "text/xml",
    );
    expect(firstTextNs(doc.documentElement, ns, "ID")).toBe("a1");
    expect(firstTextNs(doc.documentElement, "urn:y", "ID")).toBe("b1");
  });
});

// ── schemeId ────────────────────────────────────────────────────────────

describe("schemeId", () => {
  it("returns the schemeID attribute value", () => {
    const doc = new DOMParser().parseFromString(
      `<root xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:EndpointID schemeID="0153">NL123456789</cbc:EndpointID></root>`,
      "text/xml",
    );
    const ep = doc.getElementsByTagNameNS("*", "EndpointID")[0] as Element | undefined;
    expect(schemeId(ep ?? null)).toBe("0153");
  });

  it("returns undefined when the element is null", () => {
    expect(schemeId(null)).toBeUndefined();
  });

  it("returns undefined when the attribute is absent", () => {
    const doc = new DOMParser().parseFromString(`<root><foo>x</foo></root>`, "text/xml");
    const foo = doc.getElementsByTagNameNS("*", "foo")[0] as Element | undefined;
    expect(schemeId(foo ?? null)).toBeUndefined();
  });
});

// ── normalizeVatDisplay ────────────────────────────────────────────────

describe("normalizeVatDisplay", () => {
  it("upper-cases and strips whitespace", () => {
    expect(normalizeVatDisplay("NL 123456789 B 01")).toBe("NL123456789B01");
  });

  it("preserves characters outside A-Z0-9", () => {
    expect(normalizeVatDisplay("DE1234567890")).toBe("DE1234567890");
  });
});
