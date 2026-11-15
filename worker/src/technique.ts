/**
 * Technique transfer: analyse how painting B is painted, and paint image A that way.
 *
 * What is measured on B (analyzeTechnique):
 *   medium       oil or watercolor (from the catalog; decides the renderer)
 *   palette      LAB mean and spread of each channel: B's colour cast, tonal range and contrast
 *   saturation   mean chroma, so A is painted as muted or as vivid as B
 *   brokenness   how broken B's brushwork is: the share of B's edge energy that is lost when the
 *                image is blurred 3 px at 256 px wide. Dabbed, broken colour (Van Gogh 0.23, Seurat
 *                0.28, Renoir 0.30) loses most of it; smooth blended paint (academic portraits
 *                0.42-0.47) keeps it. -> mark length, mark size, restraint, softness
 *   direction    the dominant direction B's strokes run in and how consistently (structure tensor)
 *   ground       the colour under B's darks (its toned ground / underpainting)
 *
 * What is applied to A (applyTechnique + planSettingsFor): A's colours and values are mapped onto
 * B's (histogram matching of L, a and b), softened if B's paint is smooth and blended, and the stroke
 * planner gets B's stroke direction, mark size, restraint and ground. The renderer is B's medium.
 * A's subject and composition are never changed: nothing from B's picture is copied.
 */
import { DEFAULT_LAYERS, type PlanSettings } from "./vendor/impasto/planner.ts";

export type Medium = "oil" | "watercolor";

export interface Technique {
  medium: Medium;
  lab: { mean: [number, number, number]; std: [number, number, number] };
  /** Mean OKLab-ish chroma (LAB a/b magnitude). */
  chroma: number;
  /** 0 smooth, blended paint .. 1 broken, dabbed marks (see header). */
  brokenness: number;
  /** Plain-words summary of the measurements, for the app. */
  summary: string[];
  /** Dominant stroke direction (unit vector, y down) and how consistent it is (0-1). */
  direction: [number, number];
  coherence: number;
  /** 0 crisp .. 1 very soft, blended edges. */
  softness: number;
  /** B's L, a, b values sorted (sampled), for histogram matching. */
  quantiles: { L: Float32Array; a: Float32Array; b: Float32Array };
  /** Colour under B's darks, sRGB 0-1. */
  ground: [number, number, number];
  /** A few dominant colours of B, hex, for showing what was taken. */
  swatches: string[];
}

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }

// ------------------------------------------------------------------ colour
const lin = (c: number) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
const gam = (c: number) => (c > 0.0031308 ? 1.055 * c ** (1 / 2.4) - 0.055 : 12.92 * c);
const fLab = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

function toLab(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r / 255), G = lin(g / 255), B = lin(b / 255);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const fx = fLab(x), fy = fLab(y), fz = fLab(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function fromLab(L: number, a: number, bb: number): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
  const x = fInv(fx) * 0.95047, y = fInv(fy), z = fInv(fz) * 1.08883;
  const R = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const G = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const B = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, gam(Math.max(0, v)))) * 255);
  return [c(R), c(G), c(B)];
}

function labStats(p: Pixels, step = 2) {
  const s = [0, 0, 0], q = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < p.height; y += step) for (let x = 0; x < p.width; x += step) {
    const i = (y * p.width + x) * 4, l = toLab(p.data[i], p.data[i + 1], p.data[i + 2]);
    for (let k = 0; k < 3; k++) { s[k] += l[k]; q[k] += l[k] * l[k]; }
    n++;
  }
  const mean = s.map((v) => v / n) as [number, number, number];
  const std = q.map((v, k) => Math.sqrt(Math.max(1e-6, v / n - mean[k] ** 2))) as [number, number, number];
  return { mean, std };
}

/** Grey image at a fixed analysis width, as floats 0-1. */
function grey(p: Pixels, width: number) {
  const k = p.width / width, w = width, h = Math.max(8, Math.round(p.height / k));
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (Math.min(p.height - 1, Math.floor(y * k)) * p.width + Math.min(p.width - 1, Math.floor(x * k))) * 4;
    g[y * w + x] = (0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2]) / 255;
  }
  return { g, w, h };
}

function boxBlur(g: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(g.length), out = new Float32Array(g.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < w) { s += g[y * w + xx]; n++; } }
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; } }
    out[y * w + x] = s / n;
  }
  return out;
}

function gradEnergy(g: Float32Array, w: number, h: number) {
  let e = 0, edges = 0, jxx = 0, jyy = 0, jxy = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const gx = g[y * w + x + 1] - g[y * w + x - 1], gy = g[(y + 1) * w + x] - g[(y - 1) * w + x];
    const m = gx * gx + gy * gy;
    e += m;
    if (m > 0.004) edges++;
    jxx += gx * gx; jyy += gy * gy; jxy += gx * gy;
  }
  return { e: e / (w * h), edges: edges / (w * h), jxx, jyy, jxy };
}

const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

// ------------------------------------------------------------------ analyse B
export function analyzeTechnique(p: Pixels, medium: Medium): Technique {
  const lab = labStats(p);
  let chroma = 0, n = 0;
  const darks: number[][] = [];
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < p.data.length; i += 4 * 3) {
    const r = p.data[i], g = p.data[i + 1], b = p.data[i + 2];
    const l = toLab(r, g, b);
    chroma += Math.hypot(l[1], l[2]); n++;
    if (l[0] < lab.mean[0] - lab.std[0]) darks.push([r, g, b]);
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const c = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++; c.r += r; c.g += g; c.b += b;
    bins.set(key, c);
  }
  const swatches = [...bins.values()].sort((a, b) => b.n - a.n).slice(0, 5).map((c) => hex(Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)));
  const ground = darks.length
    ? (darks.reduce((s, d) => [s[0] + d[0], s[1] + d[1], s[2] + d[2]], [0, 0, 0]).map((v) => v / darks.length / 255) as [number, number, number])
    : ([0.45, 0.38, 0.3] as [number, number, number]);

  const { g, w, h } = grey(p, 256);
  const e1 = gradEnergy(boxBlur(g, w, h, 1), w, h), e3 = gradEnergy(boxBlur(g, w, h, 3), w, h);
  const kept = e3.e / (e1.e + 1e-9);
  const brokenness = Math.min(1, Math.max(0, (0.45 - kept) / 0.2));
  // structure tensor: gradients run across strokes, so the stroke direction is perpendicular
  const theta = 0.5 * Math.atan2(2 * e1.jxy, e1.jxx - e1.jyy) + Math.PI / 2;
  const tr = e1.jxx + e1.jyy, coherence = tr > 0 ? Math.sqrt((e1.jxx - e1.jyy) ** 2 + 4 * e1.jxy ** 2) / tr : 0;
  const softness = Math.min(1, Math.max(0, 1 - brokenness * 1.4)) * Math.min(1, 1.6 - Math.min(1.6, e1.e * 250));
  const sat = chroma / n;
  const dirWord = coherence < 0.15 ? "in every direction" : Math.abs(Math.cos(theta)) > 0.8 ? "mostly horizontal" : Math.abs(Math.sin(theta)) > 0.8 ? "mostly vertical" : "on a diagonal";
  const summary = [
    medium === "oil" ? "Oil: opaque, loaded paint over a toned ground" : "Watercolor: translucent washes on white paper",
    brokenness > 0.65 ? "Short, broken dabs of colour" : brokenness > 0.35 ? "Visible strokes, partly blended" : "Long, smooth, blended strokes",
    `Strokes run ${dirWord}`,
    `${lab.mean[0] < 40 ? "Dark, low-key" : lab.mean[0] > 62 ? "Light, high-key" : "Mid-key"} values, ${sat < 12 ? "muted" : sat > 22 ? "vivid" : "moderate"} colour`,
  ];
  const quant = (k: number) => {
    const v: number[] = [];
    for (let i = 0; i < p.data.length; i += 4 * 2) v.push(toLab(p.data[i], p.data[i + 1], p.data[i + 2])[k]);
    return Float32Array.from(v).sort();
  };
  return {
    medium, lab, chroma: sat, brokenness, summary, ground, swatches,
    direction: [Math.cos(theta), Math.sin(theta)], coherence, softness,
    quantiles: { L: quant(0), a: quant(1), b: quant(2) },
  };
}

// ------------------------------------------------------------------ apply to A
/** A's picture in B's palette and values (histogram matching in LAB), softened if B is smooth. */
export function applyTechnique(a: Pixels, t: Technique): Pixels {
  const n = a.width * a.height, L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l = toLab(a.data[i * 4], a.data[i * 4 + 1], a.data[i * 4 + 2]);
    L[i] = l[0]; A[i] = l[1]; B[i] = l[2];
  }
  const match = (src: Float32Array, ref: Float32Array, amt: number) => {
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    idx.sort((x, y) => src[x] - src[y]);
    const out = new Float32Array(n);
    for (let r = 0; r < n; r++) {
      const i = idx[r], v = ref[Math.min(ref.length - 1, Math.floor((r / n) * ref.length))];
      out[i] = src[i] * (1 - amt) + v * amt;
    }
    return out;
  };
  // partial match: B's palette leads, but A's own light, form and hue relationships stay readable
  // (a full per-channel match scrambles hues and washes out faces when B is much lighter or darker)
  const L2 = match(L, t.quantiles.L, 0.45), A2 = match(A, t.quantiles.a, 0.55), B2 = match(B, t.quantiles.b, 0.55);
  const out = new Uint8ClampedArray(a.data.length);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = fromLab(Math.min(100, Math.max(0, L2[i])), A2[i], B2[i]);
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
  }
  const res = { width: a.width, height: a.height, data: out };
  return t.softness > 0.5 ? softenRgba(res, Math.round(1 + (t.softness - 0.5) * 4)) : res;
}

function softenRgba(p: Pixels, r: number): Pixels {
  const { width: w, height: h } = p, out = new Uint8ClampedArray(p.data);
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) ch[i] = p.data[i * 4 + c];
    const b = boxBlur(ch, w, h, r);
    for (let i = 0; i < w * h; i++) out[i * 4 + c] = b[i];
  }
  return { width: w, height: h, data: out };
}

// ------------------------------------------------------------------ planner settings from B
/** Canvas area and raw planner settings that make the strokes behave like B's. */
export function planSettingsFor(t: Technique): { areaMm2: number; advanced: Partial<PlanSettings> } {
  const k = t.brokenness;
  // broken brushwork -> more, smaller marks on a bigger canvas; blended -> fewer, broad planes
  const areaMm2 = Math.round(130000 + k * 100000);
  // broken brushwork -> short dabs (about 0.4x the default length); blended -> long strokes
  const len = 1.35 - 0.95 * k;
  const layers = DEFAULT_LAYERS.map((l) => ({
    ...l, minLenMm: Math.max(2.5, l.minLenMm * Math.min(1, len)), maxLenMm: Math.max(5, l.maxLenMm * len),
  }));
  const form = 1.25 - 0.5 * k;
  return {
    areaMm2,
    advanced: {
      layers,
      analysisMm: 1.5, // coarse analysis grid: ~3x faster planning, same stroke count
      flatDirection: t.direction,
      flatBias: 0.06 + 0.4 * t.coherence,
      formSizesMm: [80 * form, 35 * form, 15 * form],
      ground: t.ground,
      chroma: Math.min(1.12, Math.max(0.85, t.chroma / 16)), // capped: vivid B + the watercolor renderer's own saturation glows
      restraint: 0.25 + (1 - k) * 0.55, // blended painters leave shapes as planes; dabbers break them up
      streaks: t.medium === "oil",
      underTone: t.medium === "oil" ? 0.45 : 0.1,
      look: "oil",
    },
  };
}
