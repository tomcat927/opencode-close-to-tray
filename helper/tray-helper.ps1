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
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
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

$SW_HIDE = 0
$SW_SHOW = 5
$SW_RESTORE = 9

$sync = [hashtable]::Synchronized(@{})
$sync.PipeName = $PipeName
$sync.TargetPid = $TargetPid
$sync.Queue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()

function Get-OcHandle {
    $proc = Get-Process -Id $sync.TargetPid -ErrorAction SilentlyContinue
    if ($proc -and $proc.MainWindowHandle -ne 0) {
        return $proc.MainWindowHandle
    }
    $candidates = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.MainWindowHandle -ne 0 -and $_.ProcessName -match 'OpenCode'
    }
    if ($candidates) {
        return ($candidates | Select-Object -First 1).MainWindowHandle
    }
    return [IntPtr]::Zero
}

function Resolve-Handle {
    if ($sync.Handle -eq $IntPtr::Zero -or $sync.Handle -eq $null -or -not [OcWin]::IsWindow($sync.Handle)) {
        $sync.Handle = Get-OcHandle
    }
    return $sync.Handle
}

function Invoke-Window {
    param([int]$cmd)
    $h = Resolve-Handle
    if ($h -eq [IntPtr]::Zero) { return $false }
    [OcWin]::ShowWindow($h, $cmd) | Out-Null
    if ($cmd -eq $SW_SHOW -or $cmd -eq $SW_RESTORE) {
        try { [OcWin]::SetForegroundWindow($h) | Out-Null } catch { }
    }
    return $true
}

function Toggle-Window {
    $h = Resolve-Handle
    if ($h -eq [IntPtr]::Zero) { return $false }
    if ([OcWin]::IsWindowVisible($h)) { return Invoke-Window -cmd $SW_HIDE }
    return Invoke-Window -cmd $SW_RESTORE
}

# --- named pipe server (background runspace) ---
$pipeScript = {
    param($sync)
    try {
        $server = [System.IO.Pipes.NamedPipeServerStream]::new($sync.PipeName, [System.IO.Pipes.PipeDirection]::InOut)
    } catch {
        return
    }
    while ($true) {
        try {
            $server.WaitForConnection()
            $buf = New-Object byte[] 64
            $total = 0
            while ($total -lt $buf.Length) {
                $n = $server.Read($buf, $total, $buf.Length - $total)
                if ($n -le 0) { break }
                $total += $n
                if ($buf[$total - 1] -eq 10) { break }
            }
            if ($total -gt 0) {
                $cmd = [System.Text.Encoding]::ASCII.GetString($buf, 0, $total).Trim()
                $sync.Queue.Enqueue($cmd)
            }
            if ($server.IsConnected) { $server.Disconnect() }
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
}
$pipeHost = [powershell]::Create()
$pipeHost.Runspace = [runspacefactory]::CreateRunspace()
$pipeHost.Runspace.Open()
$null = $pipeHost.AddScript($pipeScript).AddArgument($sync)
$null = $pipeHost.BeginInvoke()

# --- tray icon ---
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = Get-OcIcon
$tray.Text = 'opencode — close to tray'
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemShow = $menu.Items.Add('Show window')
$itemHide = $menu.Items.Add('Hide to tray')
$null = $menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$itemExit = $menu.Items.Add('Quit opencode')

$itemShow.Add_Click({ $null = Invoke-Window -cmd $SW_RESTORE })
$itemHide.Add_Click({ $null = Invoke-Window -cmd $SW_HIDE })
$itemExit.Add_Click({
    $null = Invoke-Window -cmd $SW_RESTORE
    $sync.Queue.Enqueue('QUIT')
})

$tray.Add_MouseUp({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Right) {
        $menu.Show([System.Windows.Forms.Cursor]::Position)
    } elseif ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        $null = Toggle-Window
    }
})

# --- timer: process pipe commands + parent monitor ---
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({
    $cmd = $null
    while ($sync.Queue.TryDequeue([ref]$cmd)) {
        switch ($cmd) {
            'SHOW' { $null = Invoke-Window -cmd $SW_RESTORE }
            'HIDE' { $null = Invoke-Window -cmd $SW_HIDE }
            'QUIT' {
                $tray.Visible = $false
                [System.Environment]::Exit(0)
            }
        }
    }
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
