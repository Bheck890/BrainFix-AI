// background.js — Thought Tidy event wiring (MV3 service worker)
importScripts("browser-polyfill.js", "lib/build-flags.js", "lib/text.js", "lib/prompts.js", "lib/pricing.js", "lib/license.js", "lib/api.js", "lib/updater.js", "lib/crypto-storage.js");

const DYN_SEP = "dyn-sep";
const DYN_MAX = 8;
const dynId   = (i) => `dyn-${i}`;

async function rebuildCustomMenu() {
  const toRemove = [DYN_SEP, ...Array.from({ length: DYN_MAX }, (_, i) => dynId(i))];
  await Promise.all(toRemove.map(id => browser.contextMenus.remove(id).catch(() => {})));

  const { customPrompts = [] } = await browser.storage.local.get("customPrompts");
  if (!customPrompts.length) return;

  await browser.contextMenus.create({
    id: DYN_SEP, parentId: "ai-root", type: "separator", contexts: ["selection"]
  });
  for (let i = 0; i < Math.min(customPrompts.length, DYN_MAX); i++) {
    await browser.contextMenus.create({
      id: dynId(i), parentId: "ai-root",
      title: `⚡ ${customPrompts[i].name}`,
      contexts: ["selection"]
    });
  }
}

browser.runtime.onInstalled.addListener(async () => {
  await migrateExtensionKeys();
  await syncWithDesktop();

  browser.contextMenus.create({ id: "ai-root", title: "Thought Tidy", contexts: ["selection"] });
  browser.contextMenus.create({ id: "see-history", title: "📋  See History", contexts: ["all"] });

  // TEST ONLY label — top of submenu, only in test builds
  if (typeof BUILD_FLAGS !== 'undefined' && BUILD_FLAGS.testBuild) {
    browser.contextMenus.create({
      id: "test-only-label", parentId: "ai-root",
      title: "── TEST ONLY ──", enabled: false, contexts: ["selection"]
    });
  }

  browser.contextMenus.create({ id: "sound-like-me", parentId: "ai-root", title: "👤  Sound Like Me",             contexts: ["selection"] });
  browser.contextMenus.create({ id: "fix-spelling",  parentId: "ai-root", title: "✓   Fix Spelling & Grammar",   contexts: ["selection"] });
  browser.contextMenus.create({ id: "professional",  parentId: "ai-root", title: "★   Make Professional",        contexts: ["selection"] });
  browser.contextMenus.create({ id: "sound-human",   parentId: "ai-root", title: "💬  Sound Human",              contexts: ["selection"] });
  browser.contextMenus.create({ id: "brain-dump",    parentId: "ai-root", title: "🧠  Brain Dump → Clear Text",  contexts: ["selection"] });
  browser.contextMenus.create({ id: "sep1",          parentId: "ai-root", type: "separator",                     contexts: ["selection"] });
  browser.contextMenus.create({ id: "improve",       parentId: "ai-root", title: "↑   Improve Writing",          contexts: ["selection"] });
  browser.contextMenus.create({ id: "formal",        parentId: "ai-root", title: "    Make Formal",              contexts: ["selection"] });
  browser.contextMenus.create({ id: "casual",        parentId: "ai-root", title: "    Make Casual",              contexts: ["selection"] });
  browser.contextMenus.create({ id: "shorten",       parentId: "ai-root", title: "    Shorten",                  contexts: ["selection"] });
  browser.contextMenus.create({ id: "expand",        parentId: "ai-root", title: "    Expand",                   contexts: ["selection"] });
  await rebuildCustomMenu();
});

browser.runtime.onStartup.addListener(async () => {
  rebuildCustomMenu();
  await migrateExtensionKeys();
  await syncWithDesktop();
});
browser.storage.onChanged.addListener((changes) => {
  if (changes.customPrompts) rebuildCustomMenu();
});

const PROVIDER_STORAGE_KEYS = [
  "configuredProviders", "geminiModels",
  // legacy keys kept for migration shim in callAIWithFallback
  "provider", "openaiKey", "claudeKey", "geminiKey",
  "openaiModel", "claudeModel", "geminiModel"
];

// The extension calls cloud APIs directly; local providers (Ollama, LM Studio, Jan AI)
// are desktop-only and are filtered out before every AI dispatch.
const _EXT_LOCAL_IDS = new Set(["ollama", "lmstudio", "jan"]);

// ── Run from popup (Process Selected Text button) ────────────────────────────
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "run-from-popup") return;
  if (sender.id !== browser.runtime.id) return;
  (async () => {
    const { tabId, actionVal, selectedText } = msg;
    const settings = await cryptoGet([
      ...PROVIDER_STORAGE_KEYS,
      "customPrompts",
      "profileName", "profileRole", "profileStyle", "profileContext", "profileEnabled"
    ]);

    let systemPrompt;
    if (actionVal.startsWith("custom-")) {
      const idx = parseInt(actionVal.replace("custom-", ""), 10);
      systemPrompt = (settings.customPrompts || [])[idx]?.prompt || "Process the following text:";
    } else {
      systemPrompt = MENU_PROMPTS[actionVal];
      if (!systemPrompt) return;
    }
    const basePrompt = systemPrompt;
    systemPrompt = buildPromptWithProfile(systemPrompt, settings);

    browser.tabs.sendMessage(tabId, { action: "show-loading", originalText: selectedText });
    try {
      const cloudProviders = (settings.configuredProviders || []).filter(p => !_EXT_LOCAL_IDS.has(p.id));
      const { result, usedProvider, usedModel } = await callAIWithFallback(
        cloudProviders, settings.geminiModels, settings, systemPrompt, selectedText, { basePrompt }
      );
      browser.tabs.sendMessage(tabId, { action: "show-results", originalText: selectedText, results: [result] });

      const today = todayDate();

      const stored0 = await browser.storage.local.get(["historyLog", "historyFull"]);
      const fresh = purgeOldLog(stored0.historyLog || []);
      fresh.push({
        timestamp: Date.now(), date: today, source: "extension",
        action: actionVal, provider: usedProvider, model: usedModel,
        inputLen: selectedText.length, outputLen: result.length
      });
      const cost = estimateCost(usedModel, selectedText, [result]);
      const historyFull0 = stored0.historyFull || [];
      historyFull0.push({
        id: uid(), timestamp: Date.now(), date: today, source: "extension",
        action: actionVal, provider: usedProvider, model: usedModel,
        systemPrompt: systemPrompt.slice(0, 2000),
        inputText: selectedText.slice(0, 5000),
        outputs: [result.slice(0, 5000)],
        ...cost
      });
      await browser.storage.local.set({
        historyLog: fresh.slice(-200), lastAction: actionVal,
        historyFull: historyFull0.slice(-500)
      });
    } catch (err) {
      browser.tabs.sendMessage(tabId, { action: "show-error", error: err.message.replace(/\b(sk-|AIza)[A-Za-z0-9_-]{4,}/g, "[key]") });
    }
  })();
  return true;
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "see-history") {
    browser.tabs.create({ url: browser.runtime.getURL("history/history.html") });
    return;
  }

  if (!info.selectionText) return;

  const selectedText = info.selectionText.trim();
  const menuId       = info.menuItemId;

  const settings = await cryptoGet([
    ...PROVIDER_STORAGE_KEYS,
    "variants", "customPrompts",
    "profileName", "profileRole", "profileStyle", "profileContext", "profileEnabled",
    "licenseEmail", "licenseKey"
  ]);

  const variants = menuId === "fix-spelling" || !isProUnlocked(settings)
    ? 1
    : Math.max(1, Math.min(4, parseInt(settings.variants, 10) || 1));

  let systemPrompt;
  if (menuId.startsWith("dyn-")) {
    const idx = parseInt(menuId.replace("dyn-", ""), 10);
    const cp  = (settings.customPrompts || [])[idx];
    systemPrompt = cp?.prompt || "Process the following text:";
  } else {
    systemPrompt = MENU_PROMPTS[menuId];
    if (!systemPrompt) return;
  }
  const basePrompt = systemPrompt;
  systemPrompt = buildPromptWithProfile(systemPrompt, settings);

  browser.tabs.sendMessage(tab.id, { action: "show-loading", originalText: selectedText });

  try {
    const cloudProviders = (settings.configuredProviders || []).filter(p => !_EXT_LOCAL_IDS.has(p.id));
    const results = [];
    let usedProvider = "", usedModel = "";
    for (let i = 0; i < variants; i++) {
      const r = await callAIWithFallback(
        cloudProviders, settings.geminiModels, settings, systemPrompt, selectedText, { basePrompt }
      );
      results.push(r.result);
      usedProvider = r.usedProvider;
      usedModel    = r.usedModel;
    }
    browser.tabs.sendMessage(tab.id, { action: "show-results", originalText: selectedText, results });

    const lastAction = menuId.startsWith("dyn-") ? menuId.replace("dyn-", "custom-") : menuId;
    const today = todayDate();

    const stored1 = await browser.storage.local.get(["historyLog", "historyFull"]);
    const fresh = purgeOldLog(stored1.historyLog || []);
    fresh.push({
      timestamp: Date.now(), date: today, source: "extension",
      action: lastAction, provider: usedProvider, model: usedModel,
      inputLen: selectedText.length,
      outputLen: results.reduce((s, r) => s + r.length, 0)
    });
    const cost = estimateCost(usedModel, selectedText, results);
    const historyFull1 = stored1.historyFull || [];
    historyFull1.push({
      id: uid(), timestamp: Date.now(), date: today, source: "extension",
      action: lastAction, provider: usedProvider, model: usedModel,
      systemPrompt: systemPrompt.slice(0, 2000),
      inputText: selectedText.slice(0, 5000),
      outputs: results.map(r => r.slice(0, 5000)),
      ...cost
    });
    await browser.storage.local.set({
      lastAction,
      historyLog: fresh.slice(-200),
      historyFull: historyFull1.slice(-500)
    });
  } catch (err) {
    browser.tabs.sendMessage(tab.id, { action: "show-error", error: err.message });
  }
});
