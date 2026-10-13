# opencode-close-to-tray

Patch the **opencode desktop app** (Electron) to minimize to the system tray when clicking the **Close (X) button** on Windows.

## Why

The opencode desktop app quits entirely when you click X. Users have been requesting close-to-tray behavior since March 2026 ([#18134](https://github.com/anomalyco/opencode/issues/18134), [#27463](https://github.com/anomalyco/opencode/issues/27463), [#42349](https://github.com/anomalyco/opencode/issues/42349)). Multiple PRs ([#35259](https://github.com/anomalyco/opencode/pull/35259), [#41484](https://github.com/anomalyco/opencode/pull/41484), [#41520](https://github.com/anomalyco/opencode/pull/41520)) were submitted but never merged. This project patches the app directly.

## Features

- **Click X → minimize to tray** (intercepts the Electron `close` event, not external polling)
- **Tray icon** with right-click menu: Show / Hide / Quit
- **Left-click tray icon** → toggle show/hide
- **Second-instance handling** — clicking the desktop shortcut restores the window
- **Balloon notification** on first minimize
- **100% reversible** — `restore.ps1` reverts to factory state

## Requirements

- Windows 10/11 (64-bit)
- [Node.js](https://nodejs.org) v18+ (for `npx @electron/asar`)
- opencode desktop installed at `%LOCALAPPDATA%\Programs\@opencode-aidesktop`

## Install

```powershell
# Right-click install.ps1 → "Run with PowerShell"
# Or from terminal:
powershell -ExecutionPolicy Bypass -File install.ps1
```

This will:
1. Back up `app.asar` and `OpenCode.exe` (only first time)
2. Extract and patch `out/main/index.js` inside the asar
3. Copy the tray helper to the app's resources folder
4. Repack the asar and update the SHA256 fuse hash in the exe
5. Clear the V8 code cache
6. Launch opencode

## Uninstall / Restore

```powershell
powershell -ExecutionPolicy Bypass -File restore.ps1
```

## How it works

The patcher modifies the Electron main process code inside `app.asar`:

1. **Close handler**: Injects `win.on("close", e => { if (!isQuitting) { e.preventDefault(); win.hide(); } })` into the `registerWindow` function, right before the existing `win.on("closed", ...)` handler.

2. **window-all-closed**: Patches the handler so hiding a window doesn't trigger `app.quit()`. The app only quits when `isQuitting` flag is set (via tray menu Quit or `before-quit`/`will-quit` events).

3. **Tray helper spawn**: On window creation, spawns a hidden PowerShell process (`tray-helper.ps1`) that creates a `NotifyIcon` with menu items. Communicates with the main process via named pipe (`\\.\pipe\opencode-tray-pipe`).

4. **Second-instance**: OpenCode's existing handler restores and focuses the window when its shortcut is opened again.

5. **Pipe server**: The main process handles `SHOW`/`HIDE`/`TOGGLE`/`QUIT` from the tray helper. Electron retains the window object even while hidden, so restoring does not depend on PowerShell finding a visible `MainWindowHandle`.

## Troubleshooting

If X removes the window but OpenCode remains in Task Manager, the app is hidden. Use the tray icon with tooltip **OpenCode - close to tray**, or open the desktop shortcut again to restore it. Windows may put the icon in the taskbar's hidden-icons area.

The separate `Eugene-Wen/opencode-tray` plugin can create another tray icon. It uses a different pipe and does not intercept X; uninstalling it is not required by this patch. Use this patch's icon when testing restore and Quit.

After installing, manually verify X, tray restore, and tray Quit. `npm test` checks pipe commands and hidden-window recovery; it does not click the actual title-bar X.

## Handling opencode updates

When opencode auto-updates, its `app.asar` is replaced. Simply run `install.ps1` again — the patcher detects the existing backup, restores a clean base, and re-applies the patch.

## Project structure

```
opencode-close-to-tray/
├── patcher/
│   └── patch.cjs           # Asar patcher (Node.js)
├── helper/
│   └── tray-helper.ps1     # PowerShell tray icon + menu + pipe client
├── install.ps1             # One-click installer
├── restore.ps1             # Revert to original
├── package.json
└── README.md
```

## Known limitations

- **Windows only** (PowerShell + WinForms + user32 API).
- **Must re-patch after each opencode update** (asar is overwritten).
- The patch modifies `app.asar` and `OpenCode.exe` (fuse hash). Antivirus may flag the exe modification — this is expected for any asar patcher.
- The tray helper checks for the parent process every 200ms; CPU impact is negligible.

## Acknowledgments

- [grok-bot-tray](https://github.com/foztrk/grok-bot-tray) — the asar patching approach and fuse hash update technique are adapted from this project.
- [opencode-tray](https://github.com/Eugene-Wen/opencode-tray) — the PowerShell tray helper design (NotifyIcon + named pipe) is based on this project.

## License

MIT
