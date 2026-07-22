// Injects REQUEST_SIGN_KEY into lib/license.js after electron-builder copies extraResources.
// The source lib/license.js has placeholder "%%REQUEST_SIGN_KEY%%" -- never the real value.
const fs   = require("fs");
const path = require("path");

module.exports = async function afterPack({ appOutDir }) {
  const licPath = path.join(appOutDir, "resources", "lib", "license.js");
  if (!fs.existsSync(licPath)) {
    console.warn("[after-pack] lib/license.js not found at:", licPath);
    return;
  }

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

  const src = fs.readFileSync(licPath, "utf8");
  if (!src.includes('"%%REQUEST_SIGN_KEY%%"')) {
    console.log("[after-pack] lib/license.js: placeholder already replaced, skipping.");
    return;
  }
  fs.writeFileSync(licPath, src.replace('"%%REQUEST_SIGN_KEY%%"', JSON.stringify(key)));
  console.log("[after-pack] REQUEST_SIGN_KEY injected into lib/license.js");
};
