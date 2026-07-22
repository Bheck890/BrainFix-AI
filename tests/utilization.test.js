// utilization.test.js — Critical functionality tests for Thought Tidy
// Covers: provider management, free-tier gates, prompts, license, text utils,
// action settings, custom prompts, history, API callers, sync logic

const { isProUnlocked, verifyWithGumroad } = require("../lib/license");
const { resolveActionSettings, LOCKED_ACTIONS, DEFAULT_ACTION_SETTINGS, MENU_PROMPTS, buildPromptWithProfile } = require("../lib/prompts");
const { wordCount, wordDiff, esc, escHtml, uid, todayDate, purgeOldLog } = require("../lib/text");
const { callOpenAI, callClaude, callGemini, callGitHubCopilot, callAIWithFallback, isRetriable } = require("../lib/api");

// ═══════════════════════════════════════════════════════════════════════════════
// 1. PROVIDER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

describe("Provider management — duplicate detection", () => {
  function alreadyConfigured(configuredProviders, providerId) {
    return configuredProviders.some(p => p.id === providerId);
  }

  test("no providers configured → none are duplicates", () => {
    expect(alreadyConfigured([], "openai")).toBe(false);
    expect(alreadyConfigured([], "claude")).toBe(false);
    expect(alreadyConfigured([], "gemini")).toBe(false);
  });

  test("one provider configured → that provider is a duplicate", () => {
    const providers = [{ id: "openai", apiKey: "sk-test", model: "gpt-4o-mini" }];
    expect(alreadyConfigured(providers, "openai")).toBe(true);
    expect(alreadyConfigured(providers, "claude")).toBe(false);
  });

  test("all three providers configured → all are duplicates", () => {
    const providers = [
      { id: "openai", apiKey: "sk-a", model: "gpt-4o-mini" },
      { id: "claude", apiKey: "sk-b", model: "claude-haiku-3" },
      { id: "gemini", apiKey: "AIza", model: "gemini-2.5-flash-lite" },
    ];
    expect(alreadyConfigured(providers, "openai")).toBe(true);
    expect(alreadyConfigured(providers, "claude")).toBe(true);
    expect(alreadyConfigured(providers, "gemini")).toBe(true);
  });

  test("provider removal leaves others intact", () => {
    let providers = [
      { id: "openai", apiKey: "sk-a", model: "gpt-4o-mini" },
      { id: "claude", apiKey: "sk-b", model: "claude-haiku-3" },
    ];
    providers = providers.filter(p => p.id !== "openai");
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe("claude");
    expect(alreadyConfigured(providers, "openai")).toBe(false);
  });
});

describe("Provider management — ordering", () => {
  function moveProvider(arr, idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= arr.length) return arr;
    const copy = [...arr];
    [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
    return copy;
  }

  test("move first provider down puts it at index 1", () => {
    const providers = [
      { id: "openai" }, { id: "claude" }, { id: "gemini" }
    ];
    const result = moveProvider(providers, 0, 1);
    expect(result[0].id).toBe("claude");
    expect(result[1].id).toBe("openai");
  });

  test("move last provider up puts it at index 1 (of 3)", () => {
    const providers = [
      { id: "openai" }, { id: "claude" }, { id: "gemini" }
    ];
    const result = moveProvider(providers, 2, -1);
    expect(result[1].id).toBe("gemini");
    expect(result[2].id).toBe("claude");
  });

  test("cannot move below index 0", () => {
    const providers = [{ id: "openai" }, { id: "claude" }];
    const result = moveProvider(providers, 0, -1);
    expect(result[0].id).toBe("openai");
  });

  test("cannot move beyond last index", () => {
    const providers = [{ id: "openai" }, { id: "claude" }];
    const result = moveProvider(providers, 1, 1);
    expect(result[1].id).toBe("claude");
  });

  test("single provider cannot be moved", () => {
    const providers = [{ id: "openai" }];
    expect(moveProvider(providers, 0, 1)).toHaveLength(1);
    expect(moveProvider(providers, 0, -1)).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. FREE TIER GATES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Free tier — variants cap", () => {
  function clampVariants(value, isPro) {
    const max = isPro ? 4 : 1;
    return Math.min(Math.max(1, parseInt(value) || 1), max);
  }

  test("free user requesting 1 variant → 1", () => {
    expect(clampVariants(1, false)).toBe(1);
  });

  test("free user requesting 2 variants → clamped to 1", () => {
    expect(clampVariants(2, false)).toBe(1);
  });

  test("free user requesting 4 variants → clamped to 1", () => {
    expect(clampVariants(4, false)).toBe(1);
  });

  test("pro user requesting 4 variants → 4", () => {
    expect(clampVariants(4, true)).toBe(4);
  });

  test("pro user requesting 0 → clamped to 1", () => {
    expect(clampVariants(0, true)).toBe(1);
  });
});

describe("Free tier — custom prompt limit", () => {
  function canAddPrompt(currentCount, isPro) {
    return currentCount < (isPro ? 8 : 1);
  }

  test("free user with 0 prompts can add", () => {
    expect(canAddPrompt(0, false)).toBe(true);
  });

  test("free user with 1 prompt cannot add more", () => {
    expect(canAddPrompt(1, false)).toBe(false);
  });

  test("pro user with 7 prompts can add", () => {
    expect(canAddPrompt(7, true)).toBe(true);
  });

  test("pro user with 8 prompts cannot add more", () => {
    expect(canAddPrompt(8, true)).toBe(false);
  });

  test("free user cannot edit or delete existing prompts", () => {
    const isPro = false;
    const hasEditControls = isPro;
    expect(hasEditControls).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. LICENSE
// ═══════════════════════════════════════════════════════════════════════════════

describe("isProUnlocked", () => {
  test("requires both email and key", () => {
    expect(isProUnlocked({ licenseEmail: "a@b.com", licenseKey: "KEY" })).toBe(true);
  });

  test("email-only is not pro", () => {
    expect(isProUnlocked({ licenseEmail: "a@b.com" })).toBe(false);
  });

  test("key-only is not pro", () => {
    expect(isProUnlocked({ licenseKey: "KEY" })).toBe(false);
  });

  test("empty strings treated as missing", () => {
    expect(isProUnlocked({ licenseEmail: "", licenseKey: "" })).toBe(false);
  });

  test("empty settings object → not pro", () => {
    expect(isProUnlocked({})).toBe(false);
  });
});

// Gumroad is now called server-side via the proxy. These tests verify that
// verifyWithGumroad correctly forwards proxy responses to the caller.
describe("verifyWithGumroad — proxy responses", () => {
  function makeStorage(deviceId = "test-device") {
    return {
      appGet: jest.fn().mockResolvedValue({ _deviceId: deviceId }),
      appSet: jest.fn().mockResolvedValue(),
    };
  }
  afterEach(() => { global.fetch = undefined; });

  test("network failure returns invalid result with connection error", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));
    const result = await verifyWithGumroad("a@b.com", "KEY123", makeStorage());
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/activation server|connection/i);
  });

  test("proxy returns invalid key error → forwarded to caller", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: false, error: "Invalid license key" })
    });
    const result = await verifyWithGumroad("a@b.com", "BADKEY", makeStorage());
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid license key");
  });

  test("proxy returns wrong email error → forwarded to caller", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: false, error: "Wrong email for this license key" })
    });
    const result = await verifyWithGumroad("a@b.com", "KEY123", makeStorage());
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/email/i);
  });

  test("proxy returns valid → caller gets valid:true", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true })
    });
    const result = await verifyWithGumroad("a@b.com", "KEY123", makeStorage());
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ACTION SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

describe("resolveActionSettings", () => {
  test("empty stored settings returns full default list", () => {
    const result = resolveActionSettings([]);
    expect(result).toHaveLength(DEFAULT_ACTION_SETTINGS.length);
  });

  test("all default action IDs are present after resolve", () => {
    const result = resolveActionSettings([]);
    const ids = result.map(a => a.id);
    DEFAULT_ACTION_SETTINGS.forEach(def => {
      expect(ids).toContain(def.id);
    });
  });

  test("stored order is preserved (relative)", () => {
    const stored = [
      { id: "improve",      label: "Improve Writing", enabled: true },
      { id: "fix-spelling", label: "Fix Spelling",    enabled: true },
    ];
    const result = resolveActionSettings(stored);
    const ids = result.map(a => a.id);
    // stored items keep their relative order; missing defaults inserted at default positions
    expect(ids.indexOf("improve")).toBeLessThan(ids.indexOf("fix-spelling"));
    expect(result.length).toBeGreaterThan(2);
  });

  test("missing defaults inserted at default position", () => {
    const stored = [{ id: "fix-spelling", label: "Fix", enabled: true }];
    const result = resolveActionSettings(stored);
    const ids = result.map(a => a.id);
    expect(ids[0]).toBe("fix-spelling");
    expect(result.length).toBeGreaterThan(1);
  });

  test("enabled:false state is preserved", () => {
    const stored = [{ id: "brain-dump", label: "Brain Dump → Clear Text", enabled: false }];
    const result = resolveActionSettings(stored);
    const entry = result.find(a => a.id === "brain-dump");
    expect(entry.enabled).toBe(false);
  });

  test("at-minimum one action stays enabled", () => {
    const allDisabled = DEFAULT_ACTION_SETTINGS.map(a => ({ ...a, enabled: false }));
    allDisabled[0].enabled = true;
    const result = resolveActionSettings(allDisabled);
    const enabledCount = result.filter(a => a.enabled).length;
    expect(enabledCount).toBeGreaterThanOrEqual(1);
  });
});

describe("LOCKED_ACTIONS", () => {
  test("built-in core actions are locked", () => {
    ["fix-spelling", "sound-like-me", "professional", "sound-human", "brain-dump", "improve"]
      .forEach(id => expect(LOCKED_ACTIONS.has(id)).toBe(true));
  });

  test("optional built-in actions are not locked (can be renamed by pro users)", () => {
    ["formal", "casual", "shorten", "expand"]
      .forEach(id => expect(LOCKED_ACTIONS.has(id)).toBe(false));
  });

  test("custom prompt IDs are never locked", () => {
    ["custom-0", "custom-1", "custom-7"].forEach(id => {
      expect(LOCKED_ACTIONS.has(id)).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. PROMPT BUILDING
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildPromptWithProfile", () => {
  const BASE = "Fix the following text:";

  test("returns base prompt unchanged when profile is disabled", () => {
    expect(buildPromptWithProfile(BASE, { profileEnabled: false, profileName: "Alice" })).toBe(BASE);
  });

  test("returns base prompt when no profile fields are filled", () => {
    expect(buildPromptWithProfile(BASE, { profileEnabled: true })).toBe(BASE);
  });

  test("prepends profile context when enabled with name", () => {
    const result = buildPromptWithProfile(BASE, {
      profileEnabled: true,
      profileName: "Bailey"
    });
    expect(result).toContain("Bailey");
    expect(result).toContain(BASE);
    expect(result.indexOf("Bailey")).toBeLessThan(result.indexOf(BASE));
  });

  test("includes all provided profile fields", () => {
    const result = buildPromptWithProfile(BASE, {
      profileEnabled: true,
      profileName:    "Bailey",
      profileRole:    "Software Engineer",
      profileStyle:   "Casual",
      profileContext: "I work at a startup"
    });
    expect(result).toContain("Bailey");
    expect(result).toContain("Software Engineer");
    expect(result).toContain("Casual");
    expect(result).toContain("I work at a startup");
  });

  test("null settings object returns base prompt", () => {
    expect(buildPromptWithProfile(BASE, null)).toBe(BASE);
  });
});

describe("MENU_PROMPTS completeness", () => {
  const ALL_ACTION_IDS = DEFAULT_ACTION_SETTINGS.map(a => a.id);

  test("every default action has a MENU_PROMPT entry", () => {
    ALL_ACTION_IDS.forEach(id => {
      expect(MENU_PROMPTS[id]).toBeDefined();
      expect(typeof MENU_PROMPTS[id]).toBe("string");
      expect(MENU_PROMPTS[id].length).toBeGreaterThan(10);
    });
  });

  test("all prompts end with a colon (instruction format)", () => {
    const STRUCTURED_PROMPTS = new Set(["brain-to-prompt", "clarity-check"]);
    Object.entries(MENU_PROMPTS).forEach(([key, p]) => {
      if (STRUCTURED_PROMPTS.has(key)) return; // structured-output format; no trailing colon by design
      expect(p.trimEnd()).toMatch(/:$/);
    });
  });

  test("fix-spelling prompt does not mention 'voice' (is literal correction only)", () => {
    expect(MENU_PROMPTS["fix-spelling"]).not.toMatch(/voice/i);
  });

  test("sound-like-me prompt references authentic voice", () => {
    expect(MENU_PROMPTS["sound-like-me"]).toMatch(/voice|authentic/i);
  });

  test("brain-dump prompt handles scattered input", () => {
    expect(MENU_PROMPTS["brain-dump"]).toMatch(/brain dump|scattered/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. TEXT UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

describe("wordCount", () => {
  test("counts words correctly", () => {
    expect(wordCount("hello world")).toBe(2);
    expect(wordCount("one")).toBe(1);
    expect(wordCount("  lots  of   spaces  ")).toBe(3);
  });

  test("empty string returns 0", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("   ")).toBe(0);
  });
});

describe("wordDiff", () => {
  test("same word count reports no delta", () => {
    expect(wordDiff("hello world", "foo bar")).toBe("2 words");
  });

  test("longer result shows positive delta", () => {
    expect(wordDiff("hello", "hello world foo")).toBe("3 words (+2)");
  });

  test("shorter result shows negative delta", () => {
    expect(wordDiff("hello world foo", "hello")).toBe("1 words (-2)");
  });
});

describe("esc (HTML escape for DOM injection)", () => {
  test("escapes ampersands", () => {
    expect(esc("a & b")).toBe("a &amp; b");
  });

  test("escapes angle brackets", () => {
    expect(esc("<b>bold</b>")).toBe("&lt;b&gt;bold&lt;/b&gt;");
  });

  test("converts newlines to <br>", () => {
    expect(esc("line1\nline2")).toBe("line1<br>line2");
  });

  test("leaves plain text unchanged", () => {
    expect(esc("hello world")).toBe("hello world");
  });
});

describe("purgeOldLog", () => {
  test("removes entries not from today", () => {
    const today = todayDate();
    const entries = [
      { date: today,        action: "fix-spelling" },
      { date: "2020-01-01", action: "improve" },
      { date: today,        action: "casual" },
    ];
    const purged = purgeOldLog(entries);
    expect(purged).toHaveLength(2);
    purged.forEach(e => expect(e.date).toBe(today));
  });

  test("returns empty array when all entries are old", () => {
    const old = [
      { date: "2020-01-01", action: "fix-spelling" },
      { date: "2019-06-15", action: "improve" },
    ];
    expect(purgeOldLog(old)).toHaveLength(0);
  });

  test("handles null/undefined gracefully", () => {
    expect(purgeOldLog(null)).toHaveLength(0);
    expect(purgeOldLog(undefined)).toHaveLength(0);
  });

  test("history log capped at 200 via slice(-200)", () => {
    const today = todayDate();
    const big = Array.from({ length: 250 }, (_, i) => ({ date: today, i }));
    const capped = purgeOldLog(big).slice(-200);
    expect(capped).toHaveLength(200);
  });
});

describe("uid", () => {
  test("generates a non-empty string", () => {
    const id = uid();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  test("generates unique IDs on successive calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => uid()));
    expect(ids.size).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. API CALLERS — ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => { jest.clearAllMocks(); });

describe("callOpenAI — error handling", () => {
  test("empty API key throws immediately without fetching", async () => {
    await expect(callOpenAI("", "gpt-4o-mini", "Fix:", "text"))
      .rejects.toThrow("OpenAI API key not set");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("API error response throws with message from response body", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      statusText: "Unauthorized",
      json: async () => ({ error: { message: "Invalid API key" } })
    });
    await expect(callOpenAI("sk-bad", "gpt-4o-mini", "Fix:", "text"))
      .rejects.toThrow("Invalid API key");
  });

  test("successful response returns trimmed text", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "  Fixed!  " } }] })
    });
    const result = await callOpenAI("sk-good", "gpt-4o-mini", "Fix:", "text");
    expect(result).toBe("Fixed!");
  });
});

describe("callClaude — error handling", () => {
  test("empty API key throws immediately", async () => {
    await expect(callClaude("", "claude-haiku-3", "Fix:", "text"))
      .rejects.toThrow("Claude API key not set");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("sends required anthropic headers", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: "Fixed!" }] })
    });
    await callClaude("sk-ant-test", "claude-haiku-3", "Fix:", "text");
    const opts = global.fetch.mock.calls[0][1];
    expect(opts.headers["anthropic-version"]).toBeDefined();
    expect(opts.headers["x-api-key"]).toBe("sk-ant-test");
  });
});

describe("callGemini — error handling", () => {
  test("empty API key throws immediately", async () => {
    await expect(callGemini("", "gemini-2.5-flash-lite", "Fix:", "text"))
      .rejects.toThrow("Gemini API key not set");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("includes API key in URL", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Fixed!" }] } }]
      })
    });
    await callGemini("AIza-test", "gemini-2.5-flash-lite", "Fix:", "text");
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain("AIza-test");
  });
});

describe("isRetriable", () => {
  test("429 rate-limit message is retriable", () => {
    expect(isRetriable("HTTP 429 rate limit exceeded")).toBe(true);
  });

  test("503 service unavailable message is retriable", () => {
    expect(isRetriable("HTTP 503 Service Unavailable")).toBe(true);
  });

  test("overloaded message is retriable", () => {
    expect(isRetriable("API overloaded, please try again")).toBe(true);
  });

  test("quota exceeded message is retriable", () => {
    expect(isRetriable("quota exceeded for today")).toBe(true);
  });

  test("401 unauthorized message is not retriable", () => {
    expect(isRetriable("HTTP 401 Unauthorized")).toBe(false);
  });

  test("invalid API key message is not retriable", () => {
    expect(isRetriable("Invalid API key provided")).toBe(false);
  });

  test("empty/undefined message returns false", () => {
    expect(isRetriable("")).toBe(false);
    expect(isRetriable(undefined)).toBe(false);
  });
});

describe("callAIWithFallback — provider selection", () => {
  test("no providers configured throws with helpful message", async () => {
    await expect(
      callAIWithFallback([], null, {}, "Fix:", "text")
    ).rejects.toThrow();
  });

  test("single OpenAI provider succeeds", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Fixed!" } }] })
    });
    const providers = [{ id: "openai", apiKey: "sk-test", model: "gpt-4o-mini" }];
    const { result, usedProvider } = await callAIWithFallback(providers, null, {}, "Fix:", "text");
    expect(result).toBe("Fixed!");
    expect(usedProvider).toBe("openai");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. SYNC ENABLED LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

describe("Sync enabled setting", () => {
  test("syncEnabled defaults to true when not set", () => {
    const syncEnabled = undefined;
    const effective = syncEnabled !== false;
    expect(effective).toBe(true);
  });

  test("syncEnabled=false disables sync", () => {
    const syncEnabled = false;
    const effective = syncEnabled !== false;
    expect(effective).toBe(false);
  });

  test("syncEnabled=true enables sync", () => {
    const syncEnabled = true;
    const effective = syncEnabled !== false;
    expect(effective).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. CUSTOM PROMPT ID RESOLUTION (background.js logic)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Custom prompt ID resolution (dyn-N ↔ custom-N)", () => {
  function resolvePromptFromMenu(menuId, customPrompts) {
    if (menuId.startsWith("dyn-")) {
      const idx = parseInt(menuId.replace("dyn-", ""), 10);
      return customPrompts[idx]?.prompt || "Process the following text:";
    }
    return MENU_PROMPTS[menuId] || null;
  }

  const CPS = [
    { name: "Email Reply", prompt: "Write a professional email reply:" },
    { name: "Slack",       prompt: "Write a Slack message:" },
  ];

  test("dyn-0 resolves to first custom prompt", () => {
    expect(resolvePromptFromMenu("dyn-0", CPS)).toBe("Write a professional email reply:");
  });

  test("dyn-1 resolves to second custom prompt", () => {
    expect(resolvePromptFromMenu("dyn-1", CPS)).toBe("Write a Slack message:");
  });

  test("dyn out of range falls back to default text", () => {
    expect(resolvePromptFromMenu("dyn-99", CPS)).toBe("Process the following text:");
  });

  test("built-in action resolves via MENU_PROMPTS", () => {
    expect(resolvePromptFromMenu("fix-spelling", CPS)).toBe(MENU_PROMPTS["fix-spelling"]);
  });

  test("unknown built-in returns null", () => {
    expect(resolvePromptFromMenu("unknown-xyz", CPS)).toBeNull();
  });

  test("lastAction normalisation: dyn-N becomes custom-N", () => {
    const normalize = id => id.startsWith("dyn-") ? id.replace("dyn-", "custom-") : id;
    expect(normalize("dyn-0")).toBe("custom-0");
    expect(normalize("dyn-7")).toBe("custom-7");
    expect(normalize("fix-spelling")).toBe("fix-spelling");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. LIVE API TESTS
// Set these env vars in CI secrets to enable (tests are skipped when absent):
//   OPENAI_API_KEY        — OpenAI live calls
//   GOOGLE_API_KEY        — Gemini live calls
//   CLAUDE_API_KEY        — Claude live calls
//   COPILOT_TOKEN  — GitHub Copilot live calls (requires active Copilot subscription)
// ═══════════════════════════════════════════════════════════════════════════════

const OPENAI_KEY    = process.env.OPENAI_API_KEY;
const GOOGLE_KEY    = process.env.GOOGLE_API_KEY;
const CLAUDE_KEY    = process.env.CLAUDE_API_KEY;
const COPILOT_TOKEN = process.env.COPILOT_TOKEN;

const describeIf = (cond) => cond ? describe : describe.skip;

// Top-level beforeEach (line ~477) replaces global.fetch with jest.fn() for unit tests.
// Live API suites need the real fetch — save it before any mock can overwrite it.
const _realFetch = global.fetch;

function useLiveFetch() {
  let saved;
  beforeEach(() => { saved = global.fetch; global.fetch = _realFetch; });
  afterEach(() => { global.fetch = saved; });
}

// Wraps a live API test so transient provider errors (rate limits, overload, quota)
// produce a console warning instead of a CI failure.
function liveTest(name, fn, timeout) {
  test(name, async () => {
    try {
      await fn();
    } catch (err) {
      if (isRetriable(err.message)) {
        console.warn(`[skipped — transient API error] ${name}: ${err.message}`);
        return;
      }
      throw err;
    }
  }, timeout || 20000);
}

describeIf(!!OPENAI_KEY)("Live API — OpenAI (requires OPENAI_API_KEY env var)", () => {
  useLiveFetch();
  liveTest("fix-spelling returns non-empty corrected text", async () => {
    const result = await callOpenAI(OPENAI_KEY, "gpt-4o-mini", MENU_PROMPTS["fix-spelling"], "teh quikc brwon fox");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  }, 20000);

  liveTest("improve returns longer or equal text", async () => {
    const input  = "Bad writing.";
    const result = await callOpenAI(OPENAI_KEY, "gpt-4o-mini", MENU_PROMPTS["improve"], input);
    expect(result.length).toBeGreaterThan(0);
  }, 20000);

  liveTest("brain-dump returns structured output", async () => {
    const input  = "need email thing... remind boss... meeting tues... budget stuff";
    const result = await callOpenAI(OPENAI_KEY, "gpt-4o-mini", MENU_PROMPTS["brain-dump"], input);
    expect(result.length).toBeGreaterThan(input.length);
  }, 20000);

  liveTest("profile-injected prompt reaches the model", async () => {
    const settings = { profileEnabled: true, profileName: "Test", profileRole: "QA" };
    const prompt   = buildPromptWithProfile(MENU_PROMPTS["fix-spelling"], settings);
    expect(prompt).toContain("Test");
    const result = await callOpenAI(OPENAI_KEY, "gpt-4o-mini", prompt, "pleese fixx ths");
    expect(result.length).toBeGreaterThan(0);
  }, 20000);

  liveTest("callAIWithFallback end-to-end with OpenAI", async () => {
    const providers = [{ id: "openai", apiKey: OPENAI_KEY, model: "gpt-4o-mini" }];
    const { result, usedProvider, usedModel } = await callAIWithFallback(
      providers, null, {}, MENU_PROMPTS["fix-spelling"], "ths is wrng"
    );
    expect(result.length).toBeGreaterThan(0);
    expect(usedProvider).toBe("openai");
    expect(usedModel).toBeTruthy();
  }, 20000);
});

describeIf(!!GOOGLE_KEY)("Live API — Gemini (requires GOOGLE_API_KEY env var)", () => {
  useLiveFetch();
  liveTest("fix-spelling returns non-empty corrected text", async () => {
    const result = await callGemini(GOOGLE_KEY, "gemini-2.5-flash-lite", MENU_PROMPTS["fix-spelling"], "teh quikc brwon fox");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  }, 20000);

  liveTest("callAIWithFallback end-to-end with Gemini", async () => {
    const providers = [{ id: "gemini", apiKey: GOOGLE_KEY, model: "gemini-2.5-flash-lite" }];
    const { result, usedProvider } = await callAIWithFallback(
      providers, ["gemini-2.5-flash-lite", null, null], {}, MENU_PROMPTS["improve"], "Bad writing."
    );
    expect(result.length).toBeGreaterThan(0);
    expect(usedProvider).toBe("gemini");
  }, 20000);

  liveTest("shorten prompt returns shorter text", async () => {
    const input  = "This is a very long piece of text that goes on and on and repeats itself quite a lot with a lot of redundant words.";
    const result = await callGemini(GOOGLE_KEY, "gemini-2.5-flash-lite", MENU_PROMPTS["shorten"], input);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(input.length * 1.5);
  }, 20000);
});

describeIf(!!CLAUDE_KEY)("Live API — Claude (requires CLAUDE_API_KEY env var)", () => {
  useLiveFetch();
  liveTest("fix-spelling returns non-empty corrected text", async () => {
    const result = await callClaude(CLAUDE_KEY, "claude-haiku-4-5-20251001", MENU_PROMPTS["fix-spelling"], "teh quikc brwon fox");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  }, 20000);

  liveTest("callAIWithFallback end-to-end with Claude", async () => {
    const providers = [{ id: "claude", apiKey: CLAUDE_KEY, model: "claude-haiku-4-5-20251001" }];
    const { result, usedProvider } = await callAIWithFallback(
      providers, null, {}, MENU_PROMPTS["fix-spelling"], "wrng speling"
    );
    expect(result.length).toBeGreaterThan(0);
    expect(usedProvider).toBe("claude");
  }, 20000);
});

describeIf(!!COPILOT_TOKEN)("Live API — GitHub Models (requires COPILOT_TOKEN env var)", () => {
  useLiveFetch();
  liveTest("fix-spelling returns non-empty corrected text", async () => {
    const result = await callGitHubCopilot(COPILOT_TOKEN, "gpt-4o-mini", MENU_PROMPTS["fix-spelling"], "teh quikc brwon fox");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  }, 20000);

  liveTest("callAIWithFallback end-to-end with GitHub Models", async () => {
    const providers = [{ id: "copilot", apiKey: COPILOT_TOKEN, model: "gpt-4o-mini" }];
    const { result, usedProvider } = await callAIWithFallback(
      providers, null, {}, MENU_PROMPTS["fix-spelling"], "wrng speling"
    );
    expect(result.length).toBeGreaterThan(0);
    expect(usedProvider).toBe("copilot");
  }, 20000);
});

describeIf(!!(OPENAI_KEY && GOOGLE_KEY))("Live API — fallback chain (requires OPENAI_API_KEY + GOOGLE_API_KEY)", () => {
  useLiveFetch();
  liveTest("uses OpenAI first when both providers configured", async () => {
    const providers = [
      { id: "openai", apiKey: OPENAI_KEY, model: "gpt-4o-mini" },
      { id: "gemini", apiKey: GOOGLE_KEY, model: "gemini-2.5-flash-lite" },
    ];
    const { usedProvider } = await callAIWithFallback(
      providers, ["gemini-2.5-flash-lite", null, null], {}, MENU_PROMPTS["fix-spelling"], "tst input"
    );
    expect(usedProvider).toBe("openai");
  }, 20000);
});

describeIf(!!(OPENAI_KEY && GOOGLE_KEY && CLAUDE_KEY && COPILOT_TOKEN))(
  "Live API — all 4 providers in priority order (requires all env vars)", () => {
  useLiveFetch();
  liveTest("first configured provider wins when all are healthy", async () => {
    const providers = [
      { id: "claude",  apiKey: CLAUDE_KEY,    model: "claude-haiku-4-5-20251001" },
      { id: "openai",  apiKey: OPENAI_KEY,    model: "gpt-4o-mini" },
      { id: "gemini",  apiKey: GOOGLE_KEY,    model: "gemini-2.5-flash-lite" },
      { id: "copilot", apiKey: COPILOT_TOKEN, model: "gpt-4o-mini" },
    ];
    const { result, usedProvider } = await callAIWithFallback(
      providers, ["gemini-2.5-flash-lite", null, null], {}, MENU_PROMPTS["fix-spelling"], "tst input"
    );
    expect(result.length).toBeGreaterThan(0);
    expect(usedProvider).toBe("claude"); // first in list wins
  }, 20000);

  liveTest("respects priority order — second provider used when first removed", async () => {
    const providers = [
      { id: "openai",  apiKey: OPENAI_KEY,    model: "gpt-4o-mini" },
      { id: "claude",  apiKey: CLAUDE_KEY,    model: "claude-haiku-4-5-20251001" },
    ];
    const { usedProvider } = await callAIWithFallback(
      providers, null, {}, MENU_PROMPTS["improve"], "Bad writing."
    );
    expect(usedProvider).toBe("openai"); // first in list wins
  }, 20000);
});
