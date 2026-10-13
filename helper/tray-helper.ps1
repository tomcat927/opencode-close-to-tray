# opencode-close-to-tray — PowerShell tray helper
# Spawned by the patched Electron main process.
# Provides: tray icon, left-click toggle, right-click menu (Show / Hide / Quit).
# Communicates with the main process via named pipe: opencode-tray-pipe

param(
    [string]$PipeName,
    [int]$TargetPid
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class OcWin {
    [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr hIcon);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern int ExtractIconEx(string lpszFile, int nIconIndex, out IntPtr phiconLarge, out IntPtr phiconSmall, uint nIcons);
}
"@

function Get-OcIcon {
    $exe = $null
    try {
        $proc = Get-Process -Id $sync.TargetPid -ErrorAction SilentlyContinue
        if ($proc -and $proc.MainModule) { $exe = $proc.MainModule.FileName }
    } catch { }
    if (-not $exe) {
        try {
            $oc = Get-Process -ErrorAction SilentlyContinue | Where-Object {
                $_.MainModule -and $_.ProcessName -match 'OpenCode'
            } | Select-Object -First 1
            if ($oc) { $exe = $oc.MainModule.FileName }
        } catch { }
    }
    if (-not $exe) { return [System.Drawing.SystemIcons]::Application }
    $large = [IntPtr]::Zero
    $small = [IntPtr]::Zero
    try {
        $n = [OcWin]::ExtractIconEx($exe, 0, [ref]$large, [ref]$small, 1)
        if ($n -gt 0 -and $large -ne [IntPtr]::Zero) {
            $icon = [System.Drawing.Icon]::FromHandle($large)
            $clone = $icon.Clone()
            [OcWin]::DestroyIcon($large) | Out-Null
            return $clone
        }
    } catch { }
    try {
        $assoc = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
        if ($assoc) { return $assoc }
    } catch { }
    return [System.Drawing.SystemIcons]::Application
}

$sync = [hashtable]::Synchronized(@{})
$sync.PipeName = $PipeName
$sync.TargetPid = $TargetPid

# --- named pipe client ---
function Send-OcCommand {
    param([string]$Command)
    $client = $null
    try {
        $client = [System.IO.Pipes.NamedPipeClientStream]::new('.', $sync.PipeName, [System.IO.Pipes.PipeDirection]::Out)
        $client.Connect(1000)
        $bytes = [System.Text.Encoding]::ASCII.GetBytes("$Command`n")
        $client.Write($bytes, 0, $bytes.Length)
        $client.Flush()
        return $true
    } catch {
        return $false
    } finally {
        if ($client) { $client.Dispose() }
    }
}

# --- tray icon ---
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = Get-OcIcon
$tray.Text = 'OpenCode - close to tray'
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemShow = $menu.Items.Add('Show window')
$itemHide = $menu.Items.Add('Hide to tray')
$null = $menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$itemExit = $menu.Items.Add('Quit opencode')

$itemShow.Add_Click({ $null = Send-OcCommand -Command 'SHOW' })
$itemHide.Add_Click({ $null = Send-OcCommand -Command 'HIDE' })
$itemExit.Add_Click({
    if (Send-OcCommand -Command 'QUIT') {
        $tray.Visible = $false
    }
})

$tray.Add_MouseUp({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Right) {
        $menu.Show([System.Windows.Forms.Cursor]::Position)
    } elseif ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        $null = Send-OcCommand -Command 'TOGGLE'
    }
})

# --- timer: parent monitor ---
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({
    # If parent process exits, clean up
    if (-not (Get-Process -Id $sync.TargetPid -ErrorAction SilentlyContinue)) {
        $tray.Visible = $false
        [System.Environment]::Exit(0)
    }
})
$timer.Start()

# Show balloon notification on first appearance
try {
    $tray.BalloonTipTitle = 'opencode'
    $tray.BalloonTipText = 'Window will minimize to tray when you click X.'
    $tray.ShowBalloonTip(3000)
} catch { }

[System.Windows.Forms.Application]::Run()
[System.Environment]::Exit(0)
