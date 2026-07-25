// Run once to convert ETC/Subscribe SVGs to PNG for Gumroad upload.
// Usage: node scripts/svg-to-png.js
// Requires: npm install --save-dev puppeteer  (downloads ~300MB headless Chrome once)
const puppeteer = require('puppeteer');
const path = require('path');

const FILES = [
  { name: 'img-thumbnail',     w: 600,  h: 600 },
  { name: 'img-hero',          w: 1200, h: 630 },
  { name: 'img-how-it-works',  w: 1200, h: 420 },
  { name: 'img-no-setup',      w: 1200, h: 480 },
  { name: 'img-features',      w: 1200, h: 500 },
];

const DIR = path.resolve(__dirname, '../ETC/Subscribe');

async function main() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  for (const { name, w, h } of FILES) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    await page.goto(`file:///${DIR.replace(/\\/g, '/')}/${name}.svg`, { waitUntil: 'networkidle0' });
    await page.screenshot({
      path: path.join(DIR, `${name}.png`),
      clip: { x: 0, y: 0, width: w, height: h },
    });
    console.log(`  ${name}.png  (${w}x${h} @2x)`);
  }

  await browser.close();
  console.log('Done. Upload the .png files to Gumroad.');
}

main().catch(err => { console.error(err); process.exit(1); });
