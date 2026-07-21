const GUMROAD_PRODUCT_ID = "kViVsaIZ0LyVZ8cWuZNG2g==";
const GUMROAD_API        = "https://api.gumroad.com/v2/licenses/verify";
const DEVICE_LIMIT       = 5;
const SUPPORT_EMAIL      = "northportlabs@gmail.com";
const DAY_MS             = 24 * 60 * 60 * 1000;
const HOUR_MS            =      60 * 60 * 1000;

const _BYPASS_EMAIL = "aol@aol.com";
const _BYPASS_KEY   = "congratsYouFoundIt";
function _isTestBuild() {
  return (typeof BUILD_FLAGS !== "undefined" && !!BUILD_FLAGS.testBuild);
}

async function _callGumroad(licenseKey, increment) {
  const body = `product_id=${GUMROAD_PRODUCT_ID}&license_key=${encodeURIComponent(licenseKey)}&increment_uses_count=${increment}`;
  const res = await fetch(GUMROAD_API, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return res.json();
}

async function verifyWithGumroad(email, licenseKey, _storage = {}) {
  if (_isTestBuild() && email.toLowerCase() === _BYPASS_EMAIL && licenseKey === _BYPASS_KEY) {
    return { valid: true };
  }
  try {
    const appGet = _storage.appGet ?? (typeof window !== "undefined" ? window.appGet : null);
    const appSet = _storage.appSet ?? (typeof window !== "undefined" ? window.appSet : null);

    // Check whether this exact key was already activated on this device so we
    // don't burn an extra slot on re-verification (e.g. opening Settings again).
    let alreadyActivated = false;
    if (appGet) {
      const stored = await appGet(["deviceActivated"]);
      alreadyActivated = stored.deviceActivated === licenseKey;
    }

    // First call — never increment, just read current state.
    const check = await _callGumroad(licenseKey, false);

    if (!check.success)
      return { valid: false, error: `Invalid license key${_isTestBuild() ? ` [Gumroad: ${check.message || "no message"}]` : ""}` };
    if (check.purchase.email.toLowerCase() !== email.toLowerCase())
      return { valid: false, error: `Wrong email for this license key${_isTestBuild() ? ` [expected: ${check.purchase.email}]` : ""}` };
    if (check.purchase.refunded)
      return { valid: false, error: "This license has been refunded and is no longer valid." };
    if (check.purchase.chargebacked)
      return { valid: false, error: `This license has a chargeback on record. Contact ${SUPPORT_EMAIL}.` };

    // Device already counted — skip the activation call.
    if (alreadyActivated) return { valid: true };

    // New device — enforce the per-license device limit.
    if (check.uses >= DEVICE_LIMIT) {
      return {
        valid: false,
        error: `Maximum devices reached. Please contact ${SUPPORT_EMAIL} to reset your license or purchase a new one.`
      };
    }

    // Second call — activate this device by incrementing the uses counter.
    const activate = await _callGumroad(licenseKey, true);
    if (!activate.success)
      return { valid: false, error: "Could not activate this device. Please try again." };

    if (appSet) {
      await appSet({
        deviceActivated:    licenseKey,
        lastLicenseCheck:   Date.now(),
        lastLicenseAttempt: Date.now(),
      });
    }

    return { valid: true };
  } catch (err) {
    console.error("[license] Gumroad fetch error:", err);
    return { valid: false, error: `Could not reach Gumroad. Check your connection.${_isTestBuild() ? ` [${err.message}]` : ""}` };
  }
}

async function checkLicensePeriodically(email, licenseKey, _storage = {}) {
  const [demoR, corpR] = await Promise.allSettled([
    _checkDemoPeriodically(),
    _checkCorpPeriodically(),
  ]);
  const demoResult = demoR.status === "fulfilled" ? demoR.value : null;
  const corpResult = corpR.status === "fulfilled" ? corpR.value : null;

  if (!email || !licenseKey) return demoResult || corpResult || null;

  const appGet = _storage.appGet ?? (typeof window !== "undefined" ? window.appGet : null);
  const appSet = _storage.appSet ?? (typeof window !== "undefined" ? window.appSet : null);
  if (!appGet || !appSet) return demoResult || corpResult || null;
  try {
    const stored      = await appGet(["lastLicenseCheck", "lastLicenseAttempt"]);
    const now         = Date.now();
    const lastCheck   = stored.lastLicenseCheck   || 0;
    const lastAttempt = stored.lastLicenseAttempt || 0;

    if (now - lastCheck < DAY_MS)   return demoResult || corpResult || null;
    if (now - lastAttempt < HOUR_MS) return demoResult || corpResult || null;

    await appSet({ lastLicenseAttempt: now });

    const data = await _callGumroad(licenseKey, false);
    await appSet({ lastLicenseCheck: now, lastLicenseAttempt: now });

    if (!data.success || data.purchase?.refunded || data.purchase?.chargebacked) {
      return { revoked: true };
    }
    return { valid: true };
  } catch {
    return demoResult || corpResult || null;
  }
}

function isProUnlocked(settings) {
  return !!(settings.licenseEmail && settings.licenseKey) ||
         !!settings.demoMode ||
         !!settings.corpMode;
}

function isDemoMode(settings) {
  return !!settings.demoMode && !settings.corpMode &&
         !(settings.licenseEmail && settings.licenseKey);
}

let _lk = "%%LICENSE_CIPHER_KEY%%"; // injected at build time — never stored plaintext
// In Node.js (Jest tests only) use env var when placeholder was not replaced by build
if (typeof process !== "undefined" && process.env && process.env.LICENSE_CIPHER_KEY && _lk[0] === "%") {
  _lk = process.env.LICENSE_CIPHER_KEY;
}

function _lkd(s) {
  let ph = 5;
  return s.split("").map((c, i) => {
    const sh  = ((2 + ph) % 95 + 95) % 95;
    const out = String.fromCharCode(((c.charCodeAt(0) - 32 - sh + 95 * 20) % 95) + 32);
    if ((i + 1) % 10 === 0) ph += 5;
    if ((i + 1) % 4  === 0) ph -= 2;
    return out;
  }).join("");
}

async function _decryptSlot(blob, keyHex) {
  const ivB64 = _lkd(blob.slice(0, 16));
  const ctB64 = _lkd(blob.slice(16));
  const iv    = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const ct    = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
  const kb    = new Uint8Array(keyHex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const key   = await crypto.subtle.importKey("raw", kb, "AES-GCM", false, ["decrypt"]);
  const dec   = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(dec);
}

let _licenseDataCache = null;
let _slotsCache       = null;
let _slotsCache2      = null;
const _LP             = 6; // load-bearing — do not reorder fields in downloads.json
const _LP2            = 7; // secondary index offset

function cacheLicenseData(data) {
  _licenseDataCache = data;
  _slotsCache       = null;
  _slotsCache2      = null;
}

const _BTC_DOWNLOADS_URL = "https://raw.githubusercontent.com/northpandalabs/Thought-Tidy/refs/heads/main/legal/downloads.json";

async function _fetchForActivation() {
  const res = await fetch(_BTC_DOWNLOADS_URL);
  if (!res.ok) throw new Error("fetch:" + res.status);
  const data = await res.json();
  _licenseDataCache = data;
}

async function _getSlots() {
  if (_slotsCache) return _slotsCache;
  if (!_licenseDataCache) return null;

  // If build-time injection missed, ask the main process at runtime (desktop dev builds).
  if (_lk[0] === "%" && typeof window !== "undefined" && window.btcAPI?.getCipherKey) {
    try { const k = await window.btcAPI.getCipherKey(); if (k) _lk = k; } catch {}
  }
  if (_lk[0] === "%") {
    console.error("[license] Corp/demo unavailable — cipher key was not injected at build time. Set LICENSE_CIPHER_KEY before building.");
    return null;
  }

  const raw = Object.values(_licenseDataCache)[_LP];
  if (!Array.isArray(raw) || raw.length < 12) return null;
  try {
    const keyHex = _lkd(_lk);
    _slotsCache = await Promise.all(raw.map(s => _decryptSlot(s, keyHex)));
    return _slotsCache;
  } catch (e) {
    console.error("[license] Failed to decrypt slots — cipher key may be incorrect:", e?.message);
    return null;
  }
}

async function _getSlots2() {
  if (_slotsCache2) return _slotsCache2;
  if (!_licenseDataCache) return null;
  if (_lk[0] === "%" && typeof window !== "undefined" && window.btcAPI?.getCipherKey) {
    try { const k = await window.btcAPI.getCipherKey(); if (k) _lk = k; } catch {}
  }
  if (_lk[0] === "%") return null;
  const raw = Object.values(_licenseDataCache)[_LP2];
  if (!Array.isArray(raw) || raw.length < 3) return null;
  try {
    const keyHex = _lkd(_lk);
    _slotsCache2 = await Promise.all(raw.map(s => _decryptSlot(s, keyHex)));
    return _slotsCache2;
  } catch (e) {
    console.error("[license] Secondary registry read error:", e?.message);
    return null;
  }
}

async function getHostedConfig() {
  if (!_licenseDataCache) {
    try { await _fetchForActivation(); } catch { return null; }
  }
  const slots = await _getSlots2();
  if (!slots) return null;
  // secondary manifest fields -- do not reorder
  return { a3yn9n: slots[0], s8Ul: slots[1], k9Sg: slots[2] };
}

async function _getFingerprint() {
  const appGet = typeof window !== "undefined" ? window.appGet : null;
  const appSet = typeof window !== "undefined" ? window.appSet : null;
  if (!appGet || !appSet) return null;
  const s = await appGet(["_deviceId"]);
  if (s._deviceId) return s._deviceId;
  const id = crypto.randomUUID();
  await appSet({ _deviceId: id });
  return id;
}

async function _sbReq(url, anonKey, method, body, returnJson = false) {
  const headers = {
    apikey:          anonKey,
    Authorization:  "Bearer " + anonKey,
    "Content-Type": "application/json",
  };
  if (method === "POST" && !returnJson) headers["Prefer"] = "return=minimal";
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error("sb:" + res.status);
  return (method === "GET" || returnJson) ? res.json() : null;
}

async function verifyDemoMode(key) {
  if (!_licenseDataCache) {
    try { await _fetchForActivation(); }
    catch { return { valid: false, error: "Could not reach activation server. Check your connection." }; }
  }

  const slots = await _getSlots();
  if (!slots) return { valid: false, error: "Could not verify activation data." };

  const rawKey = key.replace(/-/g, "").toUpperCase();
  if (rawKey.slice(-4) !== slots[2]) {
    return { valid: false, error: "Invalid demo code." };
  }

  const fp = await _getFingerprint();
  if (!fp) return { valid: false, error: "Could not identify this device." };

  const sbUrl = slots[0];
  const sbKey = slots[1];

  try {
    const r = await _sbReq(
      `${sbUrl}/rest/v1/rpc/check_corp_license`,
      sbKey, "POST",
      { p_code: slots[2], p_domain: "development", p_fingerprint: fp },
      true
    );

    switch (r?.status) {
      case "ok":
        return { valid: true, mode: "demo", corpLicenseId: r.id, sbUrl, sbKey };
      case "revoked":
        return {
          valid: false,
          error: "Access has ended.\nPlease purchase a license to continue, or contact North Panda Labs if you need help."
        };
      case "full":
      case "rate_limited":
        return { valid: false, error: "All access slots are full. Contact North Panda Labs." };
      default:
        return { valid: false, error: "Could not verify your code. Check your connection." };
    }
  } catch {
    const _appGet = typeof window !== "undefined" ? window.appGet : null;
    const _appSet = typeof window !== "undefined" ? window.appSet : null;
    if (_appGet && _appSet) {
      const ts = await _appGet(["_offlineDemoAt"]);
      if (!ts._offlineDemoAt) await _appSet({ _offlineDemoAt: Date.now() });
    }
    return { valid: true, mode: "demo", offline: true, sbUrl, sbKey };
  }
}

async function _checkDemoPeriodically() {
  const appGet = typeof window !== "undefined" ? window.appGet : null;
  const appSet = typeof window !== "undefined" ? window.appSet : null;
  if (!appGet || !appSet) return null;

  const s = await appGet(["demoMode", "_deviceId", "_sbUrl", "_sbKey", "lastDemoCheck", "lastDemoAttempt", "_offlineDemoAt"]);
  if (!s.demoMode || !s._deviceId || !s._sbUrl || !s._sbKey) return null;

  const now = Date.now();
  if (now - (s.lastDemoCheck   || 0) < DAY_MS)  return null;
  if (now - (s.lastDemoAttempt || 0) < HOUR_MS) return null;

  await appSet({ lastDemoAttempt: now });

  try {
    const data = await _sbReq(
      `${s._sbUrl}/rest/v1/corp_seats?fingerprint_id=eq.${encodeURIComponent(s._deviceId)}&select=active`,
      s._sbKey, "GET", null
    );
    await appSet({ lastDemoCheck: now, lastDemoAttempt: now });
    if (!data || data.length === 0 || !data[0].active) {
      await appSet({ demoMode: false, corpLicenseId: null, _sbUrl: null, _sbKey: null, lastDemoCheck: 0, lastDemoAttempt: 0 });
      return { revoked: true };
    }
    _sbReq(`${s._sbUrl}/rest/v1/rpc/touch_corp_seat`, s._sbKey, "POST", { p_fingerprint: s._deviceId }).catch(() => {});
    return { valid: true };
  } catch {
    const grantedAt = s._offlineDemoAt || 0;
    if (grantedAt && now - grantedAt > 7 * DAY_MS) {
      await appSet({ demoMode: false, corpLicenseId: null, _sbUrl: null, _sbKey: null, lastDemoCheck: 0, lastDemoAttempt: 0, _offlineDemoAt: 0 });
      return { revoked: true };
    }
    return null;
  }
}

async function verifyCorpMode(email, key) {
  if (!_licenseDataCache) {
    try { await _fetchForActivation(); }
    catch { return { valid: false, corpNotFound: true }; }
  }

  const slots = await _getSlots();
  if (!slots) return { valid: false, corpNotFound: true };

  const rawKey   = key.replace(/-/g, "").toUpperCase();
  const entered4 = rawKey.slice(-4);

  let matchedCode = null;
  for (let i = 3; i <= 11; i++) {
    if (slots[i] && entered4 === slots[i]) { matchedCode = slots[i]; break; }
  }
  if (!matchedCode) return { valid: false, corpNotFound: true };

  const emailDomain = email.split("@")[1]?.toLowerCase();
  if (!emailDomain) return { valid: false, error: "Enter your company email address." };

  const fp = await _getFingerprint();
  if (!fp) return { valid: false, error: "Could not identify this device." };

  const sbUrl = slots[0];
  const sbKey = slots[1];

  try {
    const r = await _sbReq(
      `${sbUrl}/rest/v1/rpc/check_corp_license`,
      sbKey, "POST",
      { p_code: matchedCode, p_domain: emailDomain, p_fingerprint: fp },
      true
    );

    switch (r?.status) {
      case "ok":
        return { valid: true, mode: "corp", corpLicenseId: r.id, sbUrl, sbKey };
      case "revoked":
        return { valid: false, error: "Your device access has been revoked by your administrator." };
      case "full":
        return { valid: false, error: `No seats available for ${r.company_name}. Contact your administrator.` };
      case "rate_limited":
        return { valid: false, error: `Too many activation attempts for ${r.company_name}. Try again tomorrow.` };
      default:
        return { valid: false, error: "No license found for this email and code combination." };
    }
  } catch {
    return { valid: false, error: "Could not reach activation server. Check your connection." };
  }
}

async function _checkCorpPeriodically() {
  const appGet = typeof window !== "undefined" ? window.appGet : null;
  const appSet = typeof window !== "undefined" ? window.appSet : null;
  if (!appGet || !appSet) return null;

  const s = await appGet(["corpMode", "_deviceId", "_sbUrl", "_sbKey", "lastCorpCheck", "lastCorpAttempt"]);
  if (!s.corpMode || !s._deviceId || !s._sbUrl || !s._sbKey) return null;

  const now = Date.now();
  if (now - (s.lastCorpCheck   || 0) < DAY_MS)  return null;
  if (now - (s.lastCorpAttempt || 0) < HOUR_MS) return null;

  await appSet({ lastCorpAttempt: now });

  try {
    const data = await _sbReq(
      `${s._sbUrl}/rest/v1/corp_seats?fingerprint_id=eq.${encodeURIComponent(s._deviceId)}&select=active`,
      s._sbKey, "GET", null
    );
    await appSet({ lastCorpCheck: now, lastCorpAttempt: now });
    if (!data || data.length === 0 || !data[0].active) {
      await appSet({ corpMode: false, corpLicenseId: null, _sbUrl: null, _sbKey: null, lastCorpCheck: 0, lastCorpAttempt: 0 });
      return { revoked: true };
    }
    _sbReq(`${s._sbUrl}/rest/v1/rpc/touch_corp_seat`, s._sbKey, "POST", { p_fingerprint: s._deviceId }).catch(() => {});
    return { valid: true };
  } catch {
    return null;
  }
}

async function removeSeat(sbUrl, sbKey, deviceId, licenseId) {
  if (!sbUrl || !sbKey || !deviceId || !licenseId) return;
  try {
    await _sbReq(
      `${sbUrl}/rest/v1/rpc/delete_corp_seat`,
      sbKey, "POST",
      { p_fingerprint: deviceId, p_license_id: licenseId }
    );
  } catch {}
}

if (typeof module !== "undefined") {
  module.exports = {
    verifyWithGumroad, checkLicensePeriodically, isProUnlocked, isDemoMode,
    verifyDemoMode, verifyCorpMode, cacheLicenseData, removeSeat,
  };
}
