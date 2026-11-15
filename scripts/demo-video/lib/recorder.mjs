/**
 * Records a page as it really runs: every frame Chromium paints is saved with its timestamp
 * (the DevTools screencast), then ffmpeg lays them on a steady 30 fps timeline. Sharper than
 * Playwright's own video, and the clip keeps named marks so the edit can cut on them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUILD = path.join(ROOT, 'build');
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const FPS = 30;

/** The newest Chromium that Playwright has already downloaded; system Chrome when there is none. */
function installedChromium() {
  const cache = path.join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(cache)) return null;
  const builds = readdirSync(cache)
    .filter(name => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const build of builds) {
    const binary = path.join(cache, build, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    if (existsSync(binary)) return binary;
  }
  return null;
}

export async function launch() {
  const executablePath = installedChromium();
  return chromium.launch({
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    headless: true,
    // the real GPU, so the 3D studio runs at full speed without a window on screen
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
  });
}

/** A pointer drawn in the page, since a headless browser has none: a soft dot that rings when it taps. */
const POINTER = `
(() => {
  if (window.__demoPointer) return;
  window.__demoPointer = true;
  const start = () => {
    const style = document.createElement('style');
    style.textContent = \`
      #demo-pointer { position: fixed; left: 0; top: 0; z-index: 2147483647; width: 30px; height: 30px; margin: -15px 0 0 -15px;
        border-radius: 50%; background: rgba(31, 26, 20, 0.34); border: 2px solid rgba(255, 255, 255, 0.92);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28); pointer-events: none; opacity: 0; transition: opacity 0.25s ease, width 0.12s ease, height 0.12s ease, margin 0.12s ease; }
      #demo-pointer.on { opacity: 1; }
      #demo-pointer.down { width: 22px; height: 22px; margin: -11px 0 0 -11px; }
      .demo-ring { position: fixed; z-index: 2147483646; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.95); box-shadow: 0 0 0 1px rgba(31, 26, 20, 0.35); pointer-events: none; animation: demo-ring 0.55s ease-out forwards; }
      @keyframes demo-ring { to { transform: scale(2.6); opacity: 0; } }
    \`;
    document.head.appendChild(style);
    const dot = document.createElement('div');
    dot.id = 'demo-pointer';
    document.body.appendChild(dot);
    window.addEventListener('mousemove', event => {
      dot.style.transform = 'translate(' + event.clientX + 'px,' + event.clientY + 'px)';
      dot.classList.add('on');
    }, true);
    window.addEventListener('mousedown', event => {
      dot.classList.add('down');
      const ring = document.createElement('div');
      ring.className = 'demo-ring';
      ring.style.left = event.clientX + 'px';
      ring.style.top = event.clientY + 'px';
      document.body.appendChild(ring);
      setTimeout(() => ring.remove(), 600);
    }, true);
    window.addEventListener('mouseup', () => dot.classList.remove('down'), true);
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
`;

export async function newPage(browser, { pointer = true } = {}) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  if (pointer) await context.addInitScript(POINTER);
  const page = await context.newPage();
  page.pointer = { x: WIDTH * 0.62, y: HEIGHT * 0.78 };
  return page;
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const ease = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Glides the pointer to a point, the way a hand moves: slow, fast, slow. */
export async function glide(page, x, y, ms = 650) {
  const from = page.pointer;
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const k = ease(i / steps);
    await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
    await sleep(ms / steps);
  }
  page.pointer = { x, y };
}

/** Where a locator sits on screen: its middle, or a point inside it given as fractions. */
export async function pointOf(locator, at = { x: 0.5, y: 0.5 }) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Nothing on screen for ' + locator);
  return { x: box.x + box.width * at.x, y: box.y + box.height * at.y };
}

/** Glides to something and taps it. */
export async function tap(page, locator, { ms = 650, hold = 90, at } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const { x, y } = await pointOf(locator, at);
  await glide(page, x, y, ms);
  await sleep(120);
  await page.mouse.down();
  await sleep(hold);
  await page.mouse.up();
}

/** Types the way a person does, a key at a time. */
export async function type(page, text, perKey = 95) {
  for (const key of text) {
    await page.keyboard.type(key);
    await sleep(perKey * (0.7 + Math.random() * 0.6));
  }
}

/** Scrolls the page (or one element) smoothly by `dy` pixels over `ms`. */
export async function scrollBy(page, dy, ms = 1200, selector = null) {
  await page.evaluate(
    ({ dy, ms, selector }) =>
      new Promise(resolve => {
        const target = selector ? document.querySelector(selector) : document.scrollingElement;
        if (!target) return resolve();
        const from = target.scrollTop;
        const began = performance.now();
        const step = now => {
          const t = Math.min(1, (now - began) / ms);
          const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
          target.scrollTop = from + dy * k;
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    { dy, ms, selector },
  );
}

/**
 * Records `page` while `action` runs. `action` gets `mark(name)` to note a moment worth cutting on.
 * Leaves build/clips/<name>.mp4 and <name>.json ({ duration, marks }).
 */
export async function record(page, name, action) {
  const dir = path.join(BUILD, 'frames', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(BUILD, 'clips'), { recursive: true });

  const frames = [];
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = 'f' + String(frames.length).padStart(6, '0') + '.jpg';
    writeFileSync(path.join(dir, file), Buffer.from(data, 'base64'));
    frames.push({ file, at: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 93, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });

  const began = Date.now() / 1000;
  const marks = {};
  const mark = label => {
    marks[label] = Date.now() / 1000 - began;
    console.log('  ' + name + ' · ' + label + ' @ ' + marks[label].toFixed(2) + 's');
  };
  try {
    await action(mark);
  } finally {
    const ended = Date.now() / 1000;
    await cdp.send('Page.stopScreencast').catch(() => {});
    await cdp.detach().catch(() => {});

    // only what was painted after the recording began, on the recording's own clock
    const kept = frames.filter(frame => frame.at <= ended);
    if (kept.length === 0) throw new Error('No frames were recorded for ' + name);
    const lines = [];
    kept.forEach((frame, index) => {
      const shownFrom = Math.max(frame.at, began);
      const shownUntil = index + 1 < kept.length ? Math.max(kept[index + 1].at, began) : ended;
      const duration = Math.max(0, shownUntil - shownFrom);
      if (duration === 0 && index + 1 < kept.length) return;
      lines.push("file '" + path.join(dir, frame.file) + "'", 'duration ' + duration.toFixed(5));
    });
    lines.push("file '" + path.join(dir, kept[kept.length - 1].file) + "'");
    const list = path.join(dir, 'frames.txt');
    writeFileSync(list, lines.join('\n') + '\n');

    const out = path.join(BUILD, 'clips', name + '.mp4');
    execFileSync('ffmpeg', [
      '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
      '-vf', 'fps=' + FPS + ',scale=' + WIDTH + ':' + HEIGHT + ':flags=lanczos,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-movflags', '+faststart', out,
    ]);
    const duration = ended - began;
    writeFileSync(path.join(BUILD, 'clips', name + '.json'), JSON.stringify({ duration, marks, frames: kept.length }, null, 2) + '\n');
    console.log(name + ': ' + duration.toFixed(1) + 's, ' + kept.length + ' frames (' + (kept.length / duration).toFixed(0) + ' fps painted)');
    rmSync(dir, { recursive: true, force: true });
  }
}
