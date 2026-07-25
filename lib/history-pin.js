// history-pin.js — PIN hashing for history lock (Pro)
// Uses Web Crypto API only — no browser, btcAPI, cryptoGet, cryptoSet

const _PBKDF2_ITERS = 310_000;

async function _pbkdf2Hash(pin, salt) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(String(pin)), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: _PBKDF2_ITERS }, key, 256
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await _pbkdf2Hash(pin, salt);
  return JSON.stringify({ v: 2, salt: btoa(String.fromCharCode(...salt)), hash });
}

async function verifyPin(pin, storedHash) {
  if (!storedHash) return false;
  try {
    const parsed = JSON.parse(storedHash);
    if (parsed.v === 2) {
      const salt = Uint8Array.from(atob(parsed.salt), c => c.charCodeAt(0));
      const hash = await _pbkdf2Hash(pin, salt);
      return hash === parsed.hash;
    }
  } catch {}
  // Legacy unsalted SHA-256 fallback for pre-existing stored hashes
  const encoded = new TextEncoder().encode(String(pin));
  const digest  = await crypto.subtle.digest("SHA-256", encoded);
  const legacy  = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  return legacy === storedHash;
}

if (typeof module !== "undefined") {
  module.exports = { hashPin, verifyPin };
}
