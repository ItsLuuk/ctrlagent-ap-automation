#!/bin/bash
# Donut Invoice Extraction Service - Setup Script

set -e  # Exit on error

echo "=================================================="
echo "Donut Invoice Extraction Service - Setup"
echo "=================================================="

# Check Python version
python_version=$(python3 --version 2>&1 | awk '{print $2}')
echo "Python version: $python_version"

# Create virtual environment
echo ""
echo "Creating virtual environment..."
python3 -m venv venv

# Activate
echo "Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install dependencies
echo ""
echo "Installing dependencies..."
pip install -r requirements.txt

echo ""
echo "=================================================="
echo "Setup complete!"
echo ""
echo "To start the service:"
echo "  source venv/bin/activate"
echo "  python main.py"
echo ""
echo "To test:"
echo "  python test_invoices.py"
echo "=================================================="
