'use strict';
/* global browser, HistoryUI, cryptoGet, cryptoSet */

let allEntries = [];
const copyFn = text => navigator.clipboard.writeText(text);

const clearBtn = document.getElementById("clear-all-btn");
clearBtn.disabled = true;

async function load() {
  const data  = await cryptoGet(["historyFull", "devMode", "historyPin"]);
  const badge = document.getElementById("dev-mode-badge");
  if (badge) badge.style.display = data.devMode ? "inline-block" : "none";

  const onReady = fresh => {
    allEntries = [...(fresh.historyFull || [])].reverse();
    HistoryUI.render(allEntries, copyFn);
    HistoryUI.showSetPinBtn(hash => HistoryUI.showPinManagement(hash));
    clearBtn.disabled = false;
  };

  if (data.historyPin) {
    HistoryUI.showPinGate(data, onReady);
    return;
  }
  onReady(data);
}

document.getElementById("search-input").addEventListener("input", e => {
  const q = sanitizeText(e.target.value).toLowerCase();
  if (!q) { HistoryUI.render(allEntries, copyFn); return; }
  HistoryUI.render(allEntries.filter(entry =>
    (entry.action       || "").toLowerCase().includes(q) ||
    (entry.inputText    || "").toLowerCase().includes(q) ||
    (entry.systemPrompt || "").toLowerCase().includes(q) ||
    (entry.provider     || "").toLowerCase().includes(q) ||
    (entry.model        || "").toLowerCase().includes(q) ||
    (entry.outputs      || []).some(o => o.toLowerCase().includes(q))
  ), copyFn);
});

clearBtn.addEventListener("click", async () => {
  if (!confirm(`Delete all ${allEntries.length} history entries? This cannot be undone.`)) return;
  await cryptoSet({ historyFull: [] });
  allEntries = [];
  HistoryUI.render([], copyFn);
});

load();
