// Writes public/pool/look.json: for every pool photo, how it looks at a glance, as a 4 x 4 grid of
// average colours in OKLab (48 whole numbers: L, a, b for each cell, each multiplied by 1000).
// The studio uses it to find works that look close to a player's picks when the Gallery API
// (server/), which knows real taste vectors, is not running. See src/blend/look.ts.
//
//   node scripts/build-pool-look.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const pool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'pool');
const GRID = 4;

const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** sRGB bytes to OKLab (Björn Ottosson's matrices). */
function oklab(r8, g8, b8) {
  const r = linear(r8 / 255), g = linear(g8 / 255), b = linear(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const photos = JSON.parse(readFileSync(path.join(pool, 'pool.json'), 'utf8'));
const look = {};
for (const photo of photos) {
  const px = await sharp(path.join(pool, photo.thumb)).removeAlpha().resize(GRID, GRID, { fit: 'fill' }).raw().toBuffer();
  const cells = [];
  for (let i = 0; i < px.length; i += 3) cells.push(...oklab(px[i], px[i + 1], px[i + 2]).map((v) => Math.round(v * 1000)));
  look[photo.id] = cells;
}
writeFileSync(path.join(pool, 'look.json'), JSON.stringify(look) + '\n');
console.log(`look.json: ${Object.keys(look).length} photos`);
