// One-time import of the photo pool: moves the source photos into public/pool/photos/ under stable
// IDs (p001, p002, ...) and writes public/pool/pool-map.json so the original names are not lost.
//
//   node scripts/import-pool.mjs "C:\path\to\atlas picks 100"
//   node scripts/import-pool.mjs "C:\path\to\folder" --dry     (count and list only, move nothing)
//
// Photos are numbered in name order. Files that are not images are left where they are, except an
// index.tsv (file, title, artist, year, art id), which is copied next to the photos.
// Then run:  npm run build-pool
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const poolDir = path.join(root, 'public', 'pool');
const photoDir = path.join(poolDir, 'photos');
const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const source = args.find((a) => !a.startsWith('--'));
if (!source || !existsSync(source)) {
  console.error('Usage: node scripts/import-pool.mjs "<folder with the photos>" [--dry]');
  process.exit(1);
}

const all = readdirSync(source, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
const images = all.filter((n) => IMAGE.has(path.extname(n).toLowerCase())).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const others = all.filter((n) => !images.includes(n));

console.log(`${images.length} image files, ${others.length} other files in ${source}`);
for (const n of others) console.log(`  not an image: ${n}`);
if (dry) process.exit(0);

if (existsSync(path.join(poolDir, 'pool-map.json'))) {
  console.error('public/pool/pool-map.json already exists: the pool was imported before. Nothing moved.');
  process.exit(1);
}

mkdirSync(photoDir, { recursive: true });
const map = {};
images.forEach((name, i) => {
  const id = `p${String(i + 1).padStart(3, '0')}`;
  const file = id + path.extname(name).toLowerCase();
  renameSync(path.join(source, name), path.join(photoDir, file));
  map[id] = name;
});
writeFileSync(path.join(poolDir, 'pool-map.json'), JSON.stringify(map, null, 2) + '\n');
if (others.includes('index.tsv')) copyFileSync(path.join(source, 'index.tsv'), path.join(poolDir, 'index.tsv'));
console.log(`Moved ${images.length} photos to public/pool/photos/ and wrote public/pool/pool-map.json`);
