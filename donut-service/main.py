"""
Donut Invoice Extraction Service
Proof-of-concept FastAPI service using Donut (OCR-free Document Understanding Transformer)
for extracting structured data from invoices.
"""

import io
import json
import time
from typing import Optional
from contextlib import asynccontextmanager

import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Model imports
import torch
from transformers import DonutProcessor, VisionEncoderDecoderModel


# ──────────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────────

# Pre-trained Donut model for document parsing (CORD dataset - receipts/invoices)
MODEL_NAME = "naver-clova-ix/donut-base-finetuned-cord-v2"

# Alternative: Use base model for fine-tuning on your own dataset
# MODEL_NAME = "naver-clova-ix/donut-base"


# ──────────────────────────────────────────────────────────────────────────────
# Global state
# ──────────────────────────────────────────────────────────────────────────────

class ModelState:
    def __init__(self):
        self.processor: Optional[DonutProcessor] = None
        self.model: Optional[VisionEncoderDecoderModel] = None
        self.device: str = "cuda" if torch.cuda.is_available() else "cpu"
        self.loaded: bool = False
        self.load_time: float = 0

state = ModelState()


# ──────────────────────────────────────────────────────────────────────────────
# FastAPI app
# ──────────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup."""
    print(f"🚀 Loading Donut model: {MODEL_NAME}")
    print(f"   Device: {state.device}")
    start = time.time()
    
    try:
        state.processor = DonutProcessor.from_pretrained(MODEL_NAME)
        state.model = VisionEncoderDecoderModel.from_pretrained(MODEL_NAME)
        
        if state.device == "cuda":
            state.model = state.model.to("cuda")
        else:
            state.model = state.model.to("cpu")
        
        state.model.eval()
        state.loaded = True
        state.load_time = time.time() - start
        print(f"✅ Model loaded in {state.load_time:.1f}s")
    except Exception as e:
        print(f"❌ Failed to load model: {e}")
        raise
    
    yield
    
    # Cleanup
    state.model = None
    state.processor = None
    print("🛑 Model unloaded")


app = FastAPI(
    title="Donut Invoice Extraction API",
    description="OCR-free invoice parsing using Donut (Document Understanding Transformer)",
    version="0.1.0",
    lifespan=lifespan,
)


# ──────────────────────────────────────────────────────────────────────────────
# Request/Response models
# ──────────────────────────────────────────────────────────────────────────────

class ExtractionResult(BaseModel):
    """Result of invoice extraction."""
    success: bool
    raw_output: str
    parsed_data: Optional[dict] = None
    inference_time_ms: float
    model: str
    device: str
    error: Optional[str] = None


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    model_loaded: bool
    device: str
    load_time_seconds: Optional[float] = None


# ──────────────────────────────────────────────────────────────────────────────
# Extraction functions
# ──────────────────────────────────────────────────────────────────────────────

def preprocess_image(image: Image.Image, max_size: int = 1280) -> Image.Image:
    """
    Resize image for optimal Donut inference.
    Donut was trained on 2560x1920 images, but smaller is faster.
    """
    width, height = image.size
    
    # Scale down if larger than max_size on any edge
    if max(width, height) > max_size:
        scale = max_size / max(width, height)
        new_size = (int(width * scale), int(height * scale))
        image = image.resize(new_size, Image.LANCZOS)
    
    return image


def extract_invoice_data(image: Image.Image) -> dict:
    """
    Run Donut inference on an invoice image.
    
    Returns:
        dict with 'raw_output' and 'parsed_data' (if parseable JSON)
    """
    if not state.loaded:
        raise RuntimeError("Model not loaded")
    
    # Preprocess
    image = preprocess_image(image)
    
    # Prepare prompt for CORD model
    # CORD format: <s_menu><s_nm>name</s_nm><s_price>price</s_price></s_menu>...
    task_prompt = "<s_cord><s_menu>"
    
    # Run inference
    decoder_input_ids = state.processor.tokenizer(
        task_prompt, 
        add_special_tokens=False, 
        return_tensors="pt"
    ).input_ids
    
    if state.device == "cuda":
        decoder_input_ids = decoder_input_ids.to("cuda")
    
    # Prepare pixel values
    pixel_values = state.processor(
        image, 
        random_padding=False, 
        return_tensors="pt"
    ).pixel_values
    
    if state.device == "cuda":
        pixel_values = pixel_values.to("cuda")
    
    # Generate
    with torch.no_grad():
        outputs = state.model.generate(
            pixel_values,
            decoder_input_ids=decoder_input_ids,
            max_length=model.config.decoder.max_position_embeddings,
            early_stopping=True,
            pad_token_id=state.processor.tokenizer.pad_token_id,
            eos_token_id=state.processor.tokenizer.eos_token_id,
            use_cache=True,
            num_beams=1,
            bad_words_ids=[[state.processor.tokenizer.unk_token_id]],
            return_dict_in_generate=True,
        )
    
    # Decode
    sequence = outputs.sequences[0]
    sequence = sequence.cpu().numpy() if state.device == "cuda" else sequence.numpy()
    
    decoded = state.processor.batch_decode(sequence, skip_special_tokens=True)[0]
    decoded = state.processor.token2json(decoded)
    
    return {
        "raw_output": decoded,
        "parsed_data": decoded if isinstance(decoded, dict) else None,
    }


# ──────────────────────────────────────────────────────────────────────────────
# API endpoints
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check if the service is healthy and model is loaded."""
    return HealthResponse(
        status="healthy" if state.loaded else "unhealthy",
        model_loaded=state.loaded,
        device=state.device,
        load_time_seconds=state.load_time if state.loaded else None,
    )


@app.post("/extract", response_model=ExtractionResult)
async def extract_invoice(file: UploadFile = File(...)):
    """
    Extract structured data from an invoice image/PDF.
    
    Accepts:
        - PNG, JPEG images
        - PDF files (first page will be extracted)
    
    Returns:
        Extracted invoice data in CORD format
    """
    if not state.loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    start_time = time.time()
    
    try:
        # Read file
        contents = await file.read()
        
        # Open image
        if file.content_type == "application/pdf":
            # For PDF, use pdf2image or PyMuPDF
            try:
                import fitz  # PyMuPDF
                doc = fitz.open(stream=contents, filetype="pdf")
                page = doc[0]  # First page
                pix = page.get_pixmap()
                image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                doc.close()
            except ImportError:
                # Fallback: try to open as image (might fail)
                image = Image.open(io.BytesIO(contents))
        else:
            image = Image.open(io.BytesIO(contents))
        
        # Convert to RGB if needed
        if image.mode != "RGB":
            image = image.convert("RGB")
        
        # Extract
        result = extract_invoice_data(image)
        
        inference_time = (time.time() - start_time) * 1000
        
        return ExtractionResult(
            success=True,
            raw_output=str(result["raw_output"]),
            parsed_data=result["parsed_data"],
            inference_time_ms=inference_time,
            model=MODEL_NAME,
            device=state.device,
        )
        
    except Exception as e:
        inference_time = (time.time() - start_time) * 1000
        return ExtractionResult(
            success=False,
            raw_output="",
            parsed_data=None,
            inference_time_ms=inference_time,
            model=MODEL_NAME,
            device=state.device,
            error=str(e),
        )


@app.post("/extract-raw")
async def extract_invoice_raw(file: UploadFile = File(...)):
    """
    Extract raw text output from Donut (no JSON parsing).
    Useful for debugging and understanding model output.
    """
    if not state.loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    start_time = time.time()
    
    try:
        contents = await file.read()
        
        if file.content_type == "application/pdf":
            import fitz
            doc = fitz.open(stream=contents, filetype="pdf")
            page = doc[0]
            pix = page.get_pixmap()
            image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            doc.close()
        else:
            image = Image.open(io.BytesIO(contents))
        
        if image.mode != "RGB":
            image = image.convert("RGB")
        
        image = preprocess_image(image)
        
        # Simple text generation without JSON parsing
        task_prompt = "<s_cord>"
        
        decoder_input_ids = state.processor.tokenizer(
            task_prompt, 
            add_special_tokens=False, 
            return_tensors="pt"
        ).input_ids
        
        if state.device == "cuda":
            decoder_input_ids = decoder_input_ids.to("cuda")
        
        pixel_values = state.processor(
            image, 
            random_padding=False, 
            return_tensors="pt"
        ).pixel_values
        
        if state.device == "cuda":
            pixel_values = pixel_values.to("cuda")
        
        with torch.no_grad():
            outputs = state.model.generate(
                pixel_values,
                decoder_input_ids=decoder_input_ids,
                max_length=768,
                early_stopping=True,
                pad_token_id=state.processor.tokenizer.pad_token_id,
                eos_token_id=state.processor.tokenizer.eos_token_id,
                use_cache=True,
                num_beams=1,
                bad_words_ids=[[state.processor.tokenizer.unk_token_id]],
            )
        
        sequence = outputs.sequences[0]
        sequence = sequence.cpu().numpy() if state.device == "cuda" else sequence.numpy()
        
        decoded = state.processor.batch_decode(sequence, skip_special_tokens=True)[0]
        
        inference_time = (time.time() - start_time) * 1000
        
        return {
            "raw_text": decoded,
            "inference_time_ms": inference_time,
            "model": MODEL_NAME,
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
