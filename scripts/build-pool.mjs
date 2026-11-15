// Builds the photo pool index and thumbnails for the photo-picks screen.
//
//   npm run build-pool
//
// Reads   public/pool/photos/p###.<ext>   (put there by scripts/import-pool.mjs)
// Writes  public/pool/thumbs/p###.jpg     (about 600 px on the long side)
//         public/pool/pool.json           [{ id, file, thumb, width, height, ... }]
//
// `file` and `thumb` are relative to public/pool/. When public/pool/index.tsv and pool-map.json are
// present, each entry also gets title, artist, year and artId (the atlas id, e.g. "smk:KMS4209").
// Needs only Node and `npm install` (sharp ships prebuilt binaries for Windows, macOS and Linux).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const poolDir = path.join(root, 'public', 'pool');
const photoDir = path.join(poolDir, 'photos');
const thumbDir = path.join(poolDir, 'thumbs');
const THUMB_SIDE = 600;

if (!existsSync(photoDir)) {
  console.error('public/pool/photos/ is missing: run scripts/import-pool.mjs first.');
  process.exit(1);
}
mkdirSync(thumbDir, { recursive: true });

// Optional details: original file name -> { title, artist, year, artId }.
const details = new Map();
const tsv = path.join(poolDir, 'index.tsv');
if (existsSync(tsv)) {
  for (const line of readFileSync(tsv, 'utf8').split(/\r?\n/)) {
    const [name, title, artist, year, artId] = line.split('\t');
    if (name && title !== undefined) details.set(name, { title, artist: artist ?? '', year: year ?? '', artId: artId ?? '' });
  }
}
const mapFile = path.join(poolDir, 'pool-map.json');
const originals = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, 'utf8')) : {};

const files = readdirSync(photoDir).filter((n) => /^p\d{3}\.[a-z0-9]+$/i.test(n)).sort();
const pool = [];
for (const file of files) {
  const id = path.basename(file, path.extname(file));
  const src = path.join(photoDir, file);
  // .rotate() applies the EXIF orientation, so width and height are as the photo is displayed.
  const image = sharp(src).rotate();
  const { data, info } = await image.toBuffer({ resolveWithObject: true });
  const thumb = `thumbs/${id}.jpg`;
  await sharp(data)
    .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(path.join(poolDir, thumb));
  pool.push({ id, file: `photos/${file}`, thumb, width: info.width, height: info.height, ...(details.get(originals[id]) ?? {}) });
}

writeFileSync(path.join(poolDir, 'pool.json'), JSON.stringify(pool, null, 2) + '\n');
console.log(`Wrote public/pool/pool.json (${pool.length} photos) and ${pool.length} thumbnails to public/pool/thumbs/`);
if (pool.length !== 100) console.warn(`Expected 100 photos, found ${pool.length}.`);
