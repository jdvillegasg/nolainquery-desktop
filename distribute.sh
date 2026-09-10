#!/bin/bash
set -e

echo "📦 Starting Zero-Install App Packaging..."

# AppImage tooling needs FUSE on Linux; without it bundling can hang indefinitely.
if [[ "$(uname -s)" == "Linux" ]] && ! dpkg -s libfuse2 >/dev/null 2>&1 && ! dpkg -s libfuse2t64 >/dev/null 2>&1; then
    echo "⚠️  libfuse2 is not installed — AppImage bundling may hang."
    echo "   Install it with: sudo apt install libfuse2"
fi

# 1. Ensure Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "🦀 Rust not found. Installing..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source $HOME/.cargo/env
fi

# 2. Build Python sidecar
echo "⚙️  Bundling Python Execution Engine..."
./desktop_app/python_engine/build-sidecar.sh

# 3. Build UI and Tauri AppImage
echo "🏗️  Building Tauri AppImage..."
cd desktop_app/frontend
npm install
# Packaged builds must talk to the hosted Cloud API, not a developer laptop.
# Ambient VITE_* from a local cloud-dev session must not leak into the artifact.
# Override with NOLAIN_CLOUD_API_URL / NOLAIN_PORTAL_URL for staging builds.
export VITE_CLOUD_API_URL="${NOLAIN_CLOUD_API_URL:-https://nolainquery.com}"
export VITE_PORTAL_URL="${NOLAIN_PORTAL_URL:-https://nolainquery.com}"
export APPIMAGE_EXTRACT_AND_RUN=1
npm run tauri build -- --bundles appimage

# 4. Copy final artifact to root
APPIMAGE=$(find src-tauri/target/release/bundle/appimage/ -name "*.AppImage" | head -n 1)
if [[ -z "$APPIMAGE" || ! -f "$APPIMAGE" ]]; then
    echo "❌ AppImage not found under src-tauri/target/release/bundle/appimage/"
    exit 1
fi
# Unlink first: overwriting a still-mapped AppImage fails with ETXTBSY.
DEST="../../Nolain-Data-Query.AppImage"
rm -f "$DEST"
cp "$APPIMAGE" "$DEST"

echo "✅ Success! Final 'Clickable' file created at: ./Nolain-Data-Query.AppImage"
echo "You can move this file anywhere and it will work with a double-click."
