'use strict';
/* global browser, formatCost, hashPin, verifyPin */

// Shared history page UI for extension (history/history.js) and desktop (renderer/history.js).
// Requires on the page: formatCost (pricing.js), hashPin + verifyPin (history-pin.js), browser (polyfill/shim).
// Call window.HistoryUI.render(entries, copyFn) where copyFn(text) => Promise.

(function () {

  // ── Entry builder ─────────────────────────────────────────────

  function buildEntry(e, copyFn) {
    const el = document.createElement("div");
    el.className = "he";

    const t           = new Date(e.timestamp);
    const time        = `${e.date || ""}\n${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`;
    const actionLabel = (e.action || "").replace(/-/g, " ");
    const meta        = [e.provider, e.model].filter(Boolean).join(" · ");
    const costTxt     = e.costUSD != null ? `~${formatCost(e.costUSD)}` : "—";
    const inputPreview = (e.inputText || "").replace(/\n+/g, " ").slice(0, 120);

    const summary = document.createElement("div"); summary.className = "he-summary";
    [
      ["he-time",   time],
      ["he-action", actionLabel],
      ["he-meta",   meta],
      [`he-cost${e.costUSD == null ? " unknown" : ""}`, costTxt],
    ].forEach(([cls, txt]) => {
      const sp = document.createElement("span"); sp.className = cls; sp.textContent = txt;
      summary.appendChild(sp);
    });

    const preview = document.createElement("div"); preview.className = "he-preview";
    preview.textContent = inputPreview + (inputPreview.length < (e.inputText || "").length ? "…" : "");
    el.append(summary, preview);

    function expand() {
      el.classList.add("expanded");
      preview.style.display = "none";

      const body = document.createElement("div");
      body.className = "he-body";

      // Prompt sent to AI — collapsible, collapsed by default
      if (e.systemPrompt) {
        const wrap   = document.createElement("div");  wrap.className = "he-collapsible";
        const toggle = document.createElement("button"); toggle.className = "he-prompt-toggle";
        toggle.textContent = "▶ Prompt sent to AI";
        const inner  = document.createElement("div");  inner.className = "he-collapsible-body";
        const spBox  = document.createElement("div");  spBox.className = "he-text-box he-prompt-box";
        spBox.textContent = e.systemPrompt;
        inner.appendChild(spBox);

        let open = false;
        toggle.addEventListener("click", () => {
          open = !open;
          toggle.textContent   = (open ? "▼" : "▶") + " Prompt sent to AI";
          inner.style.display  = open ? "block" : "none";
        });

        wrap.append(toggle, inner);
        body.appendChild(wrap);
      }

      // Input text
      const inLabel = document.createElement("div");
      inLabel.className = "he-section-label"; inLabel.textContent = "Input text";
      const inBox = document.createElement("div");
      inBox.className = "he-text-box"; inBox.textContent = e.inputText || "(no text saved)";
      body.append(inLabel, inBox);

      // Outputs
      const outputs = e.outputs || (e.outputText ? [e.outputText] : []);
      outputs.forEach((out, i) => {
        const outLabel = document.createElement("div");
        outLabel.className = "he-output-label";
        outLabel.textContent = outputs.length > 1 ? `Output ${i + 1} of ${outputs.length}` : "Output";
        const outBox = document.createElement("div");
        outBox.className = "he-output-box"; outBox.textContent = out || "(empty)";
        body.append(outLabel, outBox);
      });

      // Token / cost row
      const tokenRow = document.createElement("div");
      tokenRow.className = "he-token-row";
      [
        ["In:",        `${(e.inputTokens  || 0).toLocaleString()} tok`],
        ["Out:",       `${(e.outputTokens || 0).toLocaleString()} tok`],
        ["Est. cost:", e.costUSD != null ? formatCost(e.costUSD) : "unknown model"],
      ].forEach(([lbl, val]) => {
        tokenRow.appendChild(document.createTextNode(lbl + " "));
        const sp = document.createElement("span"); sp.textContent = val;
        tokenRow.appendChild(sp);
        tokenRow.appendChild(document.createTextNode("  "));
      });
      body.appendChild(tokenRow);

      // Action buttons
      const actRow = document.createElement("div");
      actRow.className = "he-actions-row";
      if (outputs.length > 0) {
        const copyBtn = document.createElement("button");
        copyBtn.className = "he-copy-btn";
        copyBtn.textContent = outputs.length > 1 ? "Copy Output 1" : "Copy Output";
        copyBtn.addEventListener("click", () => {
          copyFn(outputs[0]).catch(() => {});
          copyBtn.textContent = "Copied!";
          setTimeout(() => (copyBtn.textContent = outputs.length > 1 ? "Copy Output 1" : "Copy Output"), 1600);
        });
        actRow.appendChild(copyBtn);
      }
      const collapseBtn = document.createElement("button");
      collapseBtn.className = "he-collapse-btn";
      collapseBtn.textContent = "▲ Collapse";
      collapseBtn.addEventListener("click", collapse);
      actRow.appendChild(collapseBtn);
      body.appendChild(actRow);

      el.appendChild(body);
      summary.removeEventListener("click", expand);
    }

    function collapse() {
      const body = el.querySelector(".he-body");
      if (body) body.remove();
      el.classList.remove("expanded");
      preview.style.display = "";
      summary.addEventListener("click", expand);
    }

    summary.addEventListener("click", expand);
    return el;
  }

  // ── Render ─────────────────────────────────────────────────────

  function render(entries, copyFn) {
    const list     = document.getElementById("history-list");
    const empty    = document.getElementById("empty-state");
    const statsBar = document.getElementById("stats-bar");
    list.innerHTML = "";

    if (!entries.length) {
      empty.style.display    = "block";
      statsBar.style.display = "none";
      return;
    }
    empty.style.display    = "none";
    statsBar.style.display = "flex";

    let totalIn = 0, totalOut = 0, totalCost = 0, hasCost = false;
    entries.forEach(e => {
      totalIn  += e.inputTokens  || 0;
      totalOut += e.outputTokens || 0;
      if (e.costUSD != null) { totalCost += e.costUSD; hasCost = true; }
    });
    document.getElementById("stats-count").textContent  = `${entries.length} request${entries.length !== 1 ? "s" : ""}`;
    document.getElementById("stats-tokens").textContent = `${(totalIn + totalOut).toLocaleString()} tokens`;
    document.getElementById("stats-cost").textContent   = hasCost ? `~${formatCost(totalCost)} est.` : "cost unknown";

    entries.forEach(e => list.appendChild(buildEntry(e, copyFn)));
  }

  // ── Pin UI ─────────────────────────────────────────────────────

  function showSetPinBtn(onPinSet) {
    const controls = document.querySelector(".header-controls");
    if (!controls || document.getElementById("set-pin-btn")) return;

    const btn = document.createElement("button");
    btn.id = "set-pin-btn"; btn.textContent = "🔒 Set Passcode"; btn.className = "pin-action-btn";
    controls.insertBefore(btn, controls.firstChild);

    let formEl = null;
    btn.addEventListener("click", () => {
      if (formEl) { formEl.remove(); formEl = null; return; }
      formEl = _mkForm("Set History Passcode", "Lock your history behind a passcode.", [
        _mkInp("pin-set-new",     "New passcode",     "new-password"),
        _mkInp("pin-set-confirm", "Confirm passcode", "new-password"),
      ], "Set Passcode", "Cancel");
      document.querySelector(".page-header").insertAdjacentElement("afterend", formEl);
      document.getElementById("pin-set-new").focus();
      document.getElementById("pin-form-cancel").addEventListener("click", () => { formEl.remove(); formEl = null; });
      document.getElementById("pin-form-save").addEventListener("click", async () => {
        const newP = document.getElementById("pin-set-new").value;
        const conf = document.getElementById("pin-set-confirm").value;
        const err  = document.getElementById("pin-form-err");
        err.style.display = "none";
        if (!newP || !conf) { err.textContent = "Both fields are required."; err.style.display = ""; return; }
        if (newP !== conf)  { err.textContent = "Passcodes do not match.";   err.style.display = ""; return; }
        const hash = await hashPin(newP);
        await browser.storage.local.set({ historyPin: hash });
        formEl.remove(); formEl = null; btn.remove();
        onPinSet(hash);
      });
    });
  }

  function showPinGate(data, onUnlock) {
    const page     = document.querySelector(".page");
    const header   = document.querySelector(".page-header");
    const statsBar = document.getElementById("stats-bar");
    if (header)   header.style.display   = "none";
    if (statsBar) statsBar.style.display = "none";

    const gate = document.createElement("div"); gate.className = "pin-gate";
    gate.innerHTML = `
      <div class="pin-gate-icon">🔒</div>
      <p class="pin-gate-title">History is locked</p>
      <p class="pin-gate-desc">Enter your passcode to view your processing history.</p>
      <div class="pin-gate-row">
        <input type="password" id="pin-gate-input" class="pin-gate-input" placeholder="Passcode" autocomplete="off" maxlength="128">
        <button id="pin-gate-btn" class="pin-btn-primary">Unlock</button>
      </div>
      <p id="pin-gate-err" class="pin-err" style="display:none">Incorrect passcode.</p>`;
    page.prepend(gate);

    document.getElementById("pin-gate-input").addEventListener("keydown", e => {
      if (e.key === "Enter") document.getElementById("pin-gate-btn").click();
    });
    document.getElementById("pin-gate-btn").addEventListener("click", async () => {
      const pin = document.getElementById("pin-gate-input").value;
      if (!pin) return;
      const ok = await verifyPin(pin, data.historyPin);
      if (!ok) { document.getElementById("pin-gate-err").style.display = ""; return; }
      gate.remove();
      if (header) header.style.display = "";
      const _get = typeof cryptoGet !== "undefined" ? cryptoGet : browser.storage.local.get;
      const fresh = await _get(["historyFull", "devMode", "historyPin"]);
      showPinManagement(fresh.historyPin || data.historyPin);
      onUnlock(fresh);
    });
  }

  function showPinManagement(initialHash) {
    let currentHash = initialHash;
    const statsBar  = document.getElementById("stats-bar");

    const dropWrap = document.createElement("div"); dropWrap.className = "pin-drop-wrap";
    const mainBtn  = document.createElement("button"); mainBtn.textContent = "🔒 Passcode active ▾"; mainBtn.className = "pin-active-btn";
    const dropdown = document.createElement("div"); dropdown.className = "pin-dropdown";

    const changeOpt = document.createElement("button"); changeOpt.textContent = "Change Passcode"; changeOpt.className = "pin-dropdown-opt";
    const removeOpt = document.createElement("button"); removeOpt.textContent = "Remove Passcode"; removeOpt.className = "pin-dropdown-opt pin-dropdown-danger";

    dropdown.append(changeOpt, removeOpt);
    dropWrap.append(mainBtn, dropdown);
    statsBar.appendChild(dropWrap);

    mainBtn.addEventListener("click", ev => { ev.stopPropagation(); dropdown.classList.toggle("open"); });
    document.addEventListener("click", () => dropdown.classList.remove("open"));

    let formEl = null;
    const clearForm = () => { if (formEl) { formEl.remove(); formEl = null; } };
    const showForm  = (nodes, onMount) => {
      clearForm(); dropdown.classList.remove("open");
      formEl = document.createElement("div"); formEl.className = "pin-form";
      nodes.forEach(n => formEl.appendChild(n));
      statsBar.insertAdjacentElement("afterend", formEl);
      onMount();
    };

    changeOpt.addEventListener("click", () => {
      const err = _mkErrEl();
      showForm([
        _mkP("Change Passcode", "pin-form-title"),
        _mkInp("pin-current", "Current passcode",  "off"),
        _mkInp("pin-new",     "New passcode",       "new-password"),
        _mkInp("pin-confirm", "Confirm new passcode","new-password"),
        err, _mkBtnRow("Save", "Cancel"),
      ], () => {
        document.getElementById("pin-form-cancel").addEventListener("click", clearForm);
        document.getElementById("pin-form-save").addEventListener("click", async () => {
          const curr = document.getElementById("pin-current").value;
          const np   = document.getElementById("pin-new").value;
          const conf = document.getElementById("pin-confirm").value;
          err.style.display = "none";
          if (!curr || !np || !conf) { err.textContent = "All fields are required.";    err.style.display = ""; return; }
          if (np !== conf)           { err.textContent = "New passcodes do not match."; err.style.display = ""; return; }
          if (!await verifyPin(curr, currentHash)) { err.textContent = "Current passcode is incorrect."; err.style.display = ""; return; }
          const hash = await hashPin(np);
          await browser.storage.local.set({ historyPin: hash });
          currentHash = hash; clearForm();
        });
        document.getElementById("pin-current").focus();
      });
    });

    removeOpt.addEventListener("click", () => {
      const err = _mkErrEl(); err.textContent = "Incorrect passcode.";
      showForm([
        _mkP("Remove Passcode", "pin-form-title"),
        _mkP("Enter your current passcode to remove the lock.", "pin-form-desc"),
        _mkInp("pin-remove-current", "Current passcode", "off"),
        err, _mkBtnRow("Remove", "Cancel", true),
      ], () => {
        document.getElementById("pin-form-cancel").addEventListener("click", clearForm);
        document.getElementById("pin-form-save").addEventListener("click", async () => {
          const curr = document.getElementById("pin-remove-current").value;
          if (!curr) return;
          if (!await verifyPin(curr, currentHash)) { err.style.display = ""; return; }
          await browser.storage.local.remove("historyPin");
          clearForm(); dropWrap.remove();
        });
        document.getElementById("pin-remove-current").focus();
      });
    });
  }

  // ── Internal DOM helpers ───────────────────────────────────────

  function _mkInp(id, placeholder, autocomplete) {
    const inp = document.createElement("input");
    inp.type = "password"; inp.id = id; inp.placeholder = placeholder;
    inp.autocomplete = autocomplete; inp.className = "pin-input"; inp.maxLength = 128;
    return inp;
  }
  function _mkP(text, className) {
    const p = document.createElement("p"); p.className = className; p.textContent = text; return p;
  }
  function _mkErrEl() {
    const p = document.createElement("p"); p.id = "pin-form-err"; p.className = "pin-err"; p.style.display = "none"; return p;
  }
  function _mkBtnRow(saveLabel, cancelLabel, isDanger = false) {
    const row  = document.createElement("div"); row.className = "pin-btn-row";
    const save = document.createElement("button"); save.id = "pin-form-save"; save.type = "button";
    save.textContent = saveLabel; save.className = isDanger ? "pin-btn-danger" : "pin-btn-primary";
    const cancel = document.createElement("button"); cancel.id = "pin-form-cancel"; cancel.type = "button";
    cancel.textContent = cancelLabel; cancel.className = "pin-btn-secondary";
    row.append(save, cancel); return row;
  }
  function _mkForm(title, desc, fields, saveLabel, cancelLabel) {
    const wrap = document.createElement("div"); wrap.className = "pin-form";
    wrap.append(_mkP(title, "pin-form-title"), _mkP(desc, "pin-form-desc"), ...fields, _mkErrEl(), _mkBtnRow(saveLabel, cancelLabel));
    return wrap;
  }

  window.HistoryUI = { render, showPinGate, showSetPinBtn, showPinManagement };

})();
