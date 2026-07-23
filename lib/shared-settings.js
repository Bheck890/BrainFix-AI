// Shared settings logic — extension + desktop
// Requires: window.appGet, window.appSet, window.appRemove, window.platformOpenURL
// Optional: window.applyProGateExtras(isPro), window.onProvidersSaved(), window.onProActivated(), window.proActiveBtnText

const GUMROAD_URL        = "https://northpandalabs.gumroad.com/l/thought-tidy";
const PRO_ACTION_IDS     = new Set(["sound-like-me", "sound-human", "formal", "casual", "shorten", "expand"]);

const BACKUP_SETTINGS_KEYS = new Set([
  "configuredProviders", "geminiModels",
  "provider", "openaiKey", "claudeKey", "geminiKey",
  "openaiModel", "claudeModel", "geminiModel",
  "variants", "customPrompts", "actionSettings",
  "profileName", "profileRole", "profileStyle", "profileContext", "profileEnabled", "profileVocab",
  "contextPresets", "contextEnabled", "audienceLevel", "grammarFilters",
  "a3yn9n", "s8Ul",
]);
const PRO_BADGE_GRADIENT = "linear-gradient(135deg, #7c3aed, #4f46e5)";
const DEFAULT_AUDIENCE_PRESETS = [
  { name: "Casual Reader",    text: "Write for a casual reader. Use friendly, everyday language — simple, clear, and conversational. Avoid jargon." },
  { name: "Professional",     text: "Write for a professional audience. Use polished, industry-standard language and an authoritative tone." },
  { name: "Technical Expert", text: "Write for a technical expert. Be precise and concise — skip basic explanations and use specialized terminology freely." },
];

const FETCHERS = { openai: fetchOpenAIModels, claude: fetchClaudeModels, gemini: fetchGeminiModels, copilot: fetchGitHubCopilotModels };
const TESTERS  = { openai: testOpenAI,        claude: testClaude,        gemini: testGemini,        copilot: testGitHubCopilot };
const PROVIDER_INFO = {
  openai:   { name: "ChatGPT (OpenAI)",   sub: "GPT, GPT Thinking…",        keyPlaceholder: "sk-…",    keyUrl: "https://platform.openai.com/api-keys" },
  claude:   { name: "Claude (Anthropic)", sub: "Haiku, Sonnet, Opus…",      keyPlaceholder: "sk-ant-…",keyUrl: "https://platform.claude.com/settings/keys" },
  gemini:   { name: "Gemini (Google)",    sub: "Flash, Pro, Ultra…",         keyPlaceholder: "AIza…",   keyUrl: "https://aistudio.google.com/app/apikey" },
  ollama:   { name: "Ollama (Local AI)",  sub: "Llama, Mistral, Phi…",       keyPlaceholder: "",         keyUrl: "", defaultUrl: "http://localhost:11434", local: true },
  lmstudio: { name: "LM Studio",          sub: "Local AI · OpenAI-compat",   keyPlaceholder: "",         keyUrl: "", defaultUrl: "http://localhost:1234",  local: true },
  jan:      { name: "Jan AI",             sub: "Local AI · OpenAI-compat",   keyPlaceholder: "",         keyUrl: "", defaultUrl: "http://localhost:1337",  local: true },
  copilot:  { name: "GitHub Models",      sub: "GPT-4o, Claude, Llama…",     keyPlaceholder: "ghp_…",   keyUrl: "https://github.com/settings/tokens" },
  hosted:   { name: "AI Application Assistance", sub: "Hosted AI · No API key needed", keyPlaceholder: "XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX", keyUrl: "https://northpandalabs.gumroad.com/l/AIAA", hosted: true }
};
const _LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "jan"]);

let configuredProviders = [];
let geminiModels        = [null, null, null];
let wizardProvider      = null;
let actionSettings      = [];
let customPrompts       = [];
let contextPresets      = [];
let currentIsPro        = false;

// ── State initializer and getters ─────────────────────────────────────────────

function initSharedSettings(s) {
  configuredProviders = s.configuredProviders || [];
  geminiModels        = s.geminiModels        || [null, null, null];
  actionSettings      = resolveActionSettings(s.actionSettings || []);
  customPrompts       = s.customPrompts       || [];
  contextPresets      = s.contextPresets      || [];
}
function getSharedActionSettings() { return actionSettings.map(a => ({ ...a, label: sanitizeText(a.label) })); }
function getSharedCustomPrompts()  { return customPrompts; }
function getSharedContextPresets() { return contextPresets; }

// ── Gumroad ───────────────────────────────────────────────────────────────────

function openGumroad() {
  window.platformOpenURL(GUMROAD_URL);
}

// ── Generic model fetch + select populate ─────────────────────────────────────

async function fetchAndPopulate(providerId, apiKey, { statusEl, selectEls, refreshBtn, currentValues = [] } = {}) {
  if (!apiKey) {
    if (statusEl) { statusEl.textContent = "Enter an API key first."; statusEl.className = "fetch-status status-error"; }
    return null;
  }
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = "Fetching…"; }
  if (statusEl)   { statusEl.textContent = "Fetching models…"; statusEl.className = "fetch-status status-loading"; }
  try {
    const allModels = await FETCHERS[providerId](apiKey);
    if (!allModels.length) throw new Error("No compatible models returned.");
    if (statusEl) statusEl.textContent = `Testing ${allModels.length} models…`;
    const results = await Promise.all(allModels.map(async m => (await TESTERS[providerId](apiKey, m.id)) ? m : null));
    const working = results.filter(Boolean);
    if (!working.length) throw new Error("No models responded. Check your API key.");
    const sels = Array.isArray(selectEls) ? selectEls : (selectEls ? [selectEls] : []);
    sels.forEach((sel, i) => {
      if (!sel) return;
      sel.innerHTML = "";
      if (i > 0) {
        const blank = document.createElement("option");
        blank.value = ""; blank.textContent = "— none —";
        sel.appendChild(blank);
      }
      working.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.id; opt.textContent = `${m.label}  ${costTier(m.id)}`;
        sel.appendChild(opt);
      });
      const wanted = currentValues[i];
      sel.value    = (wanted && working.find(m => m.id === wanted)) ? wanted : (i === 0 ? working[0].id : "");
      sel.disabled = false;
    });
    const skipped = allModels.length - working.length;
    if (statusEl) {
      statusEl.textContent = skipped > 0 ? `${working.length}/${allModels.length} models verified` : `${working.length} models verified ✓`;
      statusEl.className = "fetch-status status-ok";
    }
    return working;
  } catch (err) {
    if (statusEl) { statusEl.textContent = `Error: ${err.message}`; statusEl.className = "fetch-status status-error"; }
    return null;
  } finally {
    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = "↻ Refresh"; }
  }
}

// ── Card rendering ─────────────────────────────────────────────────────────────

function renderProviderCards() {
  const container   = document.getElementById("provider-cards");
  const noState     = document.getElementById("no-providers-state");
  const addBtn      = document.getElementById("add-provider-btn");
  if (!container) return;
  container.innerHTML = "";

  if (!configuredProviders.length) {
    if (noState) noState.style.display = "block";
    if (addBtn) addBtn.style.display = "inline-block";
    return;
  }
  if (noState) noState.style.display = "none";
  if (addBtn) addBtn.style.display = configuredProviders.length < Object.keys(PROVIDER_INFO).length ? "inline-block" : "none";

  configuredProviders.forEach((p, idx) => {
    container.appendChild(buildCard(p, idx));
  });
}

function buildCard(p, idx) {
  const info = PROVIDER_INFO[p.id] || { name: p.id, sub: "", keyPlaceholder: "", keyUrl: "#" };
  const isLast = idx === configuredProviders.length - 1;

  const card = document.createElement("div");
  card.className  = "provider-card";
  card.dataset.idx = idx;

  // ── Header ──────────────────────────────────────────────────────────────────
  const pcHeader = document.createElement("div");
  pcHeader.className = "pc-header";

  const pcInfo = document.createElement("div");
  pcInfo.className = "pc-info";

  const pcPriority = document.createElement("span");
  pcPriority.className = "pc-priority";
  pcPriority.textContent = idx + 1;

  const pcNames = document.createElement("div");
  pcNames.className = "pc-names";
  const pcNameSp = document.createElement("span");
  pcNameSp.className = "pc-name";
  pcNameSp.textContent = info.name;
  pcNames.appendChild(pcNameSp);

  // Model display (read-only summary on card face)
  if (p.id === "gemini") {
    const slots = geminiModels.filter(Boolean);
    if (slots.length) {
      const labels = ["Primary", "Secondary", "Tertiary"];
      const modelList = document.createElement("div");
      modelList.className = "pc-model-list";
      slots.forEach((m, i) => {
        const slotSp = document.createElement("span");
        slotSp.className = "pc-model-slot";
        const lblSp = document.createElement("span");
        lblSp.className = "pc-slot-label";
        lblSp.textContent = labels[i];
        slotSp.appendChild(lblSp);
        slotSp.appendChild(document.createTextNode(m));
        modelList.appendChild(slotSp);
      });
      pcNames.appendChild(modelList);
    } else {
      const none = document.createElement("span");
      none.className = "pc-model-none";
      none.textContent = "No models — click Edit to set";
      pcNames.appendChild(none);
    }
  } else if (_LOCAL_PROVIDERS.has(p.id)) {
    const info2 = PROVIDER_INFO[p.id];
    const baseUrlShort = (p.baseUrl || info2?.defaultUrl || "localhost").replace(/^https?:\/\//, "");
    const modelSp = document.createElement("span");
    modelSp.className = "pc-model";
    modelSp.textContent = (p.model || "(no model)") + " · ";
    const small = document.createElement("small");
    small.textContent = baseUrlShort;
    modelSp.appendChild(small);
    pcNames.appendChild(modelSp);
  } else {
    const modelSp = document.createElement("span");
    modelSp.className = "pc-model";
    modelSp.textContent = p.model || "(default)";
    pcNames.appendChild(modelSp);
  }

  pcInfo.append(pcPriority, pcNames);

  const pcControls = document.createElement("div");
  pcControls.className = "pc-controls";
  if (idx > 0) {
    const up = document.createElement("button");
    up.className = "pc-btn pc-up"; up.dataset.idx = idx; up.title = "Move up"; up.textContent = "↑";
    pcControls.appendChild(up);
  }
  if (!isLast) {
    const dn = document.createElement("button");
    dn.className = "pc-btn pc-down"; dn.dataset.idx = idx; dn.title = "Move down"; dn.textContent = "↓";
    pcControls.appendChild(dn);
  }
  const pcEditBtn = document.createElement("button");
  pcEditBtn.className = "pc-btn pc-edit-btn"; pcEditBtn.dataset.idx = idx; pcEditBtn.textContent = "Edit";
  pcControls.appendChild(pcEditBtn);

  pcHeader.append(pcInfo, pcControls);
  card.appendChild(pcHeader);

  // ── Edit panel ───────────────────────────────────────────────────────────────
  const editPanel = document.createElement("div");
  editPanel.className = "pc-edit-panel";
  editPanel.style.display = "none";

  // Key / URL field
  if (_LOCAL_PROVIDERS.has(p.id)) {
    const localInfo = PROVIDER_INFO[p.id];
    const field = document.createElement("div"); field.className = "field";
    const lbl = document.createElement("label"); lbl.textContent = `${localInfo.name} Base URL`;
    const urlInput = document.createElement("input");
    urlInput.type = "text"; urlInput.className = "pc-ollama-url-input";
    urlInput.value = p.baseUrl || localInfo.defaultUrl;
    urlInput.placeholder = localInfo.defaultUrl; urlInput.autocomplete = "off"; urlInput.maxLength = 512;
    const hint = document.createElement("p"); hint.className = "hint"; hint.style.marginTop = "4px";
    hint.textContent = `Default: ${localInfo.defaultUrl}`;
    field.append(lbl, urlInput, hint);
    editPanel.appendChild(field);
  } else {
    const field = document.createElement("div"); field.className = "field";
    const lbl = document.createElement("label"); lbl.textContent = "API Key ";
    const link = document.createElement("a");
    link.className = "api-link pc-key-link"; link.href = info.keyUrl;
    link.rel = "noopener"; link.textContent = "Get key ↗";
    link.addEventListener("click", (e) => { e.preventDefault(); window.platformOpenURL(info.keyUrl); });
    lbl.appendChild(link);
    const keyRow = document.createElement("div"); keyRow.className = "key-row";
    const keyInput = document.createElement("input");
    keyInput.type = "password"; keyInput.className = "pc-key-input";
    keyInput.autocomplete = "off"; keyInput.placeholder = info.keyPlaceholder; keyInput.maxLength = 512;
    const showBtn = document.createElement("button");
    showBtn.className = "show-btn pc-show-btn"; showBtn.textContent = "Show";
    const testBtn = document.createElement("button");
    testBtn.className = "pc-btn pc-test-btn"; testBtn.textContent = "Test & Load Models";
    keyRow.append(keyInput, showBtn, testBtn);
    const keyStatus = document.createElement("div"); keyStatus.className = "fetch-status pc-key-status";
    field.append(lbl, keyRow, keyStatus);
    editPanel.appendChild(field);
  }

  // Model edit field
  if (p.id === "gemini") {
    const priorityField = document.createElement("div");
    priorityField.className = "field"; priorityField.style.marginBottom = "6px";
    const priorityLbl = document.createElement("label"); priorityLbl.textContent = "Model Priority ";
    const modelStatus = document.createElement("span"); modelStatus.className = "fetch-status pc-model-status";
    priorityLbl.appendChild(modelStatus);
    const refreshBtn = document.createElement("button");
    refreshBtn.className = "pc-btn pc-refresh-btn"; refreshBtn.style.marginTop = "6px";
    refreshBtn.textContent = "↻ Refresh Model Lists";
    priorityField.append(priorityLbl, refreshBtn);
    editPanel.appendChild(priorityField);
    ["Primary", "Secondary", "Tertiary"].forEach((label, i) => {
      const slotField = document.createElement("div"); slotField.className = "field";
      const slotLbl = document.createElement("label"); slotLbl.textContent = label + " Model";
      if (i > 0) {
        const optHint = document.createElement("span"); optHint.className = "hint"; optHint.textContent = " (optional)";
        slotLbl.appendChild(optHint);
      }
      const selectRow = document.createElement("div"); selectRow.className = "model-select-row";
      const sel = document.createElement("select");
      sel.className = "pc-gemini-slot-select"; sel.dataset.slot = i; sel.disabled = true;
      const opt = document.createElement("option"); opt.value = "";
      opt.textContent = geminiModels[i] || "— click Refresh —";
      sel.appendChild(opt);
      selectRow.appendChild(sel);
      slotField.append(slotLbl, selectRow);
      editPanel.appendChild(slotField);
    });
  } else {
    const field = document.createElement("div"); field.className = "field";
    const lbl = document.createElement("label"); lbl.textContent = "Model ";
    const modelStatus = document.createElement("span"); modelStatus.className = "fetch-status pc-model-status";
    lbl.appendChild(modelStatus);
    const selectRow = document.createElement("div"); selectRow.className = "model-select-row";
    const sel = document.createElement("select"); sel.className = "pc-model-select"; sel.disabled = true;
    const opt = document.createElement("option"); opt.value = "";
    opt.textContent = p.model || "— click Refresh to load models —";
    sel.appendChild(opt);
    const refreshBtn = document.createElement("button");
    refreshBtn.className = "pc-btn pc-refresh-btn"; refreshBtn.textContent = "↻ Refresh";
    selectRow.append(sel, refreshBtn);
    field.append(lbl, selectRow);
    editPanel.appendChild(field);
  }

  // Edit actions row
  const editActions = document.createElement("div"); editActions.className = "pc-edit-actions";
  const removeBtn = document.createElement("button");
  removeBtn.className = "pc-btn pc-remove-btn"; removeBtn.textContent = "Remove";
  const btnGroup = document.createElement("div"); btnGroup.style.cssText = "display:flex;gap:8px";
  const cancelEditBtn = document.createElement("button");
  cancelEditBtn.className = "pc-btn pc-cancel-edit-btn"; cancelEditBtn.textContent = "Cancel";
  const saveEditBtn = document.createElement("button");
  saveEditBtn.className = "pc-btn btn-primary pc-save-edit-btn"; saveEditBtn.textContent = "Save";
  btnGroup.append(cancelEditBtn, saveEditBtn);
  editActions.append(removeBtn, btnGroup);
  editPanel.appendChild(editActions);

  card.appendChild(editPanel);

  // Key value + show/hide + test (cloud providers only)
  if (!_LOCAL_PROVIDERS.has(p.id)) {
    card.querySelector(".pc-key-input").value = p.apiKey;
    const showBtn  = card.querySelector(".pc-show-btn");
    const keyInput = card.querySelector(".pc-key-input");
    showBtn.addEventListener("click", () => {
      keyInput.type       = keyInput.type === "password" ? "text" : "password";
      showBtn.textContent = keyInput.type === "password" ? "Show" : "Hide";
    });
    card.querySelector(".pc-test-btn").addEventListener("click", async () => {
      const key      = keyInput.value.trim();
      const statusEl = card.querySelector(".pc-key-status");
      const modelSt  = card.querySelector(".pc-model-status");
      if (!key) { statusEl.textContent = "Enter an API key first."; statusEl.className = "fetch-status status-error"; return; }
      if (p.id === "gemini") {
        const sels    = [...card.querySelectorAll(".pc-gemini-slot-select")];
        const curVals = geminiModels.map(m => m || "");
        await fetchAndPopulate("gemini", key, { statusEl: modelSt, selectEls: sels, currentValues: curVals });
        statusEl.textContent = ""; statusEl.className = "fetch-status";
      } else {
        await fetchAndPopulate(p.id, key, { statusEl: modelSt, selectEls: [card.querySelector(".pc-model-select")], currentValues: [p.model || ""] });
      }
    });
  }

  // Refresh button
  card.querySelector(".pc-refresh-btn")?.addEventListener("click", async () => {
    if (_LOCAL_PROVIDERS.has(p.id)) {
      const localInfo = PROVIDER_INFO[p.id];
      const baseUrl  = card.querySelector(".pc-ollama-url-input").value.trim() || localInfo.defaultUrl;
      const statusEl = card.querySelector(".pc-model-status");
      const sel      = card.querySelector(".pc-model-select");
      const btn      = card.querySelector(".pc-refresh-btn");
      if (btn) { btn.disabled = true; btn.textContent = "Fetching…"; }
      if (statusEl) { statusEl.textContent = "Fetching models…"; statusEl.className = "fetch-status status-loading"; }
      try {
        const models = p.id === "ollama"
          ? await fetchOllamaModels(baseUrl)
          : await fetchLocalOpenAIModels(baseUrl);
        if (sel) {
          sel.innerHTML = "";
          models.forEach(m => { const opt = document.createElement("option"); opt.value = m.id; opt.textContent = m.label; sel.appendChild(opt); });
          sel.value    = (p.model && models.find(m => m.id === p.model)) ? p.model : (models[0]?.id || "");
          sel.disabled = false;
        }
        if (statusEl) { statusEl.textContent = `${models.length} model${models.length === 1 ? "" : "s"} found ✓`; statusEl.className = "fetch-status status-ok"; }
      } catch (err) {
        if (statusEl) { statusEl.textContent = `Error: ${err.message}`; statusEl.className = "fetch-status status-error"; }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "↻ Refresh"; }
      }
      return;
    }
    const key = card.querySelector(".pc-key-input").value.trim();
    if (p.id === "gemini") {
      const sels = [...card.querySelectorAll(".pc-gemini-slot-select")];
      await fetchAndPopulate("gemini", key, { statusEl: card.querySelector(".pc-model-status"), refreshBtn: card.querySelector(".pc-refresh-btn"), selectEls: sels, currentValues: geminiModels.map(m => m || "") });
    } else {
      await fetchAndPopulate(p.id, key, { statusEl: card.querySelector(".pc-model-status"), refreshBtn: card.querySelector(".pc-refresh-btn"), selectEls: [card.querySelector(".pc-model-select")], currentValues: [p.model || ""] });
    }
  });

  // Priority arrows
  card.querySelector(".pc-up")?.addEventListener("click", () => moveProvider(idx, -1));
  card.querySelector(".pc-down")?.addEventListener("click", () => moveProvider(idx, 1));

  // Edit / cancel / save / remove
  card.querySelector(".pc-edit-btn").addEventListener("click", () => {
    document.querySelectorAll(".pc-edit-panel").forEach(ep => ep.style.display = "none");
    card.querySelector(".pc-edit-panel").style.display = "block";
  });
  card.querySelector(".pc-cancel-edit-btn").addEventListener("click", () => {
    renderProviderCards();
  });
  card.querySelector(".pc-save-edit-btn").addEventListener("click", () => saveCardEdit(card, idx, p));
  card.querySelector(".pc-remove-btn").addEventListener("click", () => confirmRemoveProvider(idx));

  return card;
}

async function saveCardEdit(card, idx, provider) {
  if (_LOCAL_PROVIDERS.has(provider.id)) {
    const localInfo = PROVIDER_INFO[provider.id];
    const newUrl   = sanitizeText(card.querySelector(".pc-ollama-url-input")?.value ?? "") || localInfo.defaultUrl;
    const sel      = card.querySelector(".pc-model-select");
    const newModel = (sel && !sel.disabled && sel.value) ? sel.value : provider.model;
    configuredProviders[idx] = { ...provider, baseUrl: newUrl, model: newModel };
    await saveProviders();
    renderProviderCards();
    return;
  }

  const newKey = sanitizeText(card.querySelector(".pc-key-input").value);
  if (!newKey) {
    const st = card.querySelector(".pc-key-status");
    st.textContent = "API key is required."; st.className = "fetch-status status-error";
    return;
  }
  configuredProviders[idx] = { ...provider, apiKey: newKey };

  if (provider.id === "gemini") {
    const slots     = [...card.querySelectorAll(".pc-gemini-slot-select")];
    const refreshed = slots.some(s => !s.disabled);
    if (refreshed) {
      geminiModels = slots.map(s => s.value || null);
      configuredProviders[idx].model = geminiModels[0] || "";
    }
    // else: no refresh was run — keep existing geminiModels and model unchanged
  } else {
    const sel = card.querySelector(".pc-model-select");
    if (sel && !sel.disabled && sel.value) configuredProviders[idx].model = sel.value;
    // else: no refresh was run — keep existing model unchanged
  }
  await saveProviders();
  renderProviderCards();
}

function confirmRemoveProvider(idx) {
  const info = PROVIDER_INFO[configuredProviders[idx].id] || { name: configuredProviders[idx].id };
  if (!confirm(`Remove ${info.name}? Your API key for this provider will be deleted.`)) return;
  configuredProviders.splice(idx, 1);
  if (!configuredProviders.find(p => p.id === "gemini")) geminiModels = [null, null, null];
  saveProviders().then(() => renderProviderCards());
}

function moveProvider(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= configuredProviders.length) return;
  [configuredProviders[idx], configuredProviders[newIdx]] = [configuredProviders[newIdx], configuredProviders[idx]];
  saveProviders().then(() => renderProviderCards());
}

async function saveProviders() {
  await window.appSet({ configuredProviders, geminiModels });
  if (typeof window.onProvidersSaved === "function") window.onProvidersSaved();
}

// ── Wizard ─────────────────────────────────────────────────────────────────────

function showWizard() {
  wizardProvider = null;
  const wiz = document.getElementById("provider-wizard");
  if (!wiz) return;
  wiz.style.display = "block";
  const step1 = document.getElementById("wizard-step-1");
  const step2 = document.getElementById("wizard-step-2");
  const addBtn = document.getElementById("add-provider-btn");
  if (step1) step1.style.display = "block";
  if (step2) step2.style.display = "none";
  if (addBtn) addBtn.style.display = "none";

  // Disable provider buttons that are already configured or Pro-gated
  document.querySelectorAll(".wizard-provider-btn").forEach(btn => {
    const alreadyAdded = configuredProviders.some(p => p.id === btn.dataset.provider);
    const proGated     = !currentIsPro && _LOCAL_PROVIDERS.has(btn.dataset.provider);
    btn.disabled = alreadyAdded || proGated;
    const sub = btn.querySelector(".wp-sub");
    if (sub) {
      if (alreadyAdded) {
        sub.textContent = "Already configured — Edit on card";
      } else if (proGated) {
        sub.textContent = "Pro feature — upgrade to use local AI";
      } else {
        const info = PROVIDER_INFO[btn.dataset.provider];
        if (info) sub.textContent = info.sub;
      }
    }
  });

  clearWizardStep2();
}

function hideWizard() {
  const wiz    = document.getElementById("provider-wizard");
  const addBtn = document.getElementById("add-provider-btn");
  if (wiz) wiz.style.display = "none";
  if (addBtn) addBtn.style.display = "inline-block";
  wizardProvider = null;
}

function clearWizardStep2() {
  document.getElementById("wizard-api-key").value        = "";
  document.getElementById("wizard-key-status").textContent  = "";
  document.getElementById("wizard-model-status").textContent = "";
  const sel = document.getElementById("wizard-model-select");
  sel.innerHTML = "<option value=''>— test your key above to load models —</option>";
  sel.disabled  = true;
  const g2 = document.getElementById("wizard-gemini-model-2");
  const g3 = document.getElementById("wizard-gemini-model-3");
  if (g2) { g2.innerHTML = "<option value=''>— none —</option>"; g2.disabled = true; }
  if (g3) { g3.innerHTML = "<option value=''>— none —</option>"; g3.disabled = true; }
  const ollamaUrl = document.getElementById("wizard-ollama-url");
  if (ollamaUrl) ollamaUrl.value = "http://localhost:11434";
}

function showWizardStep2(providerId) {
  wizardProvider = providerId;
  const info     = PROVIDER_INFO[providerId];
  const isLocal  = _LOCAL_PROVIDERS.has(providerId);

  document.getElementById("wizard-provider-title").textContent          = info.name;
  document.getElementById("wizard-api-key").placeholder                 = info.keyPlaceholder;
  const _keyLink = document.getElementById("wizard-key-link");
  _keyLink.href    = info.keyUrl;
  _keyLink.onclick = isLocal ? null : (e) => { e.preventDefault(); window.platformOpenURL(info.keyUrl); };
  document.getElementById("wizard-api-key-row").style.display           = isLocal ? "none" : "";
  document.getElementById("wizard-gemini-extra").style.display          = providerId === "gemini" ? "block" : "none";
  const localExtra = document.getElementById("wizard-ollama-extra");
  if (localExtra) {
    localExtra.style.display = isLocal ? "block" : "none";
    if (isLocal) {
      const urlInput = document.getElementById("wizard-ollama-url");
      if (urlInput) { urlInput.value = info.defaultUrl; urlInput.placeholder = info.defaultUrl; }
      const hint = localExtra.querySelector("p.hint, small, .hint");
      if (hint) hint.textContent = `Default: ${info.defaultUrl}`;
    }
  }
  document.getElementById("wizard-test-btn").textContent                = isLocal ? "Fetch Models" : "Test & Load Models";
  document.getElementById("wizard-key-status").textContent              = "";

  const guideBtn = document.getElementById("wizard-guide-btn");
  if (guideBtn) {
    guideBtn.style.display = isLocal ? "none" : "";
    guideBtn.onclick = () => {
      if (typeof btcAPI !== "undefined" && typeof btcAPI.openGuide === "function") {
        btcAPI.openGuide(providerId);
      } else if (typeof browser !== "undefined" && typeof browser.tabs !== "undefined") {
        browser.tabs.create({ url: browser.runtime.getURL(`popup/guide.html#${providerId}`) });
      }
    };
  }

  document.getElementById("wizard-step-1").style.display = "none";
  document.getElementById("wizard-step-2").style.display = "block";
  if (isLocal) document.getElementById("wizard-ollama-url")?.focus();
  else         document.getElementById("wizard-api-key").focus();
}

async function wizardTestAndLoad() {
  if (!wizardProvider) return;

  // Local providers: fetch models directly — no API key needed
  if (_LOCAL_PROVIDERS.has(wizardProvider)) {
    const localInfo = PROVIDER_INFO[wizardProvider];
    const baseUrl  = (document.getElementById("wizard-ollama-url")?.value || "").trim() || localInfo.defaultUrl;
    const statusEl = document.getElementById("wizard-key-status");
    const modelSt  = document.getElementById("wizard-model-status");
    const sel      = document.getElementById("wizard-model-select");

    // Platform shell may define requestOriginPermission for non-localhost URLs
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(baseUrl);
    if (!isLocal) {
      if (typeof window.requestOriginPermission === "function") {
        const granted = await window.requestOriginPermission(baseUrl);
        if (!granted) {
          statusEl.textContent = "Permission denied. Browser blocked access to " + baseUrl;
          statusEl.className   = "fetch-status status-error";
          return;
        }
      }
    }

    modelSt.textContent = "Fetching models…"; modelSt.className = "fetch-status status-loading";
    statusEl.textContent = ""; statusEl.className = "fetch-status";
    try {
      const models = wizardProvider === "ollama"
        ? await fetchOllamaModels(baseUrl)
        : await fetchLocalOpenAIModels(baseUrl);
      sel.innerHTML = "";
      models.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.id; opt.textContent = m.label;
        sel.appendChild(opt);
      });
      sel.disabled        = false;
      modelSt.textContent = `${models.length} model${models.length === 1 ? "" : "s"} found ✓`;
      modelSt.className   = "fetch-status status-ok";
      statusEl.textContent = "Ready ✓"; statusEl.className = "fetch-status status-ok";
    } catch (err) {
      modelSt.textContent = `Error: ${err.message}`; modelSt.className = "fetch-status status-error";
    }
    return;
  }

  const apiKey   = document.getElementById("wizard-api-key").value.trim();
  const statusEl = document.getElementById("wizard-key-status");
  if (!apiKey) {
    statusEl.textContent = "Enter an API key first.";
    statusEl.className   = "fetch-status status-error";
    return;
  }

  const sel1 = document.getElementById("wizard-model-select");
  const sel2 = document.getElementById("wizard-gemini-model-2");
  const sel3 = document.getElementById("wizard-gemini-model-3");
  const sels = wizardProvider === "gemini" ? [sel1, sel2, sel3] : [sel1];

  const working = await fetchAndPopulate(wizardProvider, apiKey, {
    statusEl:     document.getElementById("wizard-model-status"),
    selectEls:    sels,
    currentValues:[]
  });

  if (working) {
    statusEl.textContent = "Key valid ✓";
    statusEl.className   = "fetch-status status-ok";
  } else {
    statusEl.textContent = "Key validation failed. Check key and retry.";
    statusEl.className   = "fetch-status status-error";
  }
}

async function saveWizardProvider() {
  const statusEl = document.getElementById("wizard-key-status");

  // Local providers: no API key — save baseUrl + model directly
  if (_LOCAL_PROVIDERS.has(wizardProvider)) {
    const localInfo = PROVIDER_INFO[wizardProvider];
    if (configuredProviders.find(p => p.id === wizardProvider)) {
      statusEl.textContent = `${localInfo.name} is already configured. Use Edit on its card to update it.`;
      statusEl.className   = "fetch-status status-error";
      return;
    }
    const baseUrl = sanitizeText(document.getElementById("wizard-ollama-url")?.value ?? "") || localInfo.defaultUrl;
    const model   = document.getElementById("wizard-model-select").value || "";
    configuredProviders.push({ id: wizardProvider, apiKey: "", model, baseUrl });
    await saveProviders();
    hideWizard();
    renderProviderCards();
    return;
  }

  const apiKey = sanitizeText(document.getElementById("wizard-api-key").value);
  if (!apiKey) {
    statusEl.textContent = "Enter an API key first.";
    statusEl.className   = "fetch-status status-error";
    return;
  }

  if (configuredProviders.find(p => p.id === wizardProvider)) {
    const name = PROVIDER_INFO[wizardProvider]?.name || wizardProvider;
    statusEl.textContent = `${name} is already configured. Use Edit on its card to update it.`;
    statusEl.className   = "fetch-status status-error";
    return;
  }

  const model = document.getElementById("wizard-model-select").value || "";
  configuredProviders.push({ id: wizardProvider, apiKey, model });

  if (wizardProvider === "gemini") {
    geminiModels[0] = model || null;
    geminiModels[1] = document.getElementById("wizard-gemini-model-2")?.value || null;
    geminiModels[2] = document.getElementById("wizard-gemini-model-3")?.value || null;
  }

  await saveProviders();
  hideWizard();
  renderProviderCards();
}

// ── Action Settings Editor ─────────────────────────────────────────────────────

function renderActionEditor() {
  const list = document.getElementById("action-list");
  if (!list) return;
  list.innerHTML = "";
  const enabledCount = actionSettings.filter(a => a.enabled).length;

  const freeActs = actionSettings.filter(a => !PRO_ACTION_IDS.has(a.id));
  const proActs  = actionSettings.filter(a =>  PRO_ACTION_IDS.has(a.id));
  const toRender = currentIsPro ? actionSettings : [...freeActs, ...proActs];

  let dividerInserted = false;

  toRender.forEach((action) => {
    const realIdx    = actionSettings.indexOf(action);
    const isLocked   = LOCKED_ACTIONS.has(action.id);
    const isOnlyOne  = action.enabled && enabledCount === 1;
    const isProAction = PRO_ACTION_IDS.has(action.id);

    // Insert divider before first Pro action for free users
    if (!currentIsPro && isProAction && !dividerInserted && proActs.length > 0) {
      dividerInserted = true;
      const divider = document.createElement("div");
      divider.className = "ae-pro-divider";
      divider.style.cssText = "font-size:11px; color:#6c7086; padding:4px 0; margin:4px 0; border-top:1px solid #313244; text-align:center;";
      divider.appendChild(document.createTextNode("— "));
      const badge = document.createElement("span");
      badge.style.cssText = `font-size:10px;font-weight:700;color:#fff;background:${PRO_BADGE_GRADIENT};padding:1px 6px;border-radius:100px;vertical-align:middle`;
      badge.textContent = "PRO";
      divider.appendChild(badge);
      divider.appendChild(document.createTextNode(" actions below — upgrade to reorder —"));
      list.appendChild(divider);
    }

    const row = document.createElement("div");
    row.className = `ae-row${!action.enabled ? " ae-disabled" : ""}`;
    row.dataset.actionId = action.id;

    const ordDiv = document.createElement("div"); ordDiv.className = "ae-order";
    const upOrd = document.createElement("button");
    upOrd.className = "ae-ord-btn ae-up"; upOrd.textContent = "▲";
    const dnOrd = document.createElement("button");
    dnOrd.className = "ae-ord-btn ae-dn"; dnOrd.textContent = "▼";

    if (!currentIsPro && isProAction) {
      upOrd.disabled = true;
      upOrd.title = "Pro feature — upgrade to reorder Pro actions";
      dnOrd.disabled = true;
      dnOrd.title = "Pro feature — upgrade to reorder Pro actions";
    } else if (!currentIsPro) {
      // Free user moving free actions — only within freeActs group
      const freeIdx = freeActs.indexOf(action);
      upOrd.disabled = freeIdx === 0;
      upOrd.title = "Move up";
      dnOrd.disabled = freeIdx === freeActs.length - 1;
      dnOrd.title = "Move down";
    } else {
      // Pro user — full control by realIdx
      upOrd.disabled = realIdx === 0;
      upOrd.title = "Move up";
      dnOrd.disabled = realIdx === actionSettings.length - 1;
      dnOrd.title = "Move down";
    }
    ordDiv.append(upOrd, dnOrd);

    const check = document.createElement("input");
    check.type = "checkbox"; check.className = "ae-check"; check.checked = !!action.enabled;
    if (isOnlyOne) { check.disabled = true; check.title = "At least one action must stay enabled"; }
    else if (!currentIsPro) { check.disabled = true; check.title = "Pro feature — upgrade to enable/disable actions"; }

    const badge = document.createElement("span"); badge.className = "ae-lock-badge";
    if (isLocked) {
      const lbl = document.createElement("span"); lbl.className = "ae-label"; lbl.textContent = action.label;
      badge.textContent = "built-in";
      row.append(ordDiv, check, lbl, badge);
    } else {
      const inp = document.createElement("input");
      inp.className = "ae-name-input"; inp.value = action.label; inp.placeholder = "Action name"; inp.maxLength = 64;
      if (!currentIsPro) { inp.readOnly = true; inp.title = "Pro feature — upgrade to rename actions"; }
      row.append(ordDiv, check, inp, badge);
    }

    row.querySelector(".ae-up").addEventListener("click", () => {
      if (currentIsPro) {
        if (realIdx > 0) { [actionSettings[realIdx - 1], actionSettings[realIdx]] = [actionSettings[realIdx], actionSettings[realIdx - 1]]; renderActionEditor(); }
      } else {
        const freeIdx = freeActs.indexOf(action);
        if (freeIdx > 0) {
          const prevReal = actionSettings.indexOf(freeActs[freeIdx - 1]);
          [actionSettings[prevReal], actionSettings[realIdx]] = [actionSettings[realIdx], actionSettings[prevReal]];
          renderActionEditor();
        }
      }
    });
    row.querySelector(".ae-dn").addEventListener("click", () => {
      if (currentIsPro) {
        if (realIdx < actionSettings.length - 1) { [actionSettings[realIdx], actionSettings[realIdx + 1]] = [actionSettings[realIdx + 1], actionSettings[realIdx]]; renderActionEditor(); }
      } else {
        const freeIdx = freeActs.indexOf(action);
        if (freeIdx < freeActs.length - 1) {
          const nextReal = actionSettings.indexOf(freeActs[freeIdx + 1]);
          [actionSettings[realIdx], actionSettings[nextReal]] = [actionSettings[nextReal], actionSettings[realIdx]];
          renderActionEditor();
        }
      }
    });
    row.querySelector(".ae-check").addEventListener("change", (e) => {
      if (!e.target.checked && actionSettings.filter(a => a.enabled).length <= 1) {
        e.target.checked = true; return;
      }
      if (e.target.checked && window._isDemoMode) {
        const enabledCount = actionSettings.filter(a => a.enabled).length;
        if (enabledCount >= DEMO_MAX_ACTIONS) {
          e.target.checked = false;
          _showDemoLimitBox(`You can only have ${DEMO_MAX_ACTIONS} actions enabled in Demo mode.`);
          return;
        }
      }
      actionSettings[realIdx].enabled = e.target.checked;
      renderActionEditor();
    });
    if (!isLocked) {
      row.querySelector(".ae-name-input").addEventListener("input", (e) => {
        actionSettings[realIdx].label = e.target.value;
      });
    }
    list.appendChild(row);
  });
}

// ── Context Presets ────────────────────────────────────────────────────────────

function renderContextPresets() {
  const list = document.getElementById("context-presets-list");
  if (!list) return;
  list.innerHTML = "";

  const quickSel = document.getElementById("context-preset-quick-select");
  if (quickSel) {
    quickSel.innerHTML = '<option value="">— add new below —</option>';
    contextPresets.forEach((p, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = p.name;
      quickSel.appendChild(opt);
    });
  }
}

function setCpLevel(level) {
  level = level || "intermediate";
  document.querySelectorAll(".cp-level-btn").forEach(btn => {
    const on = btn.dataset.level === level;
    btn.style.background = on ? "var(--accent)"  : "";
    btn.style.color      = on ? "var(--bg-card)" : "";
    btn.style.fontWeight = on ? "700" : "400";
    btn.dataset.active   = on ? "1" : "";
  });
}
function getCpLevel() {
  return document.querySelector(".cp-level-btn[data-active='1']")?.dataset.level || "intermediate";
}

async function addContextPreset() {
  const name    = sanitizeText(document.getElementById("new-cpreset-name")?.value ?? "");
  const text    = sanitizeContent(document.getElementById("new-cpreset-text")?.value ?? "");
  const level   = getCpLevel();
  const saveBtn = document.getElementById("add-context-preset-btn");
  const editIdx = saveBtn?.dataset.editIdx;
  if (!name || !text) { alert("Enter both a name and a description."); return; }

  if (window._isDemoMode && contextPresets.length >= DEMO_MAX_CONTEXTS && (editIdx === undefined || editIdx === "")) {
    _showDemoLimitBox(`You can only have ${DEMO_MAX_CONTEXTS} context presets in Demo mode.`);
    return;
  }

  if (editIdx !== undefined && editIdx !== "") {
    const idx = parseInt(editIdx, 10);
    contextPresets[idx] = { ...contextPresets[idx], name, text, level };
    delete saveBtn.dataset.editIdx;
    saveBtn.textContent = "Add";
  } else {
    contextPresets.push({ id: uid(), name, text, level });
  }
  await window.appSet({ contextPresets });
  document.getElementById("new-cpreset-name").value = "";
  document.getElementById("new-cpreset-text").value = "";
  setCpLevel("intermediate");
  const quickSel = document.getElementById("context-preset-quick-select");
  if (quickSel) quickSel.value = "";
  const delBtn = document.getElementById("delete-context-preset-btn");
  if (delBtn) delBtn.style.display = "none";
  renderContextPresets();
}

// ── Custom Prompts ─────────────────────────────────────────────────────────────

function renderCustomPrompts() {
  const promptSel = document.getElementById("prompt-quick-select");
  if (promptSel) {
    const curVal = promptSel.value;
    promptSel.innerHTML = '<option value="">— Add new action —</option>';
    const sep1 = document.createElement("option");
    sep1.disabled = true; sep1.textContent = "── Built-in ──";
    promptSel.appendChild(sep1);
    DEFAULT_ACTION_SETTINGS.forEach(a => {
      const opt = document.createElement("option");
      opt.value    = "builtin-" + a.id;
      const isLocked = LOCKED_ACTIONS.has(a.id);
      opt.textContent = (isLocked ? "🔒 " : "") + a.label + (!currentIsPro && !isLocked ? " (Pro)" : "");
      promptSel.appendChild(opt);
    });
    if (customPrompts.length) {
      const sep2 = document.createElement("option");
      sep2.disabled = true; sep2.textContent = "── Custom ──";
      promptSel.appendChild(sep2);
      let freeBasicSeen = 0, freeClarifySeen = 0;
      customPrompts.forEach((p, i) => {
        const opt = document.createElement("option");
        opt.value = "custom-" + i;
        if (!currentIsPro) {
          const overLimit = p.clarify ? (freeClarifySeen++ >= 1) : (freeBasicSeen++ >= 1);
          opt.textContent = overLimit ? p.name + " (over limit)" : p.name;
          opt.disabled    = overLimit;
        } else {
          opt.textContent = p.name;
        }
        promptSel.appendChild(opt);
      });
    }
    const restorable = promptSel.querySelector(`option[value="${curVal}"]:not([disabled])`);
    promptSel.value = restorable ? curVal : "";
  }

  document.getElementById("custom-prompts-list").textContent = "";

  const addForm = document.getElementById("add-prompt-form");
  if (addForm) {
    const hasBasic   = customPrompts.some(p => !p.clarify);
    const hasClarify = customPrompts.some(p =>  p.clarify);
    const freeIsFull = hasBasic && hasClarify;
    const isFull     = currentIsPro ? customPrompts.length >= 8 : freeIsFull;
    addForm.style.display = isFull ? "none" : "";

    // For free users, guide the clarify checkbox toward whichever slot is still open
    const clarifyEl = document.getElementById("prompt-clarify");
    if (!currentIsPro && clarifyEl && !isFull) {
      if (!hasBasic && !hasClarify) {
        clarifyEl.disabled = false; // Let them choose for their first slot
      } else if (!hasBasic) {
        clarifyEl.checked = false; clarifyEl.disabled = true; // Must add a basic prompt
      } else {
        clarifyEl.checked = true; clarifyEl.disabled = true; // Must add a clarify prompt
      }
    } else if (clarifyEl) {
      clarifyEl.disabled = false;
    }

    const warn = document.getElementById("free-prompt-warning");
    if (warn) warn.style.display = !currentIsPro ? "block" : "none";
  }
}

async function addPrompt() {
  const name      = sanitizeText(document.getElementById("new-prompt-name")?.value ?? "");
  const prompt    = sanitizeContent(document.getElementById("new-prompt-text")?.value ?? "");
  const isClarify = document.getElementById("prompt-clarify")?.checked || false;
  if (!name || !prompt) { alert("Enter both a name and an instruction."); return; }
  const addBtn = document.getElementById("add-prompt-btn");
  const editId = addBtn?.dataset.editId;
  if (editId) {
    const idx = customPrompts.findIndex(p => p.id === editId);
    if (idx !== -1) customPrompts[idx] = { ...customPrompts[idx], name, prompt, clarify: isClarify };
    delete addBtn.dataset.editId;
    addBtn.textContent = "Add to Menu";
    const titleEl = document.getElementById("add-prompt-title");
    if (titleEl) titleEl.textContent = "Add New Action";
    const delBtn = document.getElementById("delete-prompt-btn");
    if (delBtn)  delBtn.style.display = "none";
    const promptSel = document.getElementById("prompt-quick-select");
    if (promptSel) promptSel.value = "";
  } else {
    if (!currentIsPro) {
      const hasBasic   = customPrompts.some(p => !p.clarify);
      const hasClarify = customPrompts.some(p =>  p.clarify);
      if (isClarify && hasClarify)  { alert("Free tier: you already have a clarify action. Upgrade to Pro to add more."); return; }
      if (!isClarify && hasBasic)   { alert("Free tier: you already have a basic action. Upgrade to Pro to add more."); return; }
    } else if (customPrompts.length >= 8) {
      alert("Maximum 8 custom actions.");
      return;
    }
    customPrompts.push({ id: uid(), name, prompt, clarify: isClarify });
  }
  await window.appSet({ customPrompts });
  renderCustomPrompts();
  document.getElementById("new-prompt-name").value = "";
  document.getElementById("new-prompt-text").value = "";
  const clarifyEl = document.getElementById("prompt-clarify");
  if (clarifyEl) clarifyEl.checked = true;
}

// ── Demo Limits ────────────────────────────────────────────────────────────────

const DEMO_MAX_ACTIONS  = 5;
const DEMO_MAX_CONTEXTS = 5;

function _showDemoLimitBox(msg) {
  alert("Demo Limit Reached\n\n" + msg + "\n\nTo remove limits, deactivate your demo license and purchase a full license.");
}

function applyDemoLimits(isDemo) {
  window._isDemoMode = !!isDemo;
  if (!isDemo) return;
  // Trim enabled actions to DEMO_MAX_ACTIONS
  let kept = 0;
  let changed = false;
  actionSettings.forEach(a => {
    if (a.enabled) {
      kept++;
      if (kept > DEMO_MAX_ACTIONS) { a.enabled = false; changed = true; }
    }
  });
  if (changed) { window.appSet({ actionSettings }); renderActionEditor(); }
  // Trim context presets to DEMO_MAX_CONTEXTS
  if (contextPresets.length > DEMO_MAX_CONTEXTS) {
    contextPresets = contextPresets.slice(0, DEMO_MAX_CONTEXTS);
    window.appSet({ contextPresets });
    renderContextPresets();
  }
}

// ── Pro Gates ──────────────────────────────────────────────────────────────────

function applyProGates(isPro) {
  currentIsPro = isPro;
  ["profile-section", "history-viewer-section", "context-presets-section"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("locked", !isPro);
  });
  const histEl = document.getElementById("history-viewer-section");
  if (histEl) histEl.style.display = isPro ? "" : "none";
  renderActionEditor();
  renderCustomPrompts();
  const lockedView = document.getElementById("pro-locked-view");
  const activeView = document.getElementById("pro-active-view");
  if (lockedView) lockedView.style.display = isPro ? "none" : "";
  if (activeView) activeView.style.display = isPro ? ""     : "none";
  document.querySelectorAll(".pro-badge-sm").forEach(el => {
    el.style.display = isPro ? "none" : "";
  });
  const proBtn = document.getElementById("activate-pro-link-btn");
  if (proBtn) proBtn.textContent = isPro ? (window.proActiveBtnText || "⚡ Pro Active — Manage ↓") : "⚡ Activate Pro";
  const histTitle = document.getElementById("history-title-text");
  if (histTitle) histTitle.textContent = isPro ? "All History" : "Today's History";
  const histFreeHint = document.getElementById("history-free-hint");
  if (histFreeHint) histFreeHint.style.display = isPro ? "none" : "block";
  document.getElementById("history-upgrade-link")?.addEventListener("click", openGumroad);
  if (isPro && !contextPresets.length) {
    contextPresets = DEFAULT_AUDIENCE_PRESETS.map(p => ({ ...p, id: uid() }));
    window.appSet({ contextPresets });
    renderContextPresets();
  }
  const exportBtn = document.getElementById("backup-export-btn");
  if (exportBtn) {
    exportBtn.disabled = !isPro;
    exportBtn.title = isPro ? "" : "Pro feature — unlock Pro to export";
  }
  if (typeof window.applyProGateExtras === "function") window.applyProGateExtras(isPro);
}

// ── Pro Section Init ───────────────────────────────────────────────────────────

function initProSection() {
  window.appGet(["licenseEmail", "licenseKey", "demoMode", "corpMode", "_deviceId"]).then(s => {
    const isPro = isProUnlocked(s);
    applyProGates(isPro);
    if (isPro && s.demoMode === "active") applyDemoLimits(true);
    if (isPro) {
      const emailEl = document.getElementById("pro-active-email");
      if (emailEl) {
        if (s.demoMode === "active")      emailEl.textContent = "Demo License Active";
        else if (s.corpMode === "active") emailEl.textContent = "Corporate License Active";
        else                              emailEl.textContent = s.licenseEmail;
      }
      if ((s.demoMode === "active" || s.corpMode === "active") && s._deviceId) {
        const row  = document.getElementById("pro-device-id-row");
        const code = document.getElementById("pro-device-id");
        if (row && code) { code.textContent = s._deviceId; row.style.display = "block"; }
      }
    }
  });

  document.getElementById("pro-buy-link")?.addEventListener("click", openGumroad);

  const proKeyInput   = document.getElementById("pro-key-input");
  const proKeyShowBtn = document.getElementById("pro-key-show-btn");
  let proKeyReal   = "";
  let proKeyMasked = true;
  let maskTimer    = null;
  const maskKey         = (v) => v.replace(/[^-]/g, "•");
  const maskLastVisible = (v) => {
    if (!v) return "";
    let lastIdx = -1;
    for (let i = v.length - 1; i >= 0; i--) { if (v[i] !== "-") { lastIdx = i; break; } }
    if (lastIdx === -1) return maskKey(v);
    return v.slice(0, lastIdx).replace(/[^-]/g, "•") + v[lastIdx];
  };
  const refreshDisplay = (showLast) => {
    if (!proKeyInput) return;
    if (!proKeyMasked) { proKeyInput.value = proKeyReal; return; }
    clearTimeout(maskTimer);
    if (showLast && proKeyReal) {
      proKeyInput.value = maskLastVisible(proKeyReal);
      maskTimer = setTimeout(() => { if (proKeyInput && proKeyMasked) proKeyInput.value = maskKey(proKeyReal); }, 600);
    } else {
      proKeyInput.value = maskKey(proKeyReal);
    }
  };

  proKeyShowBtn?.addEventListener("click", () => {
    proKeyMasked = !proKeyMasked;
    clearTimeout(maskTimer);
    if (proKeyShowBtn) proKeyShowBtn.textContent = proKeyMasked ? "Show" : "Hide";
    refreshDisplay(proKeyMasked); // when switching to masked, briefly show last char
  });

  proKeyInput?.addEventListener("focus", () => { refreshDisplay(false); });
  proKeyInput?.addEventListener("blur",  () => {
    clearTimeout(maskTimer);
    if (proKeyMasked && proKeyInput) proKeyInput.value = maskKey(proKeyReal);
  });

  // In masked mode, intercept keystrokes to keep proKeyReal as ground truth
  proKeyInput?.addEventListener("keydown", (e) => {
    if (!proKeyMasked) return;
    if (["Tab","Enter","ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) return;
    if ((e.ctrlKey || e.metaKey) && ["a","c","v","x"].includes(e.key.toLowerCase())) return;
    e.preventDefault();
    if (e.key === "Backspace" || e.key === "Delete") {
      const raw = proKeyReal.replace(/-/g, "");
      const newRaw = e.key === "Delete" ? "" : raw.slice(0, -1);
      proKeyReal = newRaw ? (newRaw.match(/.{1,8}/g)?.join("-") ?? newRaw).slice(0, 35) : "";
      refreshDisplay(false);
      return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey) return;
    const char = e.key.toUpperCase();
    if (!/[A-Z0-9]/.test(char)) return;
    const raw = proKeyReal.replace(/-/g, "");
    if (raw.length >= 32) return;
    const newRaw = raw + char;
    proKeyReal = (newRaw.match(/.{1,8}/g)?.join("-") ?? newRaw).slice(0, 35);
    refreshDisplay(true);
  });
  proKeyInput?.addEventListener("paste", (e) => {
    if (!proKeyMasked) return;
    e.preventDefault();
    const pasted = (e.clipboardData?.getData("text") || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (!pasted) return;
    const raw = pasted.slice(0, 32);
    proKeyReal = raw ? (raw.match(/.{1,8}/g)?.join("-") ?? raw).slice(0, 35) : "";
    refreshDisplay(true);
  });
  // In show mode, allow normal editing
  proKeyInput?.addEventListener("input", (e) => {
    if (proKeyMasked) return;
    const raw = e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    proKeyReal = (raw.match(/.{1,8}/g)?.join("-") ?? raw).slice(0, 35);
    e.target.value = proKeyReal;
  });

  document.querySelectorAll(".pro-unlock-link").forEach(a => {
    a.addEventListener("click", () => {
      const panel = document.getElementById("pro-panel");
      if (panel) panel.style.display = "block";
    });
  });

  document.querySelectorAll(".pro-buy-direct").forEach(a => {
    a.addEventListener("click", openGumroad);
  });

  document.getElementById("activate-pro-btn")?.addEventListener("click", async () => {
    const email = document.getElementById("pro-email-input")?.value?.trim();
    const key   = proKeyReal;
    const msgEl = document.getElementById("pro-status-msg");
    const btn   = document.getElementById("activate-pro-btn");
    if (!email || !key) { msgEl.textContent = "Enter your email and license key."; msgEl.className = "pro-status-msg error"; return; }
    btn.disabled    = true;
    btn.textContent = "Verifying…";
    msgEl.textContent = ""; msgEl.className = "pro-status-msg";

    const isDemo    = email.toLowerCase() === "development";
    const isCorpKey = key.replace(/-/g, "").includes("00000"); // 5+ zeros = corp/demo key, never Gumroad
    let result, mode = "gumroad";

    try {
      if (isDemo) {
        result = await verifyDemoMode(key);
        mode   = "demo";
      } else {
        result = await verifyCorpMode(email, key);
        if (result.valid) {
          mode = "corp";
        } else if (result.corpNotFound && !isCorpKey) {
          result = await verifyWithGumroad(email, key);
          mode   = "gumroad";
        } else if (result.corpNotFound && isCorpKey) {
          result = { valid: false, error: "Invalid corp license key." };
          mode   = "corp_err";
        } else {
          mode = "corp_err";
        }
      }
    } catch {
      btn.disabled = false; btn.textContent = "Activate";
      msgEl.textContent = "Verification failed. Check your connection and try again.";
      msgEl.className = "pro-status-msg error";
      return;
    }

    btn.disabled    = false;
    btn.textContent = "Activate";
    if (!result.valid) { msgEl.textContent = result.error; msgEl.className = "pro-status-msg error"; return; }

    if (mode === "demo") {
      await window.appSet({ demoMode: "active", corpLicenseId: result.corpLicenseId || null, lastDemoCheck: Date.now(), lastDemoAttempt: Date.now() });
    } else if (mode === "corp") {
      await window.appSet({ corpMode: "active", corpLicenseId: result.corpLicenseId || null, lastCorpCheck: Date.now(), lastCorpAttempt: Date.now() });
    } else {
      await window.appSet({ licenseEmail: email, licenseKey: key });
    }

    if (typeof window.onProActivated === "function") window.onProActivated();
    const emailEl = document.getElementById("pro-active-email");
    if (emailEl) emailEl.textContent = mode === "demo" ? "Demo License Active" : mode === "corp" ? "Corporate License Active" : email;
    if (mode === "demo" || mode === "corp") {
      window.appGet(["_deviceId"]).then(d => {
        const row  = document.getElementById("pro-device-id-row");
        const code = document.getElementById("pro-device-id");
        if (row && code && d._deviceId) { code.textContent = d._deviceId; row.style.display = "block"; }
      });
    } else {
      const row = document.getElementById("pro-device-id-row");
      if (row) row.style.display = "none";
    }
    applyProGates(true);
    if (mode === "demo") applyDemoLimits(true);
    const panel = document.getElementById("pro-panel");
    if (panel) panel.style.display = "none";
  });

  document.getElementById("deactivate-pro-btn")?.addEventListener("click", async () => {
    const ds = await window.appGet(["corpMode", "demoMode", "_deviceId", "corpLicenseId"]);
    if ((ds.corpMode === "active" || ds.demoMode === "active") && ds._deviceId && ds.corpLicenseId)
      await removeSeat(ds._deviceId, ds.corpLicenseId);
    await window.appRemove([
      "licenseEmail", "licenseKey",
      "demoMode", "corpMode", "corpLicenseId",
      "lastDemoCheck", "lastDemoAttempt",
      "lastCorpCheck", "lastCorpAttempt",
    ]);
    document.getElementById("pro-email-input").value = "";
    proKeyReal = "";
    if (proKeyInput) proKeyInput.value = "";
    applyProGates(false);
    applyDemoLimits(false);
    const panel = document.getElementById("pro-panel");
    if (panel) panel.style.display = "none";
  });
}

// ── Common page helpers ───────────────────────────────────────────────────────

function showSectionStatus(elId, msg, isErr) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.className   = "section-save-status " + (isErr ? "err" : "ok");
  setTimeout(() => { el.textContent = ""; el.className = "section-save-status"; }, 2500);
}

function getVal(id) { return document.getElementById(id)?.value ?? ""; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }

// ── Common settings-page wiring (identical between extension + desktop) ───────

function initCommonSettingsWiring(s) {
  // Action editor toggle
  document.getElementById("toggle-action-editor")?.addEventListener("click", () => {
    const panel = document.getElementById("action-editor-panel");
    const btn   = document.getElementById("toggle-action-editor");
    if (!panel) return;
    const open  = panel.style.display === "none";
    panel.style.display = open ? "block" : "none";
    if (btn) btn.textContent = open ? "← Close Editor" : "Edit Actions →";
  });
  document.getElementById("action-quick-select")?.addEventListener("change", (e) => {
    const id = e.target.value;
    document.querySelectorAll(".ae-row").forEach(r => r.style.outline = "");
    if (!id) return;
    const row = document.querySelector(`[data-action-id="${id}"]`);
    if (row) { row.style.outline = "1px solid var(--accent, #89b4fa)"; row.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  });

  // Context URL fetch
  document.getElementById("load-context-url-btn")?.addEventListener("click", () => {
    const row = document.getElementById("context-url-row");
    if (row) row.style.display = row.style.display === "none" ? "block" : "none";
  });
  document.getElementById("fetch-context-btn")?.addEventListener("click", async () => {
    const url      = sanitizeText(document.getElementById("contextUrl")?.value ?? "");
    const statusEl = document.getElementById("context-url-status");
    if (!url) { statusEl.textContent = "Enter a URL first."; statusEl.className = "fetch-status status-error"; return; }
    function _isBlockedContextHost(hostname) {
      const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
      return h === "localhost" || h === "127.0.0.1" || h === "::1" ||
             h === "::ffff:127.0.0.1" || h === "0.0.0.0" || h.startsWith("169.254.");
    }
    try {
      const u = new URL(url);
      if (_isBlockedContextHost(u.hostname)) {
        statusEl.textContent = "Localhost URLs are not allowed."; statusEl.className = "fetch-status status-error"; return;
      }
    } catch {
      statusEl.textContent = "Invalid URL."; statusEl.className = "fetch-status status-error"; return;
    }
    const btn = document.getElementById("fetch-context-btn");
    btn.disabled = true; btn.textContent = "Fetching…";
    statusEl.textContent = ""; statusEl.className = "fetch-status";
    const MAX_BYTES = 50_000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (_isBlockedContextHost(new URL(res.url).hostname))
        throw new Error("Redirected to blocked URL.");
      const raw  = await res.text();
      const text = raw.slice(0, MAX_BYTES);
      document.getElementById("profileContext").value = text;
      const note = raw.length > MAX_BYTES ? ` (truncated to ${MAX_BYTES} chars)` : "";
      statusEl.textContent = `Loaded ${text.length} characters${note}. Click Save Settings to apply.`;
      statusEl.className   = "fetch-status status-ok";
    } catch (err) {
      statusEl.textContent = `Failed: ${err.message}`; statusEl.className = "fetch-status status-error";
    } finally {
      clearTimeout(timer);
      btn.disabled = false; btn.textContent = "Fetch & Save";
    }
  });

  // Expertise level buttons
  (function () {
    const active = s.audienceLevel || "intermediate";
    function applyExpertise(level) {
      document.querySelectorAll(".expertise-btn").forEach(btn => {
        const on = btn.dataset.level === level;
        btn.style.background = on ? "var(--accent, #89b4fa)" : "";
        btn.style.color      = on ? "var(--bg-card, #1e1e2e)" : "";
        btn.style.fontWeight = on ? "700" : "400";
      });
    }
    applyExpertise(active);
    document.querySelectorAll(".expertise-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        applyExpertise(btn.dataset.level);
        await window.appSet({ audienceLevel: btn.dataset.level });
      });
    });
  })();

  // Per-audience level picker
  setCpLevel("intermediate");
  document.querySelectorAll(".cp-level-btn").forEach(btn => {
    btn.addEventListener("click", () => setCpLevel(btn.dataset.level));
  });

  // Context-preset quick-select
  renderContextPresets();
  document.getElementById("add-context-preset-btn")?.addEventListener("click", addContextPreset);
  document.getElementById("context-preset-quick-select")?.addEventListener("change", (e) => {
    const idx     = e.target.value;
    const saveBtn = document.getElementById("add-context-preset-btn");
    const delBtn  = document.getElementById("delete-context-preset-btn");
    const nameEl  = document.getElementById("new-cpreset-name");
    const textEl  = document.getElementById("new-cpreset-text");
    if (idx === "") {
      if (nameEl) nameEl.value = ""; if (textEl) textEl.value = "";
      setCpLevel("intermediate");
      if (saveBtn) delete saveBtn.dataset.editIdx;
      if (delBtn) delBtn.style.display = "none"; return;
    }
    const preset = contextPresets[parseInt(idx, 10)];
    if (!preset) return;
    if (nameEl) nameEl.value = preset.name;
    if (textEl) textEl.value = preset.text;
    setCpLevel(preset.level || "intermediate");
    if (saveBtn) saveBtn.dataset.editIdx = idx;
    if (delBtn) delBtn.style.display = "";
  });
  document.getElementById("delete-context-preset-btn")?.addEventListener("click", async () => {
    const saveBtn  = document.getElementById("add-context-preset-btn");
    const delBtn   = document.getElementById("delete-context-preset-btn");
    const quickSel = document.getElementById("context-preset-quick-select");
    const idx = parseInt(saveBtn?.dataset.editIdx, 10);
    if (isNaN(idx)) return;
    contextPresets.splice(idx, 1);
    await window.appSet({ contextPresets });
    if (saveBtn) delete saveBtn.dataset.editIdx;
    if (delBtn) delBtn.style.display = "none";
    document.getElementById("new-cpreset-name").value = "";
    document.getElementById("new-cpreset-text").value = "";
    setCpLevel("intermediate");
    if (quickSel) quickSel.value = "";
    renderContextPresets();
  });

  // Custom prompts
  renderCustomPrompts();
  document.getElementById("add-prompt-btn")?.addEventListener("click", addPrompt);
  document.querySelectorAll(".example-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("new-prompt-name").value = btn.dataset.name;
      document.getElementById("new-prompt-text").value = btn.dataset.prompt;
    });
  });

  // Prompt quick-select
  document.getElementById("prompt-quick-select")?.addEventListener("change", (e) => {
    const val     = e.target.value;
    const addBtn  = document.getElementById("add-prompt-btn");
    const nameEl  = document.getElementById("new-prompt-name");
    const textEl  = document.getElementById("new-prompt-text");
    const delBtn  = document.getElementById("delete-prompt-btn");
    const titleEl = document.getElementById("add-prompt-title");
    const resetForm = () => {
      if (nameEl)  { nameEl.value = ""; nameEl.readOnly = false; }
      if (textEl)  { textEl.value = ""; textEl.readOnly = false; }
      const ce = document.getElementById("prompt-clarify");
      if (ce) { ce.checked = true; ce.disabled = false; }
      if (addBtn)  { delete addBtn.dataset.editId; addBtn.textContent = "Add to Menu"; addBtn.disabled = false; }
      if (delBtn)  delBtn.style.display = "none";
      if (titleEl) titleEl.textContent = "Add New Action";
    };
    if (!val) { resetForm(); return; }
    if (val.startsWith("builtin-")) {
      const actionId = val.replace("builtin-", "");
      const action   = DEFAULT_ACTION_SETTINGS.find(a => a.id === actionId);
      if (!action) { resetForm(); return; }
      const isLocked = LOCKED_ACTIONS.has(actionId);
      const ro = !currentIsPro || isLocked;
      if (nameEl)  { nameEl.value = action.label; nameEl.readOnly = ro; }
      if (textEl)  { textEl.value = MENU_PROMPTS[actionId] || ""; textEl.readOnly = ro; }
      const ce = document.getElementById("prompt-clarify");
      if (ce) { ce.checked = !!action.clarify; ce.disabled = ro; }
      if (addBtn)  { delete addBtn.dataset.editId; addBtn.textContent = ro ? "Add to Menu" : "Save"; addBtn.disabled = ro; }
      if (delBtn)  delBtn.style.display = "none";
      if (titleEl) titleEl.textContent = ro ? "Built-in Action (read-only)" : "Edit Action";
      return;
    }
    if (!val.startsWith("custom-")) { resetForm(); return; }
    const idx = parseInt(val.replace("custom-", ""), 10);
    const p   = customPrompts[idx];
    if (!p) return;
    if (nameEl)  { nameEl.value = p.name; nameEl.readOnly = false; }
    if (textEl)  { textEl.value = p.prompt; textEl.readOnly = false; }
    const ce = document.getElementById("prompt-clarify");
    if (ce) { ce.checked = !!p.clarify; ce.disabled = false; }
    if (addBtn)  { addBtn.dataset.editId = p.id; addBtn.textContent = "Save"; addBtn.disabled = false; }
    if (delBtn)  delBtn.style.display = "inline-block";
    if (titleEl) titleEl.textContent = "Edit Action";
    document.getElementById("add-prompt-form")?.style.setProperty("display", "");
  });

  document.getElementById("delete-prompt-btn")?.addEventListener("click", async () => {
    const addBtn = document.getElementById("add-prompt-btn");
    const editId = addBtn?.dataset.editId;
    if (!editId) return;
    if (!confirm("Delete this action? This cannot be undone.")) return;
    customPrompts = customPrompts.filter(p => p.id !== editId);
    await window.appSet({ customPrompts });
    delete addBtn.dataset.editId;
    addBtn.textContent = "Add to Menu";
    if (document.getElementById("add-prompt-title")) document.getElementById("add-prompt-title").textContent = "Add New Action";
    if (document.getElementById("delete-prompt-btn")) document.getElementById("delete-prompt-btn").style.display = "none";
    if (document.getElementById("new-prompt-name"))   document.getElementById("new-prompt-name").value = "";
    if (document.getElementById("new-prompt-text"))   document.getElementById("new-prompt-text").value = "";
    const promptSel = document.getElementById("prompt-quick-select");
    if (promptSel) promptSel.value = "";
    renderCustomPrompts();
  });

  // Pro panel toggles — open/close wired early in each platform's init()

  // Manage-section toggles
  document.getElementById("toggle-context-presets")?.addEventListener("click", () => {
    const panel = document.getElementById("context-presets-section");
    const btn   = document.getElementById("toggle-context-presets");
    if (!panel) return;
    const open = panel.style.display === "none";
    panel.style.display = open ? "block" : "none";
    if (btn) btn.textContent = open ? "← Close" : "Manage Audience Types →";
  });
  document.getElementById("toggle-prompts")?.addEventListener("click", () => {
    const panel = document.getElementById("prompts-panel");
    const btn   = document.getElementById("toggle-prompts");
    if (!panel) return;
    const open = panel.style.display === "none";
    panel.style.display = open ? "block" : "none";
    if (btn) btn.textContent = open ? "← Close" : "Manage Actions →";
  });

  // Context enabled state
  const contextEnabledEl = document.getElementById("contextEnabled");
  if (contextEnabledEl) contextEnabledEl.checked = s.contextEnabled !== false;
}

// ── Storage migration (shared — uses window.appGet/appSet) ────────────────────

async function migrateStorage() {
  const check = await window.appGet(["configuredProviders"]);
  if (check.configuredProviders !== undefined) return;
  const s = await window.appGet([
    "provider", "openaiKey", "openaiModel", "claudeKey", "claudeModel", "geminiKey", "geminiModel"
  ]);
  const providers = [];
  const active    = s.provider || "openai";
  const order     = [active, ...["openai", "claude", "gemini"].filter(p => p !== active)];
  for (const id of order) {
    const apiKey = s[`${id}Key`];
    if (!apiKey) continue;
    providers.push({ id, apiKey, model: s[`${id}Model`] || "" });
  }
  const gEntry  = providers.find(p => p.id === "gemini");
  const gModels = gEntry ? [gEntry.model || null, null, null] : [null, null, null];
  await window.appSet({ configuredProviders: providers, geminiModels: gModels });
}

// ── History Password Lock (Pro) ───────────────────────────────────────────────

// Adds PIN-lock controls to #history-viewer-section.
// Must be called AFTER loadHistoryViewer() so the list is already populated.
async function initHistoryPinSection(s) {
  const section = document.getElementById("history-viewer-section");
  if (!section) return;

  const isPro   = isProUnlocked(s);
  const hasPin  = !!s.historyPin;
  const h2      = section.querySelector("h2");

  if (!hasPin && !isPro) return; // nothing to show

  const bar = document.createElement("div");
  bar.id = "history-pin-bar";
  bar.style.cssText = "margin-bottom:10px";

  if (hasPin) {
    // Force section visible (loadHistoryViewer may have hidden it when empty)
    section.style.display = "";

    // Header row: [Change Passcode]  🔒 History is locked
    const headerRow = document.createElement("div");
    headerRow.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:10px";

    if (isPro) {
      const changeBtn = document.createElement("button");
      changeBtn.id = "history-change-pin-btn";
      changeBtn.className = "link-btn";
      changeBtn.textContent = "Change Passcode";
      headerRow.appendChild(changeBtn);
    }

    const lockBadge = document.createElement("span");
    lockBadge.id = "history-lock-badge";
    lockBadge.style.cssText = "color:#f9e2af;font-weight:600;font-size:13px";
    lockBadge.textContent = "🔒 History is locked";
    headerRow.appendChild(lockBadge);
    bar.appendChild(headerRow);

    // Unlock form box
    const unlockBox = document.createElement("div");
    unlockBox.id = "history-unlock-box";
    unlockBox.style.cssText = "padding:12px;background:var(--bg-main,#181825);border:1px solid var(--border,#313244);border-radius:6px;display:flex;flex-direction:column;gap:8px;max-width:360px";

    const inputRow = document.createElement("div");
    inputRow.style.cssText = "display:flex;gap:8px;align-items:center";
    const pinInput = document.createElement("input");
    pinInput.type = "password"; pinInput.id = "history-unlock-input";
    pinInput.placeholder = "Enter passcode"; pinInput.maxLength = 128; pinInput.style.cssText = "flex:1;min-width:0";
    const unlockBtn = document.createElement("button");
    unlockBtn.id = "history-unlock-btn"; unlockBtn.className = "btn-primary"; unlockBtn.textContent = "Unlock";
    inputRow.appendChild(pinInput); inputRow.appendChild(unlockBtn);

    const errEl = document.createElement("div");
    errEl.id = "history-unlock-err";
    errEl.style.cssText = "color:#f38ba8;font-size:12px;display:none";

    const forgotA = document.createElement("a");
    forgotA.textContent = "Forgot passcode? Reset history to clear it.";
    forgotA.style.cssText = "cursor:pointer;color:#b4befe;font-size:12px";

    unlockBox.appendChild(inputRow);
    unlockBox.appendChild(errEl);
    unlockBox.appendChild(forgotA);
    bar.appendChild(unlockBox);

    // Hide history list while locked
    const list     = document.getElementById("history-viewer-list");
    const countEl  = document.getElementById("history-viewer-count");
    if (list)    list.style.display = "none";
    if (countEl) { countEl._savedCount = countEl.textContent; countEl.textContent = ""; }

    unlockBtn.addEventListener("click", async () => {
      const pin = pinInput.value;
      if (!pin) return;
      const ok = await verifyPin(pin, s.historyPin);
      if (!ok) {
        errEl.textContent = "Incorrect passcode."; errEl.style.display = "";
        return;
      }
      unlockBox.style.display  = "none";
      lockBadge.style.display  = "none";
      if (list)   list.style.display = "";
      if (countEl && countEl._savedCount !== undefined) countEl.textContent = countEl._savedCount;
    });

    forgotA.addEventListener("click", async () => {
      if (!confirm("This will permanently delete all history entries and remove the passcode. Are you sure?")) return;
      await window.appRemove(["historyFull", "historyLog", "historyPin"]);
      location.reload();
    });

    // Change passcode form (Pro only)
    if (isPro) {
      const changeForm = document.createElement("div");
      changeForm.id = "history-change-pin-form";
      changeForm.style.cssText = "margin-top:10px;padding:12px;background:var(--bg-main,#181825);border:1px solid var(--border,#313244);border-radius:6px;max-width:360px;flex-direction:column;gap:8px";

      const _makeField = (placeholder, id) => {
        const inp = document.createElement("input");
        inp.type = "password"; inp.placeholder = placeholder; inp.id = id; inp.maxLength = 128;
        return inp;
      };
      const curInp  = _makeField("Current passcode", "change-pin-current");
      const newInp  = _makeField("New passcode", "change-pin-new");
      const confInp = _makeField("Confirm new passcode", "change-pin-confirm");
      const saveBtn = document.createElement("button");
      saveBtn.className = "btn-primary"; saveBtn.textContent = "Save New Passcode";
      const cErrEl = document.createElement("div");
      cErrEl.style.cssText = "color:#f38ba8;font-size:12px;display:none";

      changeForm.appendChild(curInp); changeForm.appendChild(newInp);
      changeForm.appendChild(confInp); changeForm.appendChild(saveBtn);
      changeForm.appendChild(cErrEl);
      changeForm.style.display = "none";
      bar.appendChild(changeForm);

      changeBtn.addEventListener("click", () => {
        changeForm.style.display = changeForm.style.display === "none" ? "flex" : "none";
      });

      saveBtn.addEventListener("click", async () => {
        const cur  = curInp.value;
        const newP = newInp.value;
        const conf = confInp.value;
        if (!cur || !newP || !conf) { cErrEl.textContent = "All fields required."; cErrEl.style.display = ""; return; }
        if (newP !== conf) { cErrEl.textContent = "New passcode fields don't match."; cErrEl.style.display = ""; return; }
        const ok = await verifyPin(cur, s.historyPin);
        if (!ok) { cErrEl.textContent = "Current passcode is incorrect."; cErrEl.style.display = ""; return; }
        const newHash = await hashPin(newP);
        await window.appSet({ historyPin: newHash });
        location.reload();
      });
    }

  } else if (isPro) {
    // No PIN: show [Set Passcode] button and inline set form
    const setBtn = document.createElement("button");
    setBtn.id = "history-set-pin-btn"; setBtn.className = "link-btn";
    setBtn.textContent = "Set Passcode";
    bar.appendChild(setBtn);

    const setForm = document.createElement("div");
    setForm.id = "history-set-pin-form";
    setForm.style.cssText = "margin-top:10px;padding:12px;background:var(--bg-main,#181825);border:1px solid var(--border,#313244);border-radius:6px;max-width:360px;flex-direction:column;gap:8px";

    const _makeField = (placeholder, id) => {
      const inp = document.createElement("input");
      inp.type = "password"; inp.placeholder = placeholder; inp.id = id; inp.maxLength = 128;
      return inp;
    };
    const newInp  = _makeField("New passcode", "set-pin-new");
    const confInp = _makeField("Confirm passcode", "set-pin-confirm");
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn-primary"; saveBtn.textContent = "Save Passcode";
    const sErrEl = document.createElement("div");
    sErrEl.style.cssText = "color:#f38ba8;font-size:12px;display:none";

    setForm.appendChild(newInp); setForm.appendChild(confInp);
    setForm.appendChild(saveBtn); setForm.appendChild(sErrEl);
    setForm.style.display = "none";
    bar.appendChild(setForm);

    setBtn.addEventListener("click", () => {
      const open = setForm.style.display !== "none";
      setForm.style.display = open ? "none" : "flex";
      setBtn.textContent    = open ? "Set Passcode" : "Cancel";
    });

    saveBtn.addEventListener("click", async () => {
      const newP = newInp.value;
      const conf = confInp.value;
      if (!newP || !conf) { sErrEl.textContent = "Both fields required."; sErrEl.style.display = ""; return; }
      if (newP !== conf)  { sErrEl.textContent = "Passcode fields don't match."; sErrEl.style.display = ""; return; }
      const hash = await hashPin(newP);
      await window.appSet({ historyPin: hash });
      location.reload();
    });
  }

  if (h2 && bar.hasChildNodes()) h2.insertAdjacentElement("afterend", bar);
}

// ── Sound Like Me — Vocab Tracker (Pro) ──────────────────────────────────────

// Appends the vocabulary tracker subsection to #profile-section.
// Hidden entirely for free users. Reads/writes profileVocab storage key.
// profileVocab shape: { prefer: string[], avoid: string[] }
function initVocabSection(s) {
  const profileSection = document.getElementById("profile-section");
  if (!profileSection) return;
  if (!isProUnlocked(s)) return;

  const vocab = s.profileVocab || {};
  const preferList = (vocab.prefer || []).filter(Boolean);
  const avoidList  = (vocab.avoid  || []).filter(Boolean);

  const sec = document.createElement("details");
  sec.id = "vocab-section";
  sec.style.cssText = "margin-top:24px;padding-top:20px;border-top:1px solid var(--surface,#313244)";

  const summary = document.createElement("summary");
  summary.style.cssText = "list-style:none;display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;margin-bottom:0";
  summary.innerHTML = '<span style="font-size:13px;font-weight:700;color:var(--text,#cdd6f4);flex:1">Vocabulary Tracker</span><span class="vc-chevron" style="font-size:11px;color:var(--text-muted,#6c7086);transition:transform 0.15s">▼</span>';
  sec.appendChild(summary);

  sec.addEventListener("toggle", () => {
    const chevron = summary.querySelector(".vc-chevron");
    if (chevron) chevron.style.transform = sec.open ? "rotate(180deg)" : "";
  });

  const body = document.createElement("div");
  body.style.cssText = "margin-top:10px";

  const hint = document.createElement("p");
  hint.className = "hint"; hint.style.cssText = "margin-bottom:14px";
  hint.textContent = "Words and phrases included in every Sound Like Me prompt. Builds up your personal vocabulary over time.";
  body.appendChild(hint);

  const _makeList = (title, initialItems, listId, inputId) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:18px";

    const lbl = document.createElement("p");
    lbl.style.cssText = "font-size:12px;font-weight:700;color:var(--text-muted,#6c7086);text-transform:uppercase;letter-spacing:0.04em;margin:0 0 8px 0";
    lbl.textContent = title;
    wrap.appendChild(lbl);

    const chips = document.createElement("div");
    chips.id = listId;
    chips.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:26px";

    const _addChip = (text) => {
      const chip = document.createElement("span");
      chip.style.cssText = "display:inline-flex;align-items:center;gap:4px;background:var(--bg-card,#1e1e2e);border:1px solid var(--border,#313244);border-radius:100px;padding:3px 10px 3px 10px;font-size:12px;color:var(--text,#cdd6f4)";
      chip.textContent = text;
      const rm = document.createElement("button");
      rm.textContent = "×"; rm.title = "Remove";
      rm.style.cssText = "background:none;border:none;color:var(--text-muted,#6c7086);cursor:pointer;font-size:14px;padding:0 0 0 4px;line-height:1";
      rm.addEventListener("click", () => chip.remove());
      chip.appendChild(rm);
      chips.appendChild(chip);
    };
    initialItems.forEach(_addChip);
    wrap.appendChild(chips);

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px";
    const inp = document.createElement("input");
    inp.id = inputId; inp.type = "text";
    inp.placeholder = "Add word or phrase…"; inp.maxLength = 128;
    inp.style.cssText = "flex:1;padding:5px 8px;font-size:13px;border:1px solid var(--border,#313244);border-radius:6px;background:var(--bg-main,#181825);color:var(--text,#cdd6f4);outline:none";
    const addBtn = document.createElement("button");
    addBtn.textContent = "Add"; addBtn.className = "btn-primary";
    addBtn.style.cssText = "padding:5px 14px;font-size:12px;white-space:nowrap";
    const _doAdd = () => {
      const val = inp.value.trim();
      if (!val) return;
      _addChip(val);
      inp.value = "";
      inp.focus();
    };
    addBtn.addEventListener("click", _doAdd);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); _doAdd(); } });
    row.appendChild(inp); row.appendChild(addBtn);
    wrap.appendChild(row);
    return wrap;
  };

  body.appendChild(_makeList("Prefer (use these words/phrases)", preferList, "vocab-prefer-chips", "vocab-prefer-input"));
  body.appendChild(_makeList("Avoid (never use these)",           avoidList,  "vocab-avoid-chips",  "vocab-avoid-input"));

  const saveRow = document.createElement("div");
  saveRow.style.cssText = "margin-top:6px;display:flex;align-items:center;gap:12px";
  const saveBtn = document.createElement("button");
  saveBtn.id = "vocab-save-btn"; saveBtn.className = "btn-primary"; saveBtn.textContent = "Save Vocabulary";
  const statusEl = document.createElement("span");
  statusEl.id = "vocab-save-status"; statusEl.className = "section-save-status";
  saveRow.appendChild(saveBtn); saveRow.appendChild(statusEl);
  body.appendChild(saveRow);

  saveBtn.addEventListener("click", async () => {
    const getChips = (id) => [...document.getElementById(id).querySelectorAll("span")].map(c => sanitizeText(c.childNodes[0]?.textContent || "")).filter(Boolean);
    const updated = { prefer: getChips("vocab-prefer-chips"), avoid: getChips("vocab-avoid-chips") };
    await window.appSet({ profileVocab: updated });
    showSectionStatus("vocab-save-status", "Saved!");
  });

  sec.appendChild(body);
  profileSection.appendChild(sec);
}

// ── AI Grammar Filters (Pro) ──────────────────────────────────────────────────

// Appends the grammar filters subsection to #profile-section.
// Hidden entirely for free users. Reads/writes grammarFilters storage key.
function initGrammarFiltersSection(s) {
  const profileSection = document.getElementById("profile-section");
  if (!profileSection) return;
  if (!isProUnlocked(s)) return;

  const gf = s.grammarFilters || {};

  const sec = document.createElement("details");
  sec.id = "grammar-filters-section";
  sec.style.cssText = "margin-top:24px;padding-top:20px;border-top:1px solid var(--surface,#313244)";

  const summary = document.createElement("summary");
  summary.style.cssText = "list-style:none;display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;margin-bottom:0";
  summary.innerHTML = '<span style="font-size:13px;font-weight:700;color:var(--text,#cdd6f4);flex:1">AI Grammar Filters</span><span class="gf-chevron" style="font-size:11px;color:var(--text-muted,#6c7086);transition:transform 0.15s">▼</span>';
  sec.appendChild(summary);

  sec.addEventListener("toggle", () => {
    const chevron = summary.querySelector(".gf-chevron");
    if (chevron) chevron.style.transform = sec.open ? "rotate(180deg)" : "";
  });

  const body = document.createElement("div");
  body.style.cssText = "margin-top:10px";

  const hint = document.createElement("p");
  hint.className = "hint"; hint.style.cssText = "margin-bottom:14px";
  hint.textContent = "These instructions are added to every AI prompt. Results depend on the model's compliance.";
  body.appendChild(hint);

  const emDashEnabled = !!(gf.emDash?.enabled);
  const emDashMode    = gf.emDash?.mode || "dont_add";

  const emRow = document.createElement("div");
  emRow.style.cssText = "margin-bottom:10px";
  const emLabel = document.createElement("label");
  emLabel.style.cssText = "display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px";
  const emChk = document.createElement("input");
  emChk.type = "checkbox"; emChk.id = "gf-em-dash"; emChk.checked = emDashEnabled;
  emLabel.appendChild(emChk);
  emLabel.appendChild(document.createTextNode("Avoid em dashes (—)"));

  const emSub = document.createElement("div");
  emSub.id = "gf-em-sub";
  emSub.style.cssText = "margin-left:24px;margin-top:6px;display:" + (emDashEnabled ? "block" : "none");

  const _radio = (value, label, checked) => {
    const lbl = document.createElement("label");
    lbl.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;margin-bottom:4px";
    const r = document.createElement("input");
    r.type = "radio"; r.name = "gf-em-mode"; r.value = value; r.checked = checked;
    lbl.appendChild(r); lbl.appendChild(document.createTextNode(label));
    return lbl;
  };
  emSub.appendChild(_radio("dont_add", "Don't add them",           emDashMode === "dont_add"));
  emSub.appendChild(_radio("replace",  "Replace with hyphen (-)",  emDashMode === "replace"));
  emChk.addEventListener("change", () => { emSub.style.display = emChk.checked ? "block" : "none"; });
  emRow.appendChild(emLabel); emRow.appendChild(emSub);
  body.appendChild(emRow);

  const _toggle = (id, labelText, checked) => {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom:10px";
    const lbl = document.createElement("label");
    lbl.style.cssText = "display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px";
    const chk = document.createElement("input");
    chk.type = "checkbox"; chk.id = id; chk.checked = !!checked;
    lbl.appendChild(chk); lbl.appendChild(document.createTextNode(labelText));
    row.appendChild(lbl);
    return row;
  };
  body.appendChild(_toggle("gf-no-headings", "No section headings (##, bold headers)",          gf.noHeadings));
  body.appendChild(_toggle("gf-no-filler",   "No filler openers (Additionally, Furthermore…)", gf.noFillerOpeners));
  body.appendChild(_toggle("gf-no-signoffs", "No formal sign-offs (I hope this helps…)",        gf.noFormalSignoffs));

  const saveRow = document.createElement("div");
  saveRow.style.cssText = "margin-top:14px;display:flex;align-items:center;gap:12px";
  const saveBtn = document.createElement("button");
  saveBtn.id = "grammar-save-btn"; saveBtn.className = "btn-primary"; saveBtn.textContent = "Save Grammar Filters";
  const statusEl = document.createElement("span");
  statusEl.id = "grammar-save-status"; statusEl.className = "section-save-status";
  saveRow.appendChild(saveBtn); saveRow.appendChild(statusEl);
  body.appendChild(saveRow);

  saveBtn.addEventListener("click", async () => {
    const emMode = document.querySelector('input[name="gf-em-mode"]:checked')?.value || "dont_add";
    const filters = {
      emDash:           { enabled: document.getElementById("gf-em-dash")?.checked    || false, mode: emMode },
      noHeadings:       document.getElementById("gf-no-headings")?.checked            || false,
      noFillerOpeners:  document.getElementById("gf-no-filler")?.checked              || false,
      noFormalSignoffs: document.getElementById("gf-no-signoffs")?.checked            || false
    };
    await window.appSet({ grammarFilters: filters });
    showSectionStatus("grammar-save-status", "Saved!");
  });

  sec.appendChild(body);
  profileSection.appendChild(sec);
}

// ── Export / Import (.ttbackup) ───────────────────────────────────────────────

// Adds Export/Import buttons to #pro-panel.
// Requires: window.platformSaveBackup(content, filename), window.platformOpenBackup()
// Optional: window.syncWithDesktopAfterImport() called after successful import
function initExportImportSection(s) {
  const panel = document.getElementById("pro-panel");
  if (!panel) return;

  const isPro = isProUnlocked(s);

  const sec = document.createElement("div");
  sec.id = "backup-section";
  sec.style.cssText = "margin-top:16px;padding-top:14px;border-top:1px solid var(--surface,#313244)";

  const titleEl = document.createElement("p");
  titleEl.style.cssText = "font-size:12px;font-weight:700;color:var(--text-muted,#6c7086);text-transform:uppercase;letter-spacing:0.04em;margin:0 0 10px 0;text-align:center";
  titleEl.textContent = "Backup";
  sec.appendChild(titleEl);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:10px;align-items:center;justify-content:center";

  const exportBtn = document.createElement("button");
  exportBtn.id = "backup-export-btn";
  exportBtn.className = "btn-primary";
  exportBtn.textContent = "Export Backup";
  exportBtn.disabled = !isPro;
  if (!isPro) exportBtn.title = "Pro feature — unlock Pro to export";

  const importBtn = document.createElement("button");
  importBtn.id = "backup-import-btn";
  importBtn.className = "revert-btn";
  importBtn.textContent = "Import Backup";

  btnRow.appendChild(exportBtn);
  btnRow.appendChild(importBtn);
  sec.appendChild(btnRow);

  // ── Export form ───────────────────────────────────────────────────────────

  const exportForm = document.createElement("div");
  exportForm.id = "backup-export-form";
  exportForm.style.cssText = "display:none;margin-top:12px;padding:12px;background:var(--bg-main,#181825);border:1px solid var(--border,#313244);border-radius:6px;max-width:360px;margin-left:auto;margin-right:auto";

  const _makeCheck = (id, labelText, checked) => {
    const lbl = document.createElement("label");
    lbl.style.cssText = "display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;margin-bottom:8px";
    const chk = document.createElement("input");
    chk.type = "checkbox"; chk.id = id; chk.checked = checked;
    lbl.appendChild(chk); lbl.appendChild(document.createTextNode(labelText));
    return lbl;
  };
  exportForm.appendChild(_makeCheck("export-include-settings", "Settings (providers, prompts, profile, preferences)", true));
  exportForm.appendChild(_makeCheck("export-include-history",  "History (today's activity log)", true));
  exportForm.appendChild(_makeCheck("export-protect-all",      "Protect all data with PIN", true));

  const credHint = document.createElement("p");
  credHint.className = "hint"; credHint.style.cssText = "margin:2px 0 10px 24px;font-size:11px";
  credHint.textContent = "Always protects your license credentials.";
  exportForm.appendChild(credHint);

  const _makePin = (id, placeholder) => {
    const inp = document.createElement("input");
    inp.type = "password"; inp.id = id; inp.placeholder = placeholder;
    inp.style.cssText = "width:100%;margin-bottom:8px";
    return inp;
  };
  exportForm.appendChild(_makePin("export-pin",         "PIN"));
  exportForm.appendChild(_makePin("export-pin-confirm", "Confirm PIN"));

  const warnEl = document.createElement("p");
  warnEl.className = "hint"; warnEl.style.cssText = "color:#f9e2af;font-size:11px;margin-bottom:10px";
  warnEl.textContent = "⚠ Store your PIN safely — it cannot be recovered.";
  exportForm.appendChild(warnEl);

  const exportErrEl = document.createElement("div");
  exportErrEl.id = "export-err"; exportErrEl.style.cssText = "color:#f38ba8;font-size:12px;margin-bottom:8px;display:none";
  exportForm.appendChild(exportErrEl);

  const exportActRow = document.createElement("div");
  exportActRow.style.cssText = "display:flex;gap:8px;justify-content:center";
  const doExportBtn = document.createElement("button");
  doExportBtn.id = "do-export-btn"; doExportBtn.className = "btn-primary"; doExportBtn.textContent = "Export";
  const cancelExportBtn = document.createElement("button");
  cancelExportBtn.className = "revert-btn";
  cancelExportBtn.textContent = "Cancel";
  exportActRow.appendChild(doExportBtn); exportActRow.appendChild(cancelExportBtn);
  exportForm.appendChild(exportActRow);

  sec.appendChild(exportForm);

  // ── Import status panel ───────────────────────────────────────────────────
  const importPanel = document.createElement("div");
  importPanel.id = "backup-import-panel";
  importPanel.style.cssText = "display:none;margin-top:12px;padding:14px 14px 10px;background:var(--bg-main,#181825);border:1px solid var(--border,#313244);border-radius:6px;max-width:360px;margin-left:auto;margin-right:auto";

  // Status bar — spinner + single-line current status (visible to all users)
  const importStatusBar = document.createElement("div");
  importStatusBar.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px;min-height:22px";
  const importSpinner = document.createElement("span");
  importSpinner.style.cssText = "display:none;width:14px;height:14px;border:2px solid var(--border,#313244);border-top-color:var(--accent,#89b4fa);border-radius:50%;animation:spin 0.7s linear infinite;flex-shrink:0";
  const importStatusText = document.createElement("span");
  importStatusText.style.cssText = "font-size:13px;color:var(--text,#cdd6f4)";
  importStatusBar.appendChild(importSpinner);
  importStatusBar.appendChild(importStatusText);
  importPanel.appendChild(importStatusBar);

  // Dev log — collapsed by default, auto-expanded in test/dev builds
  const importLogWrap = document.createElement("div");
  importLogWrap.style.cssText = "margin-bottom:8px;display:none";
  const importLogToggle = document.createElement("button");
  importLogToggle.style.cssText = "background:none;border:none;color:var(--muted,#6c7086);font-size:11px;cursor:pointer;padding:0;margin-bottom:4px";
  importLogToggle.textContent = "▶ Developer log";
  const importLogEl = document.createElement("div");
  importLogEl.style.cssText = "display:none;font-size:11px;font-family:monospace;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto;padding:8px;background:var(--bg3,#11111b);border-radius:4px";
  importLogToggle.addEventListener("click", () => {
    const open = importLogEl.style.display !== "none";
    importLogEl.style.display = open ? "none" : "flex";
    importLogToggle.textContent = (open ? "▶" : "▼") + " Developer log";
  });
  importLogWrap.appendChild(importLogToggle);
  importLogWrap.appendChild(importLogEl);
  importPanel.appendChild(importLogWrap);

  // Show dev log only in test/debug builds
  Promise.resolve().then(async () => {
    try {
      const cfg = typeof btcAPI !== "undefined" ? await btcAPI.getAppConfig() : null;
      if (cfg?.isTestBuild) {
        importLogWrap.style.display = "block";
        importLogEl.style.display = "flex";
        importLogToggle.textContent = "▼ Developer log";
      }
    } catch { /* not desktop or no config */ }
  });

  const importPinStep = document.createElement("div");
  importPinStep.style.display = "none";
  const importPinInput = document.createElement("input");
  importPinInput.type = "password"; importPinInput.placeholder = "Enter backup PIN";
  importPinInput.style.cssText = "width:100%;margin-bottom:8px";
  const importPinRow = document.createElement("div");
  importPinRow.style.cssText = "display:flex;gap:8px;justify-content:center";
  const importPinSubmit = document.createElement("button");
  importPinSubmit.className = "btn-primary"; importPinSubmit.textContent = "Decrypt";
  const importPinCancel = document.createElement("button");
  importPinCancel.className = "revert-btn"; importPinCancel.textContent = "Cancel";
  importPinRow.appendChild(importPinSubmit); importPinRow.appendChild(importPinCancel);
  importPinStep.appendChild(importPinInput); importPinStep.appendChild(importPinRow);
  importPanel.appendChild(importPinStep);

  const importConfirmStep = document.createElement("div");
  importConfirmStep.style.display = "none";
  const importConfirmMsg = document.createElement("p");
  importConfirmMsg.style.cssText = "font-size:12px;color:#f9e2af;margin-bottom:8px";
  const importConfirmRow = document.createElement("div");
  importConfirmRow.style.cssText = "display:flex;gap:8px;justify-content:center";
  const importConfirmYes = document.createElement("button");
  importConfirmYes.className = "btn-primary"; importConfirmYes.textContent = "Yes, Import";
  const importConfirmNo = document.createElement("button");
  importConfirmNo.className = "revert-btn"; importConfirmNo.textContent = "Cancel";
  importConfirmRow.appendChild(importConfirmYes); importConfirmRow.appendChild(importConfirmNo);
  importConfirmStep.appendChild(importConfirmMsg); importConfirmStep.appendChild(importConfirmRow);
  importPanel.appendChild(importConfirmStep);

  sec.appendChild(importPanel);

  const _LOG_ICONS  = { ok: "✓", error: "✗", warn: "⚠", info: "●" };
  const _LOG_COLORS = { ok: "var(--green,#a6e3a1)", error: "var(--red,#f38ba8)", warn: "#f9e2af", info: "var(--sub,#9399b2)" };
  function _importStatus(msg, type) {
    const t = type || "info";
    importStatusText.textContent = msg;
    importStatusText.style.color = _LOG_COLORS[t] || _LOG_COLORS.info;
  }
  function _importLog(msg, type) {
    const t   = type || "info";
    const row = document.createElement("div");
    row.style.cssText = `color:${_LOG_COLORS[t] || _LOG_COLORS.info};white-space:pre-wrap`;
    row.textContent = `${_LOG_ICONS[t] || "●"}  ${msg}`;
    importLogEl.appendChild(row);
    importLogEl.scrollTop = importLogEl.scrollHeight;
    _importStatus(msg, t);
    return row;
  }
  function _importLogUpdate(row, msg, type) {
    const t = type || "info";
    row.textContent = `${_LOG_ICONS[t] || "●"}  ${msg}`;
    row.style.color = _LOG_COLORS[t] || _LOG_COLORS.info;
    _importStatus(msg, t);
  }
  function _waitForPin() {
    return new Promise((resolve, reject) => {
      importPinStep.style.display = "";
      importPinInput.value = "";
      setTimeout(() => importPinInput.focus(), 50);
      function cleanup() {
        importPinSubmit.removeEventListener("click", onSubmit);
        importPinCancel.removeEventListener("click", onCancel);
        importPinInput.removeEventListener("keydown", onKey);
        importPinStep.style.display = "none";
      }
      function onSubmit() { cleanup(); resolve(importPinInput.value); }
      function onCancel() { cleanup(); reject(new Error("cancelled")); }
      function onKey(e)   { if (e.key === "Enter") onSubmit(); }
      importPinSubmit.addEventListener("click", onSubmit);
      importPinCancel.addEventListener("click", onCancel);
      importPinInput.addEventListener("keydown", onKey);
    });
  }
  function _waitForConfirm(msg) {
    return new Promise((resolve, reject) => {
      importConfirmMsg.textContent = msg;
      importConfirmStep.style.display = "";
      function onYes() { cleanup(); resolve(); }
      function onNo()  { cleanup(); reject(new Error("cancelled")); }
      function cleanup() {
        importConfirmYes.removeEventListener("click", onYes);
        importConfirmNo.removeEventListener("click", onNo);
        importConfirmStep.style.display = "none";
      }
      importConfirmYes.addEventListener("click", onYes, { once: true });
      importConfirmNo.addEventListener("click", onNo,  { once: true });
    });
  }

  exportBtn.addEventListener("click", () => {
    exportForm.style.display = exportForm.style.display === "none" ? "block" : "none";
    importPanel.style.display = "none";
  });
  cancelExportBtn.addEventListener("click", () => {
    exportForm.style.display = "none";
  });

  doExportBtn.addEventListener("click", async () => {
    const pin        = document.getElementById("export-pin")?.value || "";
    const confirmPin = document.getElementById("export-pin-confirm")?.value || "";
    const errEl      = document.getElementById("export-err");
    errEl.style.display = "none";
    if (!pin || !confirmPin)  { errEl.textContent = "Enter and confirm a PIN."; errEl.style.display = ""; return; }
    if (pin !== confirmPin)   { errEl.textContent = "PINs don't match."; errEl.style.display = ""; return; }

    doExportBtn.disabled = true; doExportBtn.textContent = "Exporting…";
    try {
      const incSettings = document.getElementById("export-include-settings")?.checked !== false;
      const incHistory  = document.getElementById("export-include-history")?.checked  !== false;
      const protectAll  = document.getElementById("export-protect-all")?.checked       !== false;

      const stored = await window.appGet([
        "configuredProviders", "geminiModels",
        "provider", "openaiKey", "claudeKey", "geminiKey",
        "openaiModel", "claudeModel", "geminiModel", "variants", "customPrompts",
        "actionSettings", "profileName", "profileRole", "profileStyle", "profileContext",
        "profileEnabled", "profileVocab", "licenseEmail", "licenseKey", "contextPresets", "contextEnabled",
        "audienceLevel", "grammarFilters", "historyFull", "historyLog", "demoMode", "corpMode"
      ]);

      const settingsPayload = incSettings ? (() => {
        const copy = { ...stored };
        delete copy.licenseEmail; delete copy.licenseKey;
        delete copy.demoMode;     delete copy.corpMode;
        delete copy.historyFull;  delete copy.historyLog;
        return copy;
      })() : undefined;

      const historyPayload = incHistory
        ? { full: stored.historyFull, log: stored.historyLog }
        : undefined;

      // Demo/corp licenses are device-bound — never export credentials
      const exportEmail = (stored.demoMode === "active" || stored.corpMode === "active") ? "" : (stored.licenseEmail || "");
      const exportKey   = (stored.demoMode === "active" || stored.corpMode === "active") ? "" : (stored.licenseKey   || "");

      let json = await buildExport(
        { settings: settingsPayload, history: historyPayload,
          licenseEmail: exportEmail, licenseKey: exportKey },
        pin, protectAll
      );

      if (stored.demoMode === "active" || stored.corpMode === "active") {
        const parsed = JSON.parse(json);
        parsed.license_note = stored.demoMode === "active"
          ? "demo license: not exported (non-transferable)"
          : "corp license: not exported (device-bound)";
        json = JSON.stringify(parsed);
      }

      const today    = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const filename = `thought-tidy-backup-${today}.ttbackup`;

      if (typeof window.platformSaveBackup === "function") {
        await window.platformSaveBackup(json, filename);
      }
      exportForm.style.display = "none";
      document.getElementById("export-pin").value         = "";
      document.getElementById("export-pin-confirm").value = "";
    } catch (err) {
      exportErrEl.textContent = err.message; exportErrEl.style.display = "";
    } finally {
      doExportBtn.disabled = false; doExportBtn.textContent = "Export";
    }
  });

  // ── Import flow ───────────────────────────────────────────────────────────

  importBtn.addEventListener("click", async () => {
    if (typeof window.platformOpenBackup !== "function") return;
    importLogEl.innerHTML = "";
    importStatusText.textContent = "";
    importSpinner.style.display = "inline-block";
    importPanel.style.display = "";
    exportForm.style.display = "none";
    importBtn.disabled = true;

    try {
      // Step 1 — open file
      const fileRow = _importLog("Opening backup file…");
      let content;
      try { content = await window.platformOpenBackup(); } catch {
        _importLogUpdate(fileRow, "Failed to open file.", "error"); return;
      }
      if (!content) { importPanel.style.display = "none"; return; }
      _importLogUpdate(fileRow, "Backup file loaded.", "ok");

      // Step 2 — parse
      const parseRow = _importLog("Parsing backup…");
      let parsed;
      try { parsed = parseExport(content); } catch (err) {
        importSpinner.style.display = "none";
        _importLogUpdate(parseRow, "Invalid backup: " + err.message, "error"); return;
      }
      const parts = [parsed.settings && "settings", parsed.history && "history", parsed.auth && "license"].filter(Boolean);
      const fileDate = parsed.exported_at ? new Date(parsed.exported_at).toLocaleDateString() : null;
      const fileSummary = `Contains: ${parts.join(" + ")}${fileDate ? `  ·  Exported ${fileDate}` : ""}`;
      _importLogUpdate(parseRow, fileSummary, "ok");
      // Stop spinner — show file summary to user before PIN entry
      importSpinner.style.display = "none";
      importStatusText.textContent = fileSummary;
      importStatusText.style.color = "var(--text,#cdd6f4)";

      // Step 3 — decrypt (PIN only required when protect_all = true)
      let decrypted = null;
      if (parsed.protect_all) {
        for (let attempt = 0; attempt < 3; attempt++) {
          _importLog(attempt === 0 ? "Enter PIN to decrypt:" : "Wrong PIN — try again:");
          let pin;
          try { pin = await _waitForPin(); } catch {
            _importLog("Import cancelled.", "warn"); return;
          }
          importSpinner.style.display = "inline-block";
          const decRow = _importLog("Decrypting…");
          try {
            decrypted = await decryptExport(parsed, pin);
            _importLogUpdate(decRow, "Decrypted successfully.", "ok");
            break;
          } catch {
            _importLogUpdate(decRow, "Wrong PIN.", "error");
            if (attempt === 2) { _importLog("Too many failed attempts — import cancelled.", "error"); return; }
          }
        }
        if (!decrypted) return;
      } else {
        // Settings and history are plain JSON — no PIN needed for those.
        // Auth (license/activation) is still encrypted; offer optional PIN to restore it.
        _importLog("Backup is not fully encrypted — settings and history import without a PIN.", "info");
        _importLog("Enter PIN to also restore license activation (or leave blank to skip):");
        let licenseEmail = null; let licenseKey = null;
        try {
          const pin = await _waitForPin();
          if (pin) {
            importSpinner.style.display = "inline-block";
            const decRow = _importLog("Decrypting license…");
            try {
              const authResult = await decryptExport(parsed, pin);
              licenseEmail = authResult.licenseEmail || null;
              licenseKey   = authResult.licenseKey   || null;
              _importLogUpdate(decRow, "License credentials decrypted.", "ok");
            } catch {
              _importLogUpdate(decRow, "Wrong PIN — license will not be restored.", "warn");
            }
          } else {
            _importLog("No PIN entered — license activation will not be restored.", "warn");
          }
        } catch {
          _importLog("PIN step skipped — license activation will not be restored.", "warn");
        }
        decrypted = { settings: parsed.settings || null, history: parsed.history || null,
                      licenseEmail, licenseKey };
      }

      // Step 4 — confirm
      const what = [decrypted.settings && "settings", decrypted.history && "history",
                    (decrypted.licenseEmail) && "license"].filter(Boolean).join(", ");
      try {
        await _waitForConfirm(`Importing: ${what}. This overwrites current data. Continue?`);
      } catch { _importLog("Import cancelled.", "warn"); return; }

      // Step 5 — apply
      importSpinner.style.display = "inline-block";
      if (decrypted.settings) {
        const r = _importLog("Applying settings…");
        const safe = Object.fromEntries(
          Object.entries(decrypted.settings).filter(([k]) => BACKUP_SETTINGS_KEYS.has(k))
        );
        if (Array.isArray(safe.configuredProviders)) {
          const _BLOCKED_HOSTS = /^(0\.0\.0\.0|169\.254\.\d+\.\d+|metadata\.google\.internal)$/i;
          safe.configuredProviders = safe.configuredProviders.filter(p => {
            if (!p.baseUrl) return true;
            try {
              const u = new URL(p.baseUrl);
              if (u.protocol !== "http:" && u.protocol !== "https:") return false;
              if (_BLOCKED_HOSTS.test(u.hostname.toLowerCase())) return false;
              return true;
            } catch { return false; }
          });
        }
        await window.appSet(safe);
        _importLogUpdate(r, "Settings applied.", "ok");
      }
      if (decrypted.history) {
        const r = _importLog("Applying history…");
        const h = decrypted.history;
        const toSet = {};
        if (h.full !== undefined) toSet.historyFull = h.full;
        if (h.log  !== undefined) toSet.historyLog  = h.log;
        if (Object.keys(toSet).length) await window.appSet(toSet);
        _importLogUpdate(r, "History applied.", "ok");
      }
      if (decrypted.licenseEmail && decrypted.licenseKey) {
        const r = _importLog("Verifying license…");
        const stored = await window.appGet(["deviceActivated"]);
        if (stored.deviceActivated === decrypted.licenseKey) {
          await window.appSet({ licenseEmail: decrypted.licenseEmail, licenseKey: decrypted.licenseKey });
          _importLogUpdate(r, "License restored (device already activated).", "ok");
        } else {
          const result = await verifyWithGumroad(decrypted.licenseEmail, decrypted.licenseKey);
          if (result.valid) {
            await window.appSet({ licenseEmail: decrypted.licenseEmail, licenseKey: decrypted.licenseKey });
            _importLogUpdate(r, "License verified and applied.", "ok");
          } else {
            _importLogUpdate(r, result.error || "License verification failed.", "warn");
          }
        }
      }

      if (typeof window.syncWithDesktopAfterImport === "function") {
        window.syncWithDesktopAfterImport().catch(() => {});
      }

      importSpinner.style.display = "none";
      _importLog("Import complete — reloading…", "ok");
      setTimeout(() => location.reload(), 1400);

    } finally {
      importSpinner.style.display = "none";
      importBtn.disabled = false;
    }
  });

  panel.appendChild(sec);

  // ── About / version sub-section ───────────────────────────────────────────
  const aboutSec = document.createElement("div");
  aboutSec.id = "about-section";
  aboutSec.style.cssText = "margin-top:16px;padding-top:14px;border-top:1px solid var(--surface,#313244)";

  const aboutTitle = document.createElement("p");
  aboutTitle.style.cssText = "font-size:12px;font-weight:700;color:var(--text-muted,#6c7086);text-transform:uppercase;letter-spacing:0.04em;margin:0 0 10px 0;text-align:center";
  aboutTitle.textContent = "About";
  aboutSec.appendChild(aboutTitle);

  const extVer = (typeof browser !== "undefined") && browser.runtime?.getManifest?.()?.version;

  // Single row: version + button together, centred
  const aboutRow = document.createElement("div");
  aboutRow.style.cssText = "display:flex;align-items:center;justify-content:center;gap:14px";

  const verEl = document.createElement("span");
  verEl.id = "about-version-text";
  verEl.style.cssText = "font-size:13px;color:var(--text,#cdd6f4);font-weight:600";
  verEl.textContent = extVer ? `v${extVer}` : "—";

  const checkBtn = document.createElement("button");
  checkBtn.id = "about-check-update-btn";
  checkBtn.className = "revert-btn";
  checkBtn.style.cssText = "font-size:11.5px;padding:4px 12px;flex-shrink:0";
  checkBtn.textContent = "Check for updates";

  aboutRow.appendChild(verEl);
  aboutRow.appendChild(checkBtn);
  aboutSec.appendChild(aboutRow);

  // Status line — hidden until there is something to show
  const checkStatus = document.createElement("p");
  checkStatus.id = "about-update-status";
  checkStatus.style.cssText = "display:none;margin:6px 0 0;font-size:12px;text-align:center";
  aboutSec.appendChild(checkStatus);

  panel.appendChild(aboutSec);

  checkBtn.addEventListener("click", async () => {
    checkBtn.disabled = true;
    checkStatus.style.display = "block";
    checkStatus.style.color = "var(--text-muted,#6c7086)";
    checkStatus.textContent = "Checking…";
    try {
      const stored = await window.appGet(["updateAvailable"]);
      const upd = stored.updateAvailable;
      if (upd?.version) {
        checkStatus.textContent = "";
        const msg = document.createElement("span");
        msg.textContent = `Update available: v${upd.version}  `;
        msg.style.color = "#93c5fd";
        const dl = document.createElement("a");
        dl.textContent = "Download ↗";
        dl.style.cssText = "color:#93c5fd;text-decoration:underline;cursor:pointer";
        if (typeof window.platformOpenURL === "function") {
          dl.addEventListener("click", () => window.platformOpenURL(upd.url));
        } else {
          dl.href = upd.url; dl.target = "_blank"; dl.rel = "noopener";
        }
        checkStatus.appendChild(msg);
        checkStatus.appendChild(dl);
      } else {
        checkStatus.style.color = "var(--green,#10b981)";
        checkStatus.textContent = "Up to date";
      }
    } catch {
      checkStatus.style.color = "var(--text-muted,#6c7086)";
      checkStatus.textContent = "Could not check";
    }
    checkBtn.disabled = false;
  });
}

// ── Dev-mode easter egg (click "Add Provider" 5× in 10 s) ────────────────────

function wireDevModeEasterEgg(btnId) {
  let _clicks = [];
  document.getElementById(btnId)?.addEventListener("click", async () => {
    const now = Date.now();
    _clicks = _clicks.filter(t => now - t < 10000);
    _clicks.push(now);
    if (_clicks.length < 5) return;
    _clicks = [];
    const { devMode: cur } = await browser.storage.local.get("devMode");
    const next = !cur;
    await browser.storage.local.set({ devMode: next });
    const toast = document.createElement("div");
    toast.textContent = next ? "🛠 Developer mode enabled" : "Developer mode disabled";
    toast.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#313244;color:#cdd6f4;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.5);pointer-events:none;";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  });
}
