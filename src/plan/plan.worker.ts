// Plans a painting off the main thread. Only the planner is used: the package's paint simulation
// (renderImpasto) is far too slow for a kiosk.
import { planImpasto, strokesToJSON } from 'tryimpasto';
import type { StrokePlan } from '../types';
import { PLAN_VERSION, trimStrokes } from './format';

export interface PlanRequest {
  key: string;
  width: number;
  height: number;
  /** RGBA bytes. */
  data: Uint8ClampedArray;
  widthMm: number;
}

export type PlanResponse = { key: string; plan: StrokePlan } | { key: string; error: string };

// Typed by hand: the DOM and WebWorker libs cannot both be loaded in one TypeScript program.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<PlanRequest>) => void) | null;
  postMessage(message: PlanResponse): void;
};

scope.onmessage = async (e: MessageEvent<PlanRequest>) => {
  const { key, width, height, data, widthMm } = e.data;
  try {
    const result = await planImpasto({ width, height, data, channels: 4 }, { widthMm });
    const plan: StrokePlan = {
      version: PLAN_VERSION,
      id: key,
      widthMm: result.widthMm,
      heightMm: result.heightMm,
      strokes: trimStrokes(strokesToJSON(result.plan)),
    };
    scope.postMessage({ key, plan } satisfies PlanResponse);
  } catch (err) {
    scope.postMessage({ key, error: err instanceof Error ? err.message : String(err) } satisfies PlanResponse);
  }
};
