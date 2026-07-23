// content.js — DOM wiring only
// wordCount, wordDiff, esc are globals from lib/text.js (loaded first by manifest)

let savedRange    = null;
let savedActive   = null;   // element that had focus when context menu opened
let savedStart    = 0;
let savedEnd      = 0;
let modal         = null;
let _currentResults = []; // kept in module scope, not on the DOM node

document.addEventListener("contextmenu", () => {
  const el = document.activeElement;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
    savedActive = el;
    savedStart  = el.selectionStart;
    savedEnd    = el.selectionEnd;
    savedRange  = null;
  } else {
    savedActive = null;
    const sel = window.getSelection();
    savedRange = (sel && sel.rangeCount > 0 && sel.toString().trim())
      ? sel.getRangeAt(0).cloneRange()
      : null;
  }
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg.action === "show-loading") showModal(msg.originalText, null, true);
  if (msg.action === "show-results") showModal(msg.originalText, msg.results, false);
  if (msg.action === "show-error")   showError(msg.error);
});

function showModal(originalText, results, loading) {
  removeModal();

  const overlay = document.createElement("div");
  overlay.id = "aie-overlay";

  const modalEl = document.createElement("div");
  modalEl.id = "aie-modal";

  // Header
  const titleSpan = document.createElement("span");
  titleSpan.textContent = "✦ Thought Tidy";
  const closeBtn = document.createElement("button");
  closeBtn.id = "aie-close";
  closeBtn.title = "Close (Esc)";
  closeBtn.textContent = "✕";
  const header = document.createElement("div");
  header.id = "aie-header";
  header.append(titleSpan, closeBtn);

  // Body
  const body = document.createElement("div");
  body.id = "aie-body";

  // Original section
  const origWC = document.createElement("span");
  origWC.className = "aie-wordcount";
  origWC.textContent = `${wordCount(originalText)} words`;
  const origLabel = document.createElement("div");
  origLabel.className = "aie-label";
  origLabel.append("Original ", origWC);
  const origBox = document.createElement("div");
  origBox.className = "aie-box aie-original";
  origBox.textContent = originalText; // white-space:pre-wrap in CSS handles newlines
  const origSection = document.createElement("div");
  origSection.className = "aie-section";
  origSection.append(origLabel, origBox);
  body.appendChild(origSection);

  // Loading spinner
  if (loading) {
    const spinner = document.createElement("div");
    spinner.className = "aie-spinner";
    const loadingDiv = document.createElement("div");
    loadingDiv.className = "aie-loading";
    loadingDiv.append(spinner, " Processing…");
    body.appendChild(loadingDiv);
  }

  // Result sections
  if (results) {
    results.forEach((r, i) => {
      const wdSpan = document.createElement("span");
      wdSpan.className = "aie-wordcount";
      wdSpan.textContent = wordDiff(originalText, r);
      const label = document.createElement("div");
      label.className = "aie-label";
      label.append(results.length > 1 ? `Suggestion ${i + 1}` : "Suggested", wdSpan);

      const box = document.createElement("div");
      box.className = "aie-box aie-result";
      box.textContent = r;

      const copyBtn = document.createElement("button");
      copyBtn.className = "aie-btn aie-copy";
      copyBtn.dataset.idx = i;
      copyBtn.textContent = "Copy";
      const replaceBtn = document.createElement("button");
      replaceBtn.className = "aie-btn aie-replace";
      replaceBtn.dataset.idx = i;
      replaceBtn.textContent = "Replace Selected";
      const actions = document.createElement("div");
      actions.className = "aie-actions";
      actions.append(copyBtn, replaceBtn);

      const section = document.createElement("div");
      section.className = "aie-section";
      section.append(label, box, actions);
      body.appendChild(section);
    });
  }

  modalEl.append(header, body);
  overlay.appendChild(modalEl);
  document.body.appendChild(overlay);
  modal = overlay;
  _currentResults = results || [];

  closeBtn.addEventListener("click", removeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) removeModal(); });
  document.addEventListener("keydown", handleEsc);

  overlay.querySelectorAll(".aie-copy").forEach(btn => {
    btn.addEventListener("click", () => {
      const text = _currentResults[+btn.dataset.idx];
      navigator.clipboard.writeText(text).catch(() => {});
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 1600);
    });
  });

  overlay.querySelectorAll(".aie-replace").forEach(btn => {
    btn.addEventListener("click", () => {
      replaceSelection(_currentResults[+btn.dataset.idx]);
      removeModal();
    });
  });
}

function showError(msg) {
  if (!modal) return;
  const body = modal.querySelector("#aie-body");
  body.querySelector(".aie-loading")?.remove();
  const div = document.createElement("div");
  div.className = "aie-error";
  div.textContent = msg;
  body.appendChild(div);
}

function replaceSelection(newText) {
  if (savedActive) {
    const el    = savedActive;
    const start = savedStart;
    const end   = savedEnd;
    el.value = el.value.slice(0, start) + newText + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + newText.length;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    savedActive = null;
    return;
  }
  if (!savedRange) return;
  try {
    savedRange.deleteContents();
    savedRange.insertNode(document.createTextNode(newText));
    savedRange.collapse(false);
  } catch (_) {}
  savedRange = null;
}

function handleEsc(e) { if (e.key === "Escape") removeModal(); }

function removeModal() {
  if (modal) { modal.remove(); modal = null; }
  _currentResults = [];
  document.removeEventListener("keydown", handleEsc);
}
