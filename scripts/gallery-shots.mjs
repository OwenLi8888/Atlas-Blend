// Screenshots and checks for the gallery room and the hand-off into it, against a running dev or
// preview server (it needs /api/picks, so not a plain static host).
//
//   npm run dev -- --port 5199
//   node scripts/gallery-shots.mjs                      everything, at 1440 and 390 wide
//   node scripts/gallery-shots.mjs --room               the room only (direct link), skips the painting
//   node scripts/gallery-shots.mjs --url http://localhost:5173/
//
// Uses the Edge or Chrome already installed (playwright-core downloads nothing). Output: screenshots/.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'screenshots');
mkdirSync(out, { recursive: true });
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1];
};
const url = arg('--url') ?? 'http://localhost:5199/';
const roomOnly = process.argv.includes('--room');
const only = arg('--only'); // 'wide' or 'phone'

const SIZES = {
  wide: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

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

const results = [];
const note = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
};

const browser = await launch();
const shot = (page, name) => page.screenshot({ path: path.join(out, `gallery-${name}.png`) });
const phase = (page) => page.evaluate(() => document.querySelector('.gallery')?.getAttribute('data-phase'));
const waitPhase = (page, p, timeout = 15000) => page.waitForFunction((want) => document.querySelector('.gallery')?.getAttribute('data-phase') === want, p, { timeout });

/** Mean frame rate over `ms` while `act` runs. */
async function fps(page, ms, act) {
  const run = page.evaluate(
    (dur) =>
      new Promise((resolve) => {
        const frames = [];
        let last = performance.now();
        const t0 = last;
        const tick = (now) => {
          frames.push(now - last);
          last = now;
          if (now - t0 < dur) requestAnimationFrame(tick);
          else {
            frames.shift();
            frames.sort((a, b) => a - b);
            resolve({ fps: 1000 / (frames.reduce((a, b) => a + b, 0) / frames.length), p95: frames[Math.floor(frames.length * 0.95)] });
          }
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
  await act();
  return run;
}

/** Geometry checks on the settled room: nothing overlaps, plaques are legible, painters are clear of the painting. */
async function checkRoom(page, tag) {
  const g = await page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
    };
    const panels = [...document.querySelectorAll('.gal-panel')].filter((p) => getComputedStyle(p).visibility !== 'hidden');
    const front = document.querySelector('.gal-panel.front');
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      frames: panels.map((p) => box(p.querySelector('.gal-frame'))),
      frontFrame: front && box(front.querySelector('.gal-frame')),
      frontPlaque: front && box(front.querySelector('.gal-plaque')),
      plaqueFont: front && parseFloat(getComputedStyle(front.querySelector('.gal-plaque-meta')).fontSize),
      chars: [...document.querySelectorAll('.gal-char')].map(box),
      scrollW: document.documentElement.scrollWidth,
    };
  });
  const sorted = [...g.frames].sort((a, b) => a.l - b.l);
  let overlap = 0;
  for (let i = 1; i < sorted.length; i++) overlap = Math.max(overlap, sorted[i - 1].r - sorted[i].l);
  note(`${tag}: frames do not overlap`, overlap <= 0.5, `${sorted.length} frames in view, closest pair ${(-overlap).toFixed(0)} px apart`);
  const f = g.frontFrame;
  note(`${tag}: the front frame is fully on screen`, !!f && f.l >= 0 && f.r <= g.vw && f.t >= 0 && f.b <= g.vh, f ? `${f.w.toFixed(0)} x ${f.h.toFixed(0)} px at (${f.l.toFixed(0)}, ${f.t.toFixed(0)})` : 'no front frame');
  const p = g.frontPlaque;
  note(`${tag}: the plaque is on screen and readable`, !!p && p.l >= 0 && p.r <= g.vw && p.b <= g.vh && g.plaqueFont >= 11, p ? `meta text ${g.plaqueFont.toFixed(1)} px, plaque bottom at ${p.b.toFixed(0)} of ${g.vh}` : 'no plaque');
  const top = Math.min(...g.chars.map((c) => c.t));
  note(`${tag}: the painters never cover the new painting`, g.chars.length === 2 && !!f && top >= f.b, `painters start at ${top.toFixed(0)} px, the frame ends at ${f ? f.b.toFixed(0) : '?'} px`);
  note(`${tag}: no sideways scroll`, g.scrollW <= g.vw, `page is ${g.scrollW} px wide in a ${g.vw} px window`);
}

async function room(tag, size) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: size.deviceScaleFactor, isMobile: size.isMobile, hasTouch: size.hasTouch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // Painters for both users, so the room knows the partner's character.
  await page.goto(`${url}?session=shots-${tag}&user=1&view=gallery`);
  await page.evaluate(() => localStorage.setItem(`atlas:character:shots-${new URL(location.href).searchParams.get('session').slice(6)}:1`, 'ember'));
  await page.reload();
  await waitPhase(page, 'clap');
  await page.waitForTimeout(120);
  await shot(page, `${tag}-3-high-five`);
  await waitPhase(page, 'speak');
  await page.waitForTimeout(1300);
  await shot(page, `${tag}-3b-speech`);
  await waitPhase(page, 'settled');
  await page.waitForTimeout(700);
  await shot(page, `${tag}-4-settled`);
  await checkRoom(page, tag);

  const turn = await fps(page, 2600, async () => {
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(800);
    }
  });
  note(`${tag}: frame rate while turning`, turn.fps > 55, `${turn.fps.toFixed(1)} fps mean, p95 frame ${turn.p95.toFixed(1)} ms (headless)`);
  await page.waitForTimeout(500);
  await shot(page, `${tag}-5-rotated-90`);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(650);
  }
  await page.waitForTimeout(500);
  await shot(page, `${tag}-6-rotated-180`);

  // Drag back a little, then tap the front canvas to focus it.
  const cx = size.width / 2, cy = size.height * 0.4;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(700);
  const focused = await page.locator('.gal-focus').count();
  await shot(page, `${tag}-7-focus`);
  note(`${tag}: tapping a canvas focuses it`, focused === 1, focused ? 'focus view open' : 'no focus view');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  note(`${tag}: Escape returns to the room`, (await page.locator('.gal-focus').count()) === 0, 'focus view closed');
  note(`${tag}: no console errors`, errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : 'clean');
  await context.close();
}

/** The whole flow: painter, picks, the painting, the hand-off bubble, the flight, the room. */
async function flow(tag, size) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: size.deviceScaleFactor, isMobile: size.isMobile, hasTouch: size.hasTouch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${url}?session=flow-${tag}-${Date.now().toString(36)}&user=1`);
  await page.getByRole('radio', { name: /Sunny/ }).click();
  await page.getByPlaceholder('Type your name').fill('Shots'); // page 1 asks for a name before Continue
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.pick-tile').first().waitFor();
  for (let i = 0; i < 5; i++) await page.locator('.pick-tile').nth(i * 3).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  // Three canvases at 9 s each, plus the painter's walks.
  const hang = page.getByRole('button', { name: /Hang it up/ });
  await hang.waitFor({ timeout: 120000 });
  await page.waitForTimeout(2200); // the line types out
  await shot(page, `${tag}-1-handoff`);
  const ring = await page.evaluate(() => !!document.querySelector('.hang-ring'));
  note(`${tag}: the hand-off shows the cloud, the button and its ring`, ring && (await page.locator('.hang .speech').count()) === 1, 'cloud, "Hang it up", progress ring');
  await hang.click();
  await page.waitForTimeout(430);
  await shot(page, `${tag}-2a-lift`);
  await page.waitForFunction(() => !!document.querySelector('.gallery'), null, { timeout: 5000 });
  await page.waitForTimeout(380);
  // Mid-flight: the browser is flying the painting (view transition), or the room is (FLIP).
  const flying = await page.evaluate(() => ({
    shared: document.getAnimations().filter((a) => String(a.effect?.pseudoElement ?? '').includes('view-transition-group(hung-painting)')).length,
    flip: document.querySelectorAll('.gal-flyer:not(.waiting)').length,
  }));
  note(`${tag}: the painting flies into the frame as a shared element`, flying.shared + flying.flip > 0, flying.shared ? 'view transition running on hung-painting' : flying.flip ? 'FLIP flight running' : 'nothing in flight 380 ms in');
  await shot(page, `${tag}-2b-mid-transition`);
  await waitPhase(page, 'clap');
  await page.waitForTimeout(120);
  await shot(page, `${tag}-2c-high-five-after-flight`);
  await waitPhase(page, 'settled');
  await page.waitForTimeout(600);
  await shot(page, `${tag}-2d-settled-after-flight`);
  note(`${tag}: the flow reaches an explorable room`, (await phase(page)) === 'settled', 'painting finished, Hang it up, flight, high five, settled');
  note(`${tag}: no console errors in the flow`, errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : 'clean');
  await context.close();
}

try {
  for (const [tag, size] of Object.entries(SIZES)) {
    if (only && only !== tag) continue;
    await room(tag, size);
    if (!roomOnly) await flow(tag, size);
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${path.relative(root, out)}${path.sep}gallery-*.png`);
if (failed.length) process.exitCode = 1;
