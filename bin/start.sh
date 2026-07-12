#!/bin/bash
set -e

# Base directory (project root)
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/.."
cd "$DIR"

echo "📦 Starting Boya Tools Setup..."

# Setup venv if not existing
if [ ! -d "venv" ]; then
    echo "Creating virtual environment using Python 3.12..."
    /opt/homebrew/bin/python3.12 -m venv venv
fi

# Activate & Install
echo "Installing dependencies..."
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

echo "Starting Boya Tools Server on port 5001..."
./venv/bin/python server.py
