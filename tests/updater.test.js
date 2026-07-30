// Tests for lib/updater.js — btcSemverGt and checkAndStoreUpdate
// updater.js uses importScripts globals, not module.exports.
// We load it via vm.runInNewContext with mocked browser + fetch globals.

const path = require("path");
const fs   = require("fs");
const vm   = require("vm");

const updaterSrc = fs.readFileSync(path.join(__dirname, "../lib/updater.js"), "utf8");

function makeCtx(currentVersion = "1.2.3") {
  const storage = {
    get:    jest.fn().mockResolvedValue({}),
    set:    jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const ctx = {
    fetch: jest.fn(),
    browser: {
      runtime: { getManifest: jest.fn().mockReturnValue({ version: currentVersion }) },
      storage: { local: storage },
    },
  };
  vm.runInNewContext(updaterSrc, ctx);
  return ctx;
}

// ── btcSemverGt ───────────────────────────────────────────────────────────────

describe("btcSemverGt", () => {
  const { btcSemverGt } = makeCtx();

  test("newer major version → true", () => {
    expect(btcSemverGt("2.0.0", "1.9.9")).toBe(true);
  });

  test("older major version → false", () => {
    expect(btcSemverGt("1.0.0", "2.0.0")).toBe(false);
  });

  test("same major, newer minor → true", () => {
    expect(btcSemverGt("1.5.0", "1.4.9")).toBe(true);
  });

  test("same major, older minor → false", () => {
    expect(btcSemverGt("1.3.0", "1.4.0")).toBe(false);
  });

  test("same major+minor, newer patch → true", () => {
    expect(btcSemverGt("1.2.4", "1.2.3")).toBe(true);
  });

  test("same major+minor, older patch → false", () => {
    expect(btcSemverGt("1.2.2", "1.2.3")).toBe(false);
  });

  test("exactly equal versions → false (not strictly greater)", () => {
    expect(btcSemverGt("1.2.3", "1.2.3")).toBe(false);
    expect(btcSemverGt("2.0.0", "2.0.0")).toBe(false);
  });

  test("missing patch on a defaults to 0 — 1.2 equals 1.2.0", () => {
    expect(btcSemverGt("1.2", "1.2.0")).toBe(false);
  });

  test("missing patch on a — 1.2 is less than 1.2.1", () => {
    expect(btcSemverGt("1.2", "1.2.1")).toBe(false);
  });

  test("missing patch on b — 1.2.1 is greater than 1.2", () => {
    expect(btcSemverGt("1.2.1", "1.2")).toBe(true);
  });

  test("major version dominates — 2.0.0 > 1.99.99", () => {
    expect(btcSemverGt("2.0.0", "1.99.99")).toBe(true);
  });
});

// ── checkAndStoreUpdate ───────────────────────────────────────────────────────

describe("checkAndStoreUpdate", () => {
  test("does nothing when fetch returns a non-ok response", async () => {
    const ctx = makeCtx("1.0.0");
    ctx.fetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    await ctx.checkAndStoreUpdate();
    expect(ctx.browser.storage.local.set).not.toHaveBeenCalled();
    expect(ctx.browser.storage.local.remove).not.toHaveBeenCalled();
  });

  test("does nothing when response JSON has no version field", async () => {
    const ctx = makeCtx("1.0.0");
    ctx.fetch.mockResolvedValue({ ok: true, json: async () => ({ github_url: "https://github.com/northpandalabs/Thought-Tidy" }) });
    await ctx.checkAndStoreUpdate();
    expect(ctx.browser.storage.local.set).not.toHaveBeenCalled();
  });

  test("does nothing when version field is not x.x.x format", async () => {
    const ctx = makeCtx("1.0.0");
    ctx.fetch.mockResolvedValue({ ok: true, json: async () => ({ version: "v2.0.0" }) });
    await ctx.checkAndStoreUpdate();
    expect(ctx.browser.storage.local.set).not.toHaveBeenCalled();
  });

  test("sets updateAvailable when latest version is newer than current", async () => {
    const ctx = makeCtx("1.0.0");
    ctx.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ version: "2.0.0", github_url: "https://github.com/northpandalabs/Thought-Tidy" }),
    });
    await ctx.checkAndStoreUpdate();
    expect(ctx.browser.storage.local.set).toHaveBeenCalledWith({
      updateAvailable: { version: "2.0.0", url: "https://thoughttidy.app/download" },
    });
  });

  test("stores plain version number from downloads.json", async () => {
    const ctx = makeCtx("1.0.0");
    ctx.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ version: "1.5.0", github_url: "https://github.com/northpandalabs/Thought-Tidy" }),
    });
    await ctx.checkAndStoreUpdate();
    const stored = ctx.browser.storage.local.set.mock.calls[1][0];
    expect(stored.updateAvailable.version).toBe("1.5.0");
  });

  test("removes updateAvailable when latest is older than current", async () => {
    const ctx = makeCtx("2.0.0");
    ctx.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ version: "1.9.9", github_url: "https://github.com/northpandalabs/Thought-Tidy" }),
    });
    await ctx.checkAndStoreUpdate();
    expect(ctx.browser.storage.local.remove).toHaveBeenCalledWith("updateAvailable");
  });

  test("removes updateAvailable when version equals current (not newer)", async () => {
    const ctx = makeCtx("1.2.3");
    ctx.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ version: "1.2.3", github_url: "https://github.com/northpandalabs/Thought-Tidy" }),
    });
    await ctx.checkAndStoreUpdate();
    expect(ctx.browser.storage.local.remove).toHaveBeenCalledWith("updateAvailable");
  });

  test("falls back to BTC_RELEASES_PAGE url when github_url is absent", async () => {
    const ctx = makeCtx("1.0.0");
    ctx.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ version: "2.0.0" }),
    });
    await ctx.checkAndStoreUpdate();
    const stored = ctx.browser.storage.local.set.mock.calls[1][0];
    expect(typeof stored.updateAvailable.url).toBe("string");
    expect(stored.updateAvailable.url.length).toBeGreaterThan(0);
  });

  test("rejects github_url that is not a valid github.com repo URL", async () => {
    const ctx = makeCtx("1.0.0");
    ctx.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ version: "2.0.0", github_url: "https://evil.com/steal" }),
    });
    await ctx.checkAndStoreUpdate();
    const stored = ctx.browser.storage.local.set.mock.calls[1][0];
    expect(stored.updateAvailable.url).not.toContain("evil.com");
  });

  test("swallows fetch network errors silently and never throws", async () => {
    const ctx = makeCtx("1.0.0");
    ctx.fetch.mockRejectedValue(new Error("Network failure"));
    await expect(ctx.checkAndStoreUpdate()).resolves.toBeUndefined();
    expect(ctx.browser.storage.local.set).not.toHaveBeenCalled();
  });

  test("swallows JSON parse errors silently and never throws", async () => {
    const ctx = makeCtx("1.0.0");
    ctx.fetch.mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    });
    await expect(ctx.checkAndStoreUpdate()).resolves.toBeUndefined();
  });


});
