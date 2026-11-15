import type { StrokePlan } from '../../types';
import { IVORY, NAVY, hslCss, luminance, rgbToHsl } from '../color';
import { geomOf } from '../geometry';
import { hashString, mulberry32, strokeRng } from '../rng';
import type { StyleRenderer } from './types';

/**
 * Print, a three-ink linocut: paper, a mid ink in the painting's own dominant hue, and a navy key
 * ink. Each stroke takes one ink by how light its colour is, measured against this painting's own
 * range, and is cut with rough edges; key-ink strokes get paper-coloured gouge lines.
 */

const PAPER = 0;
const MID = 1;
const KEY = 2;

/** Mid ink is printed slightly off register, as a second block would be. mm. */
const MISREGISTER_X = 0.7;
const MISREGISTER_Y = 0.45;

interface Gouge {
  /** Lateral position, -1 to 1 across the stroke. */
  lat: number;
  u0: number;
  u1: number;
  width: number;
}

interface Cut {
  ink: number;
  /** Jittered outline: left edge then right edge, n points each, x y pairs. */
  left: Float32Array;
  right: Float32Array;
  gouges: Gouge[];
}

/** The painting's dominant hue (weighted by how much paint and how saturated), as a muted ink. */
function midInk(plan: StrokePlan): string {
  let x = 0;
  let y = 0;
  for (const s of plan.strokes) {
    const [h, sat] = rgbToHsl(s.color);
    const w = Math.sqrt(s.lengthMm * s.widthMm) * sat;
    x += Math.cos(h * Math.PI * 2) * w;
    y += Math.sin(h * Math.PI * 2) * w;
  }
  const hue = Math.atan2(y, x) / (Math.PI * 2);
  return hslCss(hue, 0.3, 0.52);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0.5;
  const f = p * (sorted.length - 1);
  const i = Math.floor(f);
  const j = Math.min(i + 1, sorted.length - 1);
  return sorted[i] + (sorted[j] - sorted[i]) * (f - i);
}

let grainTile: HTMLCanvasElement | null = null;
const grainPatterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();

/** A small tile of paper fibre: faint dark and light specks. */
function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const size = 192;
  const tile = document.createElement('canvas');
  tile.width = tile.height = size;
  const tctx = tile.getContext('2d')!;
  const img = tctx.createImageData(size, size);
  const r = mulberry32(0x9a9e4);
  for (let i = 0; i < size * size; i++) {
    const v = r();
    const o = i * 4;
    if (v < 0.5) {
      // Dark fleck (navy), denser at the low end.
      img.data[o] = 20; img.data[o + 1] = 47; img.data[o + 2] = 64;
      img.data[o + 3] = Math.round((0.5 - v) * 2 * 30 * r());
    } else {
      // Light fleck: paper showing through the ink.
      img.data[o] = 231; img.data[o + 1] = 222; img.data[o + 2] = 205;
      img.data[o + 3] = Math.round((v - 0.5) * 2 * 46 * r());
    }
  }
  tctx.putImageData(img, 0, 0);
  grainTile = tile;
  return tile;
}

export function createPrint(plan: StrokePlan): StyleRenderer {
  const seed = hashString(plan.id) ^ 0x11c0c07;
  const inks = [IVORY, midInk(plan), NAVY];

  // Thresholds from this painting's own strokes, so a low-contrast painting still splits three ways.
  const lums = plan.strokes.map((s) => luminance(s.color)).sort((a, b) => a - b);
  const keyBelow = percentile(lums, 0.35);
  const paperAbove = percentile(lums, 0.7);
  const inkOf = (l: number) => (l < keyBelow ? KEY : l < paperAbove ? MID : PAPER);

  const cache: (Cut | undefined)[] = new Array(plan.strokes.length);

  const build = (index: number): Cut => {
    const s = plan.strokes[index];
    const g = geomOf(plan, index);
    const r = strokeRng(seed, index);
    const ink = inkOf(luminance(s.color));
    const rough = Math.min(0.13 * s.widthMm, 1.1) + 0.12;
    const ox = ink === MID ? MISREGISTER_X : 0;
    const oy = ink === MID ? MISREGISTER_Y : 0;
    const left = new Float32Array(g.n * 2);
    const right = new Float32Array(g.n * 2);
    for (let k = 0; k < g.n; k++) {
      const nx = -g.ty[k];
      const ny = g.tx[k];
      const hl = g.hw[k] * 1.04 + (r() - 0.5) * 2 * rough;
      const hr = g.hw[k] * 1.04 + (r() - 0.5) * 2 * rough;
      // A knife slips along the cut as well as across it.
      const slip = (r() - 0.5) * rough;
      left[k * 2] = g.x[k] + nx * hl + g.tx[k] * slip + ox;
      left[k * 2 + 1] = g.y[k] + ny * hl + g.ty[k] * slip + oy;
      right[k * 2] = g.x[k] - nx * hr + g.tx[k] * slip + ox;
      right[k * 2 + 1] = g.y[k] - ny * hr + g.ty[k] * slip + oy;
    }
    const gouges: Gouge[] = [];
    if (ink === KEY && s.widthMm > 1.4) {
      const count = 1 + Math.floor(r() * Math.min(4, 1 + s.widthMm / 4));
      for (let i = 0; i < count; i++) {
        const u0 = 0.04 + 0.5 * r();
        gouges.push({
          lat: (r() - 0.5) * 1.5,
          u0,
          u1: Math.min(0.97, u0 + 0.22 + 0.4 * r()),
          width: Math.min(Math.max(0.07 * s.widthMm, 0.28), 0.8) * (0.7 + 0.6 * r()),
        });
      }
    }
    return { ink, left, right, gouges };
  };

  return {
    ground: IVORY,
    draw(ctx, index, t) {
      const c = (cache[index] ??= build(index));
      const g = geomOf(plan, index);
      const f = Math.min(Math.max(t, 0), 1) * (g.n - 1);
      const whole = Math.min(Math.floor(f), g.n - 1);
      const part = f - whole;
      const { left, right } = c;

      ctx.beginPath();
      ctx.moveTo(left[0], left[1]);
      for (let k = 1; k <= whole; k++) ctx.lineTo(left[k * 2], left[k * 2 + 1]);
      if (whole < g.n - 1 && part > 0) {
        const a = whole * 2;
        ctx.lineTo(left[a] + (left[a + 2] - left[a]) * part, left[a + 1] + (left[a + 3] - left[a + 1]) * part);
        ctx.lineTo(right[a] + (right[a + 2] - right[a]) * part, right[a + 1] + (right[a + 3] - right[a + 1]) * part);
      }
      for (let k = whole; k >= 0; k--) ctx.lineTo(right[k * 2], right[k * 2 + 1]);
      ctx.closePath();
      ctx.fillStyle = inks[c.ink];
      ctx.fill();

      if (c.gouges.length) {
        // Thin slivers of paper where the gouge ran along the stroke.
        ctx.strokeStyle = IVORY;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const cut of c.gouges) {
          const end = Math.min(cut.u1, t);
          if (end <= cut.u0) continue;
          const k0 = Math.ceil(cut.u0 * (g.n - 1));
          const k1 = Math.floor(end * (g.n - 1));
          if (k1 <= k0) continue;
          ctx.lineWidth = cut.width;
          ctx.beginPath();
          for (let k = k0; k <= k1; k++) {
            const lat = cut.lat * g.hw[k] * 0.8;
            const x = g.x[k] - g.ty[k] * lat;
            const y = g.y[k] + g.tx[k] * lat;
            if (k === k0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
    },
    overlay(ctx, widthPx, heightPx) {
      let pattern = grainPatterns.get(ctx);
      if (!pattern) {
        pattern = ctx.createPattern(grain(), 'repeat')!;
        grainPatterns.set(ctx, pattern);
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, widthPx, heightPx);
      ctx.restore();
    },
  };
}
