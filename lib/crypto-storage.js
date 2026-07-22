// crypto-storage.js — AES-256-GCM encryption for extension storage + desktop sync
// Loaded by: background.js (importScripts), popup.html, options.html
// All functions are async and transparent — callers treat storage as plaintext.
//
// Encryption key is generated once per install and stored in browser.storage.local
// under "_extCk". It never leaves the device.

/* global browser */

const CK_PREFIX  = "ck1:";
const CK_STORAGE = "_extCk";

const _SENSITIVE = new Set(["openaiKey", "claudeKey", "geminiKey", "licenseEmail", "licenseKey"]);

const SYNC_KEYS = [
  "configuredProviders", "geminiModels",
  "openaiKey", "claudeKey", "geminiKey",
  "openaiModel", "claudeModel", "geminiModel",
  "variants", "customPrompts", "actionSettings",
  "profileName", "profileRole", "profileStyle", "profileContext", "profileEnabled",
  "licenseEmail", "licenseKey"
];

let _ck  = null;  // cached CryptoKey (re-imported from storage on each service-worker wake)
let _mig = false; // in-memory guard: prevent concurrent migrateExtensionKeys() runs

async function _getKey() {
  if (_ck) return _ck;
  const stored = (await browser.storage.local.get(CK_STORAGE))[CK_STORAGE];
  if (stored) {
    const raw = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
    _ck = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  } else {
    _ck = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const exported = await crypto.subtle.exportKey("raw", _ck);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
    await browser.storage.local.set({ [CK_STORAGE]: b64 });
  }
  return _ck;
}

async function _enc(plaintext) {
  const key = await _getKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(String(plaintext)));
  const buf = new Uint8Array(12 + enc.byteLength);
  buf.set(iv);
  buf.set(new Uint8Array(enc), 12);
  return CK_PREFIX + btoa(String.fromCharCode(...buf));
}

async function _dec(value) {
  if (typeof value !== "string" || !value.startsWith(CK_PREFIX)) return value;
  try {
    const key = await _getKey();
    const buf = Uint8Array.from(atob(value.slice(CK_PREFIX.length)), c => c.charCodeAt(0));
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
    return new TextDecoder().decode(dec);
  } catch {
    return null; // corrupted or wrong key — null signals caller to prompt re-entry
  }
}

async function _encProviders(arr) {
  if (!Array.isArray(arr)) return arr;
  return Promise.all(arr.map(async p => ({
    ...p,
    apiKey: p.apiKey ? await _enc(p.apiKey) : p.apiKey
  })));
}

async function _decProviders(arr) {
  if (!Array.isArray(arr)) return arr;
  return Promise.all(arr.map(async p => ({
    ...p,
    apiKey: p.apiKey ? await _dec(p.apiKey) : p.apiKey
  })));
}

// Transparent get: decrypts sensitive fields before returning
async function cryptoGet(keys) {
  const raw = await browser.storage.local.get(keys);
  for (const k of _SENSITIVE) {
    if (raw[k]) raw[k] = await _dec(raw[k]);
  }
  if (raw.configuredProviders) raw.configuredProviders = await _decProviders(raw.configuredProviders);
  return raw;
}

// Transparent set: encrypts sensitive fields, then stamps syncMeta if any SYNC_KEY changed
async function cryptoSet(data) {
  const toStore = { ...data };
  for (const k of _SENSITIVE) {
    if (toStore[k]) toStore[k] = await _enc(toStore[k]);
  }
  if (toStore.configuredProviders) {
    toStore.configuredProviders = await _encProviders(toStore.configuredProviders);
  }
  await browser.storage.local.set(toStore);
  if (Object.keys(data).some(k => SYNC_KEYS.includes(k))) {
    await browser.storage.local.set({ syncMeta: { lastChanged: new Date().toISOString() } });
  }
}

// One-time migration: encrypt any plaintext keys already in storage
async function migrateExtensionKeys() {
  if (_mig) return;
  _mig = true;
  const { _extMig } = await browser.storage.local.get("_extMig");
  if (_extMig) { _mig = false; return; }

  const raw = await browser.storage.local.get([..._SENSITIVE, "configuredProviders"]);
  const toSet = {};
  for (const k of _SENSITIVE) {
    if (raw[k] && !raw[k].startsWith(CK_PREFIX)) toSet[k] = await _enc(raw[k]);
  }
  if (Array.isArray(raw.configuredProviders)) {
    const needsMig = raw.configuredProviders.some(p => p.apiKey && !p.apiKey.startsWith(CK_PREFIX));
    if (needsMig) toSet.configuredProviders = await _encProviders(raw.configuredProviders);
  }
  if (Object.keys(toSet).length) await browser.storage.local.set(toSet);
  await browser.storage.local.set({ _extMig: true });
  _mig = false;
}

// ── Desktop sync ───────────────────────────────────────────────────────────────

const _SYNC_SERVER = "http://127.0.0.1:47391";

function _fetchTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const id   = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

async function syncWithDesktop() {
  try {
    const pingRes = await _fetchTimeout(`${_SYNC_SERVER}/ping`, {}, 1500);
    if (!pingRes.ok) return;
    const { token, syncMeta: desktopMeta } = await pingRes.json();

    const { syncMeta: extMeta } = await browser.storage.local.get("syncMeta");
    const desktopTime = desktopMeta?.lastChanged ? new Date(desktopMeta.lastChanged).getTime() : 0;
    const extTime     = extMeta?.lastChanged     ? new Date(extMeta.lastChanged).getTime()     : 0;

    if (desktopTime === extTime) return; // already in sync

    if (desktopTime > extTime) {
      // Desktop is newer — pull, encrypt with extension key, stamp syncMeta exactly once
      const res = await _fetchTimeout(`${_SYNC_SERVER}/settings`,
        { headers: { "X-Btc-Token": token } }, 3000);
      if (!res.ok) return;
      const { settings } = await res.json();
      // Encrypt sensitive fields before storing; skip the auto-syncMeta stamp by
      // writing raw settings directly, then setting syncMeta to the desktop's timestamp
      // so both sides agree without creating a newer timestamp.
      const toStore = { ...settings };
      for (const k of _SENSITIVE) {
        if (toStore[k]) toStore[k] = await _enc(toStore[k]);
      }
      if (toStore.configuredProviders) {
        toStore.configuredProviders = await _encProviders(toStore.configuredProviders);
      }
      toStore.syncMeta = desktopMeta; // stamp once, matching desktop exactly
      await browser.storage.local.set(toStore);
    } else {
      // Extension is newer — push plaintext settings to desktop (it encrypts on its end)
      const decrypted = await cryptoGet(SYNC_KEYS);
      const res = await _fetchTimeout(`${_SYNC_SERVER}/settings`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "X-Btc-Token": token },
        body:    JSON.stringify({ settings: decrypted })
      }, 3000);
      if (!res.ok) return;
      const { syncMeta: newMeta } = await res.json();
      await browser.storage.local.set({ syncMeta: newMeta });
    }
  } catch {
    // Desktop not running or unreachable — silent no-op
  }
}

if (typeof module !== "undefined") {
  module.exports = { cryptoGet, cryptoSet, migrateExtensionKeys, syncWithDesktop };
}
