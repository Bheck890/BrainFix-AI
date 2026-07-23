// AI provider API callers — depend only on the global fetch (browser or Node 18+)

async function callOpenAI(apiKey, model, prompt, text) {
  if (!apiKey) throw new Error("OpenAI API key not set. Open Settings.");
  _validateModel(model);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user",   content: text }
      ],
      temperature: 0.7
    })
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(`OpenAI: ${e.error?.message || res.statusText}`);
  }
  return (await res.json()).choices[0].message.content.trim();
}

async function callClaude(apiKey, model, prompt, text) {
  if (!apiKey) throw new Error("Claude API key not set. Open Settings.");
  _validateModel(model);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: prompt,
      messages: [{ role: "user", content: text }]
    })
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(`Claude: ${e.error?.message || res.statusText}`);
  }
  return (await res.json()).content[0].text.trim();
}

async function callGemini(apiKey, model, prompt, text) {
  if (!apiKey) throw new Error("Gemini API key not set. Open Settings.");
  _validateModel(model);
  const modelId = encodeURIComponent(model.replace(/^models\//, "")); // strip prefix, encode for URL safety
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${prompt}\n\n${text}` }] }],
        generationConfig: { temperature: 0.7 }
      })
    }
  );
  if (!res.ok) {
    const e = await res.json();
    throw new Error(`Gemini: ${e.error?.message || res.statusText}`);
  }
  return (await res.json()).candidates[0].content.parts[0].text.trim();
}

async function callGitHubCopilot(token, model, prompt, text) {
  if (!token) throw new Error("GitHub token not set. Open Settings.");
  _validateModel(model);
  const res = await fetch("https://models.inference.ai.azure.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user",   content: text }
      ],
      temperature: 0.7
    })
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(`GitHub Models: ${e.error?.message || res.statusText}`);
  }
  return (await res.json()).choices[0].message.content.trim();
}

// Blocks cloud-metadata SSRF targets. Localhost/RFC-1918 remain allowed for
// local AI providers (Ollama, LM Studio, Jan) — that is the intended use case.
const _BLOCKED_PROVIDER_HOSTS = /^(0\.0\.0\.0|169\.254\.\d+\.\d+|168\.63\.129\.16|metadata\.google\.internal|fe80:)$/i;

function _validateProviderUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error("Invalid provider URL."); }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new Error("Provider URL must use http or https.");
  if (_BLOCKED_PROVIDER_HOSTS.test(u.hostname))
    throw new Error(`Provider URL not allowed: ${u.hostname}`);
}

function _validateModel(model) {
  if (typeof model !== "string" || !/^[\w.:/-]{1,128}$/.test(model))
    throw new Error("Invalid model identifier.");
}

async function callOllama(baseUrl, model, prompt, text) {
  if (!model) throw new Error("Ollama: no model selected. Open Settings to pick a model.");
  _validateModel(model);
  const resolvedBase = (baseUrl || "http://localhost:11434").replace(/\/$/, "");
  _validateProviderUrl(resolvedBase);
  const url = `${resolvedBase}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user",   content: text }
      ],
      temperature: 0.7,
      stream: false
    })
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(`Ollama: ${e.error?.message || res.statusText}`);
  }
  return (await res.json()).choices[0].message.content.trim();
}

const _AI_API = "https://api.northpandalabs.com/v1/ai";
// injected at build time alongside the same key in lib/license.js
let _AI_SK = "%%REQUEST_SIGN_KEY%%";
if (typeof process !== "undefined" && process.env?.REQUEST_SIGN_KEY && _AI_SK[0] === "%")
  _AI_SK = process.env.REQUEST_SIGN_KEY;
if (_AI_SK[0] === "%" && typeof BUILD_FLAGS === "undefined")
  console.error("[build] _AI_SK placeholder was not replaced -- hosted AI requests will fail.");

async function _hostedFetch(body) {
  // Sign the request so the Cloudflare Worker can verify it came from this extension.
  // A per-request nonce is included so the worker can reject replayed signatures.
  if (_AI_SK[0] === "%") throw new Error("AI Application Assistance unavailable (build configuration error).");
  const nonce   = crypto.randomUUID();
  const signed  = { ...body, nonce };
  const ts      = Date.now().toString();
  const payload = ts + JSON.stringify(signed);
  const kb      = new Uint8Array((_AI_SK.match(/.{2}/g) ?? []).map(h => parseInt(h, 16)));
  const key     = await crypto.subtle.importKey("raw", kb, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const rawSig  = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const sig     = btoa(String.fromCharCode(...new Uint8Array(rawSig)));
  return fetch(_AI_API, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-timestamp": ts, "x-sig": sig },
    body:    JSON.stringify(signed),
  });
}

async function callHostedAI(a3yn9n, s8Ul, prompt, text) {
  if (!a3yn9n) throw new Error("AI Application Assistance: account email not set. Open Settings.");
  if (!s8Ul)   throw new Error("AI Application Assistance: subscription not activated. Open Settings.");
  const res  = await _hostedFetch({ email: a3yn9n, license_key: s8Ul, prompt, text });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) throw new Error(data.error || "License deactivated. Renew your subscription.");
  if (res.status === 503) throw new Error(data.error || "Cannot verify subscription. Check your connection.");
  if (!res.ok)            throw new Error(data.error || "AI Application Assistance unavailable. Try again.");
  return (data.result || "").trim();
}

async function callAI(provider, settings, prompt, text) {
  switch (provider) {
    case "openai": return callOpenAI(settings.openaiKey, settings.openaiModel || "gpt-4o-mini",              prompt, text);
    case "claude": return callClaude(settings.claudeKey, settings.claudeModel || "claude-haiku-4-5-20251001", prompt, text);
    case "gemini": return callGemini(settings.geminiKey, settings.geminiModel || "gemini-2.0-flash",           prompt, text);
    case "ollama":  return callOllama(settings.ollamaBaseUrl || "http://localhost:11434", settings.ollamaModel || "", prompt, text);
    case "copilot": return callGitHubCopilot(settings.copilotKey, settings.copilotModel || "gpt-4o", prompt, text);
    case "hosted":  return callHostedAI(settings.a3yn9n, settings.s8Ul, prompt, text);
    default: throw new Error(`Unknown provider "${provider}". Open Settings to choose one.`);
  }
}

// Returns true when the error is likely transient and the next provider/model should be tried.
function isRetriable(errMsg) {
  return /rate.?limi|429|503|overload|quota|unavailable|exhausted|temporar/i.test(errMsg || "");
}

const _PROVIDER_LABELS = { openai: "OpenAI", claude: "Claude", gemini: "Gemini", ollama: "Ollama", lmstudio: "LM Studio", jan: "Jan AI", copilot: "GitHub Copilot", hosted: "AI Application Assistance" };

// Builds a minimal configuredProviders list from the legacy flat storage keys.
// Used as a migration shim in callers that haven't run the full settings migration yet.
function _buildFromOldKeys(s) {
  const map = {
    openai: { apiKey: s.openaiKey, model: s.openaiModel || "gpt-4o-mini" },
    claude: { apiKey: s.claudeKey, model: s.claudeModel || "claude-haiku-4-5-20251001" },
    gemini: { apiKey: s.geminiKey, model: s.geminiModel || "gemini-2.0-flash" }
  };
  const active = s.provider || "openai";
  const order  = [active, ...["openai", "claude", "gemini"].filter(p => p !== active)];
  return order.filter(id => map[id]?.apiKey).map(id => ({ id, ...map[id] }));
}

// Priority-based dispatch across configuredProviders.
// Falls back to legacy flat keys when configuredProviders is absent (migration shim).
// Returns { result, usedProvider, usedModel }.
// basePrompt (optional): the prompt without the user profile prefix. When provided,
// fallback providers (index > 0) receive basePrompt instead of the full prompt so
// that personal profile data is sent only to the primary provider the user chose.
async function callAIWithFallback(configuredProviders, geminiModels, settings, prompt, text, { onStatusUpdate, basePrompt } = {}) {
  const providers = (Array.isArray(configuredProviders) && configuredProviders.length)
    ? configuredProviders
    : _buildFromOldKeys(settings || {});

  if (!providers.length) {
    throw new Error("No AI providers configured. Open Settings to add one.");
  }

  const notify = typeof onStatusUpdate === "function" ? onStatusUpdate : () => {};
  let lastError = null;

  for (let pi = 0; pi < providers.length; pi++) {
    const p = providers[pi];
    const label = _PROVIDER_LABELS[p.id] || p.id;
    const ep = (pi > 0 && basePrompt) ? basePrompt : prompt;

    if (p.id === "gemini") {
      const slots  = Array.isArray(geminiModels) ? geminiModels.filter(Boolean) : [];
      const models = slots.length ? slots : [p.model || "gemini-2.0-flash"];
      for (const model of models) {
        notify(`Trying ${label} (${model})…`);
        try {
          const result = await callGemini(p.apiKey, model, ep, text);
          return { result, usedProvider: "gemini", usedModel: model };
        } catch (err) {
          lastError = err;
          if (!isRetriable(err.message)) throw err;
        }
      }

    } else if (p.id === "openai") {
      const model = p.model || "gpt-4o-mini";
      notify(`Trying ${label}…`);
      try {
        const result = await callOpenAI(p.apiKey, model, ep, text);
        return { result, usedProvider: "openai", usedModel: model };
      } catch (err) {
        lastError = err;
        if (!isRetriable(err.message)) throw err;
      }

    } else if (p.id === "claude") {
      const model = p.model || "claude-haiku-4-5-20251001";
      notify(`Trying ${label}…`);
      try {
        const result = await callClaude(p.apiKey, model, ep, text);
        return { result, usedProvider: "claude", usedModel: model };
      } catch (err) {
        lastError = err;
        if (!isRetriable(err.message)) throw err;
      }

    } else if (p.id === "ollama") {
      const model   = p.model   || "";
      const baseUrl = p.baseUrl || "http://localhost:11434";
      notify(`Trying Ollama (${model || "default"})…`);
      try {
        const result = await callOllama(baseUrl, model, ep, text);
        return { result, usedProvider: "ollama", usedModel: model };
      } catch (err) {
        lastError = err;
        if (!isRetriable(err.message)) throw err;
      }

    } else if (p.id === "lmstudio") {
      const model   = p.model   || "";
      const baseUrl = p.baseUrl || "http://localhost:1234";
      notify(`Trying LM Studio (${model || "default"})…`);
      try {
        const result = await callOllama(baseUrl, model, ep, text);
        return { result, usedProvider: "lmstudio", usedModel: model };
      } catch (err) {
        lastError = err;
        if (!isRetriable(err.message)) throw err;
      }

    } else if (p.id === "jan") {
      const model   = p.model   || "";
      const baseUrl = p.baseUrl || "http://localhost:1337";
      notify(`Trying Jan AI (${model || "default"})…`);
      try {
        const result = await callOllama(baseUrl, model, ep, text);
        return { result, usedProvider: "jan", usedModel: model };
      } catch (err) {
        lastError = err;
        if (!isRetriable(err.message)) throw err;
      }

    } else if (p.id === "copilot") {
      const model = p.model || "gpt-4o";
      notify(`Trying GitHub Copilot (${model})…`);
      try {
        const result = await callGitHubCopilot(p.apiKey, model, ep, text);
        return { result, usedProvider: "copilot", usedModel: model };
      } catch (err) {
        lastError = err;
        if (!isRetriable(err.message)) throw err;
      }

    } else if (p.id === "hosted") {
      notify(`Trying AI Application Assistance…`);
      try {
        const result = await callHostedAI(p.a3yn9n, p.apiKey, ep, text);
        return { result, usedProvider: "hosted", usedModel: "hosted" };
      } catch (err) {
        lastError = err;
        if (!isRetriable(err.message)) throw err;
      }
    }
  }

  throw lastError || new Error("All providers exhausted. Check your API keys.");
}

if (typeof module !== "undefined") {
  module.exports = { callOpenAI, callClaude, callGemini, callOllama, callGitHubCopilot, callHostedAI, callAI, callAIWithFallback, isRetriable, _validateProviderUrl };
}
