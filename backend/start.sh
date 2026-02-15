#!/bin/bash

echo "============================================================"
echo "🚀 Starting Groq Autonomous Agent Backend"
echo "============================================================"
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null
then
    echo "❌ Python3 not found. Please install Python 3.7 or higher."
    exit 1
fi

echo "✓ Python3 found: $(python3 --version)"

# Check if pip is installed
if ! command -v pip3 &> /dev/null
then
    echo "❌ pip3 not found. Please install pip."
    exit 1
fi

echo "✓ pip3 found"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
pip3 install -r requirements.txt --quiet

if [ $? -eq 0 ]; then
    echo "✓ Dependencies installed successfully"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo ""
echo "============================================================"
echo "Starting Flask server..."
echo "============================================================"
echo ""

# Run the server
python3 server.py
