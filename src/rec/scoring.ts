export interface Work {
  id: string; title: string; artist: string; image_vec: number[];
  image_url?: string; medium?: string; cluster?: string; cluster_id?: number;
  [key: string]: unknown;
}
export interface Taste { vector: number[]; weight: number }
export function normalize(v: number[]): number[] {
  if (!v.length || v.some(x => !Number.isFinite(x))) throw new Error('Invalid vector');
  const n = Math.hypot(...v);
  if (!n) throw new Error('Zero vector');
  return v.map(x => x / n);
}
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vector dimensions differ');
  const x = normalize(a), y = normalize(b);
  return Math.max(-1, Math.min(1, x.reduce((s, v, i) => s + v * y[i], 0)));
}
export function taste(vectors: number[][], maxK = 3): Taste[] {
  if (!vectors.length) return [];
  const xs = vectors.map(normalize);
  if (xs.some(x => x.length !== xs[0].length)) throw new Error('Vector dimensions differ');
  // Farthest-first seeds preserve separate interests; don't force extra clusters on near duplicates.
  let centers = [xs[0]];
  while (centers.length < Math.min(maxK, xs.length)) {
    const far = xs.reduce((a, b) => affinity(a, centers) < affinity(b, centers) ? a : b);
    if (affinity(far, centers) > 0.88) break;
    centers.push(far);
  }
  let groups: number[][][] = [];
  for (let step = 0; step < 12; step++) {
    groups = centers.map(() => []);
    for (const x of xs) {
      const sims = centers.map(c => cosine(x, c));
      groups[sims.indexOf(Math.max(...sims))].push(x);
    }
    centers = groups.map((g, i) => {
      if (!g.length) return centers[i];
      const sum = xs[0].map((_, d) => g.reduce((s, x) => s + x[d], 0));
      return Math.hypot(...sum) < 1e-10 ? g[0] : normalize(sum);
    });
  }
  return centers.map((vector, i) => ({ vector, weight: groups[i].length / xs.length }))
    .filter(c => c.weight > 0);
}
export function affinity(v: number[], centers: number[][]): number {
  return centers.length ? Math.max(...centers.map(c => cosine(v, c))) : -1;
}
export function blendScore(v: number[], a: Taste[], b: Taste[]): number {
  return Math.min(affinity(v, a.map(c => c.vector)), affinity(v, b.map(c => c.vector)));
}
export function overlap(a: Taste[], b: Taste[]): number {
  if (!a.length || !b.length) return 0;
  const side = (x: Taste[], y: Taste[]) => x.reduce((s, c) =>
    s + c.weight * affinity(c.vector, y.map(t => t.vector)), 0);
  return Math.round(Math.max(0, Math.min(1, (side(a, b) + side(b, a)) / 2)) * 100);
}
export function diversify(pool: Work[], score: (w: Work) => number, n: number, initial: Work[] = []): Work[] {
  const selected = [...initial], remaining = [...new Map(pool.map(w => [w.id, w])).values()]
    .filter(w => !initial.some(s => s.id === w.id));
  while (selected.length < n + initial.length && remaining.length) {
    let best = -1, value = -Infinity;
    remaining.forEach((w, i) => {
      if (w.artist && selected.filter(s => s.artist === w.artist).length >= 2) return;
      const novelty = selected.length ? affinity(w.image_vec, selected.map(s => s.image_vec)) : 0;
      const rank = 0.85 * score(w) - 0.15 * novelty;
      if (rank > value) { best = i; value = rank; }
    });
    if (best < 0) break;
    selected.push(remaining.splice(best, 1)[0]);
  }
  return selected.slice(initial.length);
}
export function recommend(pools: Work[][], centers: Taste[], excluded: Set<string>, n = 12): Work[] {
  const chosen: Work[] = [];
  // One slot per interest per round, then MMR within that interest.
  for (let round = 0; chosen.length < n; round++) {
    const before = chosen.length;
    pools.forEach((pool, i) => {
      if (chosen.length >= n) return;
      const candidates = pool.filter(w => !excluded.has(w.id) && !chosen.some(s => s.id === w.id));
      const pick = diversify(candidates, w => cosine(w.image_vec, centers[i].vector), 1, chosen)[0];
      if (pick) chosen.push(pick);
    });
    if (chosen.length === before) break;
  }
  return chosen;
}
export function bridge(top: Work, hearts: Work[]): Work | null {
  return [...hearts].sort((a, b) => cosine(top.image_vec, b.image_vec) - cosine(top.image_vec, a.image_vec))[0] ?? null;
}
export function publicWork(w: Work) {
  const { image_vec: _, ...rest } = w;
  return rest;
}
