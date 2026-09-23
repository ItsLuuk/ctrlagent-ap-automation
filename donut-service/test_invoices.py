"""
Test script for Donut Invoice Extraction Service
Tests the service against the superdoos.nl invoice.
"""

import os
import sys
import time
import json
import requests
from pathlib import Path

# Configuration
SERVICE_URL = "http://localhost:8000"
TEST_PDF = "Superdoos.nl invoice.pdf"


def test_health():
    """Test health endpoint."""
    print("Testing health endpoint...")
    try:
        response = requests.get(f"{SERVICE_URL}/health", timeout=10)
        response.raise_for_status()
        data = response.json()
        print(f"  Status: {data['status']}")
        print(f"  Model loaded: {data['model_loaded']}")
        print(f"  Device: {data['device']}")
        if data.get('load_time_seconds'):
            print(f"  Load time: {data['load_time_seconds']:.1f}s")
        return data['model_loaded']
    except Exception as e:
        print(f"  ❌ Health check failed: {e}")
        return False


def test_extraction(pdf_path: str, endpoint: str = "/extract"):
    """Test invoice extraction."""
    print(f"\nTesting extraction: {pdf_path}")
    print(f"  Endpoint: {endpoint}")
    
    if not os.path.exists(pdf_path):
        print(f"  ❌ File not found: {pdf_path}")
        return None
    
    file_size = os.path.getsize(pdf_path)
    print(f"  File size: {file_size / 1024:.1f} KB")
    
    start_time = time.time()
    
    try:
        with open(pdf_path, "rb") as f:
            files = {"file": (os.path.basename(pdf_path), f, "application/pdf")}
            response = requests.post(
                f"{SERVICE_URL}{endpoint}",
                files=files,
                timeout=120,  # Donut inference can be slow
            )
        
        elapsed = time.time() - start_time
        print(f"  Response time: {elapsed:.2f}s")
        
        if response.status_code == 200:
            result = response.json()
            print(f"  ✅ Success: {result.get('success', 'N/A')}")
            
            if "inference_time_ms" in result:
                print(f"  Inference time: {result['inference_time_ms']:.0f}ms")
            
            if "raw_output" in result:
                print(f"\n  Raw output:\n{result['raw_output']}")
            
            if "parsed_data" in result and result["parsed_data"]:
                print(f"\n  Parsed data:")
                print(json.dumps(result["parsed_data"], indent=2))
            
            if "raw_text" in result:
                print(f"\n  Raw text:\n{result['raw_text']}")
            
            return result
        else:
            print(f"  ❌ HTTP {response.status_code}: {response.text}")
            return None
            
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"  ❌ Request failed after {elapsed:.2f}s: {e}")
        return None


def main():
    """Run all tests."""
    print("=" * 60)
    print("Donut Invoice Extraction - Test Suite")
    print("=" * 60)
    
    # Check if PDF exists
    if not os.path.exists(TEST_PDF):
        print(f"\n❌ Test PDF not found: {TEST_PDF}")
        print("Please ensure the file is in the current directory.")
        sys.exit(1)
    
    # Test health
    if not test_health():
        print("\n❌ Service is not healthy. Is it running?")
        print("Start the service with: python main.py")
        sys.exit(1)
    
    # Test extraction
    result = test_extraction(TEST_PDF, "/extract")
    
    # Test raw extraction
    test_extraction(TEST_PDF, "/extract-raw")
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    
    if result and result.get("success"):
        print("✅ All tests passed!")
        print("\nThe Donut model successfully extracted invoice data.")
        print("Compare this with Gemma's output to evaluate accuracy.")
    else:
        print("⚠️  Tests completed with issues.")
        print("Check the output above for details.")
    
    print("\nNext steps:")
    print("1. Compare Donut output with Gemma extraction")
    print("2. Fine-tune Donut on Dutch invoices for better accuracy")
    print("3. Integrate into your existing pipeline as fallback/alternative")


if __name__ == "__main__":
    main()
