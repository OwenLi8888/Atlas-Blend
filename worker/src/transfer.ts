/**
 * Paint image A with painting B's technique, as a stroke-by-stroke video. One process, no Python:
 * analyse B -> A in B's palette -> impasto strokes with B's direction/mark size/ground -> B's
 * medium renderer -> MP4. Tuned to finish in well under 5 s on a laptop.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { paintImpasto, type ImpastoPaintResult } from "./impasto/paint.ts";
import { analyzeTechnique, applyTechnique, planSettingsFor, type Medium, type Technique } from "./technique.ts";

export interface TransferOptions {
  /** Image A: the picture to repaint (subject + composition). */
  a: string;
  /** Painting B: whose technique is used. */
  b: string;
  /** B's medium (from the catalog). */
  medium: Medium;
  outDir: string;
  size?: number;
  paintSeconds?: number;
  onProgress?: (p: { stage: string; pct: number; detail?: string }) => void;
}

export type TransferResult = ImpastoPaintResult & { technique: Omit<Technique, "quantiles"> & { areaMm2: number }; analyzeMs: number };

async function pixelsOf(path: string, long: number) {
  const img = await loadImage(path);
  const k = long / Math.max(img.width, img.height);
  const w = Math.max(8, Math.round(img.width * k)), h = Math.max(8, Math.round(img.height * k));
  const c = createCanvas(w, h);
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  return { width: w, height: h, data: new Uint8ClampedArray(c.getContext("2d").getImageData(0, 0, w, h).data) };
}

export async function paintTransfer(o: TransferOptions): Promise<TransferResult> {
  const progress = o.onProgress ?? (() => {});
  const t0 = Date.now();
  progress({ stage: "analysing", pct: 0, detail: "Reading the second painting's technique" });
  const tech = analyzeTechnique(await pixelsOf(o.b, 320), o.medium);
  const { areaMm2, advanced } = planSettingsFor(tech);
  const analyzeMs = Date.now() - t0;
  progress({ stage: "analysing", pct: 1, detail: tech.summary.join(" · ") });

  const r = await paintImpasto({
    still: o.a, outDir: o.outDir, style: o.medium,
    size: o.size ?? 512, fps: 24, paintSeconds: o.paintSeconds ?? 9, holdSeconds: 1.5,
    areaMm2, advanced, transform: (p) => applyTechnique(p, tech),
    sheet: false, x264: "ultrafast", onProgress: o.onProgress,
  });
  const { quantiles: _q, ...rest } = tech;
  const technique = { ...rest, areaMm2 };
  writeFileSync(join(o.outDir, "technique.json"), JSON.stringify(technique, null, 2));
  return { ...r, technique, analyzeMs, seconds: Math.round((Date.now() - t0) / 100) / 10 };
}
