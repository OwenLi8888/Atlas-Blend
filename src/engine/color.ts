import type { Rgb } from '../types';

export const IVORY = '#E7DECD';

export type Hsl = [number, number, number];

export function rgbToHsl([r, g, b]: Rgb): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function hslCss(h: number, s: number, l: number): string {
  const hue = (((h % 1) + 1) % 1) * 360;
  return `hsl(${hue.toFixed(1)} ${(clamp01(s) * 100).toFixed(1)}% ${(clamp01(l) * 100).toFixed(1)}%)`;
}

export function rgbCss([r, g, b]: Rgb): string {
  return `rgb(${Math.round(clamp01(r) * 255)} ${Math.round(clamp01(g) * 255)} ${Math.round(clamp01(b) * 255)})`;
}
