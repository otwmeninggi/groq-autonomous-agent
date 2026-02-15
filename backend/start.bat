@echo off
echo ============================================================
echo 🚀 Starting Groq Autonomous Agent Backend
echo ============================================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Python not found. Please install Python 3.7 or higher.
    pause
    exit /b 1
)

echo ✓ Python found
echo.

REM Install dependencies
echo 📦 Installing dependencies...
pip install -r requirements.txt --quiet

if %errorlevel% equ 0 (
    echo ✓ Dependencies installed successfully
) else (
    echo ❌ Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo ============================================================
echo Starting Flask server...
echo ============================================================
echo.

REM Run the server
python server.py

pause
