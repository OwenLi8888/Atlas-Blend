import type { StrokePlan } from '../../types';
import { hslCss, rgbToHsl } from '../color';
import { geomOf } from '../geometry';
import { hashString } from '../rng';
import { buildPalette, nearestIndex } from './shapes';
import { tessellate, type Tessellation } from './tessellate';
import type { StyleRenderer } from './types';

/**
 * Mosaic: a hand-made broken-tile mosaic. The canvas is cut once into irregular shards (see
 * tessellate.ts): small ones that follow the subject's contours, big random ones in flat areas.
 * A stroke colours every shard whose centre it covers, later strokes replacing earlier ones as
 * paint would, and only the shards that changed are redrawn.
 */

const GROUT = '#A89C86';
const PALETTE_SIZE = 24;
/** Each shard is drawn in from its outline by this share of its size, and never less than this many device px. */
const GROUT_SHARE = 0.09;
const MIN_GROUT_PX = 1.5;
const LIGHT_JITTER = 0.05;
const HUE_JITTER = 4 / 360;
/** Glazed tile is cleaner in colour than averaged paint. */
const SATURATION_LIFT = 1.2;
const HIGHLIGHT = 'rgba(255, 255, 255, 0.17)';
const SPARKLE_SHARE = 0.2;
const GROUT_LINE = 'rgba(46, 36, 20, 0.42)';

export function createMosaic(plan: StrokePlan): StyleRenderer {
  const seed = hashString(plan.id) ^ 0x7e55e2a;
  const n = plan.strokes.length;

  // A real tile set: about 24 colours taken from the painting.
  const paletteRgb = buildPalette(plan, PALETTE_SIZE);
  const palette = paletteRgb.map(rgbToHsl);
  const strokeColor = new Uint8Array(n);
  let maxLayer = 0;
  for (let i = 0; i < n; i++) {
    strokeColor[i] = nearestIndex(paletteRgb, plan.strokes[i].color);
    if (plan.strokes[i].layer > maxLayer) maxLayer = plan.strokes[i].layer;
  }
  let finalLayerStart = n;
  for (let i = n - 1; i >= 0 && plan.strokes[i].layer === maxLayer; i--) finalLayerStart = i;

  // ---- The layout (mm), made on first use and kept with the plan's renderer. ----
  let tess: Tessellation | null = null;
  /** Tiles by centre, in buckets `bucket` mm across. */
  let bucket = 1;
  let bw = 0;
  let bh = 0;
  let bucketStart = new Int32Array(0);
  let bucketTiles = new Int32Array(0);
  /** The stroke index at which each gem appears: spread through the final layer. */
  let gemAt: number[] = [];

  const layout = (): Tessellation => {
    if (tess) return tess;
    const t = (tess = tessellate(plan, seed));
    bucket = t.minSpacing;
    bw = Math.ceil(plan.widthMm / bucket) + 1;
    bh = Math.ceil(plan.heightMm / bucket) + 1;
    const where = (i: number) =>
      Math.min(Math.max(Math.floor(t.cy[i] / bucket), 0), bh - 1) * bw + Math.min(Math.max(Math.floor(t.cx[i] / bucket), 0), bw - 1);
    bucketStart = new Int32Array(bw * bh + 1);
    for (let i = 0; i < t.count; i++) bucketStart[where(i) + 1]++;
    for (let b = 0; b < bw * bh; b++) bucketStart[b + 1] += bucketStart[b];
    bucketTiles = new Int32Array(t.count);
    const fill = bucketStart.slice(0, bw * bh);
    for (let i = 0; i < t.count; i++) bucketTiles[fill[where(i)]++] = i;
    gemAt = t.gems.map((_, k) => finalLayerStart + Math.floor(((k + 0.5) / t.gems.length) * (n - finalLayerStart)));
    return t;
  };

  // ---- State for the canvas being painted. Reset by begin(). ----
  let pxPerMm = 1;
  let sizedFor = '';
  /** Shard outlines in device px, drawn in from the layout's outlines to leave the grout. */
  let outline = new Float32Array(0);
  /** The stroke each shard belongs to (-1: not laid yet). */
  let owner = new Int32Array(0);
  let gemShown = new Uint8Array(0);
  let gemsOut = 0;
  const laid = new Float32Array(n);
  let dirty = new Int32Array(0);
  let dirtyCount = 0;
  let marked = new Uint8Array(0);

  /** A fixed random number in 0..1 for shard `id`: the same on every replay. */
  const rand = (id: number, salt: number) => {
    let h = Math.imul(id ^ seed, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  };

  const trace = (ctx: CanvasRenderingContext2D, t: Tessellation, i: number) => {
    const a = t.start[i] * 2;
    const b = t.start[i + 1] * 2;
    ctx.moveTo(outline[a], outline[a + 1]);
    for (let k = a + 2; k < b; k += 2) ctx.lineTo(outline[k], outline[k + 1]);
    ctx.closePath();
  };

  const shardColor = (i: number, lighten = 0) => {
    const [h, s, l] = palette[strokeColor[owner[i]]];
    return hslCss(h + (rand(i, 2) * 2 - 1) * HUE_JITTER, s * SATURATION_LIFT, l + (rand(i, 3) * 2 - 1) * LIGHT_JITTER + lighten);
  };

  /** A round glass gem set in place of shard i, tinted from the shard's colour. */
  const drawGem = (ctx: CanvasRenderingContext2D, t: Tessellation, i: number) => {
    ctx.fillStyle = GROUT;
    ctx.beginPath();
    trace(ctx, t, i);
    ctx.fill();
    const x = t.cx[i] * pxPerMm;
    const y = t.cy[i] * pxPerMm;
    const r = t.size[i] * pxPerMm * 0.4;
    ctx.fillStyle = 'rgba(40, 30, 14, 0.34)';
    ctx.beginPath();
    ctx.arc(x + r * 0.1, y + r * 0.14, r * 1.04, 0, Math.PI * 2);
    ctx.fill();
    const [h, s, l] = palette[strokeColor[owner[i]]];
    const glass = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
    glass.addColorStop(0, hslCss(h, Math.min(s * 1.5 + 0.1, 0.9), Math.min(l + 0.3, 0.92)));
    glass.addColorStop(0.55, hslCss(h, Math.min(s * 1.5 + 0.1, 0.9), l + 0.04));
    glass.addColorStop(1, hslCss(h, Math.min(s * 1.4 + 0.1, 0.9), Math.max(l - 0.2, 0.06)));
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(x - r * 0.36, y - r * 0.38, Math.max(r * 0.15, 0.8), 0, Math.PI * 2);
    ctx.fill();
  };

  const drawShard = (ctx: CanvasRenderingContext2D, t: Tessellation, i: number) => {
    if (owner[i] < 0) return;
    if (gemShown[i]) {
      drawGem(ctx, t, i);
      return;
    }
    ctx.fillStyle = shardColor(i);
    ctx.beginPath();
    trace(ctx, t, i);
    ctx.fill();

    const a = t.start[i] * 2;
    const corners = t.start[i + 1] - t.start[i];
    const x = t.cx[i] * pxPerMm;
    const y = t.cy[i] * pxPerMm;

    // Glaze: light catching one edge of the shard.
    const e = Math.floor(rand(i, 4) * corners);
    const e2 = (e + 1) % corners;
    const x0 = outline[a + e * 2];
    const y0 = outline[a + e * 2 + 1];
    const x1 = outline[a + e2 * 2];
    const y1 = outline[a + e2 * 2 + 1];
    ctx.fillStyle = HIGHLIGHT;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 + (x - x1) * 0.3, y1 + (y - y1) * 0.3);
    ctx.lineTo(x0 + (x - x0) * 0.3, y0 + (y - y0) * 0.3);
    ctx.closePath();
    ctx.fill();

    // Glitter glass on some shards: a few specks, light and dark.
    if (rand(i, 5) < SPARKLE_SHARE) {
      const specks = 4 + Math.floor(rand(i, 6) * 5);
      const dot = Math.max(1, Math.min(t.size[i] * pxPerMm * 0.07, 2));
      for (let s = 0; s < specks; s++) {
        const c = Math.floor(rand(i, 10 + s * 3) * corners);
        const reach = rand(i, 11 + s * 3) * 0.75;
        ctx.fillStyle = rand(i, 12 + s * 3) < 0.7 ? 'rgba(255, 255, 255, 0.42)' : 'rgba(0, 0, 0, 0.2)';
        ctx.fillRect(x + (outline[a + c * 2] - x) * reach - dot / 2, y + (outline[a + c * 2 + 1] - y) * reach - dot / 2, dot, dot);
      }
    }
  };

  const touch = (i: number) => {
    if (marked[i]) return;
    marked[i] = 1;
    dirty[dirtyCount++] = i;
  };

  return {
    ground: GROUT,
    incremental: true,

    begin(widthPx, heightPx) {
      const t = layout();
      pxPerMm = widthPx / plan.widthMm;
      const key = `${widthPx}x${heightPx}`;
      if (key !== sizedFor) {
        sizedFor = key;
        outline = new Float32Array(t.verts.length);
        for (let i = 0; i < t.count; i++) {
          const x = t.cx[i] * pxPerMm;
          const y = t.cy[i] * pxPerMm;
          const inset = Math.max(GROUT_SHARE * t.size[i] * pxPerMm, MIN_GROUT_PX);
          for (let k = t.start[i] * 2; k < t.start[i + 1] * 2; k += 2) {
            const vx = t.verts[k] * pxPerMm;
            const vy = t.verts[k + 1] * pxPerMm;
            // Toward the centre by a fixed distance, so the grout is about as wide all round.
            const pull = Math.min(inset / (Math.hypot(vx - x, vy - y) || 1), 0.45);
            outline[k] = vx + (x - vx) * pull;
            outline[k + 1] = vy + (y - vy) * pull;
          }
        }
        owner = new Int32Array(t.count);
        gemShown = new Uint8Array(t.count);
        dirty = new Int32Array(t.count);
        marked = new Uint8Array(t.count);
      }
      owner.fill(-1);
      gemShown.fill(0);
      marked.fill(0);
      laid.fill(0);
      gemsOut = 0;
      dirtyCount = 0;
    },

    draw(ctx, index, progress) {
      const t = layout();
      const from = laid[index];
      if (progress <= from) return;
      laid[index] = progress;

      // Every shard whose centre lies under the newly laid part of the stroke takes its colour.
      // The highest stroke index wins, so the picture does not depend on the order of the calls.
      const g = geomOf(plan, index);
      const step = bucket * 0.5;
      const slack = bucket * 0.2;
      const alongSteps = Math.max(1, Math.ceil(((progress - from) * g.length) / step));
      const reachAlong = ((progress - from) * g.length) / alongSteps / 2 + slack;
      for (let a = 0; a <= alongSteps; a++) {
        const u = from + ((progress - from) * a) / alongSteps;
        const fi = u * (g.n - 1);
        const i = Math.min(Math.floor(fi), g.n - 2);
        const k = fi - i;
        const px = g.x[i] + (g.x[i + 1] - g.x[i]) * k;
        const py = g.y[i] + (g.y[i + 1] - g.y[i]) * k;
        let tx = g.tx[i] + (g.tx[i + 1] - g.tx[i]) * k;
        let ty = g.ty[i] + (g.ty[i + 1] - g.ty[i]) * k;
        const tn = Math.hypot(tx, ty) || 1;
        tx /= tn;
        ty /= tn;
        const half = g.hw[i] + (g.hw[i + 1] - g.hw[i]) * k + slack;
        const acrossSteps = Math.ceil((half * 2) / bucket);
        for (let b = 0; b <= acrossSteps; b++) {
          const lat = acrossSteps === 0 ? 0 : -half + (half * 2 * b) / acrossSteps;
          const bx = Math.floor((px - ty * lat) / bucket);
          const by = Math.floor((py + tx * lat) / bucket);
          for (let yy = Math.max(by - 1, 0); yy <= Math.min(by + 1, bh - 1); yy++) {
            for (let xx = Math.max(bx - 1, 0); xx <= Math.min(bx + 1, bw - 1); xx++) {
              const cell = yy * bw + xx;
              for (let s = bucketStart[cell]; s < bucketStart[cell + 1]; s++) {
                const tile = bucketTiles[s];
                if (owner[tile] >= index) continue;
                const dx = t.cx[tile] - px;
                const dy = t.cy[tile] - py;
                if (Math.abs(dx * tx + dy * ty) > reachAlong || Math.abs(dy * tx - dx * ty) > half) continue;
                owner[tile] = index;
                touch(tile);
              }
            }
          }
        }
      }

      // Glass gems come out one by one through the final layer.
      while (gemsOut < gemAt.length && index >= gemAt[gemsOut]) {
        gemShown[t.gems[gemsOut]] = 1;
        touch(t.gems[gemsOut]);
        gemsOut++;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (let d = 0; d < dirtyCount; d++) {
        drawShard(ctx, t, dirty[d]);
        marked[dirty[d]] = 0;
      }
      dirtyCount = 0;
    },

    finish(ctx) {
      // A darker line round every shard, where the grout meets it: depth.
      const t = layout();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = GROUT_LINE;
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      for (let i = 0; i < t.count; i += 400) {
        ctx.beginPath();
        for (let k = i; k < Math.min(i + 400, t.count); k++) if (owner[k] >= 0 && !gemShown[k]) trace(ctx, t, k);
        ctx.stroke();
      }
    },
  };
}
