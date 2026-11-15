import type { Stroke, StrokePlan } from '../types';

/** Bump when the plan file's shape changes. Keep in step with scripts/precompute-plans.mjs. */
export const PLAN_VERSION = 1;
/** Images are shrunk to this longest side before planning: detail comes from widthMm, not pixels. */
export const PLAN_MAX_SIDE = 1024;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The fields the renderers use, rounded. Mirrors trimStrokes in scripts/precompute-plans.mjs. */
export function trimStrokes(strokes: readonly Stroke[]): Stroke[] {
  return strokes.map((s) => ({
    layer: s.layer,
    primitive: s.primitive,
    points: s.points.map(([x, y]) => [r2(x), r2(y)] as [number, number]),
    widthMm: r3(s.widthMm),
    lengthMm: r3(s.lengthMm),
    contact: s.contact.map(r3),
    color: s.color.map(r3) as Stroke['color'],
    secondary: s.secondary.map(r3) as Stroke['secondary'],
  }));
}

export function isPlan(value: unknown): value is StrokePlan {
  const p = value as StrokePlan | null;
  return (
    !!p &&
    p.version === PLAN_VERSION &&
    typeof p.widthMm === 'number' &&
    typeof p.heightMm === 'number' &&
    Array.isArray(p.strokes) &&
    p.strokes.length > 0
  );
}
