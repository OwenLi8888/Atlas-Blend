import type { ImpastoStroke } from "../vendor/impasto/snapshot.ts";
import type { Ctx2D } from "./types.ts";

/**
 * How a plan's millimetres map onto the preview layer's pixels: px = mm × pxPerMm + offset.
 * The offset is non-zero only when the planning crop was padded beyond the loop's bounding box.
 */
export interface StrokeSpace {
  pxPerMm: number;
  offsetX: number;
  offsetY: number;
}

/** A stroke's centre line in preview pixels, with the distance along it at every point. */
export interface StrokePath {
  x: Float64Array;
  y: Float64Array;
  /** Cumulative length in pixels; along[0] = 0, along[n - 1] = length. */
  along: Float64Array;
  length: number;
}

export function strokePath(stroke: ImpastoStroke, space: StrokeSpace): StrokePath {
  const n = stroke.points.length;
  const x = new Float64Array(n), y = new Float64Array(n), along = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = stroke.points[i][0] * space.pxPerMm + space.offsetX;
    y[i] = stroke.points[i][1] * space.pxPerMm + space.offsetY;
    if (i > 0) along[i] = along[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
  }
  return { x, y, along, length: n ? along[n - 1] : 0 };
}

/** Linear interpolation into evenly spaced samples (ImpastoStroke.contact, .pressure), t in 0-1. */
export function sampleAt(samples: readonly number[], t: number): number {
  const n = samples.length;
  if (n === 0) return 1;
  if (n === 1) return samples[0];
  const f = Math.min(1, Math.max(0, t)) * (n - 1), i = Math.min(n - 2, Math.floor(f));
  return samples[i] + (samples[i + 1] - samples[i]) * (f - i);
}

/** Width of the mark in pixels at fraction t of the stroke: blade width × contact there. */
export function widthAt(stroke: ImpastoStroke, t: number, space: StrokeSpace): number {
  return stroke.widthMm * sampleAt(stroke.contact, t) * space.pxPerMm;
}

export interface PathPoint {
  x: number;
  y: number;
  /** Unit direction of travel. */
  dx: number;
  dy: number;
  /** Fraction of the stroke's length, 0-1. */
  t: number;
}

/** The point at distance `d` pixels along the path, with the direction of travel there. */
export function pointAlong(path: StrokePath, d: number, from = 0): PathPoint & { segment: number } {
  const n = path.x.length;
  if (n === 1) return { x: path.x[0], y: path.y[0], dx: 1, dy: 0, t: 0, segment: 0 };
  let i = Math.max(0, Math.min(from, n - 2));
  while (i < n - 2 && path.along[i + 1] < d) i++;
  const span = path.along[i + 1] - path.along[i];
  const f = span > 0 ? Math.min(1, Math.max(0, (d - path.along[i]) / span)) : 0;
  const ex = path.x[i + 1] - path.x[i], ey = path.y[i + 1] - path.y[i], len = Math.hypot(ex, ey) || 1;
  return { x: path.x[i] + ex * f, y: path.y[i] + ey * f, dx: ex / len, dy: ey / len, t: path.length > 0 ? d / path.length : 0, segment: i };
}

/** Points every `step` pixels along the path, always including both ends. */
export function resample(path: StrokePath, step: number): PathPoint[] {
  const out: PathPoint[] = [];
  if (path.x.length === 0) return out;
  const count = Math.max(1, Math.ceil(path.length / Math.max(0.5, step)));
  let segment = 0;
  for (let k = 0; k <= count; k++) {
    const p = pointAlong(path, (path.length * k) / count, segment);
    segment = p.segment;
    out.push(p);
  }
  return out;
}

/**
 * The outline of the mark a blade leaves: the centre line offset to both sides by half the
 * contact width, as one closed polygon [x0, y0, x1, y1, ...]. `widthScale` widens or narrows it.
 */
export function ribbon(stroke: ImpastoStroke, path: StrokePath, space: StrokeSpace, step: number, widthScale = 1, minWidth = 1, wobble?: (sample: number) => number): Float64Array {
  const pts = resample(path, step), n = pts.length;
  const out = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    // `wobble`, given the sample number, returns a factor for the width there (an uneven edge).
    const p = pts[i], half = (Math.max(minWidth, widthAt(stroke, p.t, space) * widthScale) * (wobble ? wobble(i) : 1)) / 2;
    // Left of travel is (dy, -dx) with y down.
    out[i * 2] = p.x + p.dy * half;
    out[i * 2 + 1] = p.y - p.dx * half;
    const j = (2 * n - 1 - i) * 2;
    out[j] = p.x - p.dy * half;
    out[j + 1] = p.y + p.dx * half;
  }
  return out;
}

export function tracePolygon(ctx: Ctx2D, polygon: Float64Array): void {
  ctx.beginPath();
  ctx.moveTo(polygon[0], polygon[1]);
  for (let i = 2; i < polygon.length; i += 2) ctx.lineTo(polygon[i], polygon[i + 1]);
  ctx.closePath();
}

const byte = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** A stroke colour (sRGB 0-1) as a CSS colour. */
export function css(color: readonly number[], alpha = 1): string {
  return alpha >= 1 ? `rgb(${byte(color[0])},${byte(color[1])},${byte(color[2])})` : `rgba(${byte(color[0])},${byte(color[1])},${byte(color[2])},${alpha})`;
}

/** Mixes a colour toward another (both sRGB 0-1) by `amount`. */
export function mix(a: readonly number[], b: readonly number[], amount: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
}

/** Scales a colour's brightness (1 = unchanged), clamped to 0-1. */
export function shade(color: readonly number[], factor: number): [number, number, number] {
  return [Math.min(1, color[0] * factor), Math.min(1, color[1] * factor), Math.min(1, color[2] * factor)];
}

/** A deterministic 0-1 hash of two integers, so a stroke always renders the same way. */
export function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
