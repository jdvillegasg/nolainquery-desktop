#!/bin/bash
# Script to bundle the Python engine into a self-contained executable for Tauri

# Ensure we're in the right directory
ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$ENGINE_DIR/../.." && pwd)"
BIN_DIR="$ROOT_DIR/desktop_app/frontend/src-tauri/bin"

mkdir -p "$BIN_DIR"

# Use the project virtualenv when present so PyInstaller bundles the same deps as dev.
if [ -f "$ROOT_DIR/.venv/bin/activate" ]; then
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.venv/bin/activate"
fi

# Install PyInstaller if not present
pip install pyinstaller

# Detect target triple for Tauri (example: x86_64-unknown-linux-gnu)
if command -v rustc &> /dev/null; then
    TARGET_TRIPLE=$(rustc -vV | grep host | awk '{print $2}')
else
    # Fallback to uname if rustc is not in the path
    ARCH=$(uname -m)
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    if [ "$OS" == "linux" ]; then
        TARGET_TRIPLE="$ARCH-unknown-linux-gnu"
    elif [ "$OS" == "darwin" ]; then
        TARGET_TRIPLE="$ARCH-apple-darwin"
    else
        TARGET_TRIPLE="$ARCH-$OS"
    fi
fi

echo "Bundling Python engine for $TARGET_TRIPLE..."

# Bundle using PyInstaller
# --onedir is safer for large frameworks like pandas/polars
# --noconfirm overwrites previous builds
cd "$ENGINE_DIR"
REPO_PACKAGES="$ROOT_DIR/packages/query_execution"
# Exclude ML/GPU stacks from the active Python env — not used by the sidecar
# but PyInstaller would otherwise bundle them (~2GB+).
PYINSTALLER_EXCLUDES=(
    --exclude-module torch
    --exclude-module torchvision
    --exclude-module torchaudio
    --exclude-module transformers
    --exclude-module sklearn
    --exclude-module tensorflow
    --exclude-module triton
    --exclude-module nvidia
)

# query_execution is imported only inside request handlers; PyInstaller will not
# collect it unless --paths / --hidden-import are set (same as build-sidecar.ps1).
pyinstaller --noconfirm --onefile --clean --noupx \
    --name "python-sidecar-$TARGET_TRIPLE" \
    --add-data "src:src" \
    --paths "$REPO_PACKAGES" \
    --hidden-import query_execution \
    --hidden-import query_execution.safe_pandas_executor \
    --hidden-import query_execution.notebook_session \
    --hidden-import query_execution.sandbox_environment \
    --hidden-import scipy \
    --hidden-import scipy.stats \
    "${PYINSTALLER_EXCLUDES[@]}" \
    main.py

# Move the resulting binary to the Tauri bin folder
mv "dist/python-sidecar-$TARGET_TRIPLE" "$BIN_DIR/"

echo "Sidecar binary created in $BIN_DIR"
