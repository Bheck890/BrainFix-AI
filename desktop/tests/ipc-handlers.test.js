// Tests for the IPC handler logic in desktop/ipc-handlers.js.
// Uses plain JavaScript mock objects — no Electron required.

const {
  makeStoreGetHandler,
  makeStoreSetHandler,
  makeStoreDeleteHandler,
  makeClipboardReadHandler,
  makeClipboardWriteHandler,
  registerAll
} = require("../ipc-handlers");

// ── Mock helpers ───────────────────────────────────────────────────────────────

function makeStore(initial = {}) {
  const data = { ...initial };
  return {
    get: (key)      => data[key],
    set: (key, val) => { data[key] = val; },
    store: data
  };
}

function makeClipboard(initial = "") {
  let text = initial;
  return {
    readText:  ()  => text,
    writeText: (t) => { text = t; }
  };
}

// The first arg to handlers is the ipcMain event object — we pass null in tests.
const EVENT = null;

// ── store-get ──────────────────────────────────────────────────────────────────

describe("makeStoreGetHandler", () => {
  let handler;
  beforeEach(() => {
    handler = makeStoreGetHandler(makeStore({ provider: "openai", openaiKey: "sk-abc" }));
  });

  test("returns a single value when called with a string key", () => {
    expect(handler(EVENT, "provider")).toBe("openai");
  });

  test("returns undefined for a missing key", () => {
    expect(handler(EVENT, "missing")).toBeUndefined();
  });

  test("returns an object with all requested keys when called with an array", () => {
    const result = handler(EVENT, ["provider", "openaiKey"]);
    expect(result).toEqual({ provider: "openai", openaiKey: "sk-abc" });
  });

  test("includes missing keys as undefined in array mode", () => {
    const result = handler(EVENT, ["provider", "claudeKey"]);
    expect(result.provider).toBe("openai");
    expect(result.claudeKey).toBeUndefined();
  });

  test("uses defaults from a defaults-object when key is missing", () => {
    const result = handler(EVENT, { provider: "gemini", variants: 2 });
    expect(result.provider).toBe("openai"); // stored value overrides default
    expect(result.variants).toBe(2);        // default used since key absent
  });

  test("stored value takes precedence over default in defaults-object mode", () => {
    const result = handler(EVENT, { openaiKey: "fallback" });
    expect(result.openaiKey).toBe("sk-abc");
  });
});

// ── store-set ──────────────────────────────────────────────────────────────────

describe("makeStoreSetHandler", () => {
  test("persists a single key-value pair", () => {
    const store   = makeStore();
    const handler = makeStoreSetHandler(store);
    handler(EVENT, { provider: "claude" });
    expect(store.get("provider")).toBe("claude");
  });

  test("persists multiple keys in one call", () => {
    const store   = makeStore();
    const handler = makeStoreSetHandler(store);
    handler(EVENT, { openaiKey: "sk-x", openaiModel: "gpt-4o" });
    expect(store.get("openaiKey")).toBe("sk-x");
    expect(store.get("openaiModel")).toBe("gpt-4o");
  });

  test("overwrites an existing value", () => {
    const store   = makeStore({ provider: "openai" });
    const handler = makeStoreSetHandler(store);
    handler(EVENT, { provider: "gemini" });
    expect(store.get("provider")).toBe("gemini");
  });

  test("handles an empty data object without throwing", () => {
    const store   = makeStore();
    const handler = makeStoreSetHandler(store);
    expect(() => handler(EVENT, {})).not.toThrow();
  });
});

// ── round-trip: get after set ──────────────────────────────────────────────────

describe("store get/set round-trip", () => {
  test("value written via set is immediately readable via get", () => {
    const store  = makeStore();
    const getter = makeStoreGetHandler(store);
    const setter = makeStoreSetHandler(store);

    setter(EVENT, { claudeKey: "sk-ant-test", claudeModel: "claude-sonnet" });

    const result = getter(EVENT, ["claudeKey", "claudeModel"]);
    expect(result).toEqual({ claudeKey: "sk-ant-test", claudeModel: "claude-sonnet" });
  });
});

// ── clipboard ──────────────────────────────────────────────────────────────────

describe("makeClipboardReadHandler", () => {
  test("returns current clipboard text", () => {
    const handler = makeClipboardReadHandler(makeClipboard("hello world"));
    expect(handler()).toBe("hello world");
  });

  test("returns empty string when clipboard is empty", () => {
    const handler = makeClipboardReadHandler(makeClipboard(""));
    expect(handler()).toBe("");
  });
});

describe("makeClipboardWriteHandler", () => {
  test("writes text to the clipboard", () => {
    const cb      = makeClipboard();
    const handler = makeClipboardWriteHandler(cb);
    handler(EVENT, "copied result");
    expect(cb.readText()).toBe("copied result");
  });

  test("overwrites previous clipboard content", () => {
    const cb      = makeClipboard("old content");
    const handler = makeClipboardWriteHandler(cb);
    handler(EVENT, "new content");
    expect(cb.readText()).toBe("new content");
  });
});

// ── registerAll ────────────────────────────────────────────────────────────────

describe("registerAll", () => {
  test("registers all expected IPC channel names", () => {
    const registered = [];
    const fakeIpc = { handle: (name) => registered.push(name) };
    registerAll(fakeIpc, {
      store:        makeStore(),
      clipboard:    makeClipboard(),
      openSettings: jest.fn(),
      openHistory:  jest.fn(),
      openResults:  jest.fn(),
      closePopup:   jest.fn(),
      openURL:      jest.fn()
    });
    expect(registered).toEqual(expect.arrayContaining([
      "store-get", "store-set", "store-delete",
      "read-clipboard", "write-clipboard",
      "open-settings", "open-history", "open-results", "close-popup", "open-url"
    ]));
    expect(registered).toHaveLength(10);
  });

  test("open-settings handler calls the provided callback", () => {
    const openSettings = jest.fn();
    const handlers     = {};
    const fakeIpc      = { handle: (name, fn) => { handlers[name] = fn; } };
    registerAll(fakeIpc, {
      store: makeStore(), clipboard: makeClipboard(),
      openSettings, closePopup: jest.fn(), openURL: jest.fn()
    });
    handlers["open-settings"]();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  test("close-popup handler calls the provided callback", () => {
    const closePopup = jest.fn();
    const handlers   = {};
    const fakeIpc    = { handle: (name, fn) => { handlers[name] = fn; } };
    registerAll(fakeIpc, {
      store: makeStore(), clipboard: makeClipboard(),
      openSettings: jest.fn(), closePopup, openURL: jest.fn()
    });
    handlers["close-popup"]();
    expect(closePopup).toHaveBeenCalledTimes(1);
  });

  test("open-url does nothing when url is not a string", () => {
    const openURL   = jest.fn();
    const handlers  = {};
    const fakeIpc   = { handle: (name, fn) => { handlers[name] = fn; } };
    registerAll(fakeIpc, {
      store: makeStore(), clipboard: makeClipboard(),
      openSettings: jest.fn(), closePopup: jest.fn(), openURL
    });
    handlers["open-url"](EVENT, 42);
    expect(openURL).not.toHaveBeenCalled();
  });

  test("open-url does nothing for an invalid URL string", () => {
    const openURL   = jest.fn();
    const handlers  = {};
    const fakeIpc   = { handle: (name, fn) => { handlers[name] = fn; } };
    registerAll(fakeIpc, {
      store: makeStore(), clipboard: makeClipboard(),
      openSettings: jest.fn(), closePopup: jest.fn(), openURL
    });
    handlers["open-url"](EVENT, "not-a-url");
    expect(openURL).not.toHaveBeenCalled();
  });

  test("open-url does nothing for a non-https URL", () => {
    const openURL   = jest.fn();
    const handlers  = {};
    const fakeIpc   = { handle: (name, fn) => { handlers[name] = fn; } };
    registerAll(fakeIpc, {
      store: makeStore(), clipboard: makeClipboard(),
      openSettings: jest.fn(), closePopup: jest.fn(), openURL
    });
    handlers["open-url"](EVENT, "http://example.com");
    expect(openURL).not.toHaveBeenCalled();
  });

  test("open-url calls openURL for a valid https URL", () => {
    const openURL   = jest.fn();
    const handlers  = {};
    const fakeIpc   = { handle: (name, fn) => { handlers[name] = fn; } };
    registerAll(fakeIpc, {
      store: makeStore(), clipboard: makeClipboard(),
      openSettings: jest.fn(), closePopup: jest.fn(), openURL
    });
    handlers["open-url"](EVENT, "https://example.com");
    expect(openURL).toHaveBeenCalledWith("https://example.com");
  });

  test("open-history and open-results do not throw when callbacks are omitted", () => {
    const handlers = {};
    const fakeIpc  = { handle: (name, fn) => { handlers[name] = fn; } };
    registerAll(fakeIpc, {
      store: makeStore(), clipboard: makeClipboard(),
      openSettings: jest.fn(), closePopup: jest.fn(), openURL: jest.fn()
    });
    expect(() => handlers["open-history"]()).not.toThrow();
    expect(() => handlers["open-results"]()).not.toThrow();
  });
});

// ── makeBackupHandlers ────────────────────────────────────────────────────────

const { makeBackupHandlers } = require("../ipc-handlers");

describe("makeBackupHandlers openBackup size guard", () => {
  function makeDialog(filePath) {
    return {
      showOpenDialog: async () => ({ canceled: false, filePaths: [filePath] }),
      showSaveDialog: async () => ({ canceled: true })
    };
  }

  test("returns null when selected file exceeds 50 MB", async () => {
    const fs = {
      statSync: () => ({ size: 51 * 1024 * 1024 }),
      readFileSync: jest.fn()
    };
    const { openBackup } = makeBackupHandlers(makeDialog("/large.ttbackup"), fs, null);
    const result = await openBackup();
    expect(result).toBeNull();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  test("reads file when size is within limit", async () => {
    const fs = {
      statSync: () => ({ size: 1024 }),
      readFileSync: () => '{"settings":{}}'
    };
    const { openBackup } = makeBackupHandlers(makeDialog("/small.ttbackup"), fs, null);
    const result = await openBackup();
    expect(result).toBe('{"settings":{}}');
  });

  test("returns null when dialog is canceled", async () => {
    const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
    const { openBackup } = makeBackupHandlers(dialog, {}, null);
    expect(await openBackup()).toBeNull();
  });
});

// ── makeStoreDeleteHandler ─────────────────────────────────────────────────────

function makeStoreWithDelete(initial = {}) {
  const data = { ...initial };
  return {
    get:    (key)      => data[key],
    set:    (key, val) => { data[key] = val; },
    delete: (key)      => { delete data[key]; },
    store:  data
  };
}

describe("makeStoreDeleteHandler", () => {
  test("deletes a key when called with a string", () => {
    const store   = makeStoreWithDelete({ provider: "openai" });
    const handler = makeStoreDeleteHandler(store);
    handler(EVENT, "provider");
    expect(store.get("provider")).toBeUndefined();
  });

  test("deletes multiple keys when called with an array", () => {
    const store   = makeStoreWithDelete({ provider: "openai", openaiKey: "sk-x" });
    const handler = makeStoreDeleteHandler(store);
    handler(EVENT, ["provider", "openaiKey"]);
    expect(store.get("provider")).toBeUndefined();
    expect(store.get("openaiKey")).toBeUndefined();
  });

  test("does not delete blocked keys", () => {
    const store   = makeStoreWithDelete({ historyPin: "1234", provider: "openai" });
    const handler = makeStoreDeleteHandler(store);
    handler(EVENT, ["historyPin", "provider"]);
    expect(store.get("historyPin")).toBe("1234");
    expect(store.get("provider")).toBeUndefined();
  });

  test("skips delete gracefully when store.delete is not a function", () => {
    const store   = makeStore({ provider: "openai" }); // makeStore has no .delete
    const handler = makeStoreDeleteHandler(store);
    expect(() => handler(EVENT, "provider")).not.toThrow();
  });
});

// ── additional makeStoreGetHandler coverage ───────────────────────────────────

describe("makeStoreGetHandler blocked-key branches", () => {
  test("returns undefined for blocked key historyPin in string mode", () => {
    const store   = makeStore({ historyPin: "1234" });
    const handler = makeStoreGetHandler(store);
    expect(handler(EVENT, "historyPin")).toBeUndefined();
  });

  test("filters blocked key out of array-mode results", () => {
    const store   = makeStore({ historyPin: "1234", provider: "openai" });
    const handler = makeStoreGetHandler(store);
    const result  = handler(EVENT, ["historyPin", "provider"]);
    expect("historyPin" in result).toBe(false);
    expect(result.provider).toBe("openai");
  });

  test("filters blocked key out of defaults-object results", () => {
    const store   = makeStore({ historyPin: "1234" });
    const handler = makeStoreGetHandler(store);
    const result  = handler(EVENT, { historyPin: "default" });
    expect("historyPin" in result).toBe(false);
  });
});

// ── additional makeStoreSetHandler coverage ───────────────────────────────────

describe("makeStoreSetHandler blocked-key and guard branches", () => {
  test("does not store blocked keys (historyPin, autoUpdaterEnabled, devMode)", () => {
    const store   = makeStore();
    const handler = makeStoreSetHandler(store);
    handler(EVENT, { historyPin: "4321", autoUpdaterEnabled: true, devMode: true });
    expect(store.get("historyPin")).toBeUndefined();
    expect(store.get("autoUpdaterEnabled")).toBeUndefined();
    expect(store.get("devMode")).toBeUndefined();
  });

  test("ignores null data without throwing", () => {
    const store   = makeStore({ provider: "openai" });
    const handler = makeStoreSetHandler(store);
    handler(EVENT, null);
    expect(store.get("provider")).toBe("openai");
  });

  test("ignores array data without throwing", () => {
    const store   = makeStore();
    const handler = makeStoreSetHandler(store);
    handler(EVENT, ["key", "value"]);
    expect(store.get("key")).toBeUndefined();
  });
});

// ── makeClipboardWriteHandler: non-string guard ───────────────────────────────

describe("makeClipboardWriteHandler non-string guard", () => {
  test("does not write to clipboard when text is not a string", () => {
    const cb      = makeClipboard("initial");
    const handler = makeClipboardWriteHandler(cb);
    handler(EVENT, 42);
    expect(cb.readText()).toBe("initial");
  });
});
