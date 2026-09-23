@echo off
REM Donut Invoice Extraction Service - Setup Script (Windows)

echo ==================================================
echo Donut Invoice Extraction Service - Setup
echo ==================================================

REM Check Python
python --version
if %errorlevel% neq 0 (
    echo Python not found. Please install Python 3.8+
    exit /b 1
)

REM Create virtual environment
echo.
echo Creating virtual environment...
python -m venv venv

REM Activate
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Upgrade pip
echo Upgrading pip...
pip install --upgrade pip

REM Install dependencies
echo.
echo Installing dependencies...
pip install -r requirements.txt

echo.
echo ==================================================
echo Setup complete!
echo.
echo To start the service:
echo   venv\Scripts\activate
echo   python main.py
echo.
echo To test:
echo   python test_invoices.py
echo ==================================================

pause
