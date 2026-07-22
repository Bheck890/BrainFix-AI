// sync-server.js — local HTTP server for extension↔desktop settings sync
// Binds to 127.0.0.1:47391 only (loopback — not reachable from other machines).
// Session token is random on each launch so there is no persistent shared secret to steal.

const http   = require("http");
const crypto = require("crypto");

const PORT          = 47391;
const SESSION_TOKEN = crypto.randomBytes(16).toString("hex");

const SYNC_KEYS = new Set([
  "configuredProviders", "geminiModels",
  "openaiKey", "claudeKey", "geminiKey",
  "openaiModel", "claudeModel", "geminiModel",
  "variants", "customPrompts", "actionSettings",
  "profileName", "profileRole", "profileStyle", "profileContext", "profileEnabled",
  "licenseEmail", "licenseKey"
]);

function _isValidProvider(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  if (typeof p.id !== "string" || !p.id) return false;
  if ("baseUrl" in p && typeof p.baseUrl !== "string") return false;
  if ("apiKey" in p && p.apiKey !== null && typeof p.apiKey !== "string") return false;
  if ("model"  in p && typeof p.model  !== "string") return false;
  return true;
}

// Validates that a value has the correct type for its sync key.
// Using a switch keeps this as one testable function instead of 16 arrow functions.
function validateSyncValue(key, val) {
  switch (key) {
    case "configuredProviders":
      return Array.isArray(val) && val.every(_isValidProvider);
    case "geminiModels":
    case "customPrompts":
    case "actionSettings":
      return Array.isArray(val);
    case "variants":
      return typeof val === "number" && Number.isFinite(val);
    case "profileEnabled":
      return typeof val === "boolean";
    default:
      return typeof val === "string";
  }
}

// encStore must implement: .get(key) → decrypted value, .set(key, val) → encrypts sensitive values
// port defaults to PORT (47391); pass 0 in tests to get an OS-assigned free port
function startSyncServer(encStore, port = PORT) {
  const server = http.createServer((req, res) => {
    // Reflect extension origins; anything else gets 127.0.0.1 (won't match web page origins)
    const origin = req.headers["origin"] || "";
    const allowedOrigin = /^(chrome-extension|moz-extension):\/\//.test(origin)
      ? origin
      : "http://127.0.0.1";
    res.setHeader("Access-Control-Allow-Origin",  allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Btc-Token");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // /ping — public, no token needed; returns syncMeta for timestamp comparison.
    // Session token is only returned to extension origins — browsers enforce this header,
    // so non-browser local processes cannot obtain it and therefore cannot call /settings.
    if (req.url === "/ping" && req.method === "GET") {
      const pingOrigin = req.headers["origin"] || "";
      const isExtension = /^(chrome-extension|moz-extension):\/\//.test(pingOrigin);
      const syncMeta = encStore.get("syncMeta") || null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token: isExtension ? SESSION_TOKEN : null, syncMeta }));
      return;
    }

    // All other routes require the session token
    if (req.headers["x-btc-token"] !== SESSION_TOKEN) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    // Settings routes are restricted to extension origins only
    if (req.url === "/settings") {
      const reqOrigin = req.headers["origin"] || "";
      if (!/^(chrome-extension|moz-extension):\/\//.test(reqOrigin)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
    }

    // GET /settings — returns all sync-relevant settings (decrypted by encStore.get)
    if (req.url === "/settings" && req.method === "GET") {
      const settings = {};
      for (const k of SYNC_KEYS) {
        const v = encStore.get(k);
        if (v !== undefined) settings[k] = v;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ settings }));
      return;
    }

    // POST /settings — receives plaintext settings from extension, stores encrypted via encStore.set
    if (req.url === "/settings" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => {
        body += chunk;
        if (body.length > 1_000_000) req.destroy();
      });
      req.on("end", () => {
        try {
          const { settings } = JSON.parse(body);
          for (const [k, v] of Object.entries(settings)) {
            if (SYNC_KEYS.has(k) && v !== undefined && validateSyncValue(k, v)) encStore.set(k, v);
          }
          // Stamp the canonical sync time and return it so both sides agree
          const newMeta = { lastChanged: new Date().toISOString() };
          encStore.set("syncMeta", newMeta);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ syncMeta: newMeta }));
        } catch {
          res.writeHead(400);
          res.end("Bad Request");
        }
      });
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  server.listen(port, "127.0.0.1", () => {});
  server.on("error", () => {}); // Silently ignore port conflicts (another instance running)
  return server;
}

module.exports = { startSyncServer };
