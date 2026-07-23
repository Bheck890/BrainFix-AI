// Model list fetchers, testers, and cost-tier helper for each AI provider
// Used by the options page to populate model dropdowns

// Returns "$" (low), "$$" (medium), or "$$$" (high) for a given model ID.
// Pattern-matched so it survives new model releases without a code change.
function costTier(modelId) {
  const id = modelId.toLowerCase();
  if (/haiku|flash(-lite)?$|gpt-4o-mini|o[34]-mini|gemini-2\.0-flash/.test(id)) return "$";
  if (/opus|o1(?!-mini)|o3(?!-mini)|o4(?!-mini)|gpt-4-(?!turbo)|gpt-4\.5/.test(id))  return "$$$";
  return "$$"; // sonnet, gpt-4o, o1-mini, 1.5-pro, etc.
}

async function fetchOpenAIModels(apiKey) {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { "Authorization": `Bearer ${apiKey}` }
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || res.statusText); }
  const data = await res.json();
  return data.data
    .filter(m => /^(gpt-|o\d|chatgpt)/.test(m.id) &&
                 !/(audio|realtime|instruct|search|tts|whisper|dall|embed|vision-preview)/.test(m.id))
    .sort((a, b) => b.created - a.created)
    .map(m => ({ id: m.id, label: m.id }));
}

async function fetchClaudeModels(apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    }
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || res.statusText); }
  const data = await res.json();
  return (data.data || []).map(m => ({ id: m.id, label: m.display_name || m.id }));
}

async function fetchGeminiModels(apiKey) {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models",
    { headers: { "x-goog-api-key": apiKey } }
  );
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || res.statusText); }
  const data = await res.json();
  return (data.models || [])
    .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
    .map(m => ({
      id:    m.name.replace(/^models\//, ""),
      label: m.displayName || m.name.replace(/^models\//, "")
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function testOpenAI(apiKey, modelId) {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "This is a test" }], max_tokens: 5 })
    });
    return res.ok;
  } catch { return false; }
}

async function testClaude(apiKey, modelId) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({ model: modelId, max_tokens: 5, messages: [{ role: "user", content: "This is a test" }] })
    });
    return res.ok;
  } catch { return false; }
}

async function testGemini(apiKey, modelId) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "This is a test" }] }],
          generationConfig: { maxOutputTokens: 5 }
        })
      }
    );
    return res.ok;
  } catch { return false; }
}

async function fetchGitHubCopilotModels(token) {
  try {
    const res = await fetch("https://models.inference.ai.azure.com/models", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      const models = (data.data || data.models || [])
        .filter(m => !m.id || !/(embedding|image|audio|tts|whisper|dall)/i.test(m.id))
        .map(m => ({ id: m.id, label: m.name || m.display_name || m.id }));
      if (models.length) return models;
    }
  } catch {}
  return [
    { id: "gpt-4o",                          label: "GPT-4o" },
    { id: "gpt-4o-mini",                     label: "GPT-4o Mini" },
    { id: "claude-3-5-sonnet-20241022",      label: "Claude 3.5 Sonnet" },
    { id: "Meta-Llama-3.3-70B-Instruct",     label: "Llama 3.3 70B" },
    { id: "Mistral-large-2411",              label: "Mistral Large" }
  ];
}

async function testGitHubCopilot(token, modelId) {
  try {
    const res = await fetch("https://models.inference.ai.azure.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5
      })
    });
    return res.ok;
  } catch { return false; }
}

// ── Local AI providers (Ollama, LM Studio, Jan AI) ───────────────────────────

async function fetchOllamaModels(baseUrl) {
  const resolved = (baseUrl || "http://localhost:11434").replace(/\/$/, "");
  const url = `${resolved}/api/tags`;
  let res;
  try { res = await fetch(url); } catch {
    const isLocal = /localhost|127\.0\.0\.1/.test(resolved);
    throw new Error(isLocal
      ? "Cannot reach Ollama. Is it running? Try: ollama serve"
      : `Cannot reach Ollama at ${resolved}. Set OLLAMA_HOST=0.0.0.0 on the remote machine and ensure the port is reachable.`);
  }
  if (!res.ok) throw new Error(`Ollama /api/tags returned ${res.status}. Is Ollama running?`);
  const data = await res.json();
  if (!(data.models || []).length) throw new Error("No models found. Run `ollama pull <model>` first.");
  return (data.models || []).map(m => ({ id: m.name, label: m.name }));
}

async function fetchLocalOpenAIModels(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, "")}/v1/models`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Server returned ${res.status}. Is it running?`);
  const data = await res.json();
  const models = (data.data || []).map(m => ({ id: m.id, label: m.id }));
  if (!models.length) throw new Error("No models found. Load a model first.");
  return models;
}

// ── Model list cache helpers ──────────────────────────────────────────────────

const MODEL_CACHE_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isModelCacheStale(fetchedAt) {
  if (!fetchedAt) return true;
  return (Date.now() - fetchedAt) > MODEL_CACHE_STALE_MS;
}

function formatCacheAge(fetchedAt) {
  if (!fetchedAt) return null;
  const diff = Date.now() - fetchedAt;
  if (diff < 60_000)     return "just now";
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

if (typeof module !== "undefined") {
  module.exports = {
    fetchOpenAIModels, fetchClaudeModels, fetchGeminiModels, fetchGitHubCopilotModels,
    testOpenAI, testClaude, testGemini, testGitHubCopilot,
    costTier,
    isModelCacheStale, formatCacheAge, MODEL_CACHE_STALE_MS
  };
}
