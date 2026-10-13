# opencode-close-to-tray — Installer
# Runs the patcher to add close-to-tray behavior to opencode desktop.
# Requires Node.js (for npx @electron/asar) and PowerShell 5.1+.

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsPrincipal]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Requesting administrator privileges..." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList ("-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"")
    exit
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "     opencode-close-to-tray Installer                      " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "[ERROR] Node.js not found! Install from https://nodejs.org" -ForegroundColor Red
    pause
    exit 1
}

# Set write permissions on app dir (needed for LOCALAPPDATA too)
$appDir = "$env:LOCALAPPDATA\Programs\@opencode-aidesktop"
if (Test-Path $appDir) {
    Write-Host "[1/2] Setting folder write permissions..." -ForegroundColor Gray
    icacls $appDir /grant Users:(OI)(CI)F /t /c /q | Out-Null
}

# Run patcher
Write-Host "[2/2] Applying close-to-tray patch..." -ForegroundColor Gray
node "$ScriptDir\patcher\patch.cjs"

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  Done! Launching opencode..." -ForegroundColor Green
    Write-Host "  Clicking X will now minimize to the system tray." -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Start-Process "$appDir\OpenCode.exe"
} else {
    Write-Host ""
    Write-Host "[ERROR] Patch failed! Check output above." -ForegroundColor Red
}

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
