import type { Painting, StrokePlan } from '../types';
import { PLAN_MAX_SIDE, isPlan } from './format';
import type { PlanRequest, PlanResponse } from './plan.worker';

/** One plan per painting, kept for the session. Keyed by painting id: an upload gets a fresh id. */
const cache = new Map<string, Promise<StrokePlan>>();

let worker: Worker | null = null;
const waiting = new Map<string, { resolve: (p: StrokePlan) => void; reject: (e: Error) => void }>();

function planWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./plan.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<PlanResponse>) => {
    const pending = waiting.get(e.data.key);
    if (!pending) return;
    waiting.delete(e.data.key);
    if ('plan' in e.data) pending.resolve(e.data.plan);
    else pending.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    for (const pending of waiting.values()) pending.reject(new Error(e.message || 'The planning worker failed'));
    waiting.clear();
    worker = null;
  };
  return worker;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The painting image could not be loaded'));
    img.src = src;
  });
}

async function planInWorker(painting: Painting): Promise<StrokePlan> {
  const img = await loadImage(painting.src);
  const shrink = Math.min(1, PLAN_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * shrink));
  const height = Math.max(1, Math.round(img.naturalHeight * shrink));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return new Promise<StrokePlan>((resolve, reject) => {
    waiting.set(painting.id, { resolve, reject });
    const request: PlanRequest = { key: painting.id, width, height, data, widthMm: painting.widthMm };
    planWorker().postMessage(request, [data.buffer]);
  });
}

/** The precomputed plan beside the image, or null when there is none (or it is out of date). */
async function fetchPrecomputed(painting: Painting): Promise<StrokePlan | null> {
  try {
    const res = await fetch(`paintings/${painting.id}.plan.json`);
    if (!res.ok) return null;
    // A dev server answers a missing file with index.html: anything that is not a plan is "none".
    const plan: unknown = await res.json();
    return isPlan(plan) ? plan : null;
  } catch {
    return null;
  }
}

/** The stroke plan for a painting: precomputed when it exists, else planned in the worker. */
export function getPlan(painting: Painting): Promise<StrokePlan> {
  let plan = cache.get(painting.id);
  if (!plan) {
    plan = (async () => (painting.uploaded ? null : await fetchPrecomputed(painting)) ?? planInWorker(painting))();
    cache.set(painting.id, plan);
    // A failure is not cached, so going back and trying again can work.
    plan.catch(() => cache.delete(painting.id));
  }
  return plan;
}
