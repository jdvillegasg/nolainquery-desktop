#!/bin/bash
set -e

echo "nolainquery desktop — setup"
echo "---------------------------"

# 1. System dependencies (requires password on Debian/Ubuntu)
echo "[1/4] Installing system dependencies..."
if ! command -v apt &> /dev/null; then
    echo "Warning: apt not found. This script targets Debian/Ubuntu."
    echo "Install Tauri prerequisites manually: https://v2.tauri.app/start/prerequisites/"
else
    sudo apt update
    sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev python3-venv python3-pip
fi

# 2. Rust toolchain
if ! command -v cargo &> /dev/null; then
    if [ -f "$HOME/.cargo/env" ]; then
        echo "Loading Rust from $HOME/.cargo/env"
        # shellcheck disable=SC1091
        source "$HOME/.cargo/env"
    else
        echo "[2/4] Installing Rust..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        # shellcheck disable=SC1091
        source "$HOME/.cargo/env"
    fi
else
    echo "[2/4] Rust already installed."
fi

# 3. Node.js
if ! command -v npm &> /dev/null; then
    echo "[3/4] Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "[3/4] Node.js already installed."
fi

# 4. Project dependencies
echo "[4/4] Installing Python and frontend dependencies..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
pip install pyinstaller

cd desktop_app/frontend
npm install
cd ../..

echo "---------------------------"
echo "Setup complete."
echo ""
echo "Start the desktop against the hosted API:"
echo "  cp desktop_app/frontend/.env.example desktop_app/frontend/.env"
echo "  ./launch.sh"
echo ""
echo "See README.md for first-run verification."
