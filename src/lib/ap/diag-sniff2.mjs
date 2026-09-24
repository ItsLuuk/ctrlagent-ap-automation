const { sniffStructuredRoot } = await import("./structured-common");

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>2026-001</cbc:ID>
</Invoice>`;

const buf = new TextEncoder().encode(UBL);

// Inline the UTF-8 decode path to see where it breaks.
function firstCloseAngleAfterRoot(text) {
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt === -1) return -1;
    const after = text.slice(lt + 1, lt + 2);
    if (after === "?") {
      i = text.indexOf("?>", lt + 2);
      if (i === -1) return -1;
      i += 2;
      continue;
    }
    if (after === "!") {
      const terminated = findMarkupTerminator(text, lt + 2);
      if (terminated === -1) return -1;
      i = terminated;
      continue;
    }
    return lt;
  }
  return -1;
}
function findMarkupTerminator(text, start) {
  if (text.slice(start, start + 4) === "!--") {
    const end = text.indexOf("-->", start + 4);
    return end === -1 ? -1 : end + 3;
  }
  if (text.slice(start, start + 9).startsWith("[CDATA[")) {
    const end = text.indexOf("]]>", start + 9);
    return end === -1 ? -1 : end + 3;
  }
  let i = start;
  let inQuote = false;
  let quoteChar = "";
  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === quoteChar) inQuote = false;
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ">") {
      return i + 1;
    }
    i++;
  }
  return -1;
}

const text = buf.toString("utf-8");
const rootStart = firstCloseAngleAfterRoot(text);
console.log("text:", JSON.stringify(text));
console.log("rootStart:", rootStart);
const slice = buf.slice(0, rootStart).toString("utf-8");
console.log("slice passed to DOMParser:", JSON.stringify(slice));
const doc = new DOMParser().parseFromString(slice, "text/xml");
const parsererror = doc.getElementsByTagName("parsererror");
console.log("parsererror elements:", parsererror.length);
if (parsererror.length > 0) {
  console.log("parsererror text:", parsererror[0].textContent);
}
console.log("docElement:", doc.documentElement?.localName);
