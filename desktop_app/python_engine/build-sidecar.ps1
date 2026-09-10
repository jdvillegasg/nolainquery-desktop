# Bundle the Python engine into a self-contained executable for Tauri (Windows).
$ErrorActionPreference = "Stop"

$EngineDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $EngineDir "..\..")
$BinDir = Join-Path $RootDir "desktop_app\frontend\src-tauri\bin"

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

if (-not (Get-Command pyinstaller -ErrorAction SilentlyContinue)) {
    python -m pip install pyinstaller
}

$TargetTriple = ""
if (Get-Command rustc -ErrorAction SilentlyContinue) {
    $TargetTriple = (rustc -vV | Select-String "^host: ").ToString().Replace("host: ", "").Trim()
} else {
    $Arch = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") {
        "aarch64"
    } else {
        "x86_64"
    }
    $TargetTriple = "$Arch-pc-windows-msvc"
}

Write-Host "Bundling Python engine for $TargetTriple..."

Push-Location $EngineDir
try {
    $SidecarName = "python-sidecar-$TargetTriple"
    $RepoPackages = Join-Path $RootDir "packages\query_execution"

    # Exclude ML/GPU stacks from the active Python env — not used by the sidecar
    # but PyInstaller would otherwise bundle them (~2GB+).
    $PyInstallerExcludes = @(
        "--exclude-module", "torch",
        "--exclude-module", "torchvision",
        "--exclude-module", "torchaudio",
        "--exclude-module", "transformers",
        "--exclude-module", "sklearn",
        "--exclude-module", "tensorflow",
        "--exclude-module", "triton",
        "--exclude-module", "nvidia"
    )

    pyinstaller --noconfirm --onefile --clean --noupx `
        --name $SidecarName `
        --add-data "src;src" `
        --paths $RepoPackages `
        --hidden-import query_execution `
        --hidden-import query_execution.safe_pandas_executor `
        --hidden-import query_execution.notebook_session `
        --hidden-import query_execution.sandbox_environment `
        --hidden-import scipy `
        --hidden-import scipy.stats `
        @PyInstallerExcludes `
        main.py

    $BuiltExe = Join-Path $EngineDir "dist\$SidecarName.exe"
    if (-not (Test-Path $BuiltExe)) {
        throw "PyInstaller did not produce $BuiltExe"
    }

    Copy-Item -Force $BuiltExe (Join-Path $BinDir "$SidecarName.exe")
    Write-Host "Sidecar binary created in $BinDir"
}
finally {
    Pop-Location
}
