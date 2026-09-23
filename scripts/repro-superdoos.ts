/** Debug: run extractFieldsFromPages on the real Superdoos invoice text. */
import { extractFieldsFromPages } from "../src/lib/ap/ocr";
import { readFileSync } from "node:fs";

const raw = readFileSync("scripts/superdoos-page1.txt", "utf8");

const result = extractFieldsFromPages([{ pageNumber: 1, text: raw, confidence: 0.98 }], "superdoos.pdf");
console.log(JSON.stringify({
  vendor: result.vendor,
  address: result.address,
  vendorEmail: result.vendorEmail,
  iban: result.iban,
  vatNumber: result.vatNumber,
  kvkNumber: result.kvkNumber,
}, null, 2));

console.log("\n--- expected ---");
console.log("vendor:      Superdoos B.V.");
console.log("address:     de Slof 10G, 5107 RJ Dongen");
console.log("vendorEmail: klantenservice@superdoos.nl");
console.log("iban:        NL95RABO0336381832");
console.log("vatNumber:   NL859520572B01 (vendor)");
console.log("kvk:         73408441 (vendor)");
