// Desktop popup shell — delegates shared logic to lib/shared-popup.js
/* global browser, btcAPI, todayDate, purgeOldLog */

window.RUN_BTN_ID   = "run-btn";
window.POPUP_SOURCE = "desktop";

window.buildSlotActions = (box) => {
  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", async () => {
    await btcAPI.writeClipboard(box.innerText);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy"), 1600);
  });
  const copyCloseBtn = document.createElement("button");
  copyCloseBtn.className   = "copy-close-btn";
  copyCloseBtn.textContent = "Copy & Close";
  copyCloseBtn.addEventListener("click", async () => {
    await btcAPI.writeClipboard(box.innerText);
    btcAPI.closePopup();
  });
  return [copyBtn, copyCloseBtn];
};

const PROVIDER_LABELS = { openai: "OpenAI", claude: "Claude", gemini: "Gemini", copilot: "GitHub Models", ollama: "Ollama", lmstudio: "LM Studio", jan: "Jan AI", hosted: "Thought Tidy AI" };

const STORAGE_KEYS = [
  "configuredProviders", "geminiModels",
  "provider", "openaiKey", "claudeKey", "geminiKey",
  "openaiModel", "claudeModel", "geminiModel",
  "variants", "customPrompts", "actionSettings", "lastAction",
  "profileName", "profileRole", "profileStyle", "profileContext", "profileEnabled", "profileVocab",
  "licenseEmail", "licenseKey", "demoMode", "corpMode", "showContextField", "contextText", "contextLevel", "contextPresets",
  "lastContextAudience", "contextEnabled", "themeMode", "historyPin", "grammarFilters",
  "clearOnOpen", "showClarityCheckBtn"
];

function updateFooter() {
  const badge = document.getElementById("provider-badge");
  if (!badge) return;
  const s         = getPopupSettings();
  const providers = s.configuredProviders;
  if (Array.isArray(providers) && providers.length > 0) {
    const p     = providers[0];
    const label = PROVIDER_LABELS[p.id] || p.id;
    const model = p.id === "gemini"
      ? (s.geminiModels?.find(Boolean) || p.model || "")
      : p.id === "hosted"
      ? (p.a3yn9n || "")
      : (p.model || "");
    badge.textContent = model ? `${label} · ${model}` : label;
  } else {
    badge.textContent = "No provider. Open Settings";
  }
}


function applyClearOnOpen(s) {
  const chk = document.getElementById("clear-on-open-chk");
  if (chk) chk.checked = !!s.clearOnOpen;
  if (s.clearOnOpen) {
    const ta = document.getElementById("input-text");
    if (ta) {
      ta.value = "";
      ta.dispatchEvent(new Event("input"));
      // Also hide any previous result
      const resultArea = document.getElementById("result-area");
      if (resultArea) resultArea.style.display = "none";
      const slotsEl = document.getElementById("result-slots");
      if (slotsEl) slotsEl.innerHTML = "";
    }
  }
}

async function init() {
  const s = await window.appGet(STORAGE_KEYS);
  setPopupSettings(s);
  document.documentElement.setAttribute("data-theme", s.themeMode || "dark");
  updateFooter();
  rebuildActionDropdown();
  rebuildVariantsSelect();
  populateAudienceSelect();
  restoreContextAudience();
  wireContextSheetHandlers();
  wireClarityCheckBtn();
  document.getElementById("input-text").focus();
  initTextareaAutogrow();

  btcAPI.onPopupOpened(async () => {
    const fresh = await window.appGet(STORAGE_KEYS);
    setPopupSettings(fresh);
    document.documentElement.setAttribute("data-theme", fresh.themeMode || "dark");
    updateFooter();
    rebuildActionDropdown();
    rebuildVariantsSelect();
    populateAudienceSelect();
    restoreContextAudience();
    applyClearOnOpen(fresh);
    // Reset multi-column layout but keep the toggle button visible
    const expandBtn = document.getElementById("result-expand-btn");
    if (expandBtn) {
      expandBtn.dataset.expanded = "0";
      expandBtn.textContent = "⇔ Side by side";
    }
    document.getElementById("result-slots")?.classList.remove("multi-col");
    if (typeof btcAPI.resizePopup === "function") btcAPI.resizePopup(1);
    document.getElementById("input-text").focus();
    // Background daily license check on each popup show.
    _runDailyLicenseCheck(fresh);
  });

  document.getElementById("variants-select")?.addEventListener("change", (e) => {
    window.appSet({ variants: e.target.value });
  });

  document.getElementById("close-btn").addEventListener("click", () => btcAPI.closePopup());
  document.getElementById("history-btn").addEventListener("click", () => btcAPI.openHistory());
  document.getElementById("settings-btn").addEventListener("click", () => btcAPI.openSettings());
  document.getElementById("run-btn").addEventListener("click", runProcess);

  document.getElementById("paste-btn").addEventListener("click", async () => {
    const raw = (await btcAPI.readClipboard()).trim();
    if (!raw) return;
    const textarea = document.getElementById("input-text");
    textarea.value = cleanPastedText(raw, false);
    textarea.dispatchEvent(new Event("input"));
    textarea.focus();
    textarea.select();
  });

  document.getElementById("input-text").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const btn = document.getElementById("run-btn");
      if (!btn || btn.disabled) return;
      runProcess();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") btcAPI.closePopup();
    if (e.ctrlKey && (e.key === "+" || e.key === "-" || e.key === "=" || e.key === "0")) {
      e.preventDefault();
    }
  });
  document.addEventListener("wheel", (e) => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });
}

function _runDailyLicenseCheck(s) {
  if (!s.licenseEmail && !s.licenseKey && !s.demoMode && !s.corpMode) return;
  checkLicensePeriodically(s.licenseEmail || "", s.licenseKey || "").then(r => {
    if (r?.revoked) {
      window.appSet({ licenseEmail: "", licenseKey: "", deviceActivated: "" });
      setPopupSettings({ ...getPopupSettings(), licenseEmail: "", licenseKey: "", demoMode: false, corpMode: false });
      rebuildVariantsSelect();
    }
  }).catch(() => {});
}

init().then(() => { loadHistory(); _runDailyLicenseCheck(getPopupSettings()); });

window.addEventListener("focus", async () => {
  const stored = await window.appGet(["showClarityCheckBtn", "contextEnabled"]);
  const s = getPopupSettings();
  const changed = stored.showClarityCheckBtn !== s.showClarityCheckBtn
               || stored.contextEnabled      !== s.contextEnabled;
  if (changed) {
    setPopupSettings({ ...s, showClarityCheckBtn: stored.showClarityCheckBtn, contextEnabled: stored.contextEnabled });
    rebuildVariantsSelect();
    restoreContextAudience();
  }
});
