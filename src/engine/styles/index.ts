import type { StrokePlan, StyleId } from '../../types';
import { createPrint } from './print';
import { createShapes } from './shapes';
import { createSwirl } from './swirl';
import type { StyleRenderer } from './types';

export type { StyleRenderer } from './types';

const cache = new WeakMap<StrokePlan, Partial<Record<StyleId, StyleRenderer>>>();

/** One renderer per plan and style, kept so a replay reuses everything already worked out. */
export function styleFor(plan: StrokePlan, id: StyleId): StyleRenderer {
  let byStyle = cache.get(plan);
  if (!byStyle) {
    byStyle = {};
    cache.set(plan, byStyle);
  }
  return (byStyle[id] ??= id === 'swirl' ? createSwirl(plan) : id === 'shapes' ? createShapes(plan) : createPrint(plan));
}
