/**
 * How each pool photo looks at a glance: a 4 x 4 grid of average colours in OKLab, from
 * public/pool/look.json (written by scripts/build-pool-look.mjs). The studio uses it to find works
 * close to a player's picks when the Gallery API, which knows real taste vectors, is not running.
 */
import { hashString } from '../engine/rng';

/** Photo id to 48 numbers: L, a, b for each of the 16 cells, each multiplied by 1000. */
export type Look = Record<string, number[]>;

let look: Promise<Look | null> | null = null;

/** Null when the file cannot be read: `distance` then falls back to a fixed shuffle. */
export function loadLook(): Promise<Look | null> {
  look ??= fetch('pool/look.json')
    .then((res) => (res.ok ? (res.json() as Promise<Look>) : null))
    .catch(() => null);
  return look;
}

/** Hue and saturation tell two paintings apart more than brightness does. */
const COLOUR_WEIGHT = 2;

/**
 * How far apart two photos look: 0 for the same picture, around 100 for a near match, 300 and up
 * for unrelated ones. Without the look data it is a fixed pseudo-random number for the pair, so a
 * choice is still made, and made the same way on both devices.
 */
export function distance(data: Look | null, a: string, b: string): number {
  const va = data?.[a], vb = data?.[b];
  if (!va || !vb || va.length !== vb.length) return 100 + (hashString(a < b ? a + b : b + a) % 300);
  let sum = 0;
  for (let i = 0; i < va.length; i++) {
    const d = (va[i] - vb[i]) * (i % 3 === 0 ? 1 : COLOUR_WEIGHT);
    sum += d * d;
  }
  return Math.sqrt(sum / (va.length / 3));
}
