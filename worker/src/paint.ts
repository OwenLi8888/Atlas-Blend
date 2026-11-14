/**
 * Painting worker (M8): corrected still -> stroke plan -> brush render -> frames -> MP4.
 *
 * Frames are captured every N strokes with a per-layer time budget (coarse layers get screen
 * time even though they have few strokes), the last frame is held for 1.5 s, and raw RGBA frames
 * are piped straight into ffmpeg (H.264, yuv420p, faststart).
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import ffmpegPath from "ffmpeg-static";
import { brushes, type BrushName, BRUSHES } from "./brushes.js";
import { planStrokes, type Plan, type Img } from "./planner.js";

export interface PaintOptions {
  still: string;
  outDir: string;
  brush?: BrushName;
  size?: number; // long side in px
  fps?: number;
  paintSeconds?: number;
  holdSeconds?: number;
  seed?: number;
  onProgress?: (p: { stage: string; pct: number; detail?: string }) => void;
}

export interface PaintResult {
  video: string;
  final: string;
  strokes: number;
  frames: number;
  seconds: number;
  duration: number;
  engine: string;
  brush: BrushName;
  width: number;
  height: number;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Optional pre-existing stroke engine, pulled in as a package dependency (PAINT_ENGINE). */
async function externalPlanner(): Promise<null | ((img: Img) => Promise<Plan> | Plan)> {
  const mod = process.env.PAINT_ENGINE;
  if (!mod) return null;
  try {
    const m = await import(mod);
    const fn = m.planStrokes ?? m.default?.planStrokes;
    return typeof fn === "function" ? fn : null;
  } catch (e) {
    console.error(`[worker] PAINT_ENGINE ${mod} failed to load, using built-in planner:`, e);
    return null;
  }
}

export async function paint(opts: PaintOptions): Promise<PaintResult> {
  const t0 = Date.now();
  const fps = opts.fps ?? 30;
  const paintSeconds = opts.paintSeconds ?? 9.5;
  const holdSeconds = opts.holdSeconds ?? 1.5;
  const brushName: BrushName = BRUSHES.includes(opts.brush as BrushName) ? (opts.brush as BrushName) : "oil";
  const brush = brushes[brushName];
  const progress = opts.onProgress ?? (() => {});
  mkdirSync(opts.outDir, { recursive: true });

  // 1. downscale the corrected still to the painting size (even dims for yuv420p)
  const src = await loadImage(opts.still);
  const long = opts.size ?? Number(process.env.PAINT_SIZE ?? 640);
  const k = long / Math.max(src.width, src.height);
  const w = Math.round((src.width * k) / 2) * 2;
  const h = Math.round((src.height * k) / 2) * 2;
  const tc = createCanvas(w, h);
  const tctx = tc.getContext("2d");
  tctx.drawImage(src, 0, 0, w, h);
  const tdata = tctx.getImageData(0, 0, w, h).data;
  const target: Img = { width: w, height: h, data: new Float32Array(w * h * 3) };
  for (let i = 0; i < w * h; i++) {
    target.data[i * 3] = tdata[i * 4];
    target.data[i * 3 + 1] = tdata[i * 4 + 1];
    target.data[i * 3 + 2] = tdata[i * 4 + 2];
  }

  // 2. stroke plan (external engine if configured)
  progress({ stage: "planning", pct: 0 });
  const ext = await externalPlanner();
  const plan = ext ? await ext(target) : planStrokes(target, { seed: opts.seed ?? 7, paper: brush.paper });
  const engine = ext ? String(process.env.PAINT_ENGINE) : "built-in-layered-planner";
  progress({ stage: "planning", pct: 1, detail: `${plan.strokes.length} strokes in ${plan.layers} layers` });

  // 3. per-layer frame budget: coarse layers get screen time
  const totalFrames = Math.round(paintSeconds * fps);
  const weights = Array.from({ length: plan.layers }, (_, i) => [0.3, 0.27, 0.25, 0.18][i] ?? 0.15);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const byLayer = Array.from({ length: plan.layers }, (_, i) => plan.strokes.filter((s) => s.layer === i));
  const glazeFrames = Math.round(0.6 * fps);

  // 4. render + stream frames to ffmpeg
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const rand = mulberry32(opts.seed ?? 7);
  brush.prepare(ctx, w, h, rand);

  const video = join(opts.outDir, "painting.mp4");
  const ff = spawn(ffmpegPath as unknown as string, [
    "-y", "-loglevel", "error",
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${w}x${h}`, "-r", String(fps), "-i", "-",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", video,
  ]);
  let ffErr = "";
  ff.stderr.on("data", (d) => (ffErr += d));
  const done = new Promise<void>((res, rej) =>
    ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}: ${ffErr}`)))));

  let frames = 0;
  const writeFrame = async () => {
    const buf = Buffer.from(ctx.getImageData(0, 0, w, h).data.buffer);
    frames++;
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  };

  await writeFrame(); // blank paper
  let drawn = 0;
  for (let L = 0; L < plan.layers; L++) {
    const strokes = byLayer[L];
    const layerFrames = Math.max(1, Math.round((totalFrames - glazeFrames) * (weights[L] / wsum)));
    const per = Math.max(1, Math.ceil(strokes.length / layerFrames));
    for (let i = 0; i < strokes.length; i++) {
      brush.draw(ctx, strokes[i], plan.layers, rand);
      drawn++;
      if ((i + 1) % per === 0 || i === strokes.length - 1) await writeFrame();
    }
    progress({ stage: "painting", pct: drawn / plan.strokes.length, detail: `layer ${L + 1}/${plan.layers}` });
  }

  // finishing glaze: a light pass of the still so the last frame lands on it
  const glazeTotal = Number(process.env.PAINT_GLAZE ?? 0.25); // cumulative still opacity
  const glazeStep = 1 - Math.pow(1 - glazeTotal, 1 / glazeFrames);
  for (let g = 1; g <= glazeFrames; g++) {
    ctx.globalAlpha = glazeStep;
    ctx.drawImage(src, 0, 0, w, h);
    ctx.globalAlpha = 1;
    await writeFrame();
  }
  const holdFrames = Math.round(holdSeconds * fps);
  for (let i = 0; i < holdFrames; i++) await writeFrame();
  ff.stdin.end();
  progress({ stage: "encoding", pct: 0.5 });
  await done;

  const final = join(opts.outDir, "final.png");
  await canvas.encode("png").then((b) => import("node:fs").then((fs) => fs.writeFileSync(final, b)));
  progress({ stage: "done", pct: 1 });
  return {
    video, final, engine, brush: brushName, width: w, height: h,
    strokes: plan.strokes.length, frames,
    duration: Math.round((frames / fps) * 10) / 10,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
  };
}
