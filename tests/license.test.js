const { verifyWithGumroad, checkLicensePeriodically, isProUnlocked, isDemoMode,
        verifyDemoMode, verifyCorpMode } = require("../lib/license");

// ── isProUnlocked ──────────────────────────────────────────────────────────────

describe("isProUnlocked", () => {
  test("returns true when both licenseEmail and licenseKey are set", () => {
    expect(isProUnlocked({ licenseEmail: "user@example.com", licenseKey: "ABC-123" })).toBe(true);
  });

  test("returns false when licenseEmail is missing", () => {
    expect(isProUnlocked({ licenseKey: "ABC-123" })).toBe(false);
  });

  test("returns false when licenseKey is missing", () => {
    expect(isProUnlocked({ licenseEmail: "user@example.com" })).toBe(false);
  });

  test("returns false when both are empty strings", () => {
    expect(isProUnlocked({ licenseEmail: "", licenseKey: "" })).toBe(false);
  });

  test("returns false for empty settings object", () => {
    expect(isProUnlocked({})).toBe(false);
  });
});

// ── shared helpers ─────────────────────────────────────────────────────────────

function makeWindow(deviceId = "test-device-uuid") {
  return {
    appGet: jest.fn().mockResolvedValue({ _deviceId: deviceId }),
    appSet: jest.fn().mockResolvedValue(),
  };
}

// Storage object that provides a known fingerprint -- used by verifyWithGumroad.
function makeActivationStorage(deviceId = "test-device-uuid") {
  return {
    appGet: jest.fn().mockResolvedValue({ _deviceId: deviceId }),
    appSet: jest.fn().mockResolvedValue(),
  };
}

// makeWindow with optional extra storage values (e.g. _demoValidatedAt for offline tests)
function makeWindowWithExtras(extras = {}, deviceId = "test-device-uuid") {
  return {
    appGet: jest.fn().mockResolvedValue({ _deviceId: deviceId, ...extras }),
    appSet: jest.fn().mockResolvedValue(),
  };
}

// Returns a signed-ok response from the proxy (ok:true so _apiCall doesn't throw).
function mockProxyOk(payload) {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => payload });
}

function mockProxyFail() {
  global.fetch = jest.fn().mockRejectedValue(new Error("offline"));
}

// ── verifyWithGumroad ──────────────────────────────────────────────────────────
// Gumroad is now called server-side via the proxy -- the extension never contacts
// api.gumroad.com directly. Tests verify the proxy response is forwarded correctly.

describe("verifyWithGumroad", () => {
  afterEach(() => {
    global.fetch = undefined;
  });

  test("returns error when fingerprint not available (no storage, no window)", async () => {
    const result = await verifyWithGumroad("user@example.com", "ABC-123");
    expect(result).toEqual({ valid: false, error: "Could not identify this device." });
  });

  test("returns valid:true when proxy confirms license", async () => {
    mockProxyOk({ valid: true });
    const result = await verifyWithGumroad("user@example.com", "ABC-123", makeActivationStorage());
    expect(result).toEqual({ valid: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("stamps deviceActivated and timestamps on success", async () => {
    const storage = makeActivationStorage();
    mockProxyOk({ valid: true });
    await verifyWithGumroad("user@example.com", "ABC-123", storage);
    expect(storage.appSet).toHaveBeenCalledWith(expect.objectContaining({ deviceActivated: "ABC-123" }));
  });

  test("returns error when proxy says invalid key", async () => {
    mockProxyOk({ valid: false, error: "Invalid license key" });
    const result = await verifyWithGumroad("user@example.com", "BAD-KEY", makeActivationStorage());
    expect(result).toEqual({ valid: false, error: "Invalid license key" });
  });

  test("returns error when proxy says wrong email", async () => {
    mockProxyOk({ valid: false, error: "Wrong email for this license key" });
    const result = await verifyWithGumroad("user@example.com", "ABC-123", makeActivationStorage());
    expect(result).toEqual({ valid: false, error: "Wrong email for this license key" });
  });

  test("returns error when proxy says license refunded", async () => {
    mockProxyOk({ valid: false, error: "This license has been refunded and is no longer valid." });
    const result = await verifyWithGumroad("user@example.com", "ABC-123", makeActivationStorage());
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/refunded/);
  });

  test("returns error when proxy says chargebacked", async () => {
    mockProxyOk({ valid: false, error: "This license has a chargeback on record. Contact northportlabs@gmail.com." });
    const result = await verifyWithGumroad("user@example.com", "ABC-123", makeActivationStorage());
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/chargeback/);
    expect(result.error).toMatch(/northportlabs@gmail\.com/);
  });

  test("returns error when proxy says device limit reached", async () => {
    mockProxyOk({ valid: false, error: "Maximum devices reached. Contact northportlabs@gmail.com to reset." });
    const result = await verifyWithGumroad("user@example.com", "ABC-123", makeActivationStorage());
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Maximum devices reached/);
    expect(result.error).toMatch(/northportlabs@gmail\.com/);
  });

  test("returns connection error on network failure", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network failure"));
    const result = await verifyWithGumroad("user@example.com", "ABC-123", makeActivationStorage());
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Could not reach activation server/);
  });
});

// ── checkLicensePeriodically ───────────────────────────────────────────────────

describe("checkLicensePeriodically", () => {
  const DAY_MS  = 24 * 60 * 60 * 1000;
  const HOUR_MS =      60 * 60 * 1000;

  function makeStorage(lastCheck = 0, lastAttempt = 0) {
    const appGet = jest.fn().mockResolvedValue({ lastLicenseCheck: lastCheck, lastLicenseAttempt: lastAttempt });
    const appSet = jest.fn().mockResolvedValue();
    return { appGet, appSet };
  }

  afterEach(() => {
    global.fetch = undefined;
  });

  test("skips check when last confirmed check was within 24 hours", async () => {
    const storage = makeStorage(Date.now() - HOUR_MS); // checked 1 hour ago
    const result = await checkLicensePeriodically("a@b.com", "KEY", storage);
    expect(result).toBeNull();
    expect(global.fetch).toBeUndefined();
  });

  test("skips check when last attempt was a network failure within 1 hour", async () => {
    const storage = makeStorage(0, Date.now() - 30 * 60 * 1000); // attempted 30 min ago
    const result = await checkLicensePeriodically("a@b.com", "KEY", storage);
    expect(result).toBeNull();
    expect(global.fetch).toBeUndefined();
  });

  test("returns null when neither appGet nor appSet is available", async () => {
    const result = await checkLicensePeriodically("a@b.com", "KEY");
    expect(result).toBeNull();
  });

  test("runs check and returns valid:true when proxy confirms license", async () => {
    const storage = makeStorage(Date.now() - DAY_MS - 1000);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ valid: true }) });
    const result = await checkLicensePeriodically("a@b.com", "KEY", storage);
    expect(result).toEqual({ valid: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(storage.appSet).toHaveBeenCalled();
  });

  test("returns revoked:true when proxy says license is no longer valid", async () => {
    const storage = makeStorage(Date.now() - DAY_MS - 1000);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ valid: false }) });
    const result = await checkLicensePeriodically("a@b.com", "KEY", storage);
    expect(result).toEqual({ revoked: true });
  });

  test("returns null on network error within 30 days of last check (benefit of the doubt)", async () => {
    const storage = makeStorage(Date.now() - DAY_MS - 1000);
    global.fetch = jest.fn().mockRejectedValue(new Error("offline"));
    const result = await checkLicensePeriodically("a@b.com", "KEY", storage);
    expect(result).toBeNull();
  });

  test("returns revoked when network fails and last confirmed check was over 30 days ago", async () => {
    const storage = makeStorage(Date.now() - 31 * DAY_MS);
    global.fetch = jest.fn().mockRejectedValue(new Error("offline"));
    const result = await checkLicensePeriodically("a@b.com", "KEY", storage);
    expect(result).toEqual({ revoked: true });
  });

  test("retries after 1 hour following a network failure", async () => {
    const storage = makeStorage(0, Date.now() - HOUR_MS - 1000);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ valid: true }) });
    const result = await checkLicensePeriodically("a@b.com", "KEY", storage);
    expect(result).toEqual({ valid: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("returns revoked:true when license is chargebacked (1 ms)", async () => {
    const storage = makeStorage(Date.now() - DAY_MS - 1000);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ valid: false }) });
    const result = await checkLicensePeriodically("a@b.com", "KEY", storage);
    expect(result).toEqual({ revoked: true });
  });

  test("stamps lastLicenseAttempt before fetch (crash safety)", async () => {
    const storage = makeStorage(Date.now() - DAY_MS - 1000);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ valid: true }) });
    await checkLicensePeriodically("a@b.com", "KEY", storage);
    expect(storage.appSet).toHaveBeenCalledTimes(2);
    expect(storage.appSet).toHaveBeenNthCalledWith(1, expect.objectContaining({ lastLicenseAttempt: expect.any(Number) }));
  });
});

// ── isDemoMode ─────────────────────────────────────────────────────────────────

describe("isDemoMode", () => {
  test("returns true when demoMode is 'active' and no other license", () => {
    expect(isDemoMode({ demoMode: "active" })).toBe(true);
  });
  test("returns false when corpMode is also 'active'", () => {
    expect(isDemoMode({ demoMode: "active", corpMode: "active" })).toBe(false);
  });
  test("returns false when Gumroad keys are present", () => {
    expect(isDemoMode({ demoMode: "active", licenseEmail: "a@b.com", licenseKey: "KEY" })).toBe(false);
  });
  test("returns false when demoMode is 'revoked'", () => {
    expect(isDemoMode({ demoMode: "revoked" })).toBe(false);
  });
  test("returns false for empty object", () => {
    expect(isDemoMode({})).toBe(false);
  });
});

// ── isProUnlocked — demo + corp extensions ────────────────────────────────────

describe("isProUnlocked — demo and corp modes", () => {
  test("returns true when demoMode is 'active'", () => {
    expect(isProUnlocked({ demoMode: "active" })).toBe(true);
  });
  test("returns true when corpMode is 'active'", () => {
    expect(isProUnlocked({ corpMode: "active" })).toBe(true);
  });
  test("returns false when demoMode and corpMode are revoked", () => {
    expect(isProUnlocked({ demoMode: "revoked", corpMode: "revoked" })).toBe(false);
  });
});

// ── verifyDemoMode — no window context ────────────────────────────────────────

describe("verifyDemoMode — no window context", () => {
  afterEach(() => { global.fetch = undefined; });

  test("returns error when window is not available (no fingerprint)", async () => {
    const result = await verifyDemoMode("0000-0000-0000-1792");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Could not identify/);
  });
});

// ── verifyDemoMode — proxy-based full flow ────────────────────────────────────

describe("verifyDemoMode — full flow", () => {
  beforeEach(() => { global.window = makeWindow(); });
  afterEach(() => { global.fetch = undefined; global.window = undefined; });

  test("rejects wrong demo code when proxy says not_found", async () => {
    mockProxyOk({ status: "not_found" });
    const result = await verifyDemoMode("0000-0000-0000-9999");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid/);
  });

  test("accepts correct demo code — proxy returns ok", async () => {
    mockProxyOk({ status: "ok", license_id: "demo-uuid" });
    const result = await verifyDemoMode("0000-0000-0000-1792");
    expect(result.valid).toBe(true);
    expect(result.mode).toBe("demo");
    expect(result.corpLicenseId).toBe("demo-uuid");
  });

  test("returns revoked error when proxy says revoked", async () => {
    mockProxyOk({ status: "revoked" });
    const result = await verifyDemoMode("0000-0000-0000-1792");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Access has ended/);
  });

  test("returns full-slots error when proxy says full or rate_limited", async () => {
    mockProxyOk({ status: "full" });
    const result = await verifyDemoMode("0000-0000-0000-1792");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/slots are full/);
  });

  test("rejects offline activation when server has never validated this device", async () => {
    mockProxyFail();
    const result = await verifyDemoMode("0000-0000-0000-1792");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/connection/i);
  });

  test("grants offline access when server previously validated this device (_demoValidatedAt set)", async () => {
    global.window = makeWindowWithExtras({ _demoValidatedAt: Date.now() - 1000 });
    mockProxyFail();
    const result = await verifyDemoMode("0000-0000-0000-1792");
    expect(result.valid).toBe(true);
    expect(result.offline).toBe(true);
  });

  test("stamps _demoValidatedAt in storage on successful online activation", async () => {
    const win = makeWindowWithExtras();
    global.window = win;
    mockProxyOk({ status: "ok", license_id: "demo-uuid" });
    await verifyDemoMode("0000-0000-0000-1792");
    expect(win.appSet).toHaveBeenCalledWith(expect.objectContaining({ _demoValidatedAt: expect.any(Number) }));
  });
});

// ── verifyCorpMode — proxy-based full flow ────────────────────────────────────

describe("verifyCorpMode — full flow", () => {
  beforeEach(() => { global.window = makeWindow(); });
  afterEach(() => { global.fetch = undefined; global.window = undefined; });

  test("returns corpNotFound when proxy says not_found", async () => {
    mockProxyOk({ status: "not_found" });
    const result = await verifyCorpMode("user@company.com", "0000-0000-0000-9999");
    expect(result.valid).toBe(false);
    expect(result.corpNotFound).toBe(true);
  });

  test("returns error for missing email domain", async () => {
    const result = await verifyCorpMode("nodomain", "0000-0000-0000-6393");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/company email/);
  });

  test("accepts matching corp code — proxy returns ok", async () => {
    mockProxyOk({ status: "ok", license_id: "corp-uuid" });
    const result = await verifyCorpMode("bheckservice@gmail.com", "0000-0000-0000-6393");
    expect(result.valid).toBe(true);
    expect(result.mode).toBe("corp");
    expect(result.corpLicenseId).toBe("corp-uuid");
  });

  test("returns corpNotFound on network failure", async () => {
    mockProxyFail();
    const result = await verifyCorpMode("bheckservice@gmail.com", "0000-0000-0000-6393");
    expect(result.valid).toBe(false);
    expect(result.corpNotFound).toBe(true);
  });

  test("returns seats-full error when proxy says full", async () => {
    mockProxyOk({ status: "full" });
    const result = await verifyCorpMode("bheckservice@gmail.com", "0000-0000-0000-6393");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/No seats available/);
  });

  test("returns rate-limited error when proxy says rate_limited", async () => {
    mockProxyOk({ status: "rate_limited" });
    const result = await verifyCorpMode("bheckservice@gmail.com", "0000-0000-0000-6393");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Too many activation attempts/);
  });

  test("returns revoked error when proxy says revoked", async () => {
    mockProxyOk({ status: "revoked" });
    const result = await verifyCorpMode("bheckservice@gmail.com", "0000-0000-0000-6393");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/revoked/);
  });

  test("email domain comparison is case-insensitive", async () => {
    mockProxyOk({ status: "ok", license_id: "corp-uuid" });
    const result = await verifyCorpMode("BHeckService@Gmail.COM", "0000-0000-0000-6393");
    expect(result.valid).toBe(true);
  });
});
