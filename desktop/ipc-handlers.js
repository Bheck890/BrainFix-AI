// ipc-handlers.js — pure IPC handler logic, no Electron imports.
// Accepts duck-typed store and clipboard so the functions are unit-testable.
//
// store    : { get(key), set(key, val), store: Object }   (electron-store shape)
// clipboard: { readText(), writeText(text) }              (electron clipboard shape)

function makeStoreGetHandler(store) {
  return function storeGet(_, keys) {
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map(k => [k, store.get(k) ?? undefined]));
    }
    if (keys && typeof keys === "object") {
      // Called with a defaults object: { key: defaultValue, … }
      return Object.fromEntries(
        Object.entries(keys).map(([k, def]) => [k, store.get(k) ?? def])
      );
    }
    return store.get(keys);
  };
}

const _BLOCKED_STORE_KEYS = new Set(["autoUpdaterEnabled", "updateAvailable", "historyPin", "devMode"]);

function makeStoreSetHandler(store) {
  return function storeSet(_, data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    for (const [k, v] of Object.entries(data)) {
      if (!_BLOCKED_STORE_KEYS.has(k)) store.set(k, v);
    }
  };
}

function makeStoreDeleteHandler(store) {
  return function storeDelete(_, keys) {
    const arr = Array.isArray(keys) ? keys : [keys];
    arr.forEach(k => { if (!_BLOCKED_STORE_KEYS.has(k) && typeof store.delete === "function") store.delete(k); });
  };
}

function makeClipboardReadHandler(clipboard) {
  return () => clipboard.readText();
}

function makeClipboardWriteHandler(clipboard) {
  return (_, text) => { if (typeof text === "string") clipboard.writeText(text); };
}

// Returns { saveBackup, openBackup } handler functions for .ttbackup file I/O.
// dialog: Electron dialog module; fs: Node fs module (or duck-typed mock).
function makeBackupHandlers(dialog, fs) {
  return {
    saveBackup: async (_, { content, filename }) => {
      const result = await dialog.showSaveDialog({
        defaultPath: filename,
        filters: [{ name: "Thought Tidy Backup", extensions: ["ttbackup"] }]
      });
      if (result.canceled || !result.filePath) return { success: false };
      fs.writeFileSync(result.filePath, content, "utf8");
      return { success: true };
    },
    openBackup: async () => {
      const result = await dialog.showOpenDialog({
        filters: [{ name: "Thought Tidy Backup", extensions: ["ttbackup"] }],
        properties: ["openFile"]
      });
      if (result.canceled || !result.filePaths.length) return null;
      try {
        return fs.readFileSync(result.filePaths[0], "utf8");
      } catch {
        return null;
      }
    }
  };
}

// Registers all handlers onto an ipcMain instance.
// The callbacks for open-settings, close-popup, and open-url come
// from main.js since they touch BrowserWindow state.
function registerAll(ipcMain, { store, clipboard, openSettings, openHistory, openResults, closePopup, openURL }) {
  ipcMain.handle("store-get",       makeStoreGetHandler(store));
  ipcMain.handle("store-set",       makeStoreSetHandler(store));
  ipcMain.handle("store-delete",    makeStoreDeleteHandler(store));
  ipcMain.handle("read-clipboard",  makeClipboardReadHandler(clipboard));
  ipcMain.handle("write-clipboard", makeClipboardWriteHandler(clipboard));
  ipcMain.handle("open-settings",   () => openSettings());
  ipcMain.handle("open-history",    () => openHistory && openHistory());
  ipcMain.handle("open-results",    () => openResults && openResults());
  ipcMain.handle("close-popup",     () => closePopup());
  ipcMain.handle("open-url",        (_, url) => {
    if (typeof url !== "string") return;
    let parsed;
    try { parsed = new URL(url); } catch { return; }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
    openURL(url);
  });
}

module.exports = {
  makeStoreGetHandler,
  makeStoreSetHandler,
  makeStoreDeleteHandler,
  makeClipboardReadHandler,
  makeClipboardWriteHandler,
  makeBackupHandlers,
  registerAll
};
