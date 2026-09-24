const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>2026-001</cbc:ID>
</Invoice>`;

const buf = new TextEncoder().encode(UBL);
console.log("byteLength:", buf.byteLength);
console.log("first 4 bytes:", [...buf.slice(0,4)].map(b=>b.toString(16).padStart(2,'0')).join(' '));
console.log("isEmpty UTF-8 head:", buf.slice(0,4).toString("utf-8").startsWith("<"));
console.log("isEmpty BOM head:", buf.slice(0,4).toString("utf-8").startsWith("\ufeff"));
console.log("head === <:", buf[0] === 0x3c);

// Re-implement decodeXmlSniffChunk step by step
function firstCloseAngleAfterRoot2(text) {
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt === -1) return -1;
    const after = text.slice(lt + 1, lt + 2);
    console.log("  at i="+i+" lt="+lt+" after="+JSON.stringify(after));
    if (after === "?") {
      const end = text.indexOf("?>", lt + 2);
      console.log("    PI ends at", end);
      i = end === -1 ? -1 : end + 2;
      continue;
    }
    if (after === "!") {
      const term = findMarkupTerminator2(text, lt + 2);
      console.log("    markup ends at", term);
      i = term;
      continue;
    }
    return lt;
  }
  return -1;
}
function findMarkupTerminator2(text, start) {
  if (text.slice(start, start + 4) === "!--") {
    const end = text.indexOf("-->", start + 4);
    return end === -1 ? -1 : end + 3;
  }
  if (text.slice(start, start + 9).startsWith("[CDATA[")) {
    const end = text.indexOf("]]>", start + 9);
    return end === -1 ? -1 : end + 3;
  }
  let i = start;
  let inQuote = false, quoteChar = "";
  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === quoteChar) inQuote = false;
    } else if (ch === '"' || ch === "'") {
      inQuote = true; quoteChar = ch;
    } else if (ch === ">") {
      return i + 1;
    }
    i++;
  }
  return -1;
}

const text = buf.toString("utf-8");
const rootStart2 = firstCloseAngleAfterRoot2(text);
console.log("rootStart2:", rootStart2);
if (rootStart2 !== -1) {
  const slice = buf.slice(0, rootStart2).toString("utf-8");
  console.log("slice length:", slice.length);
  console.log("slice:", JSON.stringify(slice));
  const doc = new DOMParser().parseFromString(slice, "text/xml");
  const pe = doc.getElementsByTagName("parsererror");
  console.log("parsererror:", pe.length);
  if (pe.length > 0) console.log("pe text:", pe[0].textContent);
  console.log("docElement:", doc.documentElement?.localName, doc.documentElement?.namespaceURI);
}
