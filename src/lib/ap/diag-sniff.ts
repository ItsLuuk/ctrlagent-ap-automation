import { sniffStructuredRoot, isStructuredInvoice } from "./structured-common";

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>2026-001</cbc:ID>
</Invoice>`;

const buf = new TextEncoder().encode(UBL);
console.log("buf length:", buf.length);
console.log("first 4 bytes:", buf.slice(0,4).toString("utf-8"));
const result = sniffStructuredRoot(buf);
console.log("sniffStructuredRoot result:", JSON.stringify(result));
console.log("isStructuredInvoice:", isStructuredInvoice(buf));
