import type { Rgb, StrokePlan } from '../../types';
import { IVORY, hslCss, rgbToHsl } from '../color';
import { geomOf } from '../geometry';
import { hashString, strokeRng } from '../rng';
import type { StyleRenderer } from './types';

/**
 * Shapes, inspired by Picasso's cubism: every stroke becomes one straight-edged facet (a skewed
 * quadrilateral or a triangle) at an angle snapped to 15 degrees, filled flat in a colour from a
 * small palette taken from the painting, with a thin navy outline.
 */

const PALETTE_SIZE = 10;
const OUTLINE = 'rgba(20, 47, 64, 0.7)';
const HATCH = 'rgba(20, 47, 64, 0.38)';
const SNAP = Math.PI / 12;

const dist2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** About ten colours that cover the painting: weighted k-means over the stroke colours, seeded by farthest points. */
export function buildPalette(plan: StrokePlan, size = PALETTE_SIZE): Rgb[] {
  const colors = plan.strokes.map((s) => s.color);
  const weights = plan.strokes.map((s) => Math.sqrt(s.lengthMm * s.widthMm));
  if (colors.length === 0) return [[0.5, 0.5, 0.5]];

  let heaviest = 0;
  for (let i = 1; i < colors.length; i++) if (weights[i] > weights[heaviest]) heaviest = i;
  const centres: Rgb[] = [[...colors[heaviest]]];
  const nearest = new Float64Array(colors.length).fill(Infinity);
  while (centres.length < Math.min(size, colors.length)) {
    const last = centres[centres.length - 1];
    let best = 0;
    let bestD = -1;
    for (let i = 0; i < colors.length; i++) {
      nearest[i] = Math.min(nearest[i], dist2(colors[i], last));
      if (nearest[i] > bestD) {
        bestD = nearest[i];
        best = i;
      }
    }
    if (bestD < 1e-5) break;
    centres.push([...colors[best]]);
  }

  for (let iter = 0; iter < 10; iter++) {
    const sum = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < colors.length; i++) {
      const c = nearestIndex(centres, colors[i]);
      const w = weights[i];
      sum[c][0] += colors[i][0] * w;
      sum[c][1] += colors[i][1] * w;
      sum[c][2] += colors[i][2] * w;
      sum[c][3] += w;
    }
    for (let c = 0; c < centres.length; c++) {
      if (sum[c][3] > 0) centres[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
    }
  }
  return centres;
}

function nearestIndex(palette: Rgb[], c: Rgb): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = dist2(palette[i], c);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

interface Facet {
  /** Start edge (a1, a2) and end edge (b1, b2): x, y pairs. */
  a1x: number; a1y: number; a2x: number; a2y: number;
  b1x: number; b1y: number; b2x: number; b2y: number;
  fill: string;
  size: number;
  /** Hatch lines as x1, y1, x2, y2; empty for most facets. */
  hatch: number[];
}

export function createShapes(plan: StrokePlan): StyleRenderer {
  const seed = hashString(plan.id) ^ 0xc0b15a;
  const palette = buildPalette(plan);
  // Flat planes want cleaner colour than averaged paint: lift each palette colour's saturation.
  const paletteCss = palette.map((c) => {
    const [h, s, l] = rgbToHsl(c);
    return hslCss(h, Math.min(s * 1.45 + 0.04, 0.9), l);
  });
  const bigFacet = 0.07 * Math.min(plan.widthMm, plan.heightMm);
  const cache: (Facet | undefined)[] = new Array(plan.strokes.length);

  const build = (index: number): Facet => {
    const s = plan.strokes[index];
    const g = geomOf(plan, index);
    const r = strokeRng(seed, index);
    const last = g.n - 1;
    let ux = g.x[last] - g.x[0];
    let uy = g.y[last] - g.y[0];
    let chord = Math.hypot(ux, uy);
    if (chord < 0.4 * s.widthMm) {
      // A dab or a tight curl: use its starting direction instead of the tiny chord.
      ux = g.tx[0];
      uy = g.ty[0];
      chord = Math.max(chord, 0.6 * s.widthMm);
    }
    const angle = Math.round(Math.atan2(uy, ux) / SNAP) * SNAP;
    ux = Math.cos(angle);
    uy = Math.sin(angle);
    const nx = -uy;
    const ny = ux;

    let meanContact = 0;
    for (const c of s.contact) meanContact += c;
    meanContact = s.contact.length ? meanContact / s.contact.length : 1;
    const halfW = (s.widthMm * Math.max(meanContact, 0.5) * 1.12) / 2;
    const halfL = (chord * 1.1) / 2;
    const mx = (g.x[0] + g.x[last]) / 2;
    const my = (g.y[0] + g.y[last]) / 2;

    // Skew each end by sliding its two corners in opposite directions along the axis.
    const skewA = (r() - 0.5) * 0.9 * halfW;
    const skewB = (r() - 0.5) * 0.9 * halfW;
    const kind = r();
    const taper = kind < 0.2 ? 0 : kind < 0.45 ? 0.45 + 0.4 * r() : 1;
    const hatched = r() < 0.3;
    const hatchCount = 3 + Math.floor(r() * 4);
    const hatchTurn = r() < 0.5 ? 1 : -1;

    const ax = mx - ux * halfL;
    const ay = my - uy * halfL;
    const bx = mx + ux * halfL;
    const by = my + uy * halfL;
    const facet: Facet = {
      a1x: ax + nx * halfW + ux * skewA,
      a1y: ay + ny * halfW + uy * skewA,
      a2x: ax - nx * halfW - ux * skewA,
      a2y: ay - ny * halfW - uy * skewA,
      b1x: bx + nx * halfW * taper + ux * skewB * taper,
      b1y: by + ny * halfW * taper + uy * skewB * taper,
      b2x: bx - nx * halfW * taper - ux * skewB * taper,
      b2y: by - ny * halfW * taper - uy * skewB * taper,
      fill: paletteCss[nearestIndex(palette, s.color)],
      size: Math.min(halfW * 2, halfL * 2),
      hatch: [],
    };

    if (hatched && facet.size > bigFacet) {
      // Parallel lines across the facet, 45 degrees off its axis; the facet outline clips them.
      const a = angle + (hatchTurn * Math.PI) / 4;
      const hx = Math.cos(a);
      const hy = Math.sin(a);
      const reach = halfL + halfW;
      for (let i = 0; i < hatchCount; i++) {
        const off = ((i + 0.5) / hatchCount - 0.5) * 2 * halfL * 0.8;
        const cx = mx + ux * off;
        const cy = my + uy * off;
        facet.hatch.push(cx - hx * reach, cy - hy * reach, cx + hx * reach, cy + hy * reach);
      }
    }
    return facet;
  };

  return {
    ground: IVORY,
    draw(ctx, index, t, mmPerPx) {
      const f = (cache[index] ??= build(index));
      // The facet unfolds from its start edge to its end edge.
      const e = 1 - (1 - t) * (1 - t);
      const b1x = f.a1x + (f.b1x - f.a1x) * e;
      const b1y = f.a1y + (f.b1y - f.a1y) * e;
      const b2x = f.a2x + (f.b2x - f.a2x) * e;
      const b2y = f.a2y + (f.b2y - f.a2y) * e;
      ctx.beginPath();
      ctx.moveTo(f.a1x, f.a1y);
      ctx.lineTo(b1x, b1y);
      ctx.lineTo(b2x, b2y);
      ctx.lineTo(f.a2x, f.a2y);
      ctx.closePath();
      ctx.fillStyle = f.fill;
      ctx.fill();

      if (f.hatch.length) {
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = HATCH;
        ctx.lineWidth = Math.max(0.8 * mmPerPx, 0.28);
        ctx.beginPath();
        for (let i = 0; i < f.hatch.length; i += 4) {
          ctx.moveTo(f.hatch[i], f.hatch[i + 1]);
          ctx.lineTo(f.hatch[i + 2], f.hatch[i + 3]);
        }
        ctx.stroke();
        ctx.restore();
        // The hatch lines replaced the current path: lay the facet outline again for the stroke below.
        ctx.beginPath();
        ctx.moveTo(f.a1x, f.a1y);
        ctx.lineTo(b1x, b1y);
        ctx.lineTo(b2x, b2y);
        ctx.lineTo(f.a2x, f.a2y);
        ctx.closePath();
      }

      // Thin navy outline; small facets get a finer line so detail does not turn to ink.
      ctx.lineJoin = 'miter';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = Math.min(Math.max(0.045 * f.size, 0.5 * mmPerPx), 1.4 * mmPerPx);
      ctx.stroke();
    },
  };
}
