# Build a zero-install Windows desktop release (MSI + NSIS installer).
# Requires: Python 3.11+, Node.js 20+, Rust, and MSVC build tools (Visual Studio Build Tools).
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Join-Path $RootDir "desktop_app\frontend"
$DistDir = Join-Path $RootDir "dist\windows"
$VenvDir = Join-Path $RootDir ".venv"

Write-Host "Starting Windows desktop packaging..."

function Ensure-Command($Name, $Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required. $Hint"
    }
}

Ensure-Command "python" "Install Python 3.11+ from https://www.python.org/downloads/"
Ensure-Command "npm" "Install Node.js 20+ from https://nodejs.org/"
Ensure-Command "cargo" "Install Rust from https://rustup.rs/"

if (-not (Test-Path $VenvDir)) {
    Write-Host "Creating Python virtual environment..."
    python -m venv $VenvDir
}

Write-Host "Installing Python dependencies..."
& (Join-Path $VenvDir "Scripts\python.exe") -m pip install --upgrade pip setuptools wheel
& (Join-Path $VenvDir "Scripts\python.exe") -m pip install -r (Join-Path $RootDir "requirements.txt")
& (Join-Path $VenvDir "Scripts\python.exe") -m pip install pyinstaller

$env:Path = "$(Join-Path $VenvDir 'Scripts');$env:Path"

Write-Host "Bundling Python execution engine..."
& (Join-Path $RootDir "desktop_app\python_engine\build-sidecar.ps1")

Write-Host "Building Tauri Windows installers..."
Push-Location $FrontendDir
try {
    npm install
    # Packaged builds must talk to the hosted Cloud API, not a developer laptop.
    if (-not $env:VITE_CLOUD_API_URL) {
        $env:VITE_CLOUD_API_URL = if ($env:NOLAIN_CLOUD_API_URL) { $env:NOLAIN_CLOUD_API_URL } else { "https://nolainquery.com" }
    }
    if (-not $env:VITE_PORTAL_URL) {
        $env:VITE_PORTAL_URL = if ($env:NOLAIN_PORTAL_URL) { $env:NOLAIN_PORTAL_URL } else { "https://nolainquery.com" }
    }
    npm run tauri build -- --bundles msi,nsis
}
finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

$BundleRoot = Join-Path $FrontendDir "src-tauri\target\release\bundle"
$Artifacts = @()

foreach ($Pattern in @("msi\*.msi", "nsis\*.exe")) {
    $Matches = Get-ChildItem -Path (Join-Path $BundleRoot $Pattern) -ErrorAction SilentlyContinue
    foreach ($File in $Matches) {
        $Dest = Join-Path $DistDir $File.Name
        Copy-Item -Force $File.FullName $Dest
        $Artifacts += $Dest
    }
}

if ($Artifacts.Count -eq 0) {
    throw "No Windows installers found under $BundleRoot (expected msi/*.msi and nsis/*.exe)"
}

Write-Host ""
Write-Host "Success! Windows release artifacts:"
foreach ($Artifact in $Artifacts) {
    Write-Host "  $Artifact"
}
Write-Host ""
Write-Host "Share the NSIS .exe for a guided setup, or the .msi for enterprise deployment."
