# Local AI Studio - Kokoro TTS setup for Windows

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent (Split-Path -Parent $scriptDir)
$appDir = Join-Path $rootDir "app"
$toolsDir = Join-Path $appDir "tools"
$nodeDir = Join-Path $toolsDir "node-win"
$nodeExe = Join-Path $nodeDir "node.exe"
$npmCmd = Join-Path $nodeDir "npm.cmd"
$runtimeDir = Join-Path $appDir "tts-runtime"
$modelsDir = Join-Path $appDir "tts-models"
$outputsDir = Join-Path $appDir "tts-outputs"
$cacheDir = Join-Path $appDir "tts-cache"

function Print-OK { param([string]$m); Write-Host "   OK  $m" -ForegroundColor Green }
function Print-Info { param([string]$m); Write-Host "   >>  $m" -ForegroundColor Cyan }
function Print-Fail { param([string]$m); Write-Host "   XX  $m" -ForegroundColor Red }

Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host "   Setting up Kokoro ONNX Text-to-Speech runtime" -ForegroundColor Cyan
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host ""

New-Item -ItemType Directory -Force -Path $runtimeDir, $modelsDir, $outputsDir, $cacheDir | Out-Null

if (-not (Test-Path $nodeExe) -or -not (Test-Path $npmCmd)) {
    Print-Fail "Portable Node.js is missing. Run scripts/setup/setup.ps1 first."
    exit 1
}

$packageJson = Join-Path $runtimeDir "package.json"
$needsWrite = $true
if (Test-Path $packageJson) {
    $content = Get-Content -Raw -Path $packageJson
    if ($content -match "node-addon-api" -and $content -match "node-gyp") {
        $needsWrite = $false
    }
}
if ($needsWrite) {
    '{"private":true,"type":"module","dependencies":{"kokoro-js":"^1.2.1","node-addon-api":"^7.1.1","node-gyp":"^10.0.0"}}' | Out-File -FilePath $packageJson -Encoding utf8
    $packageLock = Join-Path $runtimeDir "package-lock.json"
    if (Test-Path $packageLock) {
        Remove-Item -Force $packageLock
    }
}

Push-Location $runtimeDir
$oldPath = $env:PATH
$oldOrtCuda = $env:ONNXRUNTIME_NODE_INSTALL_CUDA
try {
    $env:PATH = "$nodeDir;$env:PATH"
    # Kokoro runs on CPU. Skipping ONNX Runtime's optional Linux CUDA payload
    # also avoids setup failures when a machine has a newer CUDA toolkit.
    $env:ONNXRUNTIME_NODE_INSTALL_CUDA = "skip"
    $installMode = if (Test-Path (Join-Path $runtimeDir "package-lock.json")) { "ci" } else { "install" }
    Print-Info "Installing pinned kokoro-js dependencies into app/tts-runtime..."
    & $npmCmd $installMode --prefer-online --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) {
        Print-Fail "kokoro-js install failed."
        exit 1
    }
} finally {
    $env:PATH = $oldPath
    $env:ONNXRUNTIME_NODE_INSTALL_CUDA = $oldOrtCuda
    Pop-Location
}

Print-OK "Kokoro TTS runtime is ready."
