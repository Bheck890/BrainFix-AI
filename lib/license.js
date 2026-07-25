const DAY_MS  = 24 * 60 * 60 * 1000;
const HOUR_MS =      60 * 60 * 1000;

function _isTestBuild() {
  return (typeof BUILD_FLAGS !== "undefined" && !!BUILD_FLAGS.testBuild);
}

async function verifyWithGumroad(email, licenseKey, _storage = {}) {
  try {
    const appGet = _storage.appGet ?? (typeof window !== "undefined" ? window.appGet : null);
    const appSet = _storage.appSet ?? (typeof window !== "undefined" ? window.appSet : null);
    const fp     = await _getFingerprint(appGet, appSet);
    if (!fp) return { valid: false, error: "Could not identify this device." };

    const r = await _apiCall({ action: "verify_gumroad", email, license_key: licenseKey, fingerprint: fp });

    if (!r.valid) return { valid: false, error: r.error || "Invalid license key" };

    if (appSet) {
      await appSet({
        deviceActivated:    licenseKey,
        lastLicenseCheck:   Date.now(),
        lastLicenseAttempt: Date.now(),
      });
    }
    return { valid: true };
  } catch (err) {
    console.error("[license] verify error:", err);
    return { valid: false, error: `Could not reach activation server. Check your connection.${_isTestBuild() ? ` [${err.message}]` : ""}` };
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

    if (now - lastCheck   < DAY_MS)  return demoResult || corpResult || null;
    if (now - lastAttempt < HOUR_MS) return demoResult || corpResult || null;

    await appSet({ lastLicenseAttempt: now });

    try {
      const data = await _apiCall({ action: "check_gumroad", license_key: licenseKey, email });
      await appSet({ lastLicenseCheck: now, lastLicenseAttempt: now });
      if (!data.valid) return { revoked: true };
      return { valid: true };
    } catch {
      // Benefit of the doubt for up to 30 days; after that treat as revoked so
      // a blocked network connection cannot extend a licence indefinitely.
      if (lastCheck && now - lastCheck > 30 * DAY_MS) return { revoked: true };
      return demoResult || corpResult || null;
    }
  } catch {
    return demoResult || corpResult || null;
  }
}

function isProUnlocked(settings) {
  return !!(settings.licenseEmail && settings.licenseKey) ||
         settings.demoMode === "active" ||
         settings.corpMode === "active";
}

function isDemoMode(settings) {
  return settings.demoMode === "active" && settings.corpMode !== "active" &&
         !(settings.licenseEmail && settings.licenseKey);
}

// ── proxy API (all license + hosted AI validation) ───────────────────────────

const _API = "https://api.northpandalabs.com/v1/license";
let   _SK  = "%%REQUEST_SIGN_KEY%%"; // injected at build time
if (typeof process !== "undefined" && process.env?.REQUEST_SIGN_KEY && _SK[0] === "%")
  _SK = process.env.REQUEST_SIGN_KEY;
if (_SK[0] === "%" && typeof BUILD_FLAGS === "undefined")
  console.error("[build] _SK placeholder was not replaced -- license API calls will fail.");
if (_SK[0] === "%" && typeof BUILD_FLAGS !== "undefined")
  throw new Error("[fatal] Request signing key not injected at build time. Aborting.");

async function _apiCall(body) {
  if (_SK[0] === "%") throw new Error("License API unavailable (build configuration error).");
  const nonce   = crypto.randomUUID();
  const ts      = Date.now().toString();
  const signed  = { ...body, nonce };
  const payload = ts + JSON.stringify(signed);
  const kb      = new Uint8Array((_SK.match(/.{2}/g) ?? []).map(h => parseInt(h, 16)));
  const key     = await crypto.subtle.importKey("raw", kb, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const rawSig  = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const sig     = btoa(String.fromCharCode(...new Uint8Array(rawSig)));
  const res     = await fetch(_API, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-timestamp": ts, "x-sig": sig },
    body:    JSON.stringify(signed),
  });
  if (!res.ok) throw new Error("api:" + res.status);
  return res.json();
}

async function _getFingerprint(appGet, appSet) {
  const _get = appGet ?? (typeof window !== "undefined" ? window.appGet : null);
  const _set = appSet ?? (typeof window !== "undefined" ? window.appSet : null);
  if (!_get || !_set) return null;
  const s = await _get(["_deviceId"]);
  if (s._deviceId) return s._deviceId;
  const id = crypto.randomUUID();
  await _set({ _deviceId: id });
  return id;
}

async function verifyDemoMode(key) {
  const fp = await _getFingerprint();
  if (!fp) return { valid: false, error: "Could not identify this device." };
  try {
    const r = await _apiCall({ action: "activate", code: key, fingerprint: fp });
    switch (r?.status) {
      case "ok": {
        // Stamp the time the server first confirmed this device so the offline
        // fallback below knows it is dealing with a previously-validated device.
        const _appSet = typeof window !== "undefined" ? window.appSet : null;
        if (_appSet) await _appSet({ _demoValidatedAt: Date.now() });
        return { valid: true, mode: "demo", corpLicenseId: r.license_id };
      }
      case "revoked":      return { valid: false, error: "Access has ended.\nPlease purchase a license to continue." };
      case "full":
      case "rate_limited": return { valid: false, error: "All access slots are full. Contact North Panda Labs." };
      case "not_found":    return { valid: false, error: "Invalid demo code." };
      default:             return { valid: false, error: "Could not verify your code. Check your connection." };
    }
  } catch {
    const _appGet = typeof window !== "undefined" ? window.appGet : null;
    const _appSet = typeof window !== "undefined" ? window.appSet : null;
    if (!_appGet || !_appSet) return { valid: false, error: "Could not verify your code. Check your connection." };
    const s = await _appGet(["_offlineDemoAt", "_demoValidatedAt"]);
    // Only grant offline access if the server previously confirmed this device.
    // Prevents activation with no server interaction at all.
    if (!s._demoValidatedAt) return { valid: false, error: "Could not verify your code. Check your connection." };
    if (!s._offlineDemoAt) await _appSet({ _offlineDemoAt: Date.now() });
    return { valid: true, mode: "demo", offline: true };
  }
}

async function verifyCorpMode(email, key) {
  const emailDomain = email.split("@")[1]?.toLowerCase();
  if (!emailDomain) return { valid: false, error: "Enter your company email address." };
  const fp = await _getFingerprint();
  if (!fp) return { valid: false, error: "Could not identify this device." };
  try {
    const r = await _apiCall({ action: "activate", code: key, domain: emailDomain, fingerprint: fp });
    switch (r?.status) {
      case "ok":           return { valid: true,  mode: "corp", corpLicenseId: r.license_id };
      case "revoked":      return { valid: false, error: "Your device access has been revoked by your administrator." };
      case "full":         return { valid: false, error: "No seats available. Contact your administrator." };
      case "rate_limited": return { valid: false, error: "Too many activation attempts. Try again tomorrow." };
      default:             return { valid: false, corpNotFound: true };
    }
  } catch {
    return { valid: false, corpNotFound: true };
  }
}

async function _checkDemoPeriodically() {
  const appGet = typeof window !== "undefined" ? window.appGet : null;
  const appSet = typeof window !== "undefined" ? window.appSet : null;
  if (!appGet || !appSet) return null;
  const s = await appGet(["demoMode", "_deviceId", "lastDemoCheck", "lastDemoAttempt", "_offlineDemoAt"]);
  if (s.demoMode !== "active" || !s._deviceId) return null;
  const now = Date.now();
  if (now - (s.lastDemoCheck   || 0) < DAY_MS)  return null;
  if (now - (s.lastDemoAttempt || 0) < HOUR_MS) return null;
  await appSet({ lastDemoAttempt: now });
  try {
    const data = await _apiCall({ action: "status", fingerprint: s._deviceId });
    await appSet({ lastDemoCheck: now, lastDemoAttempt: now });
    if (!data?.active) {
      await appSet({ demoMode: "revoked", corpLicenseId: null, lastDemoCheck: 0, lastDemoAttempt: 0 });
      return { revoked: true };
    }
    _apiCall({ action: "touch", fingerprint: s._deviceId }).catch(() => {});
    return { valid: true };
  } catch {
    const grantedAt = s._offlineDemoAt || 0;
    if (grantedAt && now - grantedAt > 7 * DAY_MS) {
      await appSet({ demoMode: "revoked", corpLicenseId: null, lastDemoCheck: 0, lastDemoAttempt: 0, _offlineDemoAt: 0 });
      return { revoked: true };
    }
    return null;
  }
}

async function _checkCorpPeriodically() {
  const appGet = typeof window !== "undefined" ? window.appGet : null;
  const appSet = typeof window !== "undefined" ? window.appSet : null;
  if (!appGet || !appSet) return null;
  const s = await appGet(["corpMode", "_deviceId", "lastCorpCheck", "lastCorpAttempt"]);
  if (s.corpMode !== "active" || !s._deviceId) return null;
  const now = Date.now();
  if (now - (s.lastCorpCheck   || 0) < DAY_MS)  return null;
  if (now - (s.lastCorpAttempt || 0) < HOUR_MS) return null;
  await appSet({ lastCorpAttempt: now });
  try {
    const data = await _apiCall({ action: "status", fingerprint: s._deviceId });
    await appSet({ lastCorpCheck: now, lastCorpAttempt: now });
    if (!data?.active) {
      await appSet({ corpMode: "revoked", corpLicenseId: null, lastCorpCheck: 0, lastCorpAttempt: 0 });
      return { revoked: true };
    }
    _apiCall({ action: "touch", fingerprint: s._deviceId }).catch(() => {});
    return { valid: true };
  } catch {
    const s2 = await appGet(["_offlineCorpAt"]);
    const now2 = Date.now();
    if (!s2._offlineCorpAt) await appSet({ _offlineCorpAt: now2 });
    if (now2 - (s2._offlineCorpAt || now2) > 7 * DAY_MS) {
      await appSet({ corpMode: "revoked", corpLicenseId: null,
                     lastCorpCheck: 0, lastCorpAttempt: 0, _offlineCorpAt: 0 });
      return { revoked: true };
    }
    return null;
  }
}

async function removeSeat(deviceId, licenseId) {
  if (!deviceId || !licenseId) return;
  try { await _apiCall({ action: "deactivate", fingerprint: deviceId, license_id: licenseId }); } catch {}
}

async function checkHostedLicense(email, licenseKey) {
  try {
    const data = await _apiCall({ action: "check_aiaa", license_key: licenseKey, email });
    return { valid: !!data.valid };
  } catch {
    return { valid: false };
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    verifyWithGumroad, checkLicensePeriodically, isProUnlocked, isDemoMode,
    verifyDemoMode, verifyCorpMode, removeSeat, checkHostedLicense,
  };
}
