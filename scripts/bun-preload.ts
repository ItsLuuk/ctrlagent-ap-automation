import { DOMParser as XmldomParser } from "@xmldom/xmldom";

if (typeof (globalThis as unknown as Record<string, unknown>).DOMParser === "undefined") {
  (globalThis as unknown as Record<string, unknown>).DOMParser = XmldomParser as unknown as typeof DOMParser;
}
