// Extension update checker — compares installed version against downloads.json.
// Loaded in popup.html (and via importScripts in background.js for legacy compat).

const BTC_DOWNLOADS_URL  = 'https://raw.githubusercontent.com/northpandalabs/Thought-Tidy/refs/heads/main/legal/downloads.json';
const BTC_RELEASES_PAGE  = 'https://thoughttidy.app/download';
const BTC_UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

async function checkAndStoreUpdate() {
  try {
    const stored = await browser.storage.local.get('lastUpdateCheck');
    const last   = stored.lastUpdateCheck || 0;
    if (Date.now() - last < BTC_UPDATE_CHECK_INTERVAL) return;

    const res = await fetch(BTC_DOWNLOADS_URL);
    if (!res.ok) return;
    const data = await res.json();
    // Piggyback: cache for license validation so activation needs no extra fetch
    if (typeof cacheLicenseData === "function") cacheLicenseData(data);
    const latest = typeof data.version === 'string' && /^\d+\.\d+\.\d+$/.test(data.version)
      ? data.version : null;
    if (!latest) return;
    await browser.storage.local.set({ lastUpdateCheck: Date.now() });

    const current   = browser.runtime.getManifest().version;
    const updateUrl = BTC_RELEASES_PAGE;
    if (btcSemverGt(latest, current)) {
      await browser.storage.local.set({
        updateAvailable: { version: latest, url: updateUrl }
      });
    } else {
      await browser.storage.local.remove('updateAvailable');
    }
  } catch (_) { /* silent — update check must never crash the caller */ }
}

function btcSemverGt(a, b) {
  const p = v => v.split('.').map(Number);
  const [aM, am, ap = 0] = p(a);
  const [bM, bm, bp = 0] = p(b);
  return aM !== bM ? aM > bM : am !== bm ? am > bm : ap > bp;
}
