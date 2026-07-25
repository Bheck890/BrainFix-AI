// Provider tab switching
document.querySelectorAll(".ptab").forEach(tab => {
  tab.addEventListener("click", () => {
    const provider = tab.dataset.tab;
    document.querySelectorAll(".ptab").forEach(t => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", t === tab ? "true" : "false");
    });
    document.querySelectorAll(".provider-panel").forEach(panel => {
      panel.classList.toggle("hidden", panel.id !== "tab-" + provider);
    });
  });
});

// Activate the provider tab from URL hash (e.g. guide.html#openai)
const _VALID_TABS = new Set(["openai", "claude", "gemini", "copilot", "ollama", "lmstudio", "jan", "hosted"]);
const hash = location.hash.replace("#", "");
if (hash && _VALID_TABS.has(hash)) {
  const target = document.querySelector(`[data-tab="${hash}"]`);
  if (target) target.click();
}
