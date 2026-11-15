/**
 * Taste and blend scoring. Pure functions over an in-memory corpus of image
 * vectors; no I/O. Works are referred to by their row number in the corpus.
 *
 * All similarities are cosine between SigLIP 2 image vectors. Measured on the
 * 6,674-work collection: two unrelated works sit around 0.55, only 1% of
 * random pairs exceed 0.77, and a work's nearest neighbour is around 0.85.
 */

/** Unit-length vectors for every work, stored row after row. */
export interface Corpus {
  readonly count: number;
  readonly dim: number;
  readonly vectors: Float32Array;
}

/** One of a person's interests: a group of similar hearts. */
export interface Taste {
  /**
   * The heart at the centre of the group. A real work stands in for the group
   * instead of an average: averaged vectors drift toward the middle of the
   * whole collection, which made any two people look about 93% alike.
   */
  readonly medoid: number;
  readonly members: readonly number[];
  /** Share of the person's hearts in this group; shares sum to 1. */
  readonly weight: number;
}

/** Anchors for turning a raw similarity into a 0 to 100 overlap score. */
export interface Calibration {
  /** Typical similarity between two unrelated works: scores 0. */
  readonly stranger: number;
  /** Typical similarity between a work and its nearest neighbour: scores 100. */
  readonly kindred: number;
}

export interface Pick {
  readonly index: number;
  /** Position in the tastes array this pick was chosen for. */
  readonly taste: number;
}

/** Two hearts at least this similar count as the same taste. */
export const SAME_TASTE_SIMILARITY = 0.77;
export const MAX_TASTES = 3;

/**
 * How the overlap is shown. People read a match score against the ones they
 * know, where even a loose match sits well above half, so the raw 0 to 1
 * overlap is lifted onto 50 to 100 and curved so most pairs land between 65
 * and 95. The order of scores is unchanged: a higher overlap is always a higher score.
 */
const MATCH_FLOOR = 0.5;
const MATCH_CURVE = 0.6;

const CANDIDATES_PER_TASTE = 200;
/**
 * Closeness to a heart stops counting above this, the level of a typical
 * nearest neighbour. Past it a work is close to a copy (the next print in the
 * same series), and a wall of those teaches the person nothing new.
 */
const NEAR_COPY_SIMILARITY = 0.85;
/** Balance between closeness to the taste (1) and variety on the wall (0). */
const RELEVANCE_WEIGHT = 0.7;
const MAX_PER_ARTIST = 2;
const MEDOID_ROUNDS = 8;

export function similarity(corpus: Corpus, a: number, b: number): number {
  const { dim, vectors } = corpus;
  const rowA = a * dim;
  const rowB = b * dim;
  let sum = 0;
  for (let d = 0; d < dim; d++) sum += vectors[rowA + d] * vectors[rowB + d];
  return sum;
}

/** Similarity of every work in the corpus to one work. */
export function similaritiesTo(corpus: Corpus, target: number): Float32Array {
  const { count, dim, vectors } = corpus;
  const query = vectors.subarray(target * dim, (target + 1) * dim);
  const result = new Float32Array(count);
  for (let i = 0, row = 0; i < count; i++, row += dim) {
    let sum = 0;
    for (let d = 0; d < dim; d++) sum += vectors[row + d] * query[d];
    result[i] = sum;
  }
  return result;
}

/**
 * Groups hearts into at most `maxTastes` interests.
 *
 * Centres are added one at a time, each chosen to bring the most hearts closer
 * to a centre, so a single stray heart does not claim a group ahead of a real
 * second interest. No centre is added once every heart is already close to one.
 */
export function findTastes(corpus: Corpus, hearts: readonly number[], maxTastes = MAX_TASTES): Taste[] {
  const items = [...new Set(hearts)];
  const n = items.length;
  if (n === 0) return [];

  const sims = pairwiseSimilarities(corpus, items);
  const sim = (a: number, b: number) => sims[a * n + b];

  const totalSimilarity = (a: number) => {
    let sum = 0;
    for (let b = 0; b < n; b++) sum += sim(a, b);
    return sum;
  };
  let centres = [argMax(n, totalSimilarity)];
  const closest = Float32Array.from({ length: n }, (_, b) => sim(centres[0], b));

  while (centres.length < Math.min(maxTastes, n) && closest.some(s => s < SAME_TASTE_SIMILARITY)) {
    const gain = (candidate: number) => {
      let sum = 0;
      for (let b = 0; b < n; b++) sum += Math.max(0, sim(candidate, b) - closest[b]);
      return sum;
    };
    const next = argMax(n, gain);
    centres.push(next);
    for (let b = 0; b < n; b++) closest[b] = Math.max(closest[b], sim(next, b));
  }

  let groups = assignToCentres(n, centres, sim);
  for (let round = 0; round < MEDOID_ROUNDS; round++) {
    const moved = groups.map(group => group[argMax(group.length, a => {
      let sum = 0;
      for (const b of group) sum += sim(group[a], b);
      return sum;
    })]);
    if (moved.every((centre, i) => centre === centres[i])) break;
    centres = moved;
    groups = assignToCentres(n, centres, sim);
  }

  return groups
    .map((group, i): Taste => ({
      medoid: items[centres[i]],
      members: group.map(member => items[member]),
      weight: group.length / n,
    }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Splits `total` slots between tastes in proportion to their weights. When
 * there are enough slots, every taste keeps at least one, taken from whichever
 * taste holds the most.
 */
export function allocateSlots(weights: readonly number[], total: number): number[] {
  const k = weights.length;
  if (k === 0 || total <= 0) return weights.map(() => 0);

  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map(w => (sum > 0 ? (w / sum) * total : total / k));
  const slots = exact.map(Math.floor);
  const byRemainder = exact
    .map((x, i) => ({ i, remainder: x - Math.floor(x) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  let left = total - slots.reduce((a, b) => a + b, 0);
  for (const { i } of byRemainder) {
    if (left === 0) break;
    slots[i]++;
    left--;
  }

  if (total >= k) {
    for (let i = 0; i < k; i++) {
      if (slots[i] > 0) continue;
      slots[slots.indexOf(Math.max(...slots))]--;
      slots[i] = 1;
    }
  }
  return slots;
}

/**
 * Builds a wall of recommendations: slots are shared between tastes by weight,
 * tastes take turns picking, and each pick trades closeness to its taste
 * against sameness with what is already on the wall.
 */
export function recommend(
  corpus: Corpus,
  tastes: readonly Taste[],
  options: {
    count: number;
    exclude: ReadonlySet<number>;
    /** Artist key for the per-artist cap; null for works with no known artist. */
    artistOf: (index: number) => string | null;
  },
): Pick[] {
  const { count, exclude, artistOf } = options;
  const sources = tastes.map(taste => {
    const scores = similaritiesTo(corpus, taste.medoid);
    return { scores, candidates: topIndices(scores, CANDIDATES_PER_TASTE, exclude) };
  });
  // Square roots soften the split, so a small taste still gets room to grow:
  // hearts split 90/10 share the wall about 75/25 instead of 11 slots to 1.
  const remaining = allocateSlots(tastes.map(t => Math.sqrt(t.weight)), count);

  const picks: Pick[] = [];
  // The hearts at the centre of each taste count as already on the wall, so
  // picks are pushed away from them as well as from each other.
  const shown: number[] = tastes.map(taste => taste.medoid);
  let progressed = true;
  while (picks.length < count && progressed) {
    progressed = false;
    for (let t = 0; t < tastes.length && picks.length < count; t++) {
      if (remaining[t] === 0) continue;
      const { scores, candidates } = sources[t];
      const relevance = (i: number) => Math.min(scores[i], NEAR_COPY_SIMILARITY);
      const index = nextDiversePick(corpus, candidates, relevance, shown, artistOf);
      if (index === null) {
        remaining[t] = 0;
        continue;
      }
      remaining[t]--;
      shown.push(index);
      picks.push({ index, taste: t });
      progressed = true;
    }
  }
  return picks;
}

/**
 * How well every work suits two people, judged on the whole of each person's
 * taste. Every pairing of one of A's tastes with one of B's is scored as the
 * lower of the work's closeness to each, so a work only one of them would love
 * scores low; pairings count in proportion to how much of each person's hearts
 * the two tastes hold. Scoring only the closest pair instead finds a work in
 * whatever the two already share, which is not a mix of them.
 */
export function blendScores(corpus: Corpus, a: readonly Taste[], b: readonly Taste[]): Float32Array {
  const capped = (taste: Taste) => similaritiesTo(corpus, taste.medoid).map(s => Math.min(s, NEAR_COPY_SIMILARITY));
  const toA = a.map(capped);
  const toB = b.map(capped);
  const totalWeight = sum(a.map(t => t.weight)) * sum(b.map(t => t.weight));

  const scores = new Float32Array(corpus.count);
  if (totalWeight <= 0) return scores;
  a.forEach((tasteA, i) => {
    b.forEach((tasteB, j) => {
      const weight = (tasteA.weight * tasteB.weight) / totalWeight;
      const simA = toA[i];
      const simB = toB[j];
      for (let w = 0; w < scores.length; w++) scores[w] += weight * Math.min(simA[w], simB[w]);
    });
  });
  return scores;
}

/** How close one work is to a person: its similarity to their nearest taste. */
export function closeness(corpus: Corpus, index: number, tastes: readonly Taste[]): number {
  let best = -1;
  for (const taste of tastes) best = Math.max(best, similarity(corpus, index, taste.medoid));
  return best;
}

/** Picks `count` varied works from `candidates`, best first, never repeating `shown`. */
export function selectDiverse(
  corpus: Corpus,
  candidates: readonly number[],
  options: {
    count: number;
    relevance: (index: number) => number;
    shown?: readonly number[];
    artistOf: (index: number) => string | null;
  },
): number[] {
  const shown = [...(options.shown ?? [])];
  const picked: number[] = [];
  while (picked.length < options.count) {
    const index = nextDiversePick(corpus, candidates, options.relevance, shown, options.artistOf);
    if (index === null) break;
    shown.push(index);
    picked.push(index);
  }
  return picked;
}

/** Indices of the `k` highest scores, best first, skipping `exclude`. */
export function topIndices(scores: Float32Array, k: number, exclude: ReadonlySet<number> = new Set()): number[] {
  const indices: number[] = [];
  for (let i = 0; i < scores.length; i++) if (!exclude.has(i)) indices.push(i);
  indices.sort((a, b) => scores[b] - scores[a] || a - b);
  return indices.slice(0, k);
}

/** The work among `among` most similar to `target`, or null when `among` is empty. */
export function nearest(corpus: Corpus, target: number, among: readonly number[]): number | null {
  if (among.length === 0) return null;
  return among[argMax(among.length, i => similarity(corpus, target, among[i]))];
}

/**
 * Taste match from 50 to 100 (0 when either person has no hearts). Each taste is matched to the other person's
 * closest taste, weighted by how much of that person's hearts it holds, and
 * the result is averaged over both directions so the score is symmetric.
 */
export function overlapPercent(
  corpus: Corpus,
  a: readonly Taste[],
  b: readonly Taste[],
  calibration: Calibration,
): number {
  if (a.length === 0 || b.length === 0) return 0;
  const matched = (from: readonly Taste[], to: readonly Taste[]) =>
    from.reduce((sum, taste) => {
      const best = Math.max(...to.map(other => similarity(corpus, taste.medoid, other.medoid)));
      return sum + taste.weight * best;
    }, 0);
  const raw = (matched(a, b) + matched(b, a)) / 2;
  const range = calibration.kindred - calibration.stranger;
  if (range <= 0) return 0;
  const scaled = Math.min(1, Math.max(0, (raw - calibration.stranger) / range));
  return Math.round(100 * (MATCH_FLOOR + (1 - MATCH_FLOOR) * Math.pow(scaled, MATCH_CURVE)));
}

/**
 * Measures the two anchors `overlapPercent` rescales between, from an evenly
 * spaced sample of the corpus.
 */
export function calibrate(corpus: Corpus, sampleSize = 64): Calibration {
  const size = Math.min(sampleSize, corpus.count);
  if (size < 2) return { stranger: 0, kindred: 1 };

  const sample = Array.from({ length: size }, (_, i) => Math.floor((i * corpus.count) / size));
  const between: number[] = [];
  const nearestNeighbour: number[] = [];
  sample.forEach((work, position) => {
    const scores = similaritiesTo(corpus, work);
    let best = -1;
    for (let i = 0; i < scores.length; i++) if (i !== work && scores[i] > best) best = scores[i];
    nearestNeighbour.push(best);
    for (const other of sample.slice(position + 1)) between.push(scores[other]);
  });
  return { stranger: median(between), kindred: median(nearestNeighbour) };
}

function nextDiversePick(
  corpus: Corpus,
  candidates: readonly number[],
  relevance: (index: number) => number,
  shown: readonly number[],
  artistOf: (index: number) => string | null,
): number | null {
  const shownSet = new Set(shown);
  const perArtist = new Map<string, number>();
  for (const index of shown) {
    const artist = artistOf(index);
    if (artist !== null) perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1);
  }

  let best: number | null = null;
  let bestValue = -Infinity;
  for (const candidate of candidates) {
    if (shownSet.has(candidate)) continue;
    const artist = artistOf(candidate);
    if (artist !== null && (perArtist.get(artist) ?? 0) >= MAX_PER_ARTIST) continue;

    let sameness = 0;
    for (const index of shown) sameness = Math.max(sameness, similarity(corpus, candidate, index));
    const value = RELEVANCE_WEIGHT * relevance(candidate) - (1 - RELEVANCE_WEIGHT) * sameness;
    if (value > bestValue) {
      best = candidate;
      bestValue = value;
    }
  }
  return best;
}

function pairwiseSimilarities(corpus: Corpus, items: readonly number[]): Float32Array {
  const n = items.length;
  const sims = new Float32Array(n * n);
  for (let a = 0; a < n; a++) {
    sims[a * n + a] = 1;
    for (let b = a + 1; b < n; b++) {
      const value = similarity(corpus, items[a], items[b]);
      sims[a * n + b] = value;
      sims[b * n + a] = value;
    }
  }
  return sims;
}

function assignToCentres(n: number, centres: readonly number[], sim: (a: number, b: number) => number): number[][] {
  const groups: number[][] = centres.map(() => []);
  for (let item = 0; item < n; item++) {
    const own = centres.indexOf(item);
    const group = own >= 0 ? own : argMax(centres.length, c => sim(centres[c], item));
    groups[group].push(item);
  }
  return groups;
}

/** Index in [0, length) with the highest value; the earliest wins ties. */
function argMax(length: number, value: (index: number) => number): number {
  let best = 0;
  let bestValue = -Infinity;
  for (let i = 0; i < length; i++) {
    const v = value(i);
    if (v > bestValue) {
      best = i;
      bestValue = v;
    }
  }
  return best;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
