// Drives the built app in a headless browser: screenshots every screen and every style at 50% and
// 100% for all paintings, and measures the acceptance criteria (taps, timing, frame rate, the
// character staying on the brush, clean style switches).
//
//   npm run build
//   node scripts/screenshots.mjs            everything
//   node scripts/screenshots.mjs --quick    screenshots only, no timed runs
//
// Uses the Edge or Chrome already installed (playwright-core downloads nothing). Output: screenshots/.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const out = path.join(root, 'screenshots');
const quick = process.argv.includes('--quick');
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/ is missing: run `npm run build` first.');
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

// A plain static file server, as any host would be: no SPA fallback.
const server = createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(dist, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      // Try the next browser.
    }
  }
  throw new Error('Neither Microsoft Edge nor Google Chrome could be launched.');
}

const paintings = JSON.parse(readFileSync(path.join(dist, 'paintings', 'paintings.json'), 'utf8'));
const STYLES = ['Swirl', 'Shapes', 'Mosaic'];
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const KIOSK = { width: 1180, height: 820, deviceScaleFactor: 2, isMobile: false, hasTouch: true };

const browser = await launch();
const results = [];
const note = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
};
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });

/** Home -> studio, then a style from the menu to start painting. Returns the taps it took to reach the studio. */
async function openStudio(page, paintingIndex, character = 'Pip') {
  await page.goto(url);
  let taps = 0;
  await page.getByRole('radio', { name: new RegExp(character) }).click(); taps++;
  await page.getByRole('button', { name: 'Continue' }).click(); taps++;
  await page.locator('.painting-card').nth(paintingIndex).click(); taps++;
  await page.selectOption('.style-select', 'swirl');
  await page.waitForFunction(() => !!window.__restyle, null, { timeout: 30000 });
  return taps;
}

const seek = async (page, p) => {
  await page.evaluate((v) => window.__restyle.seek(v), p);
  await page.waitForTimeout(350); // lets the character settle
};

async function capture(viewport, tag) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.deviceScaleFactor, isMobile: viewport.isMobile, hasTouch: viewport.hasTouch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(` `));

  await page.goto(url);
  await page.waitForTimeout(500);
  await shot(page, `${tag}-1-home`);
  await page.getByRole('radio', { name: /Juno/ }).click();
  await page.waitForTimeout(700);
  await shot(page, `${tag}-1-home-selected`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(900);
  await shot(page, `${tag}-2-paintings`);
  await page.getByRole('button', { name: 'Museum setup', exact: true }).click();
  await page.waitForTimeout(500);
  await shot(page, `${tag}-2-museum-setup`);

  for (let i = 0; i < paintings.length; i++) {
    await openStudio(page, i, ['Pip', 'Mo', 'Fig', 'Bea'][i % 4]);
    for (const style of STYLES) {
      await page.selectOption('.style-select', style.toLowerCase());
      await seek(page, 0.5);
      await shot(page, `${tag}-3-${paintings[i].id}-${style.toLowerCase()}-050`);
      await seek(page, 1);
      await shot(page, `${tag}-3-${paintings[i].id}-${style.toLowerCase()}-100`);
    }
    if (i === 0) {
      const hold = page.getByRole('button', { name: 'Hold to compare' });
      await hold.dispatchEvent('pointerdown', { pointerId: 1, bubbles: true });
      await page.waitForTimeout(400);
      await shot(page, `${tag}-3-${paintings[i].id}-compare`);
      await hold.dispatchEvent('pointerup', { pointerId: 1, bubbles: true });
    }
  }
  note(`${tag}: no console errors`, errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : 'clean');
  await context.close();
}

/** A missing image must give an "Add painting" card, and a missing plan must fall back to the worker. */
async function fallbacks() {
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.route('**/paintings/hokusai.jpg', (r) => r.fulfill({ status: 404, body: 'Not found' }));
  await page.route('**/paintings/michelangelo.plan.json', (r) => r.fulfill({ status: 404, body: 'Not found' }));
  await page.goto(url);
  await page.getByRole('radio', { name: /Pip/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(1200);
  await shot(page, 'fallback-missing-image');
  const empty = await page.locator('.painting-card.empty').count();
  note('missing image shows an "Add painting" card', empty === 1, `${empty} placeholder card(s)`);

  const t0 = Date.now();
  await page.locator('.painting-card').nth(2).click();
  await page.selectOption('.style-select', 'swirl');
  await page.waitForFunction(() => !!window.__restyle, null, { timeout: 60000 });
  const strokes = await page.evaluate(() => window.__restyle.plan.strokes.length);
  note('missing plan falls back to the worker', strokes > 100, `${strokes} strokes planned in the browser, ready ${Date.now() - t0} ms after the tap`);
  await page.evaluate(() => window.__restyle.seek(1));
  await page.waitForTimeout(300);
  await shot(page, 'fallback-worker-plan');

  // Upload into a slot through Museum setup.
  await page.getByRole('button', { name: /Back/ }).click();
  await page.getByRole('button', { name: 'Museum setup', exact: true }).click();
  await page.locator('.slot input[type=file]').nth(1).setInputFiles(path.join(dist, 'paintings', 'friedrich.jpg'));
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(400);
  const stillEmpty = await page.locator('.painting-card.empty').count();
  note('Museum setup upload fills the slot', stillEmpty === 0, `${stillEmpty} empty slot(s) after upload`);
  await page.locator('.painting-card').nth(1).click();
  await page.selectOption('.style-select', 'swirl');
  await page.waitForFunction(() => !!window.__restyle, null, { timeout: 60000 });
  await page.evaluate(() => window.__restyle.seek(1));
  await page.waitForTimeout(300);
  await shot(page, 'fallback-uploaded');
  await context.close();
}

/** Real-time runs on a phone viewport: taps, start latency, duration, frame rate, sprite, clean restart. */
async function timed() {
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const taps = await openStudio(page, 2);
  note('taps from home to the studio', taps === 3, `${taps} taps, then one pick from the style menu starts the painting`);

  // Tap a style, then watch the whole replay.
  const run = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas');
    const sprite = document.querySelector('.sprite');
    const pick = (id) => {
      const select = document.querySelector('.style-select');
      select.value = id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const tap = performance.now();
    pick('mosaic');
    let firstPaint = 0;
    let done = 0;
    const frames = [];
    let offCanvas = 0;
    let last = tap;
    await new Promise((resolve) => {
      const tick = (now) => {
        frames.push(now - last);
        last = now;
        const p = window.__restyle.progress;
        if (!firstPaint && p > 0 && p < 0.5) firstPaint = now;
        const c = canvas.getBoundingClientRect();
        // No sprite: the character is switched off (SHOW_PAINTER in Studio.tsx).
        const s = sprite ? sprite.getBoundingClientRect() : c;
        // The sprite box must keep touching the canvas: it never leaves it.
        if (p > 0.01 && p < 1 && (s.right < c.left || s.left > c.right || s.bottom < c.top || s.top > c.bottom)) offCanvas++;
        if (p >= 1 && !done) {
          done = now;
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    frames.shift();
    frames.sort((a, b) => a - b);
    const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
    return {
      startMs: firstPaint - tap,
      durationMs: done - tap,
      fps: 1000 / mean,
      p95: frames[Math.floor(frames.length * 0.95)],
      slow: frames.filter((f) => f > 25).length,
      count: frames.length,
      offCanvas,
      hasSprite: !!sprite,
    };
  });
  note('replay starts within 1 s of the tap', run.startMs < 1000, `${run.startMs.toFixed(0)} ms`);
  note('replay takes about 10 s', Math.abs(run.durationMs - 10000) < 800, `${(run.durationMs / 1000).toFixed(2)} s`);
  note('frame rate in Mosaic (headless desktop browser, phone viewport at 3x)', run.fps > 55, `${run.fps.toFixed(1)} fps mean, p95 frame ${run.p95.toFixed(1)} ms, ${run.slow}/${run.count} frames over 25 ms`);
  if (run.hasSprite) note('character never leaves the canvas while painting', run.offCanvas === 0, `${run.offCanvas} frames off the canvas`);

  // Switch styles mid-paint, let it finish, and compare with a clean render of the same style.
  const same = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas');
    const pick = (id) => {
      const select = document.querySelector('.style-select');
      select.value = id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const hash = () => {
      const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let h = 2166136261;
      for (let i = 0; i < d.length; i += 4) {
        h = Math.imul(h ^ d[i], 16777619);
        h = Math.imul(h ^ d[i + 1], 16777619);
        h = Math.imul(h ^ d[i + 2], 16777619);
      }
      return h >>> 0;
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    pick('swirl');
    await wait(2500);
    pick('mosaic'); // mid-paint
    await wait(1200);
    window.__restyle.seek(1);
    await wait(100);
    const switched = hash();
    pick('mosaic'); // a clean replay of the same style
    window.__restyle.seek(1);
    await wait(100);
    const clean = hash();
    pick('mosaic');
    window.__restyle.seek(0.5);
    await wait(100);
    const half1 = hash();
    pick('mosaic');
    window.__restyle.seek(0.5);
    await wait(100);
    return { switched, clean, half1, half2: hash() };
  });
  note('switching styles mid-paint leaves no stray strokes', same.switched === same.clean, `canvas hash ${same.switched} vs clean ${same.clean}`);
  note('replays are identical', same.half1 === same.half2, `50% frame hash ${same.half1} vs ${same.half2}`);
  await context.close();
}

/** The brush tip sits on the stroke point: hold the painting at several moments and compare the two. */
async function tracking() {
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await openStudio(page, 0);
  const result = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const canvas = document.querySelector('canvas');
    const sprite = document.querySelector('.sprite');
    if (!sprite) return null;
    const player = window.__restyle;
    const samples = [];
    for (const p of [0.02, 0.08, 0.2, 0.4, 0.6, 0.8, 0.97]) {
      player.seek(p);
      // Held: the sprite eases onto the point. Counted in frames, since a headless page's frames can stall.
      for (let f = 0; f < 45; f++) await new Promise((r) => requestAnimationFrame(r));
      const style = getComputedStyle(sprite);
      const origin = style.transformOrigin.split(' ').map(parseFloat);
      const m = new DOMMatrix(style.transform);
      // The transform origin is the brush tip, so it lands where the translation puts it.
      const tipX = m.e + origin[0];
      const tipY = m.f + origin[1];
      samples.push({
        p,
        tipX,
        tipY,
        gap: Math.hypot(tipX - player.brush.x, tipY - player.brush.y),
        w: canvas.clientWidth,
        h: canvas.clientHeight,
      });
    }
    return samples;
  });
  if (!result) {
    console.log('SKIP  brush tracking: the character is switched off (SHOW_PAINTER in Studio.tsx)');
    await context.close();
    return;
  }
  const worst = Math.max(...result.map((s) => s.gap));
  note('brush tip sits on the stroke point', worst <= 4, `worst gap ${worst.toFixed(1)} px over ${result.length} moments (the bob is 2.4 px)`);
  const inside = result.every((s) => s.tipX >= -1 && s.tipX <= s.w + 1 && s.tipY >= -4 && s.tipY <= s.h + 4);
  note('brush tip stays inside the canvas', inside, result.map((s) => `${(s.p * 100).toFixed(0)}%: (${s.tipX.toFixed(0)}, ${s.tipY.toFixed(0)}) of ${s.w}x${s.h}`).join('; '));
  await context.close();
}

/** Opening a painting shows it and waits: nothing is painted until a style is picked. */
async function waits() {
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole('radio', { name: /Pip/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.painting-card').nth(0).click();
  await page.waitForTimeout(2000);
  const state = await page.evaluate(() => ({
    started: !!window.__restyle,
    menu: document.querySelector('.style-select').value,
    status: document.querySelector('.status').textContent,
  }));
  await shot(page, 'phone-3-before-style');
  note('opening a painting does not start painting', !state.started && state.menu === '', `"${state.status}", menu on "${state.menu || 'Choose a style'}" after 2 s`);
  await page.selectOption('.style-select', 'shapes');
  await page.waitForFunction(() => window.__restyle && window.__restyle.progress > 0, null, { timeout: 5000 });
  note('picking a style starts it', true, await page.locator('.status').textContent());
  await context.close();
}

/** Save downloads the finished painting as a PNG, and is off until the painting is finished. */
async function saving() {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
  const page = await context.newPage();
  await openStudio(page, 1);
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await page.evaluate(() => window.__restyle.seek(0.4));
  const offEarly = await save.isDisabled();
  await page.evaluate(() => window.__restyle.seek(1));
  await page.waitForTimeout(300);
  const options = await page.locator('.style-select option:not([value=""])').allTextContents();
  note('style menu lists the 3 styles', options.length === 3 && /^Swirl/.test(options[0]) && /^Shapes/.test(options[1]) && /^Mosaic/.test(options[2]), options.join(' | '));
  const [download] = await Promise.all([page.waitForEvent('download'), save.click()]);
  const file = path.join(out, `saved-${download.suggestedFilename()}`);
  await download.saveAs(file);
  const bytes = readFileSync(file);
  const png = bytes.subarray(1, 4).toString() === 'PNG';
  const size = await page.evaluate(() => [document.querySelector('canvas').width, document.querySelector('canvas').height]);
  note('Save is disabled until the painting is finished', offEarly, offEarly ? 'disabled at 40%' : 'enabled at 40%');
  note('Save downloads the painting as a PNG', png && bytes.length > 20000, `${download.suggestedFilename()}, ${(bytes.length / 1024).toFixed(0)} kB, canvas ${size[0]} x ${size[1]} px`);
  await context.close();
}

try {
  await waits();
  await saving();
  await capture(PHONE, 'phone');
  await capture(KIOSK, 'kiosk');
  await fallbacks();
  if (!quick) {
    await timed();
    await tracking();
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${path.relative(root, out)}${path.sep}`);
if (failed.length) process.exitCode = 1;
