# opencode-close-to-tray — Restore
# Reverts opencode desktop to its original (unpatched) state.

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsPrincipal]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Requesting administrator privileges..." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList ("-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"")
    exit
}

$appDir = "$env:LOCALAPPDATA\Programs\@opencode-aidesktop"
$resourcesDir = "$appDir\resources"
$asarOriginal = "$resourcesDir\app.asar.original"
$exeOriginal = "$appDir\OpenCode.exe.original"
$asarTarget = "$resourcesDir\app.asar"
$exeTarget = "$appDir\OpenCode.exe"
$helperDst = "$resourcesDir\tray-helper.ps1"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "     opencode-close-to-tray — Restore to original          " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Stop opencode
Write-Host "[1/4] Stopping OpenCode..." -ForegroundColor Gray
try { taskkill /F /IM "OpenCode.exe" /T 2>$null | Out-Null } catch {}
Start-Sleep -Milliseconds 1500

# Restore asar
Write-Host "[2/4] Restoring app.asar..." -ForegroundColor Gray
if (Test-Path $asarOriginal) {
    Copy-Item $asarOriginal $asarTarget -Force
    Write-Host "  -> app.asar restored" -ForegroundColor Green
} else {
    Write-Host "  [warn] No backup found — asar is already original" -ForegroundColor Yellow
}

# Restore exe
Write-Host "[3/4] Restoring OpenCode.exe..." -ForegroundColor Gray
if (Test-Path $exeOriginal) {
    Copy-Item $exeOriginal $exeTarget -Force
    Write-Host "  -> OpenCode.exe restored" -ForegroundColor Green
} else {
    Write-Host "  [warn] No exe backup found — exe is already original" -ForegroundColor Yellow
}

# Remove tray helper
Write-Host "[4/4] Removing tray helper..." -ForegroundColor Gray
if (Test-Path $helperDst) {
    Remove-Item $helperDst -Force -ErrorAction SilentlyContinue
    Write-Host "  -> tray-helper.ps1 removed" -ForegroundColor Green
}

# Clear V8 cache
$v8Dir = "$env:APPDATA\ai.opencode.desktop\Code Cache\js"
if (Test-Path $v8Dir) {
    Get-ChildItem $v8Dir -File | Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Host "  -> V8 cache cleared" -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Restored! opencode is back to original state." -ForegroundColor Green
Write-Host "  The X button will now quit the app as normal." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
