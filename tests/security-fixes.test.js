// Structural and behavioural verification for security-sensitive code paths.

const fs   = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function src(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

// ── test-build flag isolation ──────────────────────────────────────────────────

describe("test-build flag isolation", () => {
  const licenseSource = src("lib/license.js");

  test("lib/license.js does not reference __BTC_TEST_BUILD__", () => {
    expect(licenseSource).not.toContain("__BTC_TEST_BUILD__");
  });

  test("lib/license.js _isTestBuild() reads only BUILD_FLAGS.testBuild", () => {
    expect(licenseSource).toContain("BUILD_FLAGS.testBuild");
  });

  test("popup/popup.html loads build-flags.js before license.js", () => {
    const html = src("popup/popup.html");
    expect(html).toContain("build-flags.js");
    const flagIdx    = html.indexOf("build-flags.js");
    const licenseIdx = html.indexOf("license.js");
    expect(flagIdx).toBeGreaterThan(-1);
    expect(licenseIdx).toBeGreaterThan(-1);
    expect(flagIdx).toBeLessThan(licenseIdx);
  });

  test("desktop/renderer/popup.html loads build-flags.js before license.js", () => {
    const html = src("desktop/renderer/popup.html");
    expect(html).toContain("build-flags.js");
    const flagIdx    = html.indexOf("build-flags.js");
    const licenseIdx = html.indexOf("license.js");
    expect(flagIdx).toBeLessThan(licenseIdx);
  });

  test("desktop/renderer/settings.html loads build-flags.js before license.js", () => {
    const html = src("desktop/renderer/settings.html");
    expect(html).toContain("build-flags.js");
    const flagIdx    = html.indexOf("build-flags.js");
    const licenseIdx = html.indexOf("license.js");
    expect(flagIdx).toBeLessThan(licenseIdx);
  });
});

// ── offline demo grant expiry ──────────────────────────────────────────────────

describe("offline demo grant expiry", () => {
  const licenseSource = src("lib/license.js");

  test("verifyDemoMode stores _offlineDemoAt timestamp when server is unreachable", () => {
    const start = licenseSource.indexOf("async function verifyDemoMode");
    const end   = licenseSource.indexOf("\nasync function", start + 1);
    const fn    = licenseSource.slice(start, end);
    expect(fn).toContain("_offlineDemoAt");
    expect(fn).toContain("_appSet({ _offlineDemoAt: Date.now() })");
  });

  test("_checkDemoPeriodically includes _offlineDemoAt in its appGet call", () => {
    const start = licenseSource.indexOf("async function _checkDemoPeriodically");
    const end   = licenseSource.indexOf("\nasync function", start + 1);
    const fn    = licenseSource.slice(start, end);
    expect(fn).toContain("_offlineDemoAt");
  });

  test("_checkDemoPeriodically revokes demo after 7 days of offline use", () => {
    const start = licenseSource.indexOf("async function _checkDemoPeriodically");
    const end   = licenseSource.indexOf("\nasync function", start + 1);
    const fn    = licenseSource.slice(start, end);
    expect(fn).toContain("7 * DAY_MS");
    expect(fn).toContain('demoMode: "revoked"');
    expect(fn).toContain("_offlineDemoAt: 0");
  });
});

// ── history read atomicity ─────────────────────────────────────────────────────

describe("history read atomicity", () => {
  const bgSource = src("background.js");

  test("background.js fetches historyLog and historyFull together in a single cryptoGet call", () => {
    const pattern = /cryptoGet\(\["historyLog",\s*"historyFull"\]\)/g;
    const matches = bgSource.match(pattern);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test("background.js does not make separate direct storage calls for historyLog and historyFull", () => {
    const isolatedLog  = /browser\.storage\.local\.get\("historyLog"\)/.test(bgSource);
    const isolatedFull = /browser\.storage\.local\.get\("historyFull"\)/.test(bgSource);
    expect(isolatedLog).toBe(false);
    expect(isolatedFull).toBe(false);
  });
});

// ── backup import key allowlist ────────────────────────────────────────────────

describe("backup import key allowlist", () => {
  const sharedSettingsSource = src("lib/shared-settings.js");

  test("lib/shared-settings.js defines BACKUP_SETTINGS_KEYS as a Set", () => {
    expect(sharedSettingsSource).toContain("const BACKUP_SETTINGS_KEYS = new Set(");
  });

  test("BACKUP_SETTINGS_KEYS allowlist includes standard user-facing settings", () => {
    const allowlistBlock = (() => {
      const start = sharedSettingsSource.indexOf("const BACKUP_SETTINGS_KEYS");
      const end   = sharedSettingsSource.indexOf("]);", start) + 3;
      return sharedSettingsSource.slice(start, end);
    })();
    expect(allowlistBlock).toContain("openaiKey");
    expect(allowlistBlock).toContain("claudeKey");
    expect(allowlistBlock).toContain("geminiKey");
    expect(allowlistBlock).toContain("customPrompts");
    expect(allowlistBlock).toContain("configuredProviders");
  });

  test("backup import filters keys through BACKUP_SETTINGS_KEYS", () => {
    expect(sharedSettingsSource).toContain("BACKUP_SETTINGS_KEYS.has(k)");
  });

  test("backup allowlist does not include internal control keys", () => {
    const start = sharedSettingsSource.indexOf("const BACKUP_SETTINGS_KEYS");
    const end   = sharedSettingsSource.indexOf("]);", start) + 3;
    const block = sharedSettingsSource.slice(start, end);
    expect(block).not.toContain("autoUpdaterEnabled");
    expect(block).not.toContain("syncMeta");
    expect(block).not.toContain("updateAvailable");
  });
});

// ── context URL fetch restrictions ────────────────────────────────────────────

describe("context URL fetch restrictions", () => {
  const sharedSettingsSource = src("lib/shared-settings.js");

  test("context URL fetch blocks localhost/127.0.0.1/::1", () => {
    expect(sharedSettingsSource).toContain('"localhost"');
    expect(sharedSettingsSource).toContain('"127.0.0.1"');
    expect(sharedSettingsSource).toContain('"::1"');
  });

  test("context URL fetch uses AbortController for timeout", () => {
    expect(sharedSettingsSource).toContain("new AbortController()");
    expect(sharedSettingsSource).toContain("ctrl.abort()");
  });

  test("context URL fetch enforces a 10-second timeout", () => {
    expect(sharedSettingsSource).toContain("10_000");
  });

  test("context URL fetch caps response at 50 KB", () => {
    expect(sharedSettingsSource).toContain("50_000");
  });

  test("context URL fetch truncates oversized responses", () => {
    expect(sharedSettingsSource).toContain("raw.slice(0, MAX_BYTES)");
  });
});

// ── migrateExtensionKeys guard ─────────────────────────────────────────────────

describe("migrateExtensionKeys guard", () => {
  const cryptoSource = src("lib/crypto-storage.js");

  test("lib/crypto-storage.js declares in-memory _mig boolean guard", () => {
    expect(cryptoSource).toContain("let _mig = false");
  });

  test("migrateExtensionKeys short-circuits on concurrent call", () => {
    const start = cryptoSource.indexOf("async function migrateExtensionKeys");
    const end   = cryptoSource.indexOf("\nasync function", start + 1);
    const fn    = cryptoSource.slice(start, end > start ? end : undefined);
    expect(fn).toContain("if (_mig) return");
    expect(fn).toContain("_mig = true");
  });
});

// ── Enter key disabled state check ────────────────────────────────────────────

describe("Enter key disabled state check", () => {
  test("popup/popup.js checks btn.disabled before calling runProcess()", () => {
    const source = src("popup/popup.js");
    const keydownIdx = source.indexOf('addEventListener("keydown"');
    expect(keydownIdx).toBeGreaterThan(-1);
    const snippet = source.slice(keydownIdx, keydownIdx + 300);
    expect(snippet).toContain("btn.disabled");
  });

  test("desktop/renderer/popup.js checks btn.disabled before calling runProcess()", () => {
    const source = src("desktop/renderer/popup.js");
    const keydownIdx = source.indexOf('addEventListener("keydown"');
    expect(keydownIdx).toBeGreaterThan(-1);
    const snippet = source.slice(keydownIdx, keydownIdx + 300);
    expect(snippet).toContain("btn.disabled");
  });
});

// ── clarify button handler cleanup ────────────────────────────────────────────

describe("clarify button handler cleanup", () => {
  test("lib/shared-popup.js uses cloneNode(true) to replace clarify-submit-btn", () => {
    const source = src("lib/shared-popup.js");
    expect(source).toContain("cloneNode(true)");
    expect(source).toContain("replaceWith(");
  });
});

// ── quickAction history ID generation ─────────────────────────────────────────

describe("quickAction history ID generation", () => {
  const mainSource = src("desktop/main.js");

  test("desktop/main.js imports uid from lib/text", () => {
    expect(mainSource).toContain('uid } = require("../lib/text")');
  });

  test("desktop/main.js does not use Math.random() for history entry IDs", () => {
    expect(mainSource).not.toContain("Math.random().toString(36)");
  });

  test("quickAction history entry uses uid()", () => {
    const start = mainSource.indexOf("async function quickAction");
    const end   = mainSource.indexOf("\nasync function", start + 1);
    const fn    = mainSource.slice(start, end);
    expect(fn).toContain("id: uid()");
  });

  test("quickCustomAction history entry uses uid()", () => {
    const start = mainSource.indexOf("async function quickCustomAction");
    const end   = mainSource.indexOf("\nasync function", start + 1);
    const fn    = mainSource.slice(start, end);
    expect(fn).toContain("id: uid()");
  });
});

// ── quickAction history systemPrompt inclusion ────────────────────────────────

describe("quickAction history systemPrompt inclusion", () => {
  const mainSource = src("desktop/main.js");

  test("quickAction historyFull entry includes systemPrompt", () => {
    const start = mainSource.indexOf("async function quickAction");
    const end   = mainSource.indexOf("\nasync function", start + 1);
    const fn    = mainSource.slice(start, end);
    expect(fn).toContain("systemPrompt:");
  });

  test("quickCustomAction historyFull entry includes systemPrompt", () => {
    const start = mainSource.indexOf("async function quickCustomAction");
    const end   = mainSource.indexOf("\nasync function", start + 1);
    const fn    = mainSource.slice(start, end);
    expect(fn).toContain("systemPrompt:");
  });

  test("systemPrompt is sliced to 2000 chars to prevent oversized entries", () => {
    expect(mainSource).toContain("systemPrompt.slice(0, 2000)");
  });
});

// ── optional_host_permissions scope ───────────────────────────────────────────

describe("optional_host_permissions scope", () => {
  let manifest;
  beforeAll(() => {
    manifest = JSON.parse(src("manifest.json"));
  });

  test("manifest optional_host_permissions does not include http://*/*", () => {
    const ohp = manifest.optional_host_permissions || [];
    expect(ohp).not.toContain("http://*/*");
  });

  test("manifest optional_host_permissions contains only the sync-server entry", () => {
    const ohp = manifest.optional_host_permissions || [];
    const allowed = new Set(["http://127.0.0.1:47391/*"]);
    for (const entry of ohp) {
      expect(allowed.has(entry)).toBe(true);
    }
  });

  test("manifest optional_host_permissions includes sync-server entry", () => {
    const ohp = manifest.optional_host_permissions || [];
    expect(ohp).toContain("http://127.0.0.1:47391/*");
  });

  test("manifest optional_host_permissions does not include local AI ports", () => {
    const ohp = manifest.optional_host_permissions || [];
    expect(ohp).not.toContain("http://127.0.0.1:11434/*");
    expect(ohp).not.toContain("http://localhost:11434/*");
    expect(ohp).not.toContain("http://localhost:1234/*");
    expect(ohp).not.toContain("http://localhost:1337/*");
  });
});

// ── parseInt radix argument ────────────────────────────────────────────────────

describe("parseInt radix argument", () => {
  const FILES_TO_CHECK = [
    "background.js",
    "lib/shared-popup.js",
    "lib/shared-settings.js",
  ];

  for (const rel of FILES_TO_CHECK) {
    test(`${rel} -- every parseInt() call includes the radix argument`, () => {
      const source = src(rel);
      const lines  = source.split("\n");
      const bare   = lines.filter((line, _i) => {
        return /\bparseInt\s*\(/.test(line) && !/, 10\)/.test(line);
      });
      expect(bare).toHaveLength(0);
    });
  }
});
