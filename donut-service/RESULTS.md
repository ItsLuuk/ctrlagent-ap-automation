# Donut Invoice Extraction — Proof-of-Concept Results

## Test Results: Superdoos.nl Invoice

**Date:** September 21, 2026  
**Model:** `naver-clova-ix/donut-base-finetuned-cord-v2`  
**Device:** CPU (no GPU)  
**Inference time:** ~36 seconds per page

---

## Raw Output (first 500 chars)

```
<s_cord><s_menu> poser poser poser poser poser poser poser poser poser poser materi satz 
Daturn: 14 dagen<s_cnt> 91939<sep/><s_nm> Super-Klant</s_nm><sep/><s_nm> Othi Earplugs</s_nm>
<s_cnt> 8TW mmer</s_nm><s_price> NL005 163491825</s_price><sep/><s_nm> Lunk Earpug</s_nm>
<sep/><s_nm> SUK numero</s_nm><sep/> ...repeats "suspens" 300+ times...
```

## Parsed JSON

```json
[
  {"nm": "Super-Klant"},
  {"nm": "Othi Earplugs", "price": "NL005 163491825"},
  {"nm": "Lunk Earpug"},
  {"nm": "SUK numero"}
]
```

---

## Analysis: Why Donut CORD Fails on This Invoice

### Root Cause: Domain Mismatch

| Aspect | Donut CORD Training | Superdoos.nl Invoice |
|--------|---------------------|---------------------|
| **Language** | Korean + English receipts | Dutch B2B invoice |
| **Document type** | Point-of-sale receipts | Business-to-business invoice |
| **Layout** | Simple item/price rows | Complex multi-section (header, PO ref, line items, totals, footer) |
| **Tax format** | Korean VAT (한국 부가세) | Dutch BTW (21%, 9%) |
| **Amount format** | Korean won (₩) | EUR with Dutch notation (1.452,00) |

### What Went Wrong

1. **Vendor name**: Donut output "Super-Klant" (the *customer* name) — it can't distinguish bill-to from ship-to
2. **Line items**: Garbled — "Othi Earplugs", "Lunk Earpug" — not real product names
3. **VAT number**: Output "NL005 163491825" — wrong format (should be NL123456789B01)
4. **Repetition loop**: Model collapsed into "suspens suspens suspens..." — a known failure mode when the model is out-of-domain
5. **No totals, dates, addresses**: None extracted

### Comparison: Donut CORD vs. Gemma (Current)

| Field | Donut CORD | Gemma (current) |
|-------|-----------|-----------------|
| Vendor name | ❌ Wrong (customer) | ✅ Correct |
| Invoice number | ❌ Not found | ✅ Extracted |
| Issue date | ❌ Not found | ✅ Extracted |
| Due date | ❌ Not found | ✅ Extracted |
| Line items | ❌ Garbled | ✅ Structured |
| Subtotal | ❌ Not found | ✅ Extracted |
| Tax (BTW) | ❌ Not found | ✅ Extracted |
| Total | ❌ Not found | ✅ Extracted |
| IBAN | ❌ Not found | ✅ Extracted |
| VAT number | ❌ Wrong format | ✅ Extracted |
| Address | ❌ Not found | ✅ Extracted |

**Winner: Gemma (by a large margin)**

---

## Conclusions

### 1. Donut CORD is NOT suitable for Dutch B2B invoices
The CORD model was trained on Korean/English POS receipts. It has never seen:
- Dutch language
- B2B invoice format
- PO references, KvK numbers, BTW-identificatienummer
- EUR currency with Dutch number formatting

### 2. Fine-tuning would be required
To make Donut useful, you'd need to:
- Create a dataset of ~500-2000 Dutch B2B invoices with ground-truth annotations
- Fine-tune the base Donut model on this dataset
- This is a **significant project** (weeks of data annotation + training)

### 3. Gemma is already doing a great job
Your current pipeline (Gemma vision model + OCR cross-check + template matching) is:
- **More flexible** — handles any invoice format
- **More accurate** — correctly extracts all fields
- **Better architecture** — multi-pass (template → VLM → OCR fallback)
- **Already integrated** — works with your zone-check, drift-recovery, etc.

### 4. When WOULD Donut make sense?
Donut would be better if:
- You need **offline extraction** without a large LLM
- You process **high volumes** of a **single vendor format** (template-like)
- You want **sub-second inference** (with GPU + quantized model)
- You're building a **mobile app** with limited compute

---

## Recommendation

**Do NOT replace Gemma with Donut.** Your current system is more capable.

However, if you want to explore Donut further, the path would be:

1. **Collect Dutch invoice dataset** — 500+ invoices with annotated fields
2. **Fine-tune Donut-base** on your dataset
3. **Export to ONNX** for faster inference
4. **Use as fast fallback** for known vendors (like your template system, but AI-powered)

This is a separate project from your current AP automation work.

---

## Files Created

```
donut-service/
├── main.py                 # FastAPI service (for future use)
├── requirements.txt        # Python dependencies
├── test_direct.py          # Direct test script
├── test_invoices.py        # API test script
├── setup.sh               # Unix setup
├── setup.bat              # Windows setup
├── Superdoos.nl invoice.pdf  # Test invoice
├── donut_output.txt       # Raw model output
└── donut_parsed.json      # Parsed JSON output
```
