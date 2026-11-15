import { Delaunay } from 'd3-delaunay';
import type { StrokePlan } from '../../types';
import { geomOf } from '../geometry';
import { mulberry32 } from '../rng';

/**
 * The broken-tile layout for Mosaic: a Voronoi diagram cut into angular shards. Worked out once
 * per painting, in mm, from the stroke plan alone.
 *
 * Seeds come from two places. Contour seeds run along the detail strokes, so tiles line up along
 * edges and flow around shapes (a mosaicist's "andamento"). Background seeds are scattered at a
 * spacing that tightens where the painting has detail and opens up in flat areas.
 */
export interface Tessellation {
  count: number;
  /** Tile i's outline is verts[start[i] * 2 .. start[i + 1] * 2), x y pairs in mm. */
  start: Int32Array;
  verts: Float32Array;
  cx: Float32Array;
  cy: Float32Array;
  /** Square root of the tile's area, mm. */
  size: Float32Array;
  /** Tiles to set as round glass gems: large ones in flat areas, well apart. */
  gems: number[];
  /** Seed spacing in the busiest and the flattest areas, mm. */
  minSpacing: number;
  baseSpacing: number;
}

/** Seed spacing as a share of the canvas's long side: flat areas, and the tightest detail. */
const BASE_DIVISOR = 36;
const MIN_DIVISOR = 108;
/** The last this-many layers count as detail. */
const DETAIL_LAYERS = 3;
const SPLIT_SHARE = 0.35;
const CHIP_SHARE = 0.15;
const VERTEX_JITTER = 0.15;

export function tessellate(plan: StrokePlan, seed: number): Tessellation {
  const W = plan.widthMm;
  const H = plan.heightMm;
  const long = Math.max(W, H);
  const base = long / BASE_DIVISOR;
  const min = long / MIN_DIVISOR;
  const rng = mulberry32(seed);

  let maxLayer = 0;
  for (const s of plan.strokes) if (s.layer > maxLayer) maxLayer = s.layer;
  const detailFrom = maxLayer - (DETAIL_LAYERS - 1);

  // ---- Where the detail is: how much detail-stroke path crosses each patch of canvas. ----
  const patch = long / 90;
  const gw = Math.ceil(W / patch);
  const gh = Math.ceil(H / patch);
  let density = new Float32Array(gw * gh);
  plan.strokes.forEach((s, index) => {
    if (s.layer < detailFrom) return;
    const g = geomOf(plan, index);
    for (let k = 0; k < g.n; k++) {
      const x = Math.floor(g.x[k] / patch);
      const y = Math.floor(g.y[k] / patch);
      if (x >= 0 && y >= 0 && x < gw && y < gh) density[y * gw + x] += g.length / g.n;
    }
  });
  for (let pass = 0; pass < 3; pass++) {
    const out = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
            sum += density[yy * gw + xx];
            n++;
          }
        }
        out[y * gw + x] = sum / n;
      }
    }
    density = out;
  }
  const busy = Array.from(density).filter((v) => v > 0).sort((a, b) => a - b);
  const full = busy.length ? busy[Math.floor(busy.length * 0.8)] * 0.7 : 1;
  /** 0 in flat areas, 1 where detail is thickest. */
  const detailAt = (x: number, y: number) => {
    const gx = Math.min(Math.max(Math.floor(x / patch), 0), gw - 1);
    const gy = Math.min(Math.max(Math.floor(y / patch), 0), gh - 1);
    return Math.min(density[gy * gw + gx] / full, 1);
  };
  const spacingAt = (x: number, y: number) => {
    const d = detailAt(x, y);
    return base + (min - base) * d;
  };

  // ---- Seeds, kept apart with a bucket grid. ----
  const bucket = min;
  const bw = Math.ceil(W / bucket) + 1;
  const bh = Math.ceil(H / bucket) + 1;
  const buckets: number[][] = Array.from({ length: bw * bh }, () => []);
  const sx: number[] = [];
  const sy: number[] = [];
  const crowded = (x: number, y: number, r: number) => {
    const reach = Math.ceil(r / bucket);
    const bx = Math.floor(x / bucket);
    const by = Math.floor(y / bucket);
    for (let yy = Math.max(by - reach, 0); yy <= Math.min(by + reach, bh - 1); yy++) {
      for (let xx = Math.max(bx - reach, 0); xx <= Math.min(bx + reach, bw - 1); xx++) {
        for (const i of buckets[yy * bw + xx]) {
          if ((sx[i] - x) ** 2 + (sy[i] - y) ** 2 < r * r) return true;
        }
      }
    }
    return false;
  };
  const addSeed = (x: number, y: number) => {
    buckets[Math.floor(y / bucket) * bw + Math.floor(x / bucket)].push(sx.length);
    sx.push(x);
    sy.push(y);
  };

  // Contour seeds: along each detail stroke, one row on the path or two rows astride it. The top
  // strokes go first, since they are the ones that end up visible.
  const pitch = min * 1.15;
  for (let index = plan.strokes.length - 1; index >= 0; index--) {
    const s = plan.strokes[index];
    if (s.layer < detailFrom) continue;
    const g = geomOf(plan, index);
    const rows = s.widthMm >= pitch * 2.2 ? [-s.widthMm / 4, s.widthMm / 4] : [0];
    const steps = Math.max(1, Math.round(g.length / pitch));
    for (let a = 0; a < steps; a++) {
      const fi = ((a + 0.5) / steps) * (g.n - 1);
      const i = Math.min(Math.floor(fi), g.n - 2);
      const k = fi - i;
      const px = g.x[i] + (g.x[i + 1] - g.x[i]) * k;
      const py = g.y[i] + (g.y[i + 1] - g.y[i]) * k;
      for (const lat of rows) {
        const x = px - g.ty[i] * lat;
        const y = py + g.tx[i] * lat;
        if (x <= 0 || y <= 0 || x >= W || y >= H) continue;
        if (!crowded(x, y, pitch * 0.72)) addSeed(x, y);
      }
    }
  }

  // Background seeds: random darts, each kept only if nothing is closer than the local spacing.
  const darts = Math.ceil(((W * H) / (min * min)) * 3);
  for (let d = 0; d < darts; d++) {
    const x = rng() * W;
    const y = rng() * H;
    if (!crowded(x, y, spacingAt(x, y))) addSeed(x, y);
  }

  // ---- Voronoi cells, then broken into shards. ----
  const coords = new Float64Array(sx.length * 2);
  for (let i = 0; i < sx.length; i++) {
    coords[i * 2] = sx[i];
    coords[i * 2 + 1] = sy[i];
  }
  const voronoi = new Delaunay(coords).voronoi([0, 0, W, H]);

  /** A fixed nudge for the corner at (x, y): cells that share the corner move it the same way. */
  const nudge = (x: number, y: number, out: [number, number]) => {
    const edge = 1e-6;
    if (x < edge || y < edge || x > W - edge || y > H - edge) {
      out[0] = x;
      out[1] = y;
      return;
    }
    let h = (Math.imul(Math.round(x * 64), 0x27d4eb2d) ^ Math.imul(Math.round(y * 64), 0x165667b1) ^ seed) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    const angle = ((h & 0xffff) / 0x10000) * Math.PI * 2;
    const reach = (((h >>> 16) & 0xffff) / 0x10000) * VERTEX_JITTER * spacingAt(x, y);
    out[0] = Math.min(Math.max(x + Math.cos(angle) * reach, 0), W);
    out[1] = Math.min(Math.max(y + Math.sin(angle) * reach, 0), H);
  };

  const start: number[] = [0];
  const verts: number[] = [];
  const cx: number[] = [];
  const cy: number[] = [];
  const size: number[] = [];
  const minArea = min * min * 0.12;

  const addTile = (poly: [number, number][]) => {
    let area = 0;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      mx += (x0 + x1) * cross;
      my += (y0 + y1) * cross;
    }
    area /= 2;
    if (Math.abs(area) < minArea) return;
    for (const [x, y] of poly) verts.push(x, y);
    start.push(verts.length / 2);
    cx.push(mx / (6 * area));
    cy.push(my / (6 * area));
    size.push(Math.sqrt(Math.abs(area)));
  };

  /** Knocks one corner off, leaving a chipped edge. */
  const chip = (poly: [number, number][]): [number, number][] => {
    if (rng() >= CHIP_SHARE || poly.length < 3) return poly;
    const k = Math.floor(rng() * poly.length);
    const depth = 0.28 + 0.2 * rng();
    const p = poly[k];
    const before = poly[(k + poly.length - 1) % poly.length];
    const after = poly[(k + 1) % poly.length];
    const out = poly.slice();
    out.splice(
      k,
      1,
      [p[0] + (before[0] - p[0]) * depth, p[1] + (before[1] - p[1]) * depth],
      [p[0] + (after[0] - p[0]) * depth, p[1] + (after[1] - p[1]) * depth],
    );
    return out;
  };

  const moved: [number, number] = [0, 0];
  for (let i = 0; i < sx.length; i++) {
    const ring = voronoi.cellPolygon(i);
    if (!ring || ring.length < 4) continue;
    const poly: [number, number][] = [];
    for (let k = 0; k < ring.length - 1; k++) {
      nudge(ring[k][0], ring[k][1], moved);
      poly.push([moved[0], moved[1]]);
    }
    // Some cells break in two along a diagonal: more angles, more variety of size.
    const splits = rng() < SPLIT_SHARE;
    const from = Math.floor(rng() * poly.length);
    if (splits && poly.length >= 4) {
      const to = from + Math.floor(poly.length / 2);
      const a: [number, number][] = [];
      const b: [number, number][] = [];
      for (let k = from; k <= to; k++) a.push(poly[k % poly.length]);
      for (let k = to; k <= from + poly.length; k++) b.push(poly[k % poly.length]);
      addTile(chip(a));
      addTile(chip(b));
    } else {
      addTile(chip(poly));
    }
  }

  // ---- Glass gems: 6 to 10 large tiles in flat areas, away from the frame and from each other. ----
  const count = cx.length;
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const wanted = 6 + Math.floor(rng() * 5);
  const gems: number[] = [];
  for (const i of order) {
    if (gems.length >= wanted) break;
    if (size[i] < base * 0.62) continue;
    // Flat here and flat all round: never on the subject, even on a quiet part of it.
    let flat = true;
    for (let dy = -2; dy <= 2 && flat; dy++) {
      for (let dx = -2; dx <= 2 && flat; dx++) flat = detailAt(cx[i] + dx * base, cy[i] + dy * base) <= 0.04;
    }
    if (!flat) continue;
    if (cx[i] < base || cy[i] < base || cx[i] > W - base || cy[i] > H - base) continue;
    if (gems.some((g) => Math.hypot(cx[g] - cx[i], cy[g] - cy[i]) < long / 7)) continue;
    gems.push(i);
  }

  return {
    count,
    start: Int32Array.from(start),
    verts: Float32Array.from(verts),
    cx: Float32Array.from(cx),
    cy: Float32Array.from(cy),
    size: Float32Array.from(size),
    gems,
    minSpacing: min,
    baseSpacing: base,
  };
}
