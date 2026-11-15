// Tiles screenshots/ into contact sheets (screenshots/sheet-*.png) for a quick visual review.
//   node scripts/contact-sheet.mjs
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
const files = readdirSync(dir).filter((f) => f.endsWith('.png') && !f.startsWith('sheet-'));
const groups = {
  'phone-screens': files.filter((f) => /^phone-[12]-|compare|^fallback/.test(f)),
  'kiosk-screens': files.filter((f) => /^kiosk-[12]-|^kiosk.*compare/.test(f)),
};
for (const tag of ['phone', 'kiosk']) {
  for (const style of ['swirl', 'shapes', 'print']) {
    groups[`${tag}-${style}`] = files.filter((f) => f.startsWith(`${tag}-3-`) && f.includes(`-${style}-`));
  }
}

let browser;
for (const channel of ['msedge', 'chrome']) {
  try {
    browser = await chromium.launch({ channel, headless: true });
    break;
  } catch {
    // Try the next browser.
  }
}
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (const [name, list] of Object.entries(groups)) {
  if (!list.length) continue;
  const cols = name.startsWith('kiosk') ? 2 : Math.min(list.length, 4);
  const html = `<body style="margin:0;background:#888;display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;padding:6px;font:12px sans-serif">${list
    .map((f) => `<figure style="margin:0"><img src="${encodeURI(f)}" style="width:100%;display:block"><figcaption style="color:#fff">${f}</figcaption></figure>`)
    .join('')}</body>`;
  // Loaded from a file beside the images: a blank page may not read file:// URLs.
  const tmp = path.join(dir, '_sheet.html');
  writeFileSync(tmp, html);
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
  rmSync(tmp);
  await page.screenshot({ path: path.join(dir, `sheet-${name}.png`), fullPage: true });
  console.log(`sheet-${name}.png (${list.length})`);
}
await browser.close();
