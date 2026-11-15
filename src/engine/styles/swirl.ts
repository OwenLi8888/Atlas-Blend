import type { StrokePlan } from '../../types';
import { IVORY, hslCss, rgbToHsl } from '../color';
import { geomOf } from '../geometry';
import { hashString, mulberry32, strokeRng, valueNoise } from '../rng';
import type { StyleRenderer } from './types';

/**
 * Swirl, inspired by Van Gogh: every stroke is laid as rows of short thick dashes, each turned by
 * a flow field (a few vortices plus smooth noise) blended with the stroke's own direction.
 */

interface Vortex {
  x: number;
  y: number;
  r: number;
  spin: number;
}

/** Floats per dash: x1, y1, x2, y2, thickness, position along the stroke (0 to 1). */
const F = 6;

interface Dashes {
  data: Float32Array;
  color: string[];
  edge: (string | null)[];
}

export function createSwirl(plan: StrokePlan): StyleRenderer {
  const seed = hashString(plan.id) ^ 0x5a17c0de;
  const rng = mulberry32(seed);
  const W = plan.widthMm;
  const H = plan.heightMm;
  const R = Math.min(W, H);

  // A few vortex centres, kept apart so each owns a region of the canvas.
  const vortices: Vortex[] = [];
  const count = 3 + (rng() < 0.5 ? 1 : 0);
  for (let tries = 0; vortices.length < count && tries < 200; tries++) {
    const x = (0.12 + 0.76 * rng()) * W;
    const y = (0.12 + 0.76 * rng()) * H;
    if (vortices.some((v) => Math.hypot(v.x - x, v.y - y) < 0.34 * R)) continue;
    vortices.push({ x, y, r: (0.26 + 0.2 * rng()) * R, spin: rng() < 0.5 ? -1 : 1 });
  }
  const noise = valueNoise(seed ^ 0x77aa);
  const noiseScale = 1 / (0.2 * R);

  /** Unit flow direction at (x, y). */
  const flow = (x: number, y: number, out: { x: number; y: number }) => {
    const a = noise(x * noiseScale, y * noiseScale) * Math.PI * 2;
    let fx = Math.cos(a) * 0.3;
    let fy = Math.sin(a) * 0.3;
    for (const v of vortices) {
      const dx = x - v.x;
      const dy = y - v.y;
      const d = Math.hypot(dx, dy) + 1e-3;
      const w = Math.exp(-((d / v.r) ** 2));
      // Around the centre, with a slight pull inward so the arms spiral.
      fx += (w * (-dy * v.spin - dx * 0.22)) / d;
      fy += (w * (dx * v.spin - dy * 0.22)) / d;
    }
    const len = Math.hypot(fx, fy) || 1;
    out.x = fx / len;
    out.y = fy / len;
  };

  let maxLayer = 0;
  for (const s of plan.strokes) if (s.layer > maxLayer) maxLayer = s.layer;
  /** How much the flow field turns a dash. Near zero for the last two (detail) layers, so faces keep their drawing. */
  const swirlAmount = (layer: number) => {
    const fromTop = maxLayer - layer;
    return fromTop <= 1 ? 0.05 : fromTop === 2 ? 0.3 : fromTop === 3 ? 0.6 : 0.82;
  };

  // Dashes stop growing with the stroke past this width: wide underpaint strokes get more rows
  // of dashes instead of a few huge ones.
  const unitCap = 0.042 * W;
  const cache: (Dashes | undefined)[] = new Array(plan.strokes.length);
  const f = { x: 0, y: 0 };

  const build = (index: number): Dashes => {
    const s = plan.strokes[index];
    const g = geomOf(plan, index);
    const r = strokeRng(seed, index);
    const unit = Math.min(s.widthMm, unitCap);
    const thick = Math.max(0.25 * unit, 0.5);
    const dashLen = Math.max(0.8 * unit, 1.6);
    const rows = Math.max(1, Math.round(s.widthMm / (thick * 0.92)));
    const cols = Math.max(1, Math.round(g.length / (dashLen * 0.7)));
    const amount = swirlAmount(s.layer);
    const main = rgbToHsl(s.color);
    const second = rgbToHsl(s.secondary);

    const data: number[] = [];
    const color: string[] = [];
    const edge: (string | null)[] = [];
    for (let c = 0; c < cols; c++) {
      for (let row = 0; row < rows; row++) {
        const u = Math.min(1, Math.max(0, (c + 0.5 + (row % 2 ? 0.5 : 0) + (r() - 0.5) * 0.5) / (cols + 0.5)));
        const fi = u * (g.n - 1);
        const i = Math.min(Math.floor(fi), g.n - 2);
        const k = fi - i;
        const hw = g.hw[i] + (g.hw[i + 1] - g.hw[i]) * k;
        const jitterLat = (r() - 0.5) * thick * 0.6;
        const lenScale = 0.75 + 0.5 * r();
        const useSecond = r() < 0.28;
        const dh = (r() - 0.5) * 0.04;
        const ds = 0.92 + 0.3 * r();
        const dl = (r() - 0.5) * 0.11;
        const edged = r() < 0.32;
        // The blade has lifted here: nothing to lay (all draws above stay, to keep the sequence fixed).
        if (hw * 2 < 0.22 * s.widthMm) continue;

        const tx = g.tx[i] + (g.tx[i + 1] - g.tx[i]) * k;
        const ty = g.ty[i] + (g.ty[i + 1] - g.ty[i]) * k;
        const lat = ((row + 0.5) / rows - 0.5) * 2 * hw + jitterLat;
        const px = g.x[i] + (g.x[i + 1] - g.x[i]) * k - ty * lat;
        const py = g.y[i] + (g.y[i + 1] - g.y[i]) * k + tx * lat;

        flow(px, py, f);
        const sign = f.x * tx + f.y * ty < 0 ? -1 : 1;
        let dx = tx * (1 - amount) + f.x * sign * amount;
        let dy = ty * (1 - amount) + f.y * sign * amount;
        const dn = Math.hypot(dx, dy) || 1;
        dx /= dn;
        dy /= dn;

        const half = (dashLen * lenScale) / 2;
        data.push(px - dx * half, py - dy * half, px + dx * half, py + dy * half, thick, u);
        const [h, sat, l] = useSecond ? second : main;
        color.push(hslCss(h + dh, sat * ds, l + dl));
        edge.push(edged ? hslCss(h + dh, sat * ds, (l + dl) * 0.58) : null);
      }
    }
    return { data: Float32Array.from(data), color, edge };
  };

  return {
    ground: IVORY,
    draw(ctx, index, t) {
      const d = (cache[index] ??= build(index));
      const a = d.data;
      ctx.lineCap = 'round';
      for (let k = 0, n = d.color.length; k < n; k++) {
        const o = k * F;
        if (a[o + 5] > t) continue;
        const thick = a[o + 4];
        ctx.lineWidth = thick;
        const e = d.edge[k];
        if (e) {
          // A thin darker edge on the shadow side of the dab.
          const off = thick * 0.2;
          ctx.strokeStyle = e;
          ctx.beginPath();
          ctx.moveTo(a[o] + off, a[o + 1] + off);
          ctx.lineTo(a[o + 2] + off, a[o + 3] + off);
          ctx.stroke();
        }
        ctx.strokeStyle = d.color[k];
        ctx.beginPath();
        ctx.moveTo(a[o], a[o + 1]);
        ctx.lineTo(a[o + 2], a[o + 3]);
        ctx.stroke();
      }
    },
  };
}
