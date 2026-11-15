// Writes the PLACEHOLDER art of the gallery room: public/gallery/placeholder.jpg (stands in for the
// painting the two users made) and public/gallery/samples/sample-01.jpg to sample-11.jpg with their
// samples.json. Simple seeded studies in the app's three looks (Swirl, Shapes, Mosaic) and its own
// colours, so nothing here needs a licence. Replace the files with real paintings and edit
// samples.json by hand; this script is only for regenerating the stand-ins.
//
//   node scripts/make-gallery-placeholders.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'gallery');
mkdirSync(path.join(out, 'samples'), { recursive: true });

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The app palette (src/styles.css) and the six painters' colours (src/characters.tsx).
const PALETTES = [
  ['#142f40', '#62929e', '#e7decd', '#a6445d', '#FFC62E'],
  ['#EF5A26', '#FFC62E', '#e7decd', '#a6445d', '#393a10'],
  ['#2F55D8', '#62929e', '#EFE8DA', '#142f40', '#E2337F'],
  ['#1F9E6E', '#393a10', '#e7decd', '#FFC62E', '#62929e'],
  ['#E2337F', '#a6445d', '#EFE8DA', '#2F55D8', '#FFC62E'],
];

const f = (n) => n.toFixed(1);

/** Long curved strokes that follow one slow turn, as the Swirl style lays them. */
function swirl(w, h, r, pal) {
  const parts = [`<rect width="${w}" height="${h}" fill="${pal[0]}"/>`];
  const cx = w * (0.3 + r() * 0.4), cy = h * (0.3 + r() * 0.4);
  for (let i = 0; i < 520; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * Math.max(w, h) * 0.85;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    const t = a + Math.PI / 2 + (r() - 0.5) * 0.5, len = 26 + r() * 60;
    const x2 = x + Math.cos(t) * len, y2 = y + Math.sin(t) * len;
    const mx = (x + x2) / 2 + Math.cos(a) * len * 0.22, my = (y + y2) / 2 + Math.sin(a) * len * 0.22;
    const band = Math.floor((d / (Math.max(w, h) * 0.85)) * (pal.length - 1) + r() * 1.3) % pal.length;
    parts.push(`<path d="M${f(x)},${f(y)}Q${f(mx)},${f(my)} ${f(x2)},${f(y2)}" stroke="${pal[band]}" stroke-width="${f(7 + r() * 11)}" stroke-linecap="round" fill="none" opacity="${f(0.7 + r() * 0.3)}"/>`);
  }
  return parts.join('');
}

/** Flat overlapping facets, as the Shapes style cuts a picture up. */
function shapes(w, h, r, pal) {
  const parts = [`<rect width="${w}" height="${h}" fill="${pal[2]}"/>`];
  for (let i = 0; i < 46; i++) {
    const x = r() * w, y = r() * h, s = 60 + r() * 190, n = 3 + Math.floor(r() * 3), a0 = r() * Math.PI;
    const pts = Array.from({ length: n }, (_, k) => {
      const a = a0 + (k / n) * Math.PI * 2, d = s * (0.55 + r() * 0.45);
      return `${f(x + Math.cos(a) * d)},${f(y + Math.sin(a) * d)}`;
    });
    parts.push(`<polygon points="${pts.join(' ')}" fill="${pal[Math.floor(r() * pal.length)]}" opacity="${f(0.62 + r() * 0.34)}" stroke="#142f40" stroke-opacity="0.35" stroke-width="2"/>`);
  }
  return parts.join('');
}

/** Small uneven tiles with grout between them, as the Mosaic style sets them. */
function mosaic(w, h, r, pal) {
  const parts = [`<rect width="${w}" height="${h}" fill="#efe8da"/>`];
  const cell = 34, cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const cx = w * (0.25 + r() * 0.5), cy = h * (0.25 + r() * 0.5);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = i * cell, y = j * cell, g = 2.5;
      const q = () => (r() - 0.5) * 7;
      const pts = [
        [x + g + q(), y + g + q()], [x + cell - g + q(), y + g + q()],
        [x + cell - g + q(), y + cell - g + q()], [x + g + q(), y + cell - g + q()],
      ].map((p) => `${f(p[0])},${f(p[1])}`);
      const d = Math.hypot(x - cx, y - cy) / Math.hypot(w, h);
      const band = Math.floor(d * 2.4 * pal.length + r() * 1.4) % pal.length;
      parts.push(`<polygon points="${pts.join(' ')}" fill="${pal[band]}" opacity="${f(0.82 + r() * 0.18)}"/>`);
    }
  }
  return parts.join('');
}

const DRAW = { Swirl: swirl, Shapes: shapes, Mosaic: mosaic };

async function write(file, style, w, h, seed) {
  const r = rng(seed);
  const pal = PALETTES[seed % PALETTES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${DRAW[style](w, h, r, pal)}</svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 82, mozjpeg: true }).toFile(file);
}

const SIZES = [[720, 900], [900, 720], [800, 800], [720, 960], [960, 720]];
const TITLES = ['Morning Study', 'Harbour Study', 'Garden Study', 'Hillside Study', 'Window Study', 'Market Study', 'River Study', 'Orchard Study', 'Evening Study', 'Rooftop Study', 'Meadow Study'];
const STYLES = ['Swirl', 'Shapes', 'Mosaic'];

const samples = [];
for (let i = 0; i < 11; i++) {
  const style = STYLES[i % 3];
  const [w, h] = SIZES[i % SIZES.length];
  const name = `sample-${String(i + 1).padStart(2, '0')}`;
  await write(path.join(out, 'samples', `${name}.jpg`), style, w, h, 11 + i * 7);
  samples.push({ id: name, file: `${name}.jpg`, title: TITLES[i], style, credit: 'Placeholder: replace with a real painting' });
}
writeFileSync(path.join(out, 'samples', 'samples.json'), JSON.stringify(samples, null, 2) + '\n');
await write(path.join(out, 'placeholder.jpg'), 'Swirl', 800, 1000, 5);
console.log(`Wrote ${samples.length} samples and placeholder.jpg to ${path.relative(root, out)}`);
