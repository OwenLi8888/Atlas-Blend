/**
 * Regroups the works on the walls into visual families and writes them to
 * `families.json`. Run it after the collection changes a lot:
 *
 *   npm run recluster
 *
 * Works are grouped by spherical k-means on their image vectors, with the
 * collection average taken away first. Without that step every vector shares
 * one large common direction, so all family averages look about 95% alike and
 * small, distinct groups are swallowed by large ones.
 *
 * Two families whose averages are very alike are then merged: k-means splits
 * a big kind of work in two as readily as it separates two kinds, and the
 * splits it made here were the same art photographed by different museums
 * (Indian album pages from the Met and from Cleveland) or the same tradition
 * in two formats (Japanese handscrolls and hanging scrolls). A merge that would
 * hold more than a set share of the collection is skipped, so merging never
 * rebuilds a catch-all.
 *
 * The result is deterministic: the same collection always gives the same
 * families. It then lists each family's most typical works and the name it gets
 * from `families.ts`; a family with no name, or two, needs a name written there.
 */
import { writeFile } from 'node:fs/promises';
import { isShown, loadCatalogData } from './catalog';
import { FAMILY_NAMES } from './families';

const FAMILY_COUNT = 32;
/** k-means is restarted from these seeds and the tightest grouping is kept. */
const SEEDS = [7, 11, 23, 42];
const MAX_ROUNDS = 50;
/**
 * Families whose averages are at least this alike are merged. Measured on this
 * collection: same-kind splits sit at 0.78 to 0.85; neighbouring kinds that
 * read as different on a wall (ukiyo-e prints and narrative scrolls, two
 * schools of landscape) sit at 0.75 and below.
 */
const MERGE_LIKENESS = 0.78;
/** No merge may make a family hold more than this share of the works. */
const MAX_FAMILY_SHARE = 0.07;

const host = process.env.TYPESENSE_HOST;
const apiKey = process.env.TYPESENSE_KEY;
if (!host || !apiKey) throw new Error('Set TYPESENSE_HOST and TYPESENSE_KEY (see .env.example)');

const raw = await loadCatalogData({
  host,
  apiKey,
  collection: process.env.TYPESENSE_COLLECTION ?? 'art_v1',
  cacheDir: new URL('./.cache', import.meta.url).pathname,
});
const rows = raw.works.flatMap((work, row) => (isShown(work) ? [row] : []));
const dim = raw.dim;
const count = rows.length;

// Centre and re-normalise the vectors of the works on the walls.
const points = new Float32Array(count * dim);
const mean = new Float64Array(dim);
rows.forEach(row => {
  for (let d = 0; d < dim; d++) mean[d] += raw.vectors[row * dim + d];
});
for (let d = 0; d < dim; d++) mean[d] /= count;
rows.forEach((row, point) => {
  let squared = 0;
  for (let d = 0; d < dim; d++) {
    const x = raw.vectors[row * dim + d] - mean[d];
    points[point * dim + d] = x;
    squared += x * x;
  }
  const length = Math.sqrt(squared) || 1;
  for (let d = 0; d < dim; d++) points[point * dim + d] /= length;
});

function dot(a: Float32Array, aRow: number, b: Float32Array, bRow: number): number {
  let sum = 0;
  const ai = aRow * dim;
  const bi = bRow * dim;
  for (let d = 0; d < dim; d++) sum += a[ai + d] * b[bi + d];
  return sum;
}

/** Small seeded generator (mulberry32), so every run picks the same starting points. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Grouping {
  family: Int32Array;
  /** Mean likeness of each work to its family's average: higher is tighter. */
  fit: number;
}

function kmeans(k: number, seed: number): Grouping {
  const random = seeded(seed);
  const centroids = new Float32Array(k * dim);

  // k-means++: each new centre is drawn with weight by squared distance to the nearest chosen one.
  const nearest = new Float64Array(count).fill(Infinity);
  let pick = Math.floor(random() * count);
  for (let c = 0; c < k; c++) {
    centroids.set(points.subarray(pick * dim, (pick + 1) * dim), c * dim);
    if (c === k - 1) break;
    let total = 0;
    for (let p = 0; p < count; p++) {
      const distance = Math.max(0, 1 - dot(points, p, centroids, c));
      nearest[p] = Math.min(nearest[p], distance * distance);
      total += nearest[p];
    }
    let target = random() * total;
    pick = count - 1;
    for (let p = 0; p < count; p++) {
      target -= nearest[p];
      if (target <= 0) {
        pick = p;
        break;
      }
    }
  }

  const family = new Int32Array(count).fill(-1);
  let fit = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let moved = 0;
    fit = 0;
    for (let p = 0; p < count; p++) {
      let best = 0;
      let bestScore = -Infinity;
      for (let c = 0; c < k; c++) {
        const score = dot(points, p, centroids, c);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      fit += bestScore;
      if (family[p] !== best) {
        family[p] = best;
        moved++;
      }
    }
    fit /= count;
    if (moved === 0) break;

    centroids.fill(0);
    for (let p = 0; p < count; p++) {
      const c = family[p] * dim;
      for (let d = 0; d < dim; d++) centroids[c + d] += points[p * dim + d];
    }
    for (let c = 0; c < k; c++) {
      let squared = 0;
      for (let d = 0; d < dim; d++) squared += centroids[c * dim + d] ** 2;
      if (squared === 0) {
        // An emptied family restarts from a random work rather than vanishing.
        const restart = Math.floor(random() * count);
        centroids.set(points.subarray(restart * dim, (restart + 1) * dim), c * dim);
        continue;
      }
      const length = Math.sqrt(squared);
      for (let d = 0; d < dim; d++) centroids[c * dim + d] /= length;
    }
  }
  return { family, fit };
}

console.log('Clustering ' + count + ' works into ' + FAMILY_COUNT + ' families (' + SEEDS.length + ' starts)…');
let best: Grouping | null = null;
for (const seed of SEEDS) {
  const grouping = kmeans(FAMILY_COUNT, seed);
  console.log('  seed ' + seed + ': mean likeness ' + grouping.fit.toFixed(4));
  if (!best || grouping.fit > best.fit) best = grouping;
}
if (!best) throw new Error('No grouping was made');
const { family } = best;

// Merge the most alike pair of families until no pair is alike enough.
let groups: number[][] = Array.from({ length: FAMILY_COUNT }, () => []);
for (let p = 0; p < count; p++) groups[family[p]].push(p);
groups = groups.filter(group => group.length > 0);
const maxSize = Math.floor(count * MAX_FAMILY_SHARE);
for (;;) {
  const averages = new Float32Array(groups.length * dim);
  groups.forEach((group, index) => averages.set(averageOf(group), index * dim));
  let pair: [number, number] | null = null;
  let pairLikeness = MERGE_LIKENESS;
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      if (groups[a].length + groups[b].length > maxSize) continue;
      const likeness = dot(averages, a, averages, b);
      if (likeness >= pairLikeness) {
        pair = [a, b];
        pairLikeness = likeness;
      }
    }
  }
  if (!pair) break;
  const [a, b] = pair;
  console.log('  merged two families (' + groups[a].length + ' + ' + groups[b].length + ' works, ' + pairLikeness.toFixed(3) + ' alike)');
  groups[a] = [...groups[a], ...groups[b]];
  groups.splice(b, 1);
}

/** Unit-length average of a group's points. */
function averageOf(group: readonly number[]): Float32Array {
  const average = new Float32Array(dim);
  for (const p of group) for (let d = 0; d < dim; d++) average[d] += points[p * dim + d];
  const length = Math.hypot(...average) || 1;
  for (let d = 0; d < dim; d++) average[d] /= length;
  return average;
}

// Families largest first; inside each, the most typical work first.
const families = groups
  .map(group => {
    const average = averageOf(group);
    return group.map(point => ({ point, likeness: dot(points, point, average, 0) }));
  })
  .sort((a, b) => b.length - a.length)
  .map(group => group.sort((a, b) => b.likeness - a.likeness));

const ids = families.map(group => group.map(({ point }) => raw.works[rows[point]].id));
await writeFile(new URL('./families.json', import.meta.url), JSON.stringify({ families: ids }, null, 1) + '\n');

// A report for naming: each family's size, its name from families.ts and its most typical works.
const familyOfId = new Map(ids.flatMap((group, index) => group.map(id => [id, index] as const)));
const namesOf = ids.map(() => [] as string[]);
for (const { anchor, name } of FAMILY_NAMES) {
  const index = familyOfId.get(anchor);
  if (index !== undefined) namesOf[index].push(name);
}
families.forEach((group, index) => {
  const names = namesOf[index];
  const label = names.length === 0 ? 'NEEDS A NAME' : names.length > 1 ? 'SEVERAL NAMES: ' + names.join(' / ') : names[0];
  console.log('\n' + index + '. ' + label + ' (' + group.length + ' works)');
  for (const { point, likeness } of group.slice(0, 6)) {
    const work = raw.works[rows[point]];
    console.log('   ' + likeness.toFixed(2) + '  ' + work.id + '  ' + work.title.slice(0, 50) + ' · ' + work.artist.slice(0, 30) + ' · ' + (work.date ?? ''));
  }
});
const unused = FAMILY_NAMES.filter(({ anchor }) => !familyOfId.has(anchor));
for (const { anchor, name } of unused) console.log('\nName not used: "' + name + '" (' + anchor + ' is not on the walls)');
console.log('\nWrote families.json: ' + ids.length + ' families, ' + count + ' works.');
