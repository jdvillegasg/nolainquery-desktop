# Install Python, Node, and frontend dependencies for a Windows source build.
# Requires: Python 3.11+, Node.js 20+, Rust, and MSVC (Visual Studio Build Tools).
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvDir = Join-Path $RootDir ".venv"
$FrontendDir = Join-Path $RootDir "desktop_app\frontend"

Write-Host "nolainquery desktop — Windows setup"
Write-Host "-----------------------------------"

function Ensure-Command($Name, $Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required. $Hint"
    }
}

Ensure-Command "python" "Install Python 3.11+ from https://www.python.org/downloads/ and enable Add to PATH."
Ensure-Command "npm" "Install Node.js 20+ from https://nodejs.org/"
Ensure-Command "cargo" "Install Rust from https://rustup.rs/"

if (-not (Test-Path $VenvDir)) {
    Write-Host "Creating Python virtual environment..."
    python -m venv $VenvDir
}

$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
Write-Host "Installing Python dependencies..."
& $VenvPython -m pip install --upgrade pip setuptools wheel
& $VenvPython -m pip install -r (Join-Path $RootDir "requirements.txt")
& $VenvPython -m pip install pyinstaller

Write-Host "Installing frontend packages..."
Push-Location $FrontendDir
try {
    npm install
} finally {
    Pop-Location
}

Write-Host "-----------------------------------"
Write-Host "Setup complete."
Write-Host ""
Write-Host "Copy desktop_app\frontend\.env.example to desktop_app\frontend\.env"
Write-Host "Then start the app with:"
Write-Host "  .\launch.ps1"
