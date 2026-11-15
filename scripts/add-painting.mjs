// Copies an image into public/paintings/ as a web-sized JPEG.
//
//   node scripts/add-painting.mjs <source image> <id>
//   node scripts/add-painting.mjs "C:\Downloads\night-watch.png" rembrandt
//
// Writes public/paintings/<id>.jpg (longest side at most 1400 px). Then add or edit the entry in
// public/paintings/paintings.json and run `npm run precompute`.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeImage, downscale, encodeJpeg } from './lib/images.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [src, id] = process.argv.slice(2);
if (!src || !id || !/^[a-z0-9-]+$/.test(id)) {
  console.error('Usage: node scripts/add-painting.mjs <source image> <id>   (id: lowercase letters, digits, dashes)');
  process.exit(1);
}

const dir = path.join(root, 'public', 'paintings');
mkdirSync(dir, { recursive: true });
const img = downscale(decodeImage(path.resolve(src)), 1400);
const out = path.join(dir, `${id}.jpg`);
writeFileSync(out, encodeJpeg(img, 88));
console.log(`${path.relative(root, out)}  ${img.width} x ${img.height}`);
