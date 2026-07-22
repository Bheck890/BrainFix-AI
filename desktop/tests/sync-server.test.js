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
});
