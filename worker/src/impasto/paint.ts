/**
 * Painting-process video with the impasto stroke planner (as in magic-brush):
 * still -> planImpasto (knife/bristle strokes, layer by layer) -> stroke player -> oil /
 * watercolor / dots renderer -> frames -> MP4, plus a sheet of the canvas after every layer.
 *
 * The whole image is planned as one region, starting from a blank toned canvas, so the video
 * shows the painting being built from the underpainting to the last accents.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import ffmpegPath from "ffmpeg-static";
import { MAX_SIDE_MM, planImpasto, strokesToJSON, type ImpastoStroke } from "../vendor/impasto/index.ts";
import type { PlanSettings } from "../vendor/impasto/planner.ts";
import { dotsRenderer } from "./dots.ts";
import { oilRenderer } from "./oil.ts";
import type { RenderFrame, StrokeRenderer } from "./types.ts";
import { watercolorRenderer } from "./watercolor.ts";

export const STYLES = { oil: oilRenderer, watercolor: watercolorRenderer, dots: dotsRenderer } satisfies Record<string, StrokeRenderer>;
export type StyleName = keyof typeof STYLES;

/** Blank canvas colour under each style before the first stroke. */
const GROUND: Record<StyleName, string> = { oil: "#d9cfbf", watercolor: "#f6f1e7", dots: "#2a1d16" };

export interface ImpastoPaintOptions {
  still: string;
  outDir: string;
  style?: StyleName;
  /** Long side of the video in px. */
  size?: number;
  /**
   * Planning area budget, mm². magic-brush uses 20,000 for one lassoed region; a whole painting
   * needs ~200,000 (about 1,300 strokes, ~12 s to plan at 640 px) to read as the image.
   */
  areaMm2?: number;
  fps?: number;
  paintSeconds?: number;
  holdSeconds?: number;
  seed?: number;
  /** Rewrites the still's pixels before planning (technique transfer: A in B's palette). */
  transform?: (p: { width: number; height: number; data: Uint8ClampedArray }) => { width: number; height: number; data: Uint8ClampedArray };
  /** Raw planner settings (technique transfer: B's stroke direction, mark size, ground...). */
  advanced?: Partial<PlanSettings>;
  /** Write the per-layer process sheet (default true; off for the fast app path). */
  sheet?: boolean;
  /** x264 preset (default veryfast). */
  x264?: string;
  onProgress?: (p: { stage: string; pct: number; detail?: string }) => void;
}

export interface ImpastoPaintResult {
  video: string;
  final: string;
  sheet: string;
  strokesFile: string;
  strokes: number;
  layers: { name: string; strokes: number }[];
  frames: number;
  duration: number;
  planSeconds: number;
  seconds: number;
  engine: "impasto";
  style: StyleName;
  width: number;
  height: number;
  canvasMm: [number, number];
}

/** When each stroke is due, 0-1 of the paint time: long broad strokes get more time than dabs (magic-brush player). */
function strokeSchedule(strokes: readonly ImpastoStroke[]): Float64Array {
  const due = new Float64Array(strokes.length);
  let total = 0;
  for (let i = 0; i < strokes.length; i++) {
    due[i] = total;
    total += 0.6 + Math.min(3, strokes[i].lengthMm / 25);
  }
  if (total > 0) for (let i = 0; i < due.length; i++) due[i] /= total;
  return due;
}

/** Canvas width for an area budget, kept within impasto's 480 mm longest side. */
function planWidthMm(w: number, h: number, areaMm2: number): number {
  const widthMm = Math.sqrt((areaMm2 * w) / h);
  return widthMm * Math.min(1, MAX_SIDE_MM / Math.max(widthMm, (widthMm * h) / w));
}

export async function paintImpasto(opts: ImpastoPaintOptions): Promise<ImpastoPaintResult> {
  const t0 = Date.now();
  const style: StyleName = opts.style && opts.style in STYLES ? opts.style : "oil";
  const renderer = STYLES[style];
  const fps = opts.fps ?? 30;
  const paintSeconds = opts.paintSeconds ?? 14;
  const holdSeconds = opts.holdSeconds ?? 2;
  const areaMm2 = opts.areaMm2 ?? 200000;
  const progress = opts.onProgress ?? (() => {});
  mkdirSync(opts.outDir, { recursive: true });

  // 1. the still at video size (even dims for yuv420p)
  const src = await loadImage(opts.still);
  const long = opts.size ?? 640;
  const k = long / Math.max(src.width, src.height);
  const w = Math.round((src.width * k) / 2) * 2;
  const h = Math.round((src.height * k) / 2) * 2;
  const tc = createCanvas(w, h);
  tc.getContext("2d").drawImage(src, 0, 0, w, h);
  let pixels: Uint8ClampedArray = new Uint8ClampedArray(tc.getContext("2d").getImageData(0, 0, w, h).data);
  if (opts.transform) {
    pixels = opts.transform({ width: w, height: h, data: pixels }).data;
    const id = tc.getContext("2d").createImageData(w, h);
    id.data.set(pixels);
    tc.getContext("2d").putImageData(id, 0, 0); // the sheet's "target" shows what was planned
  }

  // 2. plan: same call magic-brush makes in its worker, on the whole image
  progress({ stage: "planning", pct: 0 });
  const tp = Date.now();
  const planned = await planImpasto(
    { width: w, height: h, data: pixels, channels: 4 },
    {
      preset: "oil",
      widthMm: planWidthMm(w, h, areaMm2),
      seed: opts.seed ?? 1,
      advanced: opts.advanced,
      onProgress: ({ stage, layer, layers, layerName }) =>
        progress({ stage: "planning", pct: layers ? ((layer ?? 0) + 1) / layers : 0, detail: layerName ? `${stage}: ${layerName}` : stage }),
    },
  );
  const planSeconds = (Date.now() - tp) / 1000;
  const strokes = strokesToJSON(planned.plan);
  const layerNames = [...planned.plan.layerNames];
  const strokesFile = join(opts.outDir, "strokes.json");
  writeFileSync(strokesFile, JSON.stringify({ widthMm: planned.widthMm, heightMm: planned.heightMm, layerNames, strokes }));
  const layers = layerNames.map((name, i) => ({ name, strokes: strokes.filter((s) => s.layer === i).length }));
  progress({ stage: "planning", pct: 1, detail: `${strokes.length} strokes in ${layerNames.length} layers (${planSeconds.toFixed(1)} s)` });

  // 3. canvas: blank toned ground, then the renderer's own ground
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const frame: RenderFrame = { width: w, height: h, imageSide: Math.max(w, h), layers: layerNames.length, space: { pxPerMm: w / planned.widthMm, offsetX: 0, offsetY: 0 } };
  ctx.fillStyle = GROUND[style];
  ctx.fillRect(0, 0, w, h);
  renderer.begin(ctx, frame);

  // 4. ffmpeg
  const video = join(opts.outDir, `painting_${style}.mp4`);
  const ff = spawn(ffmpegPath as unknown as string, [
    "-y", "-loglevel", "error",
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${w}x${h}`, "-r", String(fps), "-i", "-",
    "-c:v", "libx264", "-preset", opts.x264 ?? "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", video,
  ]);
  let ffErr = "";
  ff.stderr.on("data", (d) => (ffErr += d));
  const done = new Promise<void>((res, rej) => ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}: ${ffErr}`)))));
  let frames = 0;
  const writeFrame = async () => {
    const buf = Buffer.from(ctx.getImageData(0, 0, w, h).data.buffer);
    frames++;
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  };

  // 5. play: strokes fall due along the schedule; a keyframe is kept at the end of every layer
  const due = strokeSchedule(strokes);
  const totalFrames = Math.max(1, Math.round(paintSeconds * fps));
  const keyframes: { label: string; image: Canvas }[] = [];
  const snapshot = (label: string) => {
    if (opts.sheet === false) return;
    const c = createCanvas(w, h);
    c.getContext("2d").drawImage(canvas, 0, 0);
    keyframes.push({ label, image: c });
  };
  snapshot("blank canvas");
  for (let i = 0; i < Math.round(0.5 * fps); i++) await writeFrame(); // a beat on the empty canvas
  let next = 0;
  for (let f = 1; f <= totalFrames; f++) {
    const until = f / totalFrames;
    while (next < strokes.length && (due[next] <= until || f === totalFrames)) {
      renderer.stroke(ctx, strokes[next], frame);
      const layer = strokes[next].layer;
      next++;
      if (next === strokes.length || strokes[next].layer !== layer) snapshot(`${layer + 1}. ${layerNames[layer]} (${next} strokes)`);
    }
    await writeFrame();
    if (f % fps === 0) progress({ stage: "painting", pct: next / strokes.length, detail: `${next}/${strokes.length} strokes` });
  }
  for (let i = 0; i < Math.round(holdSeconds * fps); i++) await writeFrame();
  ff.stdin.end();
  progress({ stage: "encoding", pct: 0.5 });
  await done;

  // 6. final frame + process sheet (target, then the canvas after each layer)
  const final = join(opts.outDir, `final_${style}.png`);
  writeFileSync(final, await canvas.encode("png"));
  const sheet = join(opts.outDir, `process_${style}.png`);
  if (opts.sheet !== false) writeFileSync(sheet, await processSheet([{ label: "target", image: tc }, ...keyframes], w, h));
  progress({ stage: "done", pct: 1 });

  return {
    video, final, sheet, strokesFile, engine: "impasto", style, width: w, height: h,
    strokes: strokes.length, layers, frames, planSeconds: Math.round(planSeconds * 10) / 10,
    duration: Math.round((frames / fps) * 10) / 10,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    canvasMm: [planned.widthMm, planned.heightMm],
  };
}

async function processSheet(tiles: { label: string; image: Canvas }[], w: number, h: number): Promise<Buffer> {
  const cols = 4, tw = 300, th = Math.round((tw * h) / w), pad = 10, lab = 22;
  const rows = Math.ceil(tiles.length / cols);
  const sheet = createCanvas(cols * (tw + pad) + pad, rows * (th + lab + pad) + pad);
  const c = sheet.getContext("2d");
  c.fillStyle = "#18181b";
  c.fillRect(0, 0, sheet.width, sheet.height);
  c.font = "13px sans-serif";
  tiles.forEach((t, i) => {
    const x = pad + (i % cols) * (tw + pad), y = pad + Math.floor(i / cols) * (th + lab + pad);
    c.drawImage(t.image, x, y, tw, th);
    c.fillStyle = "#e8e6e1";
    c.fillText(t.label, x, y + th + 16);
  });
  return sheet.encode("png");
}
