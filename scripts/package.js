// scripts/package.js -- Build browser extension ZIPs with the sign key baked in.
// The release/ folder is gitignored. Never commit it. Submit these ZIPs to the stores.
//
// Usage:
//   node scripts/package.js               (reads key from ETC/brainfix-ai.env or REQUEST_SIGN_KEY env var)
//   REQUEST_SIGN_KEY=<hex> node scripts/package.js

const fs    = require("fs");
const path  = require("path");
const cp    = require("child_process");

const ROOT    = path.resolve(__dirname, "..");
const DIST    = path.join(ROOT, "dist");
const RELEASE = path.join(ROOT, "release");

// ── resolve the sign key ────────────────────────────────────────────────────────

function readKey() {
  if (process.env.REQUEST_SIGN_KEY) return process.env.REQUEST_SIGN_KEY;
  const etcFile = path.join(ROOT, "ETC", "brainfix-ai.env");
  if (fs.existsSync(etcFile)) {
    for (const line of fs.readFileSync(etcFile, "utf8").split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0 && line.slice(0, eq).trim() === "REQUEST_SIGN_KEY")
        return line.slice(eq + 1).trim() || null;
    }
  }
  return null;
}

const key = readKey();
if (!key) {
  console.error("ERROR: REQUEST_SIGN_KEY not found.");
  console.error("  Set it in ETC/brainfix-ai.env as:  REQUEST_SIGN_KEY=<64-char hex>");
  console.error("  Or pass it as an env var:           REQUEST_SIGN_KEY=<hex> node scripts/package.js");
  process.exit(1);
}

if (!/^[0-9a-fA-F]{64}$/.test(key)) {
  console.error("ERROR: REQUEST_SIGN_KEY must be a 64-character hex string.");
  console.error("  Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  process.exit(1);
}

// ── build both targets ──────────────────────────────────────────────────────────

console.log("Building Firefox and Chrome...");
cp.execSync("node scripts/build.js", {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, REQUEST_SIGN_KEY: key },
});

// ── verify key was injected (not left as placeholder) ──────────────────────────

for (const target of ["firefox", "chrome"]) {
  const licFile = path.join(DIST, target, "lib", "license.js");
  const src = fs.readFileSync(licFile, "utf8");
  if (src.includes("%%REQUEST_SIGN_KEY%%")) {
    console.error(`ERROR: Key placeholder was not replaced in dist/${target}/lib/license.js`);
    process.exit(1);
  }
}

// ── verify no sensitive strings leaked into the binary ─────────────────────────

const BANNED = [
  "supabase.co", "openrouter", "hyper-responder",
  "rjzxlaxgqhajzdriubdi", "ocxnrnmfstklptwkeggw",
  "kViVsaIZ0LyVZ8cWuZNG2g",
];

function scanDir(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      scanDir(full);
    } else if (full.endsWith(".js") || full.endsWith(".json") || full.endsWith(".html")) {
      const src = fs.readFileSync(full, "utf8");
      for (const banned of BANNED) {
        if (src.includes(banned)) {
          console.error(`ERROR: Sensitive string "${banned}" found in ${full}`);
          process.exit(1);
        }
      }
    }
  }
}

console.log("Scanning for sensitive strings...");
scanDir(path.join(DIST, "firefox"));
scanDir(path.join(DIST, "chrome"));
console.log("  Clean -- no sensitive strings found.");

// ── zip each target ─────────────────────────────────────────────────────────────

fs.mkdirSync(RELEASE, { recursive: true });

function zipDir(sourceDir, outFile) {
  if (fs.existsSync(outFile)) fs.rmSync(outFile);
  if (process.platform === "win32") {
    cp.execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${outFile}'"`,
      { stdio: "inherit" }
    );
  } else {
    cp.execSync(`zip -r "${outFile}" .`, { cwd: sourceDir, stdio: "inherit" });
  }
}

const version = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).version;

const firefoxZip = path.join(RELEASE, `brainfix-firefox-${version}.zip`);
const chromeZip  = path.join(RELEASE, `brainfix-chrome-${version}.zip`);

console.log(`\nZipping Firefox -> release/brainfix-firefox-${version}.zip`);
zipDir(path.join(DIST, "firefox"), firefoxZip);

console.log(`Zipping Chrome  -> release/brainfix-chrome-${version}.zip`);
zipDir(path.join(DIST, "chrome"), chromeZip);

console.log(`\nDone. Submit these to the browser stores:\n  ${firefoxZip}\n  ${chromeZip}`);
