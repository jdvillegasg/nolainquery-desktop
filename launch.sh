#!/bin/bash
# Development launcher for the desktop app and local Python engine.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_PID=""
CLEANED_UP=0

cleanup() {
    if [ "$CLEANED_UP" -eq 1 ]; then
        return
    fi
    CLEANED_UP=1

    if [ -n "$PY_PID" ] && kill -0 "$PY_PID" 2>/dev/null; then
        echo "Stopping local execution engine..."
        kill "$PY_PID" 2>/dev/null || true
        wait "$PY_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

if [ ! -d "$ROOT_DIR/.venv" ]; then
    echo "Error: .venv not found. Run ./setup.sh first." >&2
    exit 1
fi

# shellcheck disable=SC1091
source "$ROOT_DIR/.venv/bin/activate"

if ! command -v cargo >/dev/null 2>&1 && [ -f "$HOME/.cargo/env" ]; then
    # shellcheck disable=SC1090
    source "$HOME/.cargo/env"
fi

for command in cargo curl npm python; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "Error: $command is required. Run ./setup.sh first." >&2
        exit 1
    fi
done

if curl --fail --silent --max-time 1 http://127.0.0.1:8001/health >/dev/null 2>&1; then
    echo "Error: a local execution engine is already listening on port 8001." >&2
    exit 1
fi

echo "Starting local execution engine..."
(
    cd "$ROOT_DIR/desktop_app/python_engine"
    exec python main.py
) &
PY_PID=$!

echo "Waiting for the local execution engine..."
ENGINE_READY=0
for _ in {1..60}; do
    if curl --fail --silent --max-time 1 http://127.0.0.1:8001/health >/dev/null 2>&1; then
        ENGINE_READY=1
        break
    fi
    if ! kill -0 "$PY_PID" 2>/dev/null; then
        echo "Error: local execution engine exited before becoming ready." >&2
        exit 1
    fi
    sleep 0.5
done

if [ "$ENGINE_READY" -ne 1 ]; then
    echo "Error: local execution engine did not become ready on port 8001." >&2
    exit 1
fi

echo "Local execution engine is ready."
echo "Starting desktop UI..."
cd "$ROOT_DIR/desktop_app/frontend"
npm run tauri dev
