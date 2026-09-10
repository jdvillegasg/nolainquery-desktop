# Development launcher for the desktop app and local Python engine (Windows).
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPython = Join-Path $RootDir ".venv\Scripts\python.exe"
$EngineDir = Join-Path $RootDir "desktop_app\python_engine"
$FrontendDir = Join-Path $RootDir "desktop_app\frontend"
$EngineJob = $null

function Stop-Engine {
    if ($null -ne $EngineJob -and -not $EngineJob.HasExited) {
        Write-Host "Stopping local execution engine..."
        Stop-Process -Id $EngineJob.Id -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path $VenvPython)) {
    throw ".venv not found. Run .\setup-windows.ps1 first."
}

foreach ($Name in @("cargo", "npm")) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required. Run .\setup-windows.ps1 first."
    }
}

try {
    $null = Invoke-WebRequest -Uri "http://127.0.0.1:8001/health" -TimeoutSec 1 -UseBasicParsing
    throw "A local execution engine is already listening on port 8001."
} catch [System.Net.WebException], [System.Net.Http.HttpRequestException], [System.InvalidOperationException] {
    # Engine is not running — expected.
} catch {
    if ($_.Exception.Message -match "8001") { throw }
}

Write-Host "Starting local execution engine..."
$EngineJob = Start-Process -FilePath $VenvPython -ArgumentList "main.py" -WorkingDirectory $EngineDir -PassThru

$EngineReady = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $null = Invoke-WebRequest -Uri "http://127.0.0.1:8001/health" -TimeoutSec 1 -UseBasicParsing
        $EngineReady = $true
        break
    } catch {
        if ($EngineJob.HasExited) {
            throw "Local execution engine exited before becoming ready."
        }
        Start-Sleep -Milliseconds 500
    }
}

if (-not $EngineReady) {
    Stop-Engine
    throw "Local execution engine did not become ready on port 8001."
}

Write-Host "Local execution engine is ready."
Write-Host "Starting desktop UI..."
try {
    Push-Location $FrontendDir
    npm run tauri dev
} finally {
    Pop-Location
    Stop-Engine
}
