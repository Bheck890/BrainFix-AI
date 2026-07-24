// Injects REQUEST_SIGN_KEY into lib/license.js after electron-builder copies extraResources.
// The source lib/license.js has placeholder "%%REQUEST_SIGN_KEY%%" -- never the real value.
const fs   = require("fs");
const path = require("path");

module.exports = async function afterPack({ appOutDir }) {
  let key = process.env.REQUEST_SIGN_KEY;
  if (!key) {
    const etcFile = path.join(__dirname, "..", "..", "ETC", "brainfix-ai.env");
    if (fs.existsSync(etcFile)) {
      for (const line of fs.readFileSync(etcFile, "utf8").split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0 && line.slice(0, eq).trim() === "REQUEST_SIGN_KEY") {
          key = line.slice(eq + 1).trim();
          break;
        }
      }
    }
  }

  if (!key) {
    console.error("[after-pack] ERROR: REQUEST_SIGN_KEY env var not set.");
    console.error("             License activation will fail in the built app.");
    return;
  }

  for (const rel of ["lib/license.js", "lib/api.js"]) {
    const p = path.join(appOutDir, "resources", rel);
    if (!fs.existsSync(p)) { console.warn(`[after-pack] ${rel} not found, skipping.`); continue; }
    const src = fs.readFileSync(p, "utf8");
    if (!src.includes('"%%REQUEST_SIGN_KEY%%"')) continue;
    fs.writeFileSync(p, src.replace('"%%REQUEST_SIGN_KEY%%"', JSON.stringify(key)));
    console.log(`[after-pack] REQUEST_SIGN_KEY injected into ${rel}`);
  }
};
