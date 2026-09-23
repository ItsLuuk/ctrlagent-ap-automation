# Golden-file regression corpus

**What it is.** 10–15 real invoices per major NL producer with the expected extracted fields captured as ground truth. Run on every CI build through the deterministic paths only — text layer, UBL, regex — so a regression in the deterministic pipeline is caught without needing a model round-trip.

**Why now.** The deterministic paths carry the majority of invoices in a mature installation (learned templates + text-layer PDFs + UBL). A regression there is high-frequency, high-confidence, and model-free. The VLM path is exercised by its own integration tests with a live model; it does not belong in this corpus.

**Scope.** Start with the producers already in `src/lib/ap/pdf-meta.ts` `TABLE` plus any whose invoices you already have on disk. Expand one producer at a time as real invoices arrive.

| Producer | Invoices | Fields captured | Path under test |
|---|---|---|---|
| Moneybird | 10–15 | vendor, invoiceNumber, issueDate, dueDate, subtotal, tax, total, currency, iban, vatNumber, businessRegistrationNumber, lineItems[] | text layer + regex |
| Exact Online | 10–15 | same | text layer + regex |
| AFAS Safari | 10–15 | same | text layer + regex |
| eBoekhouden.nl | 10–15 | same | text layer + regex |
| WeFact | 10–15 | same | text layer + regex |
| Mollie | 10–15 | same | text layer + regex |
| UBL (any generator) | 10–15 | same, plus UBL-specific fields (Note, PaymentMeans) | UBL parse |

**Where files live.**

```
corpus/
  moneybird/
    expected.json        # ground-truth fields for every invoice in this folder
    inv-001.pdf
    inv-002.pdf
    ...
  exact-online/
    expected.json
    inv-001.pdf
    ...
  ubl/
    expected.json
    inv-001.xml          # UBL XML shipped inside the PDF (embedded) or as .xml sidecar
    inv-001.pdf
    ...
```

**expected.json shape.** One file per producer folder. An array of objects, one per invoice, keyed by filename.

```json
[
  {
    "file": "inv-001.pdf",
    "vendor": "Baker St. 42 BV",
    "invoiceNumber": "FB2026-00421",
    "issueDate": "2026-03-04",
    "dueDate": "2026-04-03",
    "subtotal": 1452.00,
    "tax": 304.92,
    "total": 1756.92,
    "currency": "EUR",
    "iban": "NL91ABNA0417164300",
    "vatNumber": "NL123456789B01",
    "businessRegistrationNumber": "73408441",
    "lineItems": [
      { "description": "Consultancy hours", "quantity": 8, "unitPrice": 181.50, "amount": 1452.00 }
    ]
  }
]
```

Fields not present on a given invoice are omitted (not nulled) so the harness only asserts on what the invoice actually carries. `lineItems` is omitted when the invoice has none (credit notes, etc.).

**What the harness asserts.** For each invoice in a folder:

1. Load the PDF through the existing `loadPages` / text-layer path (the same code the upload pipeline uses).
2. Run `extractFieldsFromPages` over the loaded pages.
3. Compare each expected field to the extracted value with a tolerance:
   - Strings: exact, trimmed.
   - Numbers: absolute tolerance €0.01 for totals/tax/subtotal; quantity/unitPrice/amount exact to €0.01.
   - Dates: exact `YYYY-MM-DD`.
   - `lineItems[]`: order-insensitive match on description + amount; quantity and unitPrice must match within €0.01.
4. Fail the build on the first mismatch with the invoice filename, field name, expected, and got.

**What it deliberately does not test.** The VLM path, template drift recovery, zone-check, cross-check, prepaid detection, currency inference on ambiguous documents, and any path that requires a model. Those are covered by their own tests. This corpus is for the deterministic path only.

**Adding a new producer.**

1. Drop 10–15 real PDF invoices into `corpus/<producer>/`.
2. Run the extraction once manually, inspect the result, and write `expected.json` from the fields you trust.
3. Run `bun run test:corpus` (once the script exists) and fix any mismatches by correcting `expected.json`, not the extraction code — the corpus is ground truth, not a mirror of current behaviour.
4. Add the producer to the table in this doc.

**CI integration.** The corpus test is deterministic and model-free, so it runs on every push and on the default CI budget. It is not skipped when Ollama is absent. If a PDF in the corpus cannot be read at all (corrupt, XFA-only, image-only), mark it with `_skip: true` in `expected.json` and file a ticket — do not silently skip the whole folder.
