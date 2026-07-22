const { callOpenAI, callClaude, callGemini, callOllama, callGitHubCopilot, callAI, callAIWithFallback, isRetriable } = require("../lib/api");

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockOk(body) {
  return jest.fn().mockResolvedValue({ ok: true, json: async () => body });
}

function mockFail(status, errorMsg) {
  return jest.fn().mockResolvedValue({
    ok: false,
    statusText: `HTTP ${status}`,
    json: async () => ({ error: { message: errorMsg } })
  });
}

beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => { jest.clearAllMocks(); });

// ── callOpenAI ────────────────────────────────────────────────────────────────

describe("callOpenAI", () => {
  test("throws a meaningful error when API key is empty", async () => {
    await expect(callOpenAI("", "gpt-4o-mini", "Fix:", "hello"))
      .rejects.toThrow("OpenAI API key not set");
  });

  test("calls the correct OpenAI endpoint", async () => {
    global.fetch = mockOk({ choices: [{ message: { content: "Fixed" } }] });
    await callOpenAI("sk-test", "gpt-4o-mini", "Fix:", "hello");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.any(Object)
    );
  });

  test("sends correct Authorization header", async () => {
    global.fetch = mockOk({ choices: [{ message: { content: "Fixed" } }] });
    await callOpenAI("sk-mykey", "gpt-4o-mini", "Fix:", "hello");
    const opts = global.fetch.mock.calls[0][1];
    expect(opts.headers["Authorization"]).toBe("Bearer sk-mykey");
  });

  test("sends system prompt as first message and text as second", async () => {
    global.fetch = mockOk({ choices: [{ message: { content: "Fixed" } }] });
    await callOpenAI("sk-test", "gpt-4o-mini", "Fix this:", "my text");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: "system", content: "Fix this:" });
    expect(body.messages[1]).toEqual({ role: "user",   content: "my text" });
  });

  test("sends the specified model", async () => {
    global.fetch = mockOk({ choices: [{ message: { content: "ok" } }] });
    await callOpenAI("sk-test", "gpt-4o", "Fix:", "text");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-4o");
  });

  test("returns trimmed response text", async () => {
    global.fetch = mockOk({ choices: [{ message: { content: "  Fixed!  " } }] });
    const result = await callOpenAI("sk-test", "gpt-4o-mini", "Fix:", "hello");
    expect(result).toBe("Fixed!");
  });

  test("throws with the API error message on non-ok response", async () => {
    global.fetch = mockFail(401, "Invalid API key.");
    await expect(callOpenAI("sk-bad", "gpt-4o-mini", "Fix:", "hello"))
      .rejects.toThrow("OpenAI: Invalid API key.");
  });

  test("falls back to statusText when error body has no message", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, statusText: "Unauthorized", json: async () => ({})
    });
    await expect(callOpenAI("sk-bad", "gpt-4o-mini", "Fix:", "hello"))
      .rejects.toThrow("OpenAI: Unauthorized");
  });
});

// ── callClaude ────────────────────────────────────────────────────────────────

describe("callClaude", () => {
  test("throws a meaningful error when API key is empty", async () => {
    await expect(callClaude("", "claude-haiku-4-5-20251001", "Fix:", "hello"))
      .rejects.toThrow("Claude API key not set");
  });

  test("calls the correct Anthropic endpoint", async () => {
    global.fetch = mockOk({ content: [{ text: "Fixed" }] });
    await callClaude("sk-ant-test", "claude-haiku-4-5-20251001", "Fix:", "hello");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.any(Object)
    );
  });

  test("sends required Anthropic headers", async () => {
    global.fetch = mockOk({ content: [{ text: "Fixed" }] });
    await callClaude("sk-ant-key", "claude-haiku-4-5-20251001", "Fix:", "hello");
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers["x-api-key"]).toBe("sk-ant-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  });

  test("sends prompt as system field, text as user message", async () => {
    global.fetch = mockOk({ content: [{ text: "ok" }] });
    await callClaude("sk-ant-test", "claude-haiku-4-5-20251001", "My prompt:", "My text");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.system).toBe("My prompt:");
    expect(body.messages[0]).toEqual({ role: "user", content: "My text" });
  });

  test("returns trimmed response text", async () => {
    global.fetch = mockOk({ content: [{ text: "  Clean output  " }] });
    const result = await callClaude("sk-ant-test", "claude-haiku-4-5-20251001", "Fix:", "hello");
    expect(result).toBe("Clean output");
  });

  test("throws with API error message on non-ok response", async () => {
    global.fetch = mockFail(401, "Invalid x-api-key.");
    await expect(callClaude("bad-key", "claude-haiku-4-5-20251001", "Fix:", "hello"))
      .rejects.toThrow("Claude: Invalid x-api-key.");
  });
});

// ── callGemini ────────────────────────────────────────────────────────────────

describe("callGemini", () => {
  test("throws a meaningful error when API key is empty", async () => {
    await expect(callGemini("", "gemini-2.0-flash", "Fix:", "hello"))
      .rejects.toThrow("Gemini API key not set");
  });

  test("calls the correct Gemini endpoint and sends key as header (not URL param)", async () => {
    global.fetch = mockOk({ candidates: [{ content: { parts: [{ text: "Fixed" }] } }] });
    await callGemini("AIza-test", "gemini-2.0-flash", "Fix:", "hello");
    const url  = global.fetch.mock.calls[0][0];
    const opts = global.fetch.mock.calls[0][1];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).toContain("gemini-2.0-flash:generateContent");
    expect(url).not.toContain("key=");
    expect(opts.headers["x-goog-api-key"]).toBe("AIza-test");
  });

  test("strips the 'models/' prefix from model ID in the URL", async () => {
    global.fetch = mockOk({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    await callGemini("AIza-test", "models/gemini-2.0-flash", "Fix:", "hello");
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain("models/gemini-2.0-flash:generateContent");
    expect(url).not.toContain("models/models/");
  });

  test("combines prompt and text in the user parts field", async () => {
    global.fetch = mockOk({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    await callGemini("AIza-test", "gemini-2.0-flash", "My instruction:", "My input");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const partText = body.contents[0].parts[0].text;
    expect(partText).toContain("My instruction:");
    expect(partText).toContain("My input");
  });

  test("returns trimmed response text", async () => {
    global.fetch = mockOk({ candidates: [{ content: { parts: [{ text: "  Output  " }] } }] });
    const result = await callGemini("AIza-test", "gemini-2.0-flash", "Fix:", "hello");
    expect(result).toBe("Output");
  });

  test("throws with API error message on non-ok response", async () => {
    global.fetch = mockFail(400, "API key not valid.");
    await expect(callGemini("bad-key", "gemini-2.0-flash", "Fix:", "hello"))
      .rejects.toThrow("Gemini: API key not valid.");
  });
});

// ── callOllama ────────────────────────────────────────────────────────────────

describe("callOllama", () => {
  test("throws when no model is selected", async () => {
    await expect(callOllama("http://localhost:11434", "", "Fix:", "hello"))
      .rejects.toThrow("Ollama: no model selected");
  });

  test("calls the OpenAI-compatible completions endpoint on the base URL", async () => {
    global.fetch = mockOk({ choices: [{ message: { content: "Fixed" } }] });
    await callOllama("http://localhost:11434", "llama3.2:latest", "Fix:", "hello");
    expect(global.fetch.mock.calls[0][0]).toBe("http://localhost:11434/v1/chat/completions");
  });

  test("strips trailing slash from base URL", async () => {
    global.fetch = mockOk({ choices: [{ message: { content: "ok" } }] });
    await callOllama("http://localhost:11434/", "llama3.2:latest", "Fix:", "text");
    expect(global.fetch.mock.calls[0][0]).toBe("http://localhost:11434/v1/chat/completions");
  });

  test("defaults to localhost:11434 when baseUrl is falsy", async () => {
    global.fetch = mockOk({ choices: [{ message: { content: "ok" } }] });
    await callOllama(null, "llama3.2:latest", "Fix:", "text");
    expect(global.fetch.mock.calls[0][0]).toBe("http://localhost:11434/v1/chat/completions");
  });

  test("sends system prompt and user text as messages", async () => {
    global.fetch = mockOk({ choices: [{ message: { content: "ok" } }] });
    await callOllama("http://localhost:11434", "llama3.2:latest", "My instruction:", "My text");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: "system", content: "My instruction:" });
    expect(body.messages[1]).toEqual({ role: "user",   content: "My text" });
  });

  test("returns trimmed response text", async () => {
    global.fetch = mockOk({ choices: [{ message: { content: "  Clean result  " } }] });
    const result = await callOllama("http://localhost:11434", "llama3.2:latest", "Fix:", "hello");
    expect(result).toBe("Clean result");
  });

  test("throws Ollama-prefixed error on non-ok response", async () => {
    global.fetch = mockFail(500, "model not found");
    await expect(callOllama("http://localhost:11434", "llama3.2:latest", "Fix:", "hello"))
      .rejects.toThrow("Ollama: model not found");
  });

  test("works with a remote base URL", async () => {
    global.fetch = mockOk({ choices: [{ message: { content: "remote ok" } }] });
    const result = await callOllama("http://192.168.1.50:11434", "mistral:latest", "Fix:", "hello");
    expect(result).toBe("remote ok");
    expect(global.fetch.mock.calls[0][0]).toBe("http://192.168.1.50:11434/v1/chat/completions");
  });
});

// ── callAI (router) ───────────────────────────────────────────────────────────

describe("callAI", () => {
  beforeEach(() => {
    global.fetch = mockOk({ choices: [{ message: { content: "ok" } }] });
  });

  test("routes 'openai' to the OpenAI endpoint", async () => {
    await callAI("openai", { openaiKey: "sk-x", openaiModel: "gpt-4o-mini" }, "Fix:", "text");
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
  });

  test("routes 'claude' to the Anthropic endpoint", async () => {
    global.fetch = mockOk({ content: [{ text: "ok" }] });
    await callAI("claude", { claudeKey: "sk-ant-x", claudeModel: "claude-haiku-4-5-20251001" }, "Fix:", "text");
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
  });

  test("routes 'gemini' to the Gemini endpoint", async () => {
    global.fetch = mockOk({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    await callAI("gemini", { geminiKey: "AIza-x", geminiModel: "gemini-2.0-flash" }, "Fix:", "text");
    expect(global.fetch.mock.calls[0][0]).toContain("generativelanguage.googleapis.com");
  });

  test("uses default model when none is saved in settings", async () => {
    await callAI("openai", { openaiKey: "sk-x" }, "Fix:", "text");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-4o-mini");
  });

  test("throws a clear error for an unknown provider", async () => {
    await expect(callAI("unknown-ai", {}, "Fix:", "text"))
      .rejects.toThrow('Unknown provider "unknown-ai"');
  });
});

// ── isRetriable ───────────────────────────────────────────────────────────────

describe("isRetriable", () => {
  test("returns true for 429 rate limit messages", () => {
    expect(isRetriable("Rate limit 429 exceeded")).toBe(true);
  });

  test("returns true for 503 messages", () => {
    expect(isRetriable("Service 503 temporarily unavailable")).toBe(true);
  });

  test("returns true for overload messages", () => {
    expect(isRetriable("Model is overloaded")).toBe(true);
  });

  test("returns false for 401 auth errors", () => {
    expect(isRetriable("401 Unauthorized: Invalid API key")).toBe(false);
  });

  test("returns false for 400 bad request errors", () => {
    expect(isRetriable("400 Bad Request: Invalid model")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isRetriable("")).toBe(false);
  });
});

// ── callAIWithFallback ────────────────────────────────────────────────────────

describe("callAIWithFallback", () => {
  function openaiOk() {
    return jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) });
  }
  function claudeOk() {
    return jest.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [{ text: "ok" }] }) });
  }
  function geminiOk() {
    return jest.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }) });
  }
  function rateLimitFail() {
    return jest.fn().mockResolvedValue({ ok: false, statusText: "Too Many Requests", json: async () => ({ error: { message: "Rate limit 429 exceeded" } }) });
  }
  function authFail() {
    return jest.fn().mockResolvedValue({ ok: false, statusText: "Unauthorized", json: async () => ({ error: { message: "401 Invalid API key" } }) });
  }

  afterEach(() => { jest.clearAllMocks(); });

  test("throws when configuredProviders is empty", async () => {
    await expect(callAIWithFallback([], [], {}, "Fix:", "text"))
      .rejects.toThrow("No AI providers configured");
  });

  test("returns result from first provider when it succeeds", async () => {
    global.fetch = openaiOk();
    const p = [{ id: "openai", apiKey: "sk-x", model: "gpt-4o-mini" }];
    const { result, usedProvider } = await callAIWithFallback(p, [], {}, "Fix:", "text");
    expect(result).toBe("ok");
    expect(usedProvider).toBe("openai");
  });

  test("falls to provider[1] when provider[0] returns a retriable error", async () => {
    global.fetch = rateLimitFail()
      .mockResolvedValueOnce({ ok: false, statusText: "Rate limit", json: async () => ({ error: { message: "Rate limit 429 exceeded" } }) })
      .mockResolvedValueOnce({ ok: true,  json: async () => ({ content: [{ text: "from claude" }] }) });
    const p = [
      { id: "openai", apiKey: "sk-x", model: "gpt-4o-mini" },
      { id: "claude", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" }
    ];
    const { result, usedProvider } = await callAIWithFallback(p, [], {}, "Fix:", "text");
    expect(result).toBe("from claude");
    expect(usedProvider).toBe("claude");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("throws immediately on non-retriable 401 without trying next provider", async () => {
    global.fetch = authFail();
    const p = [
      { id: "openai", apiKey: "sk-bad", model: "gpt-4o-mini" },
      { id: "claude", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" }
    ];
    await expect(callAIWithFallback(p, [], {}, "Fix:", "text"))
      .rejects.toThrow("401 Invalid API key");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("Gemini falls to secondary model when primary returns retriable error", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, statusText: "Overloaded", json: async () => ({ error: { message: "Model overloaded 503" } }) })
      .mockResolvedValueOnce({ ok: true,  json: async () => ({ candidates: [{ content: { parts: [{ text: "from secondary" }] } }] }) });
    const p = [{ id: "gemini", apiKey: "AIza-x", model: "gemini-2.0-flash" }];
    const gm = ["gemini-2.0-flash", "gemini-1.5-flash", null];
    const { result, usedModel } = await callAIWithFallback(p, gm, {}, "Fix:", "text");
    expect(result).toBe("from secondary");
    expect(usedModel).toBe("gemini-1.5-flash");
  });

  test("calls onStatusUpdate with provider name at each attempt", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, statusText: "Rate limit", json: async () => ({ error: { message: "Rate limit 429" } }) })
      .mockResolvedValueOnce({ ok: true,  json: async () => ({ content: [{ text: "ok" }] }) });
    const p = [
      { id: "openai", apiKey: "sk-x",     model: "gpt-4o-mini" },
      { id: "claude", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" }
    ];
    const updates = [];
    await callAIWithFallback(p, [], {}, "Fix:", "text", { onStatusUpdate: msg => updates.push(msg) });
    expect(updates[0]).toContain("OpenAI");
    expect(updates[1]).toContain("Claude");
  });

  test("falls back to legacy flat keys when configuredProviders is null", async () => {
    global.fetch = openaiOk();
    const { result } = await callAIWithFallback(
      null, null,
      { provider: "openai", openaiKey: "sk-x", openaiModel: "gpt-4o-mini" },
      "Fix:", "text"
    );
    expect(result).toBe("ok");
  });

  test("routes to Ollama provider and returns result with usedProvider='ollama'", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "from ollama" } }] }) });
    const p = [{ id: "ollama", apiKey: "", model: "llama3.2:latest", baseUrl: "http://localhost:11434" }];
    const { result, usedProvider, usedModel } = await callAIWithFallback(p, [], {}, "Fix:", "text");
    expect(result).toBe("from ollama");
    expect(usedProvider).toBe("ollama");
    expect(usedModel).toBe("llama3.2:latest");
  });

  test("Ollama falls back to next provider on retriable error", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, statusText: "Service Unavailable", json: async () => ({ error: { message: "503 unavailable" } }) })
      .mockResolvedValueOnce({ ok: true,  json: async () => ({ content: [{ text: "from claude" }] }) });
    const p = [
      { id: "ollama", apiKey: "", model: "llama3.2:latest", baseUrl: "http://localhost:11434" },
      { id: "claude", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" }
    ];
    const { result, usedProvider } = await callAIWithFallback(p, [], {}, "Fix:", "text");
    expect(result).toBe("from claude");
    expect(usedProvider).toBe("claude");
  });

  test("Ollama short-circuits on non-retriable error without trying next provider", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, statusText: "Bad Request", json: async () => ({ error: { message: "400 bad request" } }) });
    const p = [
      { id: "ollama", apiKey: "", model: "llama3.2:latest", baseUrl: "http://localhost:11434" },
      { id: "claude", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" }
    ];
    await expect(callAIWithFallback(p, [], {}, "Fix:", "text")).rejects.toThrow("Ollama: 400 bad request");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("routes to GitHub Copilot provider and returns usedProvider='copilot'", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "from copilot" } }] }) });
    const p = [{ id: "copilot", apiKey: "ghp_token", model: "gpt-4o" }];
    const { result, usedProvider, usedModel } = await callAIWithFallback(p, [], {}, "Fix:", "text");
    expect(result).toBe("from copilot");
    expect(usedProvider).toBe("copilot");
    expect(usedModel).toBe("gpt-4o");
  });

  test("Copilot falls back to next provider on retriable error", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, statusText: "Service Unavailable", json: async () => ({ error: { message: "503 overloaded" } }) })
      .mockResolvedValueOnce({ ok: true,  json: async () => ({ content: [{ text: "from claude" }] }) });
    const p = [
      { id: "copilot", apiKey: "ghp_token", model: "gpt-4o" },
      { id: "claude",  apiKey: "sk-ant-x",  model: "claude-haiku-4-5-20251001" }
    ];
    const { result, usedProvider } = await callAIWithFallback(p, [], {}, "Fix:", "text");
    expect(result).toBe("from claude");
    expect(usedProvider).toBe("claude");
  });
});

// ── callGitHubCopilot ─────────────────────────────────────────────────────────

describe("callGitHubCopilot", () => {
  test("throws a meaningful error when token is empty", async () => {
    await expect(callGitHubCopilot("", "gpt-4o", "Fix:", "hello"))
      .rejects.toThrow("GitHub token not set");
  });

  test("calls the correct GitHub Copilot endpoint", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "Fixed" } }] }) });
    await callGitHubCopilot("ghp_token", "gpt-4o", "Fix:", "hello");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://models.inference.ai.azure.com/chat/completions",
      expect.any(Object)
    );
  });

  test("sends correct Authorization Bearer header", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) });
    await callGitHubCopilot("ghp_mytoken", "gpt-4o", "Fix:", "hello");
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers["Authorization"]).toBe("Bearer ghp_mytoken");
  });

  test("does not send proprietary Copilot headers (uses standard Bearer auth only)", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) });
    await callGitHubCopilot("ghp_t", "gpt-4o", "Fix:", "hello");
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers["Copilot-Integration-Id"]).toBeUndefined();
    expect(headers["Editor-Version"]).toBeUndefined();
    expect(headers["Authorization"]).toBe("Bearer ghp_t");
  });

  test("sends system prompt as first message and text as second", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) });
    await callGitHubCopilot("ghp_t", "gpt-4o", "Fix this:", "my text");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: "system", content: "Fix this:" });
    expect(body.messages[1]).toEqual({ role: "user",   content: "my text" });
  });

  test("sends the specified model in the request body", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) });
    await callGitHubCopilot("ghp_t", "claude-3.5-sonnet", "Fix:", "text");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe("claude-3.5-sonnet");
  });

  test("returns trimmed response text", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "  Fixed!  " } }] }) });
    const result = await callGitHubCopilot("ghp_t", "gpt-4o", "Fix:", "hello");
    expect(result).toBe("Fixed!");
  });

  test("throws with the API error message on non-ok response", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, statusText: "Unauthorized", json: async () => ({ error: { message: "Bad credentials" } }) });
    await expect(callGitHubCopilot("ghp_bad", "gpt-4o", "Fix:", "hello"))
      .rejects.toThrow("GitHub Models: Bad credentials");
  });

  test("falls back to statusText when error body has no message", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, statusText: "Forbidden", json: async () => ({}) });
    await expect(callGitHubCopilot("ghp_bad", "gpt-4o", "Fix:", "hello"))
      .rejects.toThrow("GitHub Models: Forbidden");
  });
});

// ── callAI router ─────────────────────────────────────────────────────────────

describe("callAI", () => {
  test("routes 'copilot' to the GitHub Copilot endpoint", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) });
    await callAI("copilot", { copilotKey: "ghp_x", copilotModel: "gpt-4o" }, "Fix:", "text");
    expect(global.fetch.mock.calls[0][0]).toBe("https://models.inference.ai.azure.com/chat/completions");
  });

  test("routes 'ollama' to the Ollama endpoint", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) });
    await callAI("ollama", { ollamaBaseUrl: "http://localhost:11434", ollamaModel: "llama3" }, "Fix:", "text");
    expect(global.fetch.mock.calls[0][0]).toContain("localhost:11434");
  });

  test("throws for unknown provider", async () => {
    await expect(callAI("unknown-ai", {}, "Fix:", "text"))
      .rejects.toThrow('Unknown provider "unknown-ai"');
  });
});
