// Passive version check against downloads.json — never auto-downloads or auto-installs.
// Checks once at the next noon (local time), then every 24 hours.
// Writes { version, url } to electron-store key 'updateAvailable' when a newer
// release is found; deletes the key when already up to date.

const https = require('https');
const { app } = require('electron');

const DOWNLOADS_URL  = 'https://raw.githubusercontent.com/northpandalabs/Thought-Tidy/refs/heads/main/legal/downloads.json';
const RELEASES_PAGE  = 'https://thoughttidy.app/download';

function fetchDownloadsJson() {
  return new Promise((resolve, reject) => {
    const req = https.get(DOWNLOADS_URL, {
      headers: { 'User-Agent': 'thought-tidy-updater' }
    }, res => {
      let body = '';
      const MAX_BODY = 64 * 1024;
      res.on('data', c => {
        body += c;
        if (body.length > MAX_BODY) { req.destroy(); reject(new Error('Update response too large')); }
      });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Invalid downloads.json response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('Update check timed out')); });
  });
}

function semverGt(a, b) {
  const parse = v => v.split('.').map(Number);
  const [aM, am, ap = 0] = parse(a);
  const [bM, bm, bp = 0] = parse(b);
  return aM !== bM ? aM > bM : am !== bm ? am > bm : ap > bp;
}

function msUntilNextNoon() {
  const now  = new Date();
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  if (noon <= now) noon.setDate(noon.getDate() + 1);
  return noon - now;
}

async function checkNow(store) {
  const data = await fetchDownloadsJson();

  const latest = typeof data.version === 'string' && /^\d+\.\d+\.\d+$/.test(data.version)
    ? data.version : null;
  if (!latest) return null;

  const current   = app.getVersion();
  const updateUrl = RELEASES_PAGE;

  if (semverGt(latest, current)) {
    const upd = { version: latest, url: updateUrl };
    store.set('updateAvailable', upd);
    return upd;
  } else {
    store.delete('updateAvailable');
    return null;
  }
}

function scheduleUpdateCheck(store) {
  function check() {
    checkNow(store).catch(() => {});
  }
  setTimeout(() => {
    check();
    setInterval(check, 24 * 60 * 60 * 1000);
  }, msUntilNextNoon());
}

module.exports = { scheduleUpdateCheck, checkNow };
