/**
 * opencode-close-to-tray patcher
 *
 * Patches the opencode desktop app's app.asar to intercept the window
 * close (X) button: instead of quitting the app, it hides the window
 * to the system tray. A lightweight PowerShell tray helper provides
 * the tray icon and menu (show / hide / quit).
 *
 * Adapted from grok-bot-tray (https://github.com/foztrk/grok-bot-tray)
 * for the opencode desktop app (Electron, @opencode-ai/desktop).
 *
 * License: MIT
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

// ---------------------------------------------------------------------------
// Paths — resolve the opencode desktop install directory.
// ---------------------------------------------------------------------------
const APP_DIR =
  process.env.OPENCODE_DIR ||
  path.join(process.env.LOCALAPPDATA, "Programs", "@opencode-aidesktop");

const RESOURCES_DIR = path.join(APP_DIR, "resources");
const ASAR_TARGET = path.join(RESOURCES_DIR, "app.asar");
const ASAR_BACKUP = path.join(RESOURCES_DIR, "app.asar.original");
const EXE_TARGET = path.join(APP_DIR, "OpenCode.exe");
const EXE_BACKUP = path.join(APP_DIR, "OpenCode.exe.original");

// opencode uses %APPDATA%\ai.opencode.desktop as userData (Chromium cache)
const USER_DATA = path.join(process.env.APPDATA, "ai.opencode.desktop");
const V8_CACHE_DIR = path.join(USER_DATA, "Code Cache", "js");

const ROOT_DIR = path.resolve(__dirname, "..");
const TEMP_DIR = path.join(ROOT_DIR, ".tmp_extract");
const TEMP_ASAR = path.join(ROOT_DIR, ".tmp_patched.asar");

const HELPER_SRC = path.join(ROOT_DIR, "helper", "tray-helper.ps1");
const HELPER_DST = path.join(RESOURCES_DIR, "tray-helper.ps1");

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

function writeFileWithRetry(filePath, data, maxRetries = 10, delayMs = 800) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      fs.writeFileSync(filePath, data);
      return;
    } catch (e) {
      if (i === maxRetries) throw e;
      console.log(
        `  [wait] ${path.basename(filePath)} locked, retrying (${i}/${maxRetries})...`
      );
      sleep(delayMs);
    }
  }
}

function copyFileWithRetry(src, dst, maxRetries = 10, delayMs = 800) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      fs.copyFileSync(src, dst);
      return;
    } catch (e) {
      if (i === maxRetries) throw e;
      console.log(
        `  [wait] ${path.basename(dst)} locked, retrying (${i}/${maxRetries})...`
      );
      sleep(delayMs);
    }
  }
}

function getAsarHeaderSha256(asarPath) {
  const fd = fs.openSync(asarPath, "r");
  const sizeBuf = Buffer.alloc(16);
  fs.readSync(fd, sizeBuf, 0, 16, 0);
  const headerSize = sizeBuf.readUInt32LE(12);
  const headerBuf = Buffer.alloc(headerSize);
  fs.readSync(fd, headerBuf, 0, headerSize, 16);
  fs.closeSync(fd);
  return crypto.createHash("sha256").update(headerBuf).digest("hex");
}

// ---------------------------------------------------------------------------
// Patch markers — unique enough to detect and clean prior patches.
// ---------------------------------------------------------------------------
const PATCH_TAG = "__oct_isQuitting";

// ---------------------------------------------------------------------------
console.log("===========================================================");
console.log("    opencode-close-to-tray patcher  v1.0.0");
console.log("===========================================================");

// 0. Validate paths
if (!fs.existsSync(ASAR_TARGET) || !fs.existsSync(EXE_TARGET)) {
  console.error(`[ERROR] opencode desktop not found at: ${APP_DIR}`);
  console.error("Set OPENCODE_DIR env var if installed elsewhere.");
  process.exit(1);
}
if (!fs.existsSync(HELPER_SRC)) {
  console.error(`[ERROR] tray-helper.ps1 not found at: ${HELPER_SRC}`);
  process.exit(1);
}

// 1. Kill running opencode processes
console.log("\n[1/7] Stopping running OpenCode processes...");
try {
  execSync('taskkill /F /IM "OpenCode.exe" /T 2>nul', { stdio: "ignore" });
} catch (e) {}
sleep(1500);

// 2. Backup originals (only first time)
console.log("[2/7] Backing up original files...");
if (!fs.existsSync(ASAR_BACKUP)) {
  fs.copyFileSync(ASAR_TARGET, ASAR_BACKUP);
  console.log("  -> app.asar.original created");
} else {
  // Restore from backup first — ensures clean patch base
  console.log("  -> app.asar.original exists, restoring clean base...");
  fs.copyFileSync(ASAR_BACKUP, ASAR_TARGET);
}
if (!fs.existsSync(EXE_BACKUP)) {
  fs.copyFileSync(EXE_TARGET, EXE_BACKUP);
  console.log("  -> OpenCode.exe.original created");
} else {
  fs.copyFileSync(EXE_BACKUP, EXE_TARGET);
  console.log("  -> OpenCode.exe restored from backup");
}

// 3. Copy tray helper
console.log("[3/7] Copying tray helper...");
copyFileWithRetry(HELPER_SRC, HELPER_DST);

// 4. Extract app.asar
console.log("[4/7] Extracting app.asar...");
if (fs.existsSync(TEMP_DIR)) {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}
execSync(`npx @electron/asar extract "${ASAR_TARGET}" "${TEMP_DIR}"`, {
  stdio: "inherit",
});

// 5. Patch out/main/index.js
console.log("[5/7] Patching out/main/index.js...");
const mainPath = path.join(TEMP_DIR, "out", "main", "index.js");
if (!fs.existsSync(mainPath)) {
  console.error("[ERROR] out/main/index.js not found in asar!");
  process.exit(1);
}

let code = fs.readFileSync(mainPath, "utf8");

// --- Patch A: Inject close-to-tray in registerWindow ---
// Anchor: win.on("closed", () => registry.closed(id));
// We inject a close handler BEFORE the closed handler that intercepts
// the X button: if not quitting, preventDefault + hide window.
const anchorRegex =
  /win\.on\("closed",\(\)=>\{registry\.closed\(id\)\}\);/;
const anchorMatch = anchorRegex.exec(code);

if (!anchorMatch) {
  console.error("[ERROR] registerWindow anchor not found!");
  console.error("opencode main code structure may have changed.");
  console.error("Please file an issue at the project repository.");
  process.exit(1);
}

const fullAnchor = anchorMatch[0];

const closePatch = `win.on("close",(e)=>{if(!global[${JSON.stringify(
  PATCH_TAG
)}]){e.preventDefault();win.hide();if(!global.__oct_balloonShown){global.__oct_balloonShown=true;try{require("node:net").connect("\\\\\\\\.\\\\pipe\\\\opencode-tray-balloon",()=>{}).on("error",()=>{});}catch(__e){}}}});${fullAnchor}`;

code = code.replace(fullAnchor, closePatch);
console.log("  -> close-to-tray handler injected");

// --- Patch B: Fix window-all-closed to respect quitting flag ---
// Original: app.on("window-all-closed", () => {
//   if (process.platform === "darwin") return;
//   app.quit();
// });
// Patched: only quit if isQuitting flag is set (so hiding window doesn't quit)
const wacAnchor =
  'app.on("window-all-closed",()=>{if(process.platform==="darwin")return;app.quit();});';
const wacRegex = /app\.on\("window-all-closed",\(\)=>\{if\(process\.platform==="darwin"\)return;app\.quit\(\);\}\);/;
const wacMatch = wacRegex.exec(code);

if (wacMatch) {
  const wacPatched = `app.on("window-all-closed",()=>{if(process.platform==="darwin")return;if(global[${JSON.stringify(
    PATCH_TAG
  )}]){app.quit();}});`;
  code = code.replace(wacMatch[0], wacPatched);
  console.log("  -> window-all-closed patched");
} else {
  console.log("  [warn] window-all-closed anchor not found (may have changed)");
}

// --- Patch C: Set quitting flag in before-quit ---
// Original: app.on("before-quit", () => { setAppQuitting(); ... });
// We also set our flag so window-all-closed lets it quit.
const bqRegex = /app\.on\("before-quit",\(\)=>\{setAppQuitting\(\);/;
const bqMatch = bqRegex.exec(code);
if (bqMatch) {
  code = code.replace(
    bqMatch[0],
    `app.on("before-quit",()=>{global[${JSON.stringify(
      PATCH_TAG
    )}]=true;setAppQuitting();`
  );
  console.log("  -> before-quit patched");
} else {
  console.log("  [warn] before-quit anchor not found");
}

// --- Patch D: Set quitting flag in will-quit ---
const wqRegex = /app\.on\("will-quit",\(\)=>\{setAppQuitting\(\);/;
const wqMatch = wqRegex.exec(code);
if (wqMatch) {
  code = code.replace(
    wqMatch[0],
    `app.on("will-quit",()=>{global[${JSON.stringify(
      PATCH_TAG
    )}]=true;setAppQuitting();`
  );
  console.log("  -> will-quit patched");
}

// --- Patch E: Spawn tray helper on window creation ---
// Inject after registerWindow(win, id) call in createMainWindow
const rwAnchor = "registerWindow(win, id);";
const rwIdx = code.indexOf(rwAnchor);
if (rwIdx !== -1) {
  const spawnPatch = `${rwAnchor}
  try{const __oct_cp=require("node:child_process");const __oct_path=require("node:path");const __oct_hp=__oct_path.join(process.resourcesPath,"tray-helper.ps1");if(require("node:fs").existsSync(__oct_hp)){const __oct_p=__oct_cp.spawn("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",__oct_hp,"-PipeName","opencode-tray-pipe","-TargetPid",String(process.pid)],{windowsHide:true,stdio:"ignore"});__oct_p.unref();}}catch(__e){}`;
  code = code.replace(rwAnchor, spawnPatch);
  console.log("  -> tray helper spawn injected");
} else {
  console.log("  [warn] registerWindow call anchor not found");
}

// --- Patch F: Handle second-instance (show window when clicking shortcut) ---
const siRegex = /app\.on\("second-instance",\(\)=>\{/;
const siMatch = siRegex.exec(code);
if (siMatch) {
  // Find the matching block and inject show logic at the start
  const insertPos = siMatch.index + siMatch[0].length;
  code =
    code.slice(0, insertPos) +
    '{const __oct_w=require("electron").BrowserWindow.getAllWindows()[0];if(__oct_w){if(__oct_w.isMinimized())__oct_w.restore();__oct_w.show();__oct_w.focus();}' +
    code.slice(insertPos);
  // Remove the duplicate opening brace by replacing the original
  // Actually simpler: just insert show logic before the block content
  // The above adds a new block — let's fix by not duplicating the brace
  // Revert and use a cleaner approach
  code = code.replace(
    siMatch[0] + '{const __oct_w=require("electron").BrowserWindow.getAllWindows()[0];if(__oct_w){if(__oct_w.isMinimized())__oct_w.restore();__oct_w.show();__oct_w.focus();}',
    siMatch[0] + 'const __oct_w=require("electron").BrowserWindow.getAllWindows()[0];if(__oct_w){if(__oct_w.isMinimized())__oct_w.restore();__oct_w.show();__oct_w.focus();}'
  );
  console.log("  -> second-instance handler patched");
}

// --- Patch G: Named pipe server for tray commands (SHOW/QUIT) ---
// Inject near the end of the file, before the last expression
const pipeServerCode = `
// --- opencode-close-to-tray: pipe server for tray helper ---
try{
  const __oct_net=require("node:net");
  const __oct_pipe="\\\\\\\\.\\\\pipe\\\\opencode-tray-pipe";
  const __oct_server=__oct_net.createServer((socket)=>{
    socket.on("data",(buf)=>{
      const cmd=buf.toString().trim();
      if(cmd==="SHOW"){
        const w=require("electron").BrowserWindow.getAllWindows()[0];
        if(w){if(w.isMinimized())w.restore();w.show();w.focus();}
      }else if(cmd==="QUIT"){
        global[${JSON.stringify(PATCH_TAG)}]=true;
        require("electron").app.quit();
      }
    });
    socket.on("error",()=>{});
  });
  __oct_server.on("error",()=>{});
  __oct_server.listen(__oct_pipe);
}catch(__e){}
`;
code += pipeServerCode;
console.log("  -> tray pipe server injected");

fs.writeFileSync(mainPath, code, "utf8");
console.log("  -> All patches applied to index.js");

// 6. Pack asar + update exe fuse hash
console.log("[6/7] Packing app.asar...");
const packCmd = `npx @electron/asar pack "${TEMP_DIR}" "${TEMP_ASAR}" --unpack-dir "{node_modules/@lydell,node_modules/@msgpackr-extract,node_modules/@parcel}"`;
execSync(packCmd, { stdio: "inherit" });

const newHeaderHash = getAsarHeaderSha256(TEMP_ASAR);
console.log(`  -> New asar hash: ${newHeaderHash}`);

// Update the SHA256 fuse embedded in OpenCode.exe
let exeBuf = fs.readFileSync(EXE_TARGET);
const fusePrefix = '"resources\\\\app.asar","alg":"SHA256","value":"';
const prefixPos = exeBuf.indexOf(fusePrefix, 0, "ascii");
if (prefixPos === -1) {
  console.error("[ERROR] Electron fuse header not found in OpenCode.exe!");
  console.error("The asar integrity check will fail on launch.");
  process.exit(1);
}
const hashPos = prefixPos + fusePrefix.length;
console.log(`  -> Updating fuse hash in OpenCode.exe (offset: ${hashPos})...`);
exeBuf.write(newHeaderHash, hashPos, "ascii");
writeFileWithRetry(EXE_TARGET, exeBuf);

copyFileWithRetry(TEMP_ASAR, ASAR_TARGET);

// Cleanup temp files
try {
  if (fs.existsSync(TEMP_DIR)) fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  if (fs.existsSync(TEMP_ASAR)) fs.unlinkSync(TEMP_ASAR);
} catch (e) {}

// 7. Clear V8 code cache
console.log("[7/7] Clearing V8 code cache...");
if (fs.existsSync(V8_CACHE_DIR)) {
  const files = fs.readdirSync(V8_CACHE_DIR);
  for (const f of files) {
    try {
      fs.unlinkSync(path.join(V8_CACHE_DIR, f));
    } catch (e) {}
  }
  console.log(`  -> Cleared ${files.length} cache files`);
} else {
  console.log("  -> No V8 cache found (fresh install)");
}

console.log("\n===========================================================");
console.log("  [SUCCESS] opencode-close-to-tray patch applied!");
console.log("  Clicking X will now minimize to the system tray.");
console.log("  Right-click the tray icon for: Show / Hide / Quit");
console.log("===========================================================");
