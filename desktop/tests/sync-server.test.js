// Tests for desktop/lib-node/sync-server.js
// Uses port 0 so the OS assigns a free port — no conflict with a running desktop app.

const http = require("http");
const { startSyncServer } = require("../lib-node/sync-server");

// ── helpers ────────────────────────────────────────────────────────────────────

let TEST_PORT = 0; // set after server starts

function request({ method = "GET", path = "/ping", token = null, body = null, origin = null } = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "127.0.0.1",
      port: TEST_PORT,
      path,
      method,
      headers: {}
    };
    if (token)  opts.headers["X-Btc-Token"] = token;
    if (origin) opts.headers["Origin"]       = origin;
    if (body !== null) {
      const payload = typeof body === "string" ? body : JSON.stringify(body);
      opts.headers["Content-Type"]   = "application/json";
      opts.headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = http.request(opts, res => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body !== null) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

// ── test suite ─────────────────────────────────────────────────────────────────

const EXT_ORIGIN = "chrome-extension://test-extension-id";

describe("sync-server", () => {
  let server;
  let sessionToken;
  let mockStore;

  beforeAll(async () => {
    mockStore = {
      _data: {
        openaiKey:   "sk-plaintext",
        claudeKey:   undefined,       // undefined → should be omitted in GET /settings
        geminiModel: "gemini-2.0-flash",
        syncMeta:    { lastChanged: "2026-05-24T00:00:00.000Z" }
      },
      get(key)      { return this._data[key]; },
      set(key, val) { this._data[key] = val; }
    };

    server = startSyncServer(mockStore, 0); // 0 = OS-assigned free port

    await new Promise((resolve, reject) => {
      if (server.listening) { TEST_PORT = server.address().port; resolve(); return; }
      server.once("listening", () => { TEST_PORT = server.address().port; resolve(); });
      server.once("error",     reject);
    });

    // Extension origins receive the session token; use it for all authenticated tests
    const ping = await request({ path: "/ping", origin: EXT_ORIGIN });
    sessionToken = JSON.parse(ping.body).token;
  });

  afterAll(() => new Promise(resolve => server.close(resolve)));

  // ── exports ───────────────────────────────────────────────────────────────────

  test("exports startSyncServer as a function", () => {
    expect(typeof startSyncServer).toBe("function");
  });

  // ── OPTIONS preflight ─────────────────────────────────────────────────────────

  test("OPTIONS / from extension origin reflects that origin", async () => {
    const res = await request({ method: "OPTIONS", path: "/", origin: "chrome-extension://testid" });
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("chrome-extension://testid");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });

  test("OPTIONS / from non-extension origin gets 127.0.0.1 (not wildcard)", async () => {
    const res = await request({ method: "OPTIONS", path: "/", origin: "https://evil.com" });
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1");
  });

  // ── GET /ping ─────────────────────────────────────────────────────────────────

  test("GET /ping with extension origin returns token and syncMeta", async () => {
    const res = await request({ path: "/ping", origin: EXT_ORIGIN });
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(typeof json.token).toBe("string");
    expect(json.token.length).toBe(32); // 16 random bytes → 32 hex chars
    expect(json.syncMeta).toEqual({ lastChanged: "2026-05-24T00:00:00.000Z" });
  });

  test("GET /ping without extension origin returns null token (prevents local-process spoofing)", async () => {
    const res  = await request({ path: "/ping" });
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.token).toBeNull();
    expect(json.syncMeta).toBeDefined(); // syncMeta is still public
  });

  test("GET /ping with no syncMeta in store returns syncMeta: null", async () => {
    const original = mockStore._data.syncMeta;
    mockStore._data.syncMeta = undefined;
    const res  = await request({ path: "/ping", origin: EXT_ORIGIN });
    const json = JSON.parse(res.body);
    expect(json.syncMeta).toBeNull();
    mockStore._data.syncMeta = original;
  });

  // ── token gating ──────────────────────────────────────────────────────────────

  test("GET /settings without token returns 401", async () => {
    const res = await request({ path: "/settings" });
    expect(res.status).toBe(401);
  });

  test("GET /settings with wrong token returns 401", async () => {
    const res = await request({ path: "/settings", token: "wrong-token" });
    expect(res.status).toBe(401);
  });

  test("POST /settings without token returns 401", async () => {
    const res = await request({ method: "POST", path: "/settings", body: { settings: {} } });
    expect(res.status).toBe(401);
  });

  // ── GET /settings ─────────────────────────────────────────────────────────────

  test("GET /settings returns only defined SYNC_KEY values", async () => {
    const res  = await request({ path: "/settings", token: sessionToken, origin: EXT_ORIGIN });
    expect(res.status).toBe(200);
    const { settings } = JSON.parse(res.body);
    expect(settings.openaiKey).toBe("sk-plaintext");
    expect(settings.geminiModel).toBe("gemini-2.0-flash");
    // claudeKey is undefined in store — should be omitted
    expect("claudeKey" in settings).toBe(false);
  });

  test("GET /settings without extension origin returns 403", async () => {
    const res = await request({ path: "/settings", token: sessionToken });
    expect(res.status).toBe(403);
  });

  // ── POST /settings ────────────────────────────────────────────────────────────

  test("POST /settings stores SYNC_KEY values and returns syncMeta", async () => {
    const res = await request({
      method: "POST",
      path:   "/settings",
      token:  sessionToken,
      origin: EXT_ORIGIN,
      body:   { settings: { openaiKey: "sk-new", unknownKey: "ignored" } }
    });
    expect(res.status).toBe(200);
    const { syncMeta } = JSON.parse(res.body);
    expect(typeof syncMeta.lastChanged).toBe("string");
    expect(mockStore._data.openaiKey).toBe("sk-new");
    // Non-SYNC_KEY "unknownKey" should not have been stored
    expect(mockStore._data.unknownKey).toBeUndefined();
  });

  test("POST /settings with invalid JSON returns 400", async () => {
    const res = await request({
      method: "POST",
      path:   "/settings",
      token:  sessionToken,
      origin: EXT_ORIGIN,
      body:   "not-valid-json{{"
    });
    expect(res.status).toBe(400);
  });

  test("POST /settings with missing settings key returns 400", async () => {
    const res = await request({
      method: "POST",
      path:   "/settings",
      token:  sessionToken,
      origin: EXT_ORIGIN,
      body:   { notSettings: {} }
    });
    expect(res.status).toBe(400);
  });

  test("POST /settings ignores values with wrong type (string instead of number)", async () => {
    mockStore._data.variants = 2;
    const res = await request({
      method: "POST",
      path:   "/settings",
      token:  sessionToken,
      origin: EXT_ORIGIN,
      body:   { settings: { variants: "should-be-a-number" } }
    });
    expect(res.status).toBe(200);
    expect(mockStore._data.variants).toBe(2); // unchanged — type mismatch rejected
  });

  test("POST /settings ignores configuredProviders if not an array", async () => {
    mockStore._data.configuredProviders = [];
    const res = await request({
      method: "POST",
      path:   "/settings",
      token:  sessionToken,
      origin: EXT_ORIGIN,
      body:   { settings: { configuredProviders: "not-an-array" } }
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(mockStore._data.configuredProviders)).toBe(true); // unchanged
  });

  test("POST /settings ignores profileEnabled if not a boolean", async () => {
    mockStore._data.profileEnabled = false;
    const res = await request({
      method: "POST",
      path:   "/settings",
      token:  sessionToken,
      origin: EXT_ORIGIN,
      body:   { settings: { profileEnabled: "yes" } }
    });
    expect(res.status).toBe(200);
    expect(mockStore._data.profileEnabled).toBe(false); // unchanged
  });

  // ── unknown routes ────────────────────────────────────────────────────────────

  test("GET /unknown returns 404", async () => {
    const res = await request({ path: "/unknown", token: sessionToken });
    expect(res.status).toBe(404);
  });

  test("POST /unknown returns 404", async () => {
    const res = await request({ method: "POST", path: "/unknown", token: sessionToken, body: {} });
    expect(res.status).toBe(404);
  });

  // ── _isValidProvider branch coverage (via configuredProviders) ────────────────

  test("POST /settings accepts valid provider with minimal fields", async () => {
    const res = await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { configuredProviders: [{ id: "my-provider" }] } } });
    expect(res.status).toBe(200);
    expect(Array.isArray(mockStore._data.configuredProviders)).toBe(true);
  });

  test("POST /settings rejects configuredProviders containing null (falsy element)", async () => {
    mockStore._data.configuredProviders = [];
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { configuredProviders: [null] } } });
    expect(mockStore._data.configuredProviders).toEqual([]);
  });

  test("POST /settings rejects configuredProviders containing an array element", async () => {
    mockStore._data.configuredProviders = [];
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { configuredProviders: [[]] } } });
    expect(mockStore._data.configuredProviders).toEqual([]);
  });

  test("POST /settings rejects provider with missing id field", async () => {
    mockStore._data.configuredProviders = [];
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { configuredProviders: [{ name: "no-id" }] } } });
    expect(mockStore._data.configuredProviders).toEqual([]);
  });

  test("POST /settings rejects provider with empty string id", async () => {
    mockStore._data.configuredProviders = [];
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { configuredProviders: [{ id: "" }] } } });
    expect(mockStore._data.configuredProviders).toEqual([]);
  });

  test("POST /settings rejects provider with non-string baseUrl", async () => {
    mockStore._data.configuredProviders = [];
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { configuredProviders: [{ id: "p", baseUrl: 123 }] } } });
    expect(mockStore._data.configuredProviders).toEqual([]);
  });

  test("POST /settings accepts provider with empty baseUrl (falsy — skips URL parse)", async () => {
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { configuredProviders: [{ id: "p", baseUrl: "" }] } } });
    expect(mockStore._data.configuredProviders[0]).toMatchObject({ id: "p", baseUrl: "" });
  });

  test("POST /settings rejects provider with invalid baseUrl (URL parse throws)", async () => {
    mockStore._data.configuredProviders = [];
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { configuredProviders: [{ id: "p", baseUrl: "not-a-url" }] } } });
    expect(mockStore._data.configuredProviders).toEqual([]);
  });

  test("POST /settings rejects provider with ftp baseUrl (wrong protocol)", async () => {
    mockStore._data.configuredProviders = [];
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { configuredProviders: [{ id: "p", baseUrl: "ftp://example.com" }] } } });
    expect(mockStore._data.configuredProviders).toEqual([]);
  });

  test("POST /settings rejects provider with SSRF-blocked baseUrl (169.254.x.x)", async () => {
    mockStore._data.configuredProviders = [];
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { configuredProviders: [{ id: "p", baseUrl: "http://169.254.169.254/metadata" }] } } });
    expect(mockStore._data.configuredProviders).toEqual([]);
  });

  test("POST /settings accepts provider with valid https baseUrl", async () => {
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { configuredProviders: [{ id: "p", baseUrl: "https://api.example.com" }] } } });
    expect(mockStore._data.configuredProviders[0]).toMatchObject({ id: "p" });
  });

  test("POST /settings rejects provider with numeric apiKey (not null, not string)", async () => {
    mockStore._data.configuredProviders = [];
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { configuredProviders: [{ id: "p", apiKey: 42 }] } } });
    expect(mockStore._data.configuredProviders).toEqual([]);
  });

  test("POST /settings accepts provider with apiKey: null", async () => {
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { configuredProviders: [{ id: "p", apiKey: null }] } } });
    expect(mockStore._data.configuredProviders[0]).toMatchObject({ id: "p", apiKey: null });
  });

  test("POST /settings rejects provider with numeric model", async () => {
    mockStore._data.configuredProviders = [];
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { configuredProviders: [{ id: "p", model: 42 }] } } });
    expect(mockStore._data.configuredProviders).toEqual([]);
  });

  // ── validateSyncValue: geminiModels / customPrompts / actionSettings (line 49) ──

  test("POST /settings accepts geminiModels as an array", async () => {
    mockStore._data.geminiModels = undefined;
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { geminiModels: ["gemini-2.0-flash"] } } });
    expect(mockStore._data.geminiModels).toEqual(["gemini-2.0-flash"]);
  });

  test("POST /settings rejects geminiModels as a string", async () => {
    mockStore._data.geminiModels = ["existing"];
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { geminiModels: "not-an-array" } } });
    expect(mockStore._data.geminiModels).toEqual(["existing"]);
  });

  test("POST /settings accepts customPrompts as an array", async () => {
    mockStore._data.customPrompts = undefined;
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { customPrompts: [{ text: "hello" }] } } });
    expect(Array.isArray(mockStore._data.customPrompts)).toBe(true);
  });

  test("POST /settings accepts actionSettings as an array", async () => {
    mockStore._data.actionSettings = undefined;
    await request({ method: "POST", path: "/settings", token: sessionToken, origin: EXT_ORIGIN,
      body: { settings: { actionSettings: [] } } });
    expect(Array.isArray(mockStore._data.actionSettings)).toBe(true);
  });
});

// ── Rogue extension: second extension origin gets null token ──────────────────
// Uses a fresh server instance because _authorizedExtensionOrigin is per-instance.

describe("sync-server rogue extension prevention", () => {
  let server2;
  let port2;

  beforeAll(async () => {
    const s = { get() {}, set() {} };
    server2 = startSyncServer(s, 0);
    await new Promise((resolve, reject) => {
      if (server2.listening) { port2 = server2.address().port; resolve(); return; }
      server2.once("listening", () => { port2 = server2.address().port; resolve(); });
      server2.once("error", reject);
    });
    // Let the legitimate first extension claim the token
    await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: port2, path: "/ping", method: "GET",
          headers: { Origin: "chrome-extension://first-ext" } },
        res => { res.resume(); res.on("end", resolve); }
      );
      req.on("error", reject);
      req.end();
    });
  });

  afterAll(() => new Promise(resolve => server2.close(resolve)));

  test("a different extension origin receives null token after the first has connected", async () => {
    const json = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: port2, path: "/ping", method: "GET",
          headers: { Origin: "chrome-extension://rogue-ext" } },
        res => {
          let body = "";
          res.on("data", c => { body += c; });
          res.on("end", () => resolve(JSON.parse(body)));
        }
      );
      req.on("error", reject);
      req.end();
    });
    expect(json.token).toBeNull();
  });
});
