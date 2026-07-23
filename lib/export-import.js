// export-import.js — .ttbackup file format (build, parse, decrypt)
// Uses Web Crypto API only — no browser, btcAPI, cryptoGet, cryptoSet

const BACKUP_VERSION = 1;

async function _deriveKey(pin, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(pin)),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Returns base64 string: salt(16) + IV(12) + ciphertext
async function encryptField(plaintext, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await _deriveKey(pin, salt);
  const enc  = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(String(plaintext))
  );
  const buf = new Uint8Array(16 + 12 + enc.byteLength);
  buf.set(salt, 0);
  buf.set(iv, 16);
  buf.set(new Uint8Array(enc), 28);
  return btoa(String.fromCharCode(...buf));
}

// Decrypts base64 string produced by encryptField — throws on wrong PIN or corruption
async function decryptField(encoded, pin) {
  const buf  = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const salt = buf.slice(0, 16);
  const iv   = buf.slice(16, 28);
  const data = buf.slice(28);
  const key  = await _deriveKey(pin, salt);
  const dec  = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(dec);
}

// Builds and returns a .ttbackup JSON string.
// data.settings / data.history may be omitted to exclude those sections.
// auth is always encrypted regardless of protectAll.
async function buildExport({ settings, history, licenseEmail, licenseKey }, pin, protectAll = true) {
  const auth = await encryptField(
    JSON.stringify({ licenseEmail: licenseEmail || "", licenseKey: licenseKey || "" }),
    pin
  );

  const obj = {
    version:     BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    protect_all: protectAll,
    auth
  };

  if (settings !== undefined && settings !== null) {
    obj.settings = protectAll ? await encryptField(JSON.stringify(settings), pin) : settings;
  }

  if (history !== undefined && history !== null) {
    obj.history = protectAll ? await encryptField(JSON.stringify(history), pin) : history;
  }

  return JSON.stringify(obj);
}

// Parses and validates a .ttbackup string — throws on invalid structure
function parseExport(content) {
  if (!content || typeof content !== "string" || !content.trim()) {
    throw new Error("Invalid backup: empty content");
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Invalid backup: not valid JSON");
  }
  if (!parsed.version) throw new Error("Invalid backup: missing version field");
  if (!parsed.auth)    throw new Error("Invalid backup: missing auth field");
  return parsed;
}

// Decrypts a parsed backup using the given PIN.
// Returns { settings, history, licenseEmail, licenseKey } — throws on wrong PIN.
async function decryptExport(parsed, pin) {
  let authStr;
  try {
    authStr = await decryptField(parsed.auth, pin);
  } catch {
    throw new Error("Incorrect PIN");
  }

  const { licenseEmail, licenseKey } = JSON.parse(authStr);

  let settings = parsed.settings;
  let history  = parsed.history;

  if (parsed.protect_all) {
    if (settings != null) settings = JSON.parse(await decryptField(settings, pin));
    if (history  != null) history  = JSON.parse(await decryptField(history,  pin));
  }

  return { settings, history, licenseEmail, licenseKey };
}

if (typeof module !== "undefined") {
  module.exports = { buildExport, parseExport, decryptExport, encryptField, decryptField };
}
