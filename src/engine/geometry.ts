import type { Stroke, StrokePlan } from '../types';

/**
 * A stroke resampled at even steps along its path: position, unit tangent and half-width (blade
 * width times the contact profile) at each sample. All in mm.
 */
export interface StrokeGeom {
  n: number;
  x: Float32Array;
  y: Float32Array;
  tx: Float32Array;
  ty: Float32Array;
  hw: Float32Array;
  length: number;
}

function contactAt(contact: number[], u: number): number {
  if (contact.length === 0) return 1;
  const f = Math.min(Math.max(u, 0), 1) * (contact.length - 1);
  const i = Math.min(Math.floor(f), contact.length - 2);
  if (i < 0) return contact[0];
  return contact[i] + (contact[i + 1] - contact[i]) * (f - i);
}

export function buildGeom(s: Stroke): StrokeGeom {
  const pts = s.points;
  const segs = Math.max(pts.length - 1, 0);
  const cum = new Float32Array(segs + 1);
  for (let i = 0; i < segs; i++) {
    cum[i + 1] = cum[i] + Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  const length = cum[segs];
  const n = Math.min(48, Math.max(6, Math.ceil(length / 1.2) + 1));
  const g: StrokeGeom = {
    n,
    x: new Float32Array(n),
    y: new Float32Array(n),
    tx: new Float32Array(n),
    ty: new Float32Array(n),
    hw: new Float32Array(n),
    length,
  };
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    const d = u * length;
    while (seg < segs - 1 && cum[seg + 1] < d) seg++;
    const a = pts[Math.min(seg, pts.length - 1)];
    const b = pts[Math.min(seg + 1, pts.length - 1)];
    const segLen = cum[seg + 1] - cum[seg] || 1;
    const f = segs === 0 ? 0 : Math.min(Math.max((d - cum[seg]) / segLen, 0), 1);
    g.x[k] = a[0] + (b[0] - a[0]) * f;
    g.y[k] = a[1] + (b[1] - a[1]) * f;
    g.hw[k] = (s.widthMm * contactAt(s.contact, u)) / 2;
  }
  // Tangents from neighbouring samples, so corners of the source polyline are rounded off.
  for (let k = 0; k < n; k++) {
    const i0 = Math.max(k - 1, 0);
    const i1 = Math.min(k + 1, n - 1);
    let dx = g.x[i1] - g.x[i0];
    let dy = g.y[i1] - g.y[i0];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      dx = 1;
      dy = 0;
    } else {
      dx /= len;
      dy /= len;
    }
    g.tx[k] = dx;
    g.ty[k] = dy;
  }
  return g;
}

/** Position at progress t (0 to 1) along the stroke. */
export function pointAt(g: StrokeGeom, t: number, out: { x: number; y: number }): void {
  const f = Math.min(Math.max(t, 0), 1) * (g.n - 1);
  const i = Math.min(Math.floor(f), g.n - 2);
  const r = f - i;
  out.x = g.x[i] + (g.x[i + 1] - g.x[i]) * r;
  out.y = g.y[i] + (g.y[i + 1] - g.y[i]) * r;
}

const geomCache = new WeakMap<StrokePlan, (StrokeGeom | undefined)[]>();

/** Lazily built, cached per plan: the three styles and the player share one set. */
export function geomOf(plan: StrokePlan, index: number): StrokeGeom {
  let list = geomCache.get(plan);
  if (!list) {
    list = new Array(plan.strokes.length);
    geomCache.set(plan, list);
  }
  return (list[index] ??= buildGeom(plan.strokes[index]));
}
