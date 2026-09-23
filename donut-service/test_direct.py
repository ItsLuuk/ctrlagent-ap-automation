"""
Direct test of Donut extraction on the superdoos.nl invoice.
No server needed - runs directly.
"""

import sys
import os
import time
import json
from pathlib import Path

# Force UTF-8 output on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import torch
from PIL import Image
from transformers import DonutProcessor, VisionEncoderDecoderModel


# ──────────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────────

MODEL_NAME = "naver-clova-ix/donut-base-finetuned-cord-v2"
TEST_PDF = "Superdoos.nl invoice.pdf"


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("Donut Invoice Extraction - Direct Test")
    print("=" * 60)
    
    # Check if PDF exists
    if not Path(TEST_PDF).exists():
        print(f"\n[ERROR] Test PDF not found: {TEST_PDF}")
        print("Please ensure the file is in the current directory.")
        sys.exit(1)
    
    # Load model
    print(f"\nLoading model: {MODEL_NAME}")
    print("This will take ~1 minute on first run (downloading ~500MB)...")
    
    start = time.time()
    processor = DonutProcessor.from_pretrained(MODEL_NAME)
    model = VisionEncoderDecoderModel.from_pretrained(MODEL_NAME)
    
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Device: {device}")
    
    if device == "cuda":
        model = model.to("cuda")
    else:
        model = model.to("cpu")
    
    model.eval()
    load_time = time.time() - start
    print(f"[OK] Model loaded in {load_time:.1f}s\n")
    
    # Open PDF
    print(f"Opening PDF: {TEST_PDF}")
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(TEST_PDF)
        page = doc[0]  # First page
        pix = page.get_pixmap()
        image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        doc.close()
        print(f"  PDF opened: {pix.width}x{pix.height} pixels")
    except Exception as e:
        print(f"  [ERROR] Failed to open PDF: {e}")
        sys.exit(1)
    
    # Convert to RGB if needed
    if image.mode != "RGB":
        image = image.convert("RGB")
    
    # Resize for faster inference (Donut was trained on 2560x1920)
    max_size = 1280
    width, height = image.size
    if max(width, height) > max_size:
        scale = max_size / max(width, height)
        new_size = (int(width * scale), int(height * scale))
        image = image.resize(new_size, Image.LANCZOS)
        print(f"  Resized to: {image.size[0]}x{image.size[1]}")
    
    # Prepare prompt for CORD model
    task_prompt = "<s_cord><s_menu>"
    
    # Run inference
    print("\nRunning inference...")
    start = time.time()
    
    decoder_input_ids = processor.tokenizer(
        task_prompt, 
        add_special_tokens=False, 
        return_tensors="pt"
    ).input_ids
    
    if device == "cuda":
        decoder_input_ids = decoder_input_ids.to("cuda")
    
    pixel_values = processor(
        image, 
        random_padding=False, 
        return_tensors="pt"
    ).pixel_values
    
    if device == "cuda":
        pixel_values = pixel_values.to("cuda")
    
    with torch.no_grad():
        outputs = model.generate(
            pixel_values,
            decoder_input_ids=decoder_input_ids,
            max_length=model.config.decoder.max_position_embeddings,
            early_stopping=True,
            pad_token_id=processor.tokenizer.pad_token_id,
            eos_token_id=processor.tokenizer.eos_token_id,
            use_cache=True,
            num_beams=1,
            bad_words_ids=[[processor.tokenizer.unk_token_id]],
            return_dict_in_generate=True,
        )
    
    inference_time = time.time() - start
    
    # Decode output
    sequence = outputs.sequences[0]
    sequence = sequence.cpu().numpy() if device == "cuda" else sequence.numpy()
    
    decoded = processor.batch_decode(sequence, skip_special_tokens=True)[0]
    parsed = processor.token2json(decoded)
    
    # Print results
    print(f"\n{'=' * 60}")
    print("EXTRACTION RESULTS")
    print(f"{'=' * 60}")
    print(f"\nInference time: {inference_time:.2f}s")
    
    # Write raw output to file to avoid encoding issues
    with open('donut_output.txt', 'w', encoding='utf-8') as f:
        f.write(decoded)
    print(f"\nRaw output written to: donut_output.txt")
    print(f"\nRaw output (first 500 chars):\n{decoded[:500]}...")
    
    if parsed:
        # Write parsed JSON to file
        with open('donut_parsed.json', 'w', encoding='utf-8') as f:
            json.dump(parsed, f, indent=2, ensure_ascii=False)
        print(f"\nParsed JSON written to: donut_parsed.json")
        print(f"\nParsed JSON:\n{json.dumps(parsed, indent=2, ensure_ascii=False)}")
    
    # Extract key fields
    if parsed:
        print(f"\n{'=' * 60}")
        print("KEY FIELDS")
        print(f"{'=' * 60}")
        
        # parsed can be a list or a dict with a 'menu' key
        if isinstance(parsed, list):
            menu_items = parsed
        elif isinstance(parsed, dict):
            menu_items = parsed.get("menu", [])
            if isinstance(menu_items, dict):
                menu_items = [menu_items]
        else:
            menu_items = []
        
        for i, item in enumerate(menu_items[:10]):  # First 10 items
            if isinstance(item, dict):
                name = item.get("nm", "N/A")
                count = item.get("cnt", "1")
                price = item.get("price", "N/A")
                print(f"  {i+1}. {name} x{count} = {price}")
        
        if isinstance(parsed, dict):
            total = parsed.get("total", {})
            if isinstance(total, dict):
                total_price = total.get("total_price", "N/A")
                print(f"\n  Total: {total_price}")
    
    print(f"\n{'=' * 60}")
    print("COMPARISON NOTES")
    print(f"{'=' * 60}")
    print("""
Compare this Donut output with your Gemma extraction:

Donut (CORD model):
  - Trained on receipts/invoices (CORD dataset)
  - OCR-free: reads directly from image
  - Structured JSON output
  - ~500MB model, runs on CPU/GPU

Gemma (current):
  - General-purpose vision LLM
  - Uses OCR text as context
  - More flexible (can handle any prompt)
  - Larger model, needs more resources

Key questions:
  1. Which extracts more accurate vendor name?
  2. Which handles line items better?
  3. Which is faster for your use case?
""")


if __name__ == "__main__":
    main()
