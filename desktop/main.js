// main.js — Thought Tidy desktop app (Electron main process)
// Tray icon + global hotkey + popup + settings windows

const {
  app, BrowserWindow, Tray, Menu, globalShortcut,
  ipcMain, clipboard, nativeImage, shell, Notification, screen,
  safeStorage, dialog
} = require("electron");
const path  = require("path");
const Store = require("electron-store");
const { registerAll, makeBackupHandlers } = require("./ipc-handlers");
const fs = require("fs");
const { todayDate, purgeOldLog, uid } = require("../lib/text");

const store = new Store({ name: "thought-tidy-settings" });

// ── OS keychain encryption (Electron safeStorage) ──────────────────────────────
// safeStorage uses DPAPI on Windows, Keychain on macOS — keys are never stored
// in plaintext on disk. The ENC_PREFIX sentinel lets us detect already-encrypted
// values so migration and getters are safe to call repeatedly.

const ENC_PREFIX = "enc1:";
const _SENSITIVE     = new Set(["openaiKey", "claudeKey", "geminiKey", "licenseEmail", "licenseKey", "demoMode", "corpMode"]);
const _STRICT_KEYS   = new Set(["demoMode", "corpMode"]);
const _SYNC_KEYS = new Set([
  "configuredProviders", "geminiModels",
  "openaiKey", "claudeKey", "geminiKey",
  "openaiModel", "claudeModel", "geminiModel",
  "variants", "customPrompts", "actionSettings",
  "profileName", "profileRole", "profileStyle", "profileContext", "profileEnabled", "profileVocab",
  "licenseEmail", "licenseKey"
]);

let _encWarnSent = false;
function _encVal(v) {
  if (!safeStorage.isEncryptionAvailable()) {
    if (!_encWarnSent) {
      _encWarnSent = true;
      console.warn("[security] safeStorage encryption unavailable -- API keys are stored unprotected on disk.");
    }
    return v;
  }
  try { return ENC_PREFIX + safeStorage.encryptString(String(v)).toString("base64"); }
  catch { return v; }
}
function _decVal(v) {
  if (typeof v !== "string" || !v.startsWith(ENC_PREFIX)) return v;
  try { return safeStorage.decryptString(Buffer.from(v.slice(ENC_PREFIX.length), "base64")); }
  catch { return v; }
}
function _decValStrict(v) {
  if (typeof v !== "string" || !v.startsWith(ENC_PREFIX)) return null;
  try { return safeStorage.decryptString(Buffer.from(v.slice(ENC_PREFIX.length), "base64")); }
  catch { return null; }
}
function _encProviders(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr.map(p => ({ ...p, apiKey: p.apiKey ? _encVal(p.apiKey) : p.apiKey }));
}
function _decProviders(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr.map(p => ({ ...p, apiKey: p.apiKey ? _decVal(p.apiKey) : p.apiKey }));
}

function makeEncryptingStore(raw) {
  return {
    get(key) {
      const v = raw.get(key);
      if (_STRICT_KEYS.has(key)) return _decValStrict(v);
      if (_SENSITIVE.has(key)) return _decVal(v);
      if (key === "configuredProviders") return _decProviders(v);
      return v;
    },
    set(key, val) {
      if (_SENSITIVE.has(key)) {
        raw.set(key, _encVal(val));
      } else if (key === "configuredProviders") {
        raw.set(key, _encProviders(val));
      } else {
        raw.set(key, val);
      }
      // Auto-stamp syncMeta whenever a sync-relevant key changes so the extension
      // can compare timestamps without decrypting anything.
      if (_SYNC_KEYS.has(key)) {
        raw.set("syncMeta", { lastChanged: new Date().toISOString() });
      }
    },
    delete(key) {
      raw.delete(key);
    },
    get store() {
      const s = { ...raw.store };
      for (const k of _SENSITIVE) {
        if (k in s) s[k] = _STRICT_KEYS.has(k) ? _decValStrict(s[k]) : _decVal(s[k]);
      }
      if (s.configuredProviders) s.configuredProviders = _decProviders(s.configuredProviders);
      return s;
    }
  };
}

function migrateToEncryptedKeys(raw) {
  if (!safeStorage.isEncryptionAvailable()) return;
  for (const k of _SENSITIVE) {
    const v = raw.get(k);
    if (v && typeof v === "string" && !v.startsWith(ENC_PREFIX)) {
      try { raw.set(k, _encVal(v)); } catch {}
    }
  }
  const providers = raw.get("configuredProviders");
  if (Array.isArray(providers)) {
    const needsMig = providers.some(p => p.apiKey && !p.apiKey.startsWith(ENC_PREFIX));
    if (needsMig) {
      try { raw.set("configuredProviders", _encProviders(providers)); } catch {}
    }
  }
}

// encStore is set in whenReady() after safeStorage becomes available.
// quickAction / quickCustomAction run only after startup, so it is always initialised.
let encStore = null;
const isDev = process.argv.includes("--dev");

// Runtime sign key -- read from env var or (dev only) ETC/brainfix-ai.env.
// afterPack injects this into lib/license.js at build time; this is a fallback
// for dev builds where the env var wasn't set during the build.
function _readCipherKey() {
  if (process.env.REQUEST_SIGN_KEY) return process.env.REQUEST_SIGN_KEY;
  if (app.isPackaged) return null; // installed build must rely on afterPack injection
  try {
    const etcFile = path.join(__dirname, "..", "ETC", "brainfix-ai.env");
    if (!fs.existsSync(etcFile)) return null;
    for (const line of fs.readFileSync(etcFile, "utf8").split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0 && line.slice(0, eq).trim() === "REQUEST_SIGN_KEY")
        return line.slice(eq + 1).trim();
    }
  } catch {}
  return null;
}

// True when built with testBuild:true injected via electron-builder-test.yml.
// Drives TEST ONLY banners in settings UI and tray menu label.
const IS_TEST_BUILD = (() => {
  if (!app.isPackaged) return process.env.TEST_BUILD === 'true';
  try { return require('./package.json').testBuild === true; } catch { return false; }
})();

let tray        = null;
let popupWin    = null;
let settingsWin = null;

function applyZoomToWindow(win) {
  if (!win || win.isDestroyed()) return;
  const zoom = encStore ? encStore.get("zoomLevel") : null;
  const factor = (!zoom || zoom === "auto") ? 1.0 : parseFloat(zoom);
  if (!isNaN(factor)) win.webContents.setZoomFactor(factor);
}

// ── Path helpers ───────────────────────────────────────────────────────────────

// In production (packaged), extra resources land in process.resourcesPath.
// In development they live relative to this file.
function rootPath(...parts) {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(__dirname, "..", ...parts);
}

const APP_ICON = rootPath("icons", "icon.png");

// ── Popup window ───────────────────────────────────────────────────────────────

function createPopup() {
  popupWin = new BrowserWindow({
    width:     360,
    height:    660,
    show:      false,
    frame:     false,
    resizable: false,
    movable:   true,
    alwaysOnTop: true,
    skipTaskbar: true,
    roundedCorners: true,
    icon: APP_ICON,
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false
    }
  });

  popupWin.loadFile(path.join(__dirname, "renderer", "popup.html"));

  popupWin.webContents.on("did-finish-load", () => applyZoomToWindow(popupWin));

  // Hide (don't close) when focus is lost
  popupWin.on("blur", () => {
    if (!isDev) popupWin.hide();
  });

  popupWin.on("closed", () => { popupWin = null; });

  if (isDev || IS_TEST_BUILD || store.get("devMode")) popupWin.webContents.openDevTools({ mode: "detach" });
  popupWin.webContents.on("before-input-event", (_, input) => {
    if (input.type === "keyDown" && input.key === "F12")
      popupWin.webContents.isDevToolsOpened() ? popupWin.webContents.closeDevTools() : popupWin.webContents.openDevTools({ mode: "detach" });
  });
}

function openPopup() {
  if (!popupWin || popupWin.isDestroyed()) createPopup();

  // Position: bottom-right of the primary display work area
  const { workAreaSize } = screen.getPrimaryDisplay();
  const [w, h] = [360, 660];
  popupWin.setBounds({
    x: workAreaSize.width  - w - 16,
    y: workAreaSize.height - h - 16,
    width: w, height: h
  });

  popupWin.show();
  popupWin.focus();
  // Tell the renderer to pre-fill clipboard
  popupWin.webContents.send("popup-opened");
}

// ── Results window (3+ suggestions) ───────────────────────────────────────────

let resultsWin = null;

function openResults() {
  const resultsHtml = path.join(__dirname, "..", "popup", "results.html");
  if (resultsWin && !resultsWin.isDestroyed()) {
    resultsWin.loadFile(resultsHtml);
    resultsWin.focus();
    return;
  }
  resultsWin = new BrowserWindow({
    width:    900,
    height:   680,
    minWidth: 560,
    title:    "Thought Tidy — Suggestions",
    icon:     APP_ICON,
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false
    }
  });
  resultsWin.setMenu(null);
  resultsWin.loadFile(resultsHtml);
  resultsWin.webContents.on("did-finish-load", () => applyZoomToWindow(resultsWin));
  if (isDev || IS_TEST_BUILD || store.get("devMode")) resultsWin.webContents.openDevTools({ mode: "detach" });
  resultsWin.webContents.on("before-input-event", (_, input) => {
    if (input.type === "keyDown" && input.key === "F12")
      resultsWin.webContents.isDevToolsOpened() ? resultsWin.webContents.closeDevTools() : resultsWin.webContents.openDevTools({ mode: "detach" });
  });
  resultsWin.on("closed", () => { resultsWin = null; });
}

// ── Guide window ───────────────────────────────────────────────────────────────

let guideWin = null;

function openGuide(hash) {
  if (guideWin && !guideWin.isDestroyed()) {
    if (hash) guideWin.webContents.loadFile(path.join(__dirname, "renderer", "guide.html"), { hash });
    guideWin.focus();
    return;
  }
  guideWin = new BrowserWindow({
    width:    700,
    height:   780,
    minWidth: 500,
    title:    "Setup Guide & Privacy",
    icon:     APP_ICON,
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false
    }
  });
  guideWin.setMenu(null);
  guideWin.webContents.setWindowOpenHandler(({ url }) => {
    try { const u = new URL(url); if (u.protocol === "https:" || u.protocol === "http:") shell.openExternal(url); } catch {}
    return { action: "deny" };
  });
  guideWin.loadFile(path.join(__dirname, "renderer", "guide.html"), hash ? { hash } : {});
  guideWin.on("closed", () => { guideWin = null; });
}

// ── History window ─────────────────────────────────────────────────────────────

let historyWin = null;

function openHistory() {
  if (historyWin && !historyWin.isDestroyed()) { historyWin.focus(); return; }
  historyWin = new BrowserWindow({
    width:    860,
    height:   700,
    minWidth: 600,
    title:    "Thought Tidy — History",
    icon:     APP_ICON,
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false
    }
  });
  historyWin.setMenu(null);
  historyWin.loadFile(path.join(__dirname, "renderer", "history.html"));
  historyWin.on("closed", () => { historyWin = null; });
}

// ── Settings window ────────────────────────────────────────────────────────────

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width:    780,
    height:   720,
    minWidth: 600,
    title:    "Thought Tidy — Settings",
    icon:     APP_ICON,
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false
    }
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, "renderer", "settings.html"));
  settingsWin.webContents.on("did-finish-load", () => applyZoomToWindow(settingsWin));
  settingsWin.on("closed", () => { settingsWin = null; });

  if (isDev || IS_TEST_BUILD || store.get("devMode")) settingsWin.webContents.openDevTools({ mode: "right" });
  settingsWin.webContents.on("before-input-event", (_, input) => {
    if (input.type === "keyDown" && input.key === "F12")
      settingsWin.webContents.isDevToolsOpened() ? settingsWin.webContents.closeDevTools() : settingsWin.webContents.openDevTools({ mode: "right" });
  });
}

// ── Tray ───────────────────────────────────────────────────────────────────────

const _TRAY_PRO_IDS = new Set(["sound-like-me", "sound-human", "formal", "casual", "shorten", "expand", "clarity-check"]);

function buildTrayMenu() {
  const { DEFAULT_ACTION_SETTINGS, resolveActionSettings } = require("../lib/prompts");
  const { isProUnlocked } = require("../lib/license");
  const s              = encStore ? encStore.store : store.store;
  const isPro          = isProUnlocked(s);
  const storedActions  = resolveActionSettings(store.get("actionSettings") || []);
  const enabledActions = storedActions.filter(a => a.enabled && (isPro || !_TRAY_PRO_IDS.has(a.id)));
  const customPrompts  = isPro ? (store.get("customPrompts") || []) : [];

  const quickItems = enabledActions.map(a => ({
    label: a.label,
    click: () => quickAction(a.id, a.label)
  }));
  if (customPrompts.length) {
    quickItems.push({ type: "separator" });
    customPrompts.slice(0, 8).forEach((cp, i) => {
      quickItems.push({ label: `⚡ ${cp.name}`, click: () => quickCustomAction(i) });
    });
  }

  const items = [];
  if (IS_TEST_BUILD) {
    items.push({ label: "── TEST ONLY ──", enabled: false });
    items.push({ type: "separator" });
  }
  items.push(
    { label: "Process Text…",          click: openPopup },
    { type:  "separator" },
    { label: "Quick Fix (Clipboard)",  submenu: quickItems },
    { type:  "separator" },
    { label: "📋 See History",         click: openHistory },
    { type:  "separator" },
    { label: "Settings…",              click: openSettings },
    { type:  "separator" },
    { label: "Quit Thought Tidy",     role: "quit" }
  );
  return Menu.buildFromTemplate(items);
}

async function quickAction(action) {
  const text = clipboard.readText().trim();
  if (!text) {
    new Notification({ title: "Thought Tidy", body: "Clipboard is empty." }).show();
    return;
  }

  try {
    const { MENU_PROMPTS, buildPromptWithProfile, buildGrammarInstructions } = require("./lib-node/prompts");
    const { callAIWithFallback }                   = require("./lib-node/api");
    const { estimateCost }                         = require("../lib/pricing");
    const s = encStore.store;
    const rawBase      = MENU_PROMPTS[action] || MENU_PROMPTS["fix-spelling"];
    const grammarBlock = buildGrammarInstructions(s.grammarFilters);
    const basePrompt   = grammarBlock ? rawBase + "\n\n" + grammarBlock : rawBase;
    const systemPrompt = buildPromptWithProfile(basePrompt, s);
    const { result, usedProvider, usedModel } = await callAIWithFallback(
      s.configuredProviders || [], s.geminiModels || [null, null, null], s, systemPrompt, text,
      { basePrompt }
    );
    clipboard.writeText(result);
    store.set("lastAction", action);

    const today = todayDate();
    const fresh = purgeOldLog(store.get("historyLog") || []);
    fresh.push({
      timestamp: Date.now(), date: today, source: "desktop",
      action, provider: usedProvider, model: usedModel,
      inputLen: text.length, outputLen: result.length
    });
    store.set("historyLog", fresh.slice(-200));

    const historyFull = store.get("historyFull") || [];
    const cost = estimateCost(usedModel, text, [result]);
    historyFull.push({
      id: uid(),
      timestamp: Date.now(), date: today, source: "desktop",
      action, provider: usedProvider, model: usedModel,
      systemPrompt: systemPrompt.slice(0, 2000),
      inputText: text.slice(0, 5000),
      outputs: [result.slice(0, 5000)],
      ...cost
    });
    store.set("historyFull", historyFull.slice(-500));

    updateTrayTooltip();
    new Notification({ title: "Thought Tidy", body: "Done — result copied to clipboard." }).show();
  } catch (err) {
    const n = new Notification({ title: "Thought Tidy — Error", body: err.message + " — Click to open Settings." });
    n.on("click", openSettings);
    n.show();
  }
}

async function quickCustomAction(idx) {
  const text = clipboard.readText().trim();
  if (!text) { new Notification({ title: "Thought Tidy", body: "Clipboard is empty." }).show(); return; }
  try {
    const { buildPromptWithProfile, buildGrammarInstructions } = require("./lib-node/prompts");
    const { callAIWithFallback }     = require("./lib-node/api");
    const { estimateCost }           = require("../lib/pricing");
    const s         = encStore.store;
    const cp        = (s.customPrompts || [])[idx];
    if (!cp) return;
    const grammarBlock = buildGrammarInstructions(s.grammarFilters);
    const basePrompt   = grammarBlock ? cp.prompt + "\n\n" + grammarBlock : cp.prompt;
    const systemPrompt = buildPromptWithProfile(basePrompt, s);
    const { result, usedProvider, usedModel } = await callAIWithFallback(
      s.configuredProviders || [], s.geminiModels || [null, null, null], s, systemPrompt, text,
      { basePrompt }
    );
    clipboard.writeText(result);
    store.set("lastAction", `custom-${idx}`);

    const today = todayDate();
    const fresh = purgeOldLog(store.get("historyLog") || []);
    fresh.push({
      timestamp: Date.now(), date: today, source: "desktop",
      action: `custom-${idx}`, provider: usedProvider, model: usedModel,
      inputLen: text.length, outputLen: result.length
    });
    store.set("historyLog", fresh.slice(-200));

    const historyFull = store.get("historyFull") || [];
    const cost = estimateCost(usedModel, text, [result]);
    historyFull.push({
      id: uid(),
      timestamp: Date.now(), date: today, source: "desktop",
      action: `custom-${idx}`, provider: usedProvider, model: usedModel,
      systemPrompt: systemPrompt.slice(0, 2000),
      inputText: text.slice(0, 5000), outputs: [result.slice(0, 5000)], ...cost
    });
    store.set("historyFull", historyFull.slice(-500));

    updateTrayTooltip();
    new Notification({ title: "Thought Tidy", body: "Done — result copied to clipboard." }).show();
  } catch (err) {
    const n = new Notification({ title: "Thought Tidy — Error", body: err.message + " — Click to open Settings." });
    n.on("click", openSettings);
    n.show();
  }
}

function updateTrayTooltip() {
  if (!tray) return;
  const count = purgeOldLog(store.get("historyLog") || []).length;
  tray.setToolTip(count > 0 ? `Thought Tidy · ${count} fix${count === 1 ? "" : "es"} today` : "Thought Tidy");
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  let icon;
  try {
    icon = nativeImage.createFromPath(APP_ICON);
    if (icon.isEmpty()) throw new Error("empty");
    icon = icon.resize({ width: 22, height: 22 });
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip("Thought Tidy");
  tray.setContextMenu(buildTrayMenu());

  // Left-click / primary click opens the popup
  tray.on("click",        openPopup);
  tray.on("double-click", openPopup);
}

// ── Smart shortcut routing ─────────────────────────────────────────────────────
// Browsers capture Ctrl+Shift+Space for the extension shortcut at the browser level,
// but Electron's globalShortcut is an OS-level hook that fires regardless of which
// app is focused. We use this to capture selected text from the active OS window
// before the popup opens — the target app still has focus at the point we simulate Ctrl+C.
function smartOpenPopup() {
  // Toggle-close if the popup is already visible and focused
  if (popupWin && !popupWin.isDestroyed() && popupWin.isVisible() && popupWin.isFocused()) {
    popupWin.hide();
    return;
  }
  // Skip if a settings/history window has focus
  if (BrowserWindow.getFocusedWindow()) return;
  openPopup();
}

// ── Single-instance lock ───────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.whenReady().then(() => {
    dialog.showMessageBoxSync({
      type:    "warning",
      title:   "Thought Tidy",
      message: "Another instance of Thought Tidy is already running.",
      buttons: ["OK"]
    });
    app.quit();
  });
}

// ── App lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  if (!gotLock) return; // second instance — quit after dialog
  app.setName("Thought Tidy");

  // Migrate plaintext keys to OS keychain encryption, then wrap the store
  migrateToEncryptedKeys(store);
  encStore = makeEncryptingStore(store);

  // Start the local sync server so the browser extension can sync settings
  const { startSyncServer } = require("./lib-node/sync-server");
  startSyncServer(encStore);

  registerAll(ipcMain, {
    store:       encStore,
    clipboard,
    openSettings,
    openHistory,
    openResults,
    closePopup: () => { if (popupWin) popupWin.hide(); },
    openURL:    (url) => shell.openExternal(url)
  });

  ipcMain.handle("open-guide",      (_, hash) => openGuide(hash));
  ipcMain.handle("get-cipher-key",  ()        => _readCipherKey());
  ipcMain.handle("rebuild-tray",    ()        => updateTrayTooltip());

  const backupHandlers = makeBackupHandlers(dialog, fs);
  ipcMain.handle("save-backup", backupHandlers.saveBackup);
  ipcMain.handle("open-backup", backupHandlers.openBackup);

  ipcMain.handle("get-app-config", () => ({
    isTestBuild:     IS_TEST_BUILD,
    appVersion:      app.getVersion(),
    updateAvailable: encStore.get("updateAvailable") || null
  }));

  ipcMain.handle("check-for-update", async () => {
    try {
      const { checkNow } = require("./lib-node/updater");
      return await checkNow(store);
    } catch { return null; }
  });

  ipcMain.handle("resize-popup", (_, count) => {
    if (!popupWin || popupWin.isDestroyed()) return;
    const cols = Math.max(1, Math.min(4, count || 1));
    const w    = cols * 360;
    const h    = 660;
    const { workAreaSize } = screen.getPrimaryDisplay();
    popupWin.setBounds({
      x: Math.max(0, workAreaSize.width  - w - 16),
      y: workAreaSize.height - h - 16,
      width: w, height: h
    });
  });

  ipcMain.handle("set-zoom", (_, zoom) => {
    encStore.set("zoomLevel", zoom);
    const raw    = (!zoom || zoom === "auto") ? 1.0 : parseFloat(zoom);
    const factor = isNaN(raw) ? 1.0 : Math.min(2.0, Math.max(0.5, raw));
    for (const win of [popupWin, settingsWin]) {
      if (win && !win.isDestroyed()) win.webContents.setZoomFactor(factor);
    }
  });

  function startupShortcut() {
    return path.join(
      app.getPath("appData"),
      "Microsoft", "Windows", "Start Menu", "Programs", "Startup",
      "Thought Tidy.lnk"
    );
  }

  ipcMain.handle("get-login-item", () => {
    if (process.platform !== "win32") return app.getLoginItemSettings().openAtLogin;
    return require("fs").existsSync(startupShortcut());
  });

  ipcMain.handle("set-login-item", (_, val) => {
    if (process.platform !== "win32") {
      app.setLoginItemSettings({ openAtLogin: !!val, openAsHidden: true });
      return;
    }
    const lnk = startupShortcut();
    if (val) {
      shell.writeShortcutLink(lnk, "create", { target: process.execPath, description: "Thought Tidy" });
    } else {
      try { require("fs").unlinkSync(lnk); } catch {}
    }
  });

  ipcMain.handle("clear-all-data", async () => {
    const { response } = await dialog.showMessageBox({
      type:      "warning",
      buttons:   ["Cancel", "Clear Everything"],
      defaultId: 0,
      cancelId:  0,
      title:     "Clear All Data",
      message:   "Delete all settings, API keys, history, and license info?",
      detail:    "This cannot be undone. The app will restart with a clean slate.",
    });
    if (response !== 1) return { cleared: false };
    try { require("fs").unlinkSync(startupShortcut()); } catch {}
    store.clear();
    app.relaunch();
    app.exit(0);
    return { cleared: true };
  });

  // macOS: no dock icon — pure tray app
  if (process.platform === "darwin") app.dock.hide();

  createTray();
  updateTrayTooltip();
  // Purge stale log entries from previous days on launch
  store.set("historyLog", purgeOldLog(store.get("historyLog") || []));

  // Global shortcut: Ctrl+Shift+Space  (Cmd+Shift+Space on Mac)
  const shortcut = process.platform === "darwin"
    ? "Command+Shift+Space"
    : "Control+Shift+Space";

  const registered = globalShortcut.register(shortcut, smartOpenPopup);
  if (!registered && isDev) console.warn("Global shortcut registration failed.");

  // First run: open settings if no provider configured yet
  const hasKey = encStore.get("openaiKey") || encStore.get("claudeKey") || encStore.get("geminiKey")
    || (Array.isArray(encStore.get("configuredProviders")) && encStore.get("configuredProviders").length > 0);
  if (!hasKey) {
    openSettings();
  }

  // On first install, read auto-updater preference written by the installer checkbox.
  // After that the store is the source of truth (user can toggle in settings later).
  if (!store.has("autoUpdaterEnabled")) {
    let enabled = true;
    try {
      const { execSync } = require("child_process");
      const out = execSync(
        'reg query "HKCU\\Software\\NorthPandaLabs\\ThoughtTidy" /v autoUpdater',
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
      );
      enabled = /0x1/.test(out);
    } catch { /* registry key absent — default on */ }
    store.set("autoUpdaterEnabled", enabled);
  }

  // Schedule passive update check (packaged builds only — checks at noon daily)
  if (app.isPackaged && store.get("autoUpdaterEnabled", true)) {
    const { scheduleUpdateCheck } = require("./lib-node/updater");
    scheduleUpdateCheck(store);
  }
});


// Keep process alive after all windows close (tray app — stays in background)
app.on("window-all-closed", () => {});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
