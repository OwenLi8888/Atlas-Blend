import type { StrokePlan, StyleId } from '../types';
import { geomOf, pointAt } from './geometry';
import { styleFor, type StyleRenderer } from './styles';

export const PAINT_SECONDS = 10;
/** A stroke is never drawn faster than this, so even the quickest detail visibly lands. ms. */
const MIN_STROKE_MS = 110;
const MAX_DPR = 2;

export interface PlayerFrame {
  /** Brush position in CSS pixels from the canvas's top-left corner, kept inside the canvas. */
  x: number;
  y: number;
  /** True until the last stroke is down. */
  painting: boolean;
  /** 0 to 1. */
  progress: number;
}

export interface PlayerOptions {
  style: StyleId;
  durationMs?: number;
  /** Called every animation frame, painting or not. */
  onFrame?: (frame: PlayerFrame) => void;
  onDone?: () => void;
}

/**
 * When each stroke starts and ends. Time is shared out by sqrt(length x width), so the broad early
 * layers take longest and detail lands fast: the picture arrives coarse to fine.
 */
export function schedule(plan: StrokePlan, durationMs: number): { start: Float64Array; end: Float64Array } {
  const n = plan.strokes.length;
  const start = new Float64Array(n);
  const end = new Float64Array(n);
  let total = 0;
  const weight = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = plan.strokes[i];
    weight[i] = Math.sqrt(Math.max(s.lengthMm * s.widthMm, 1e-3));
    total += weight[i];
  }
  let t = 0;
  for (let i = 0; i < n; i++) {
    const slot = (weight[i] / total) * durationMs;
    start[i] = t;
    // Ends never decrease from one stroke to the next, so strokes still finish in paint order.
    end[i] = Math.min(t + Math.max(slot, MIN_STROKE_MS), durationMs);
    t += slot;
  }
  return { start, end };
}

/**
 * Plays a stroke plan onto a canvas in one style. Finished strokes are drawn once onto an
 * offscreen "committed" canvas; each frame copies it and draws the strokes in progress on top.
 */
export class Player {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly committed: HTMLCanvasElement;
  private readonly cctx: CanvasRenderingContext2D;
  private readonly plan: StrokePlan;
  private readonly opts: PlayerOptions;
  private readonly durationMs: number;
  private readonly start: Float64Array;
  private readonly end: Float64Array;
  private readonly observer: ResizeObserver;

  private style: StyleRenderer;
  private raf = 0;
  private last = 0;
  private elapsed = 0;
  private committedCount = 0;
  private paused = false;
  private finished = false;
  private dirty = true;
  /** The style's finishing pass has been drawn. */
  private sealed = false;
  private cssW = 1;
  private cssH = 1;
  /** Device pixels per mm. */
  private scale = 1;
  private readonly brush = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, plan: StrokePlan, opts: PlayerOptions) {
    this.canvas = canvas;
    this.plan = plan;
    this.opts = opts;
    this.durationMs = opts.durationMs ?? PAINT_SECONDS * 1000;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.committed = document.createElement('canvas');
    this.cctx = this.committed.getContext('2d', { alpha: false })!;
    this.style = styleFor(plan, opts.style);
    ({ start: this.start, end: this.end } = schedule(plan, this.durationMs));

    this.measure();
    this.reset();
    this.observer = new ResizeObserver(() => {
      if (this.measure()) this.reset();
    });
    this.observer.observe(canvas);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Clears the canvas and paints again from the first stroke, in `style` if given. */
  restart(style?: StyleId): void {
    if (style) this.style = styleFor(this.plan, style);
    this.elapsed = 0;
    this.paused = false;
    this.finished = false;
    this.reset();
  }

  /** Jumps to a point in the painting (0 to 1) and holds there. For tests and a future scrub bar. */
  seek(progress: number): void {
    this.elapsed = Math.min(Math.max(progress, 0), 1) * this.durationMs;
    this.paused = true;
    this.finished = false;
    this.reset();
    this.render();
  }

  resume(): void {
    this.paused = false;
  }

  get progress(): number {
    return this.elapsed / this.durationMs;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
  }

  /** Sizes both canvases to the element's CSS box. Returns whether the size changed. */
  private measure(): boolean {
    const cssW = Math.max(1, this.canvas.clientWidth);
    const cssH = Math.max(1, this.canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    this.cssW = cssW;
    this.cssH = cssH;
    this.scale = w / this.plan.widthMm;
    if (this.canvas.width === w && this.canvas.height === h && this.committed.width === w) return false;
    this.canvas.width = this.committed.width = w;
    this.canvas.height = this.committed.height = h;
    return true;
  }

  /** Back to bare ground. The next render lays every stroke finished by then again (restart, resize, seek). */
  private reset(): void {
    this.committedCount = 0;
    this.sealed = false;
    this.cctx.setTransform(1, 0, 0, 1, 0, 0);
    this.cctx.fillStyle = this.style.ground;
    this.cctx.fillRect(0, 0, this.committed.width, this.committed.height);
    this.style.begin?.(this.committed.width, this.committed.height);
    this.dirty = true;
  }

  private tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick);
    // A long gap means the tab was hidden: carry on from where it stopped instead of skipping ahead.
    const dt = Math.min(now - this.last, 100);
    this.last = now;
    if (!this.paused && !this.finished) {
      this.elapsed = Math.min(this.elapsed + dt, this.durationMs);
      this.dirty = true;
    }
    if (this.dirty) this.render();

    this.opts.onFrame?.({
      x: this.brush.x,
      y: this.brush.y,
      // Held by seek() still counts: the brush stays on its stroke.
      painting: !this.finished,
      progress: this.elapsed / this.durationMs,
    });
    if (!this.finished && this.elapsed >= this.durationMs) {
      this.finished = true;
      this.opts.onDone?.();
    }
  };

  private render(): void {
    this.dirty = false;
    const { plan, style, start, end, elapsed, ctx, cctx, scale } = this;
    const n = plan.strokes.length;
    const mmPerPx = plan.widthMm / this.cssW;

    cctx.setTransform(scale, 0, 0, scale, 0, 0);
    while (this.committedCount < n && end[this.committedCount] <= elapsed) {
      style.draw(cctx, this.committedCount, 1, mmPerPx);
      this.committedCount++;
    }

    // Strokes in progress go on top of the copy; an incremental style adds them to the committed
    // canvas itself (it only ever draws what is new).
    const live = style.incremental ? cctx : ctx;
    if (!style.incremental) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.committed, 0, 0);
    }
    live.setTransform(scale, 0, 0, scale, 0, 0);
    let latest = this.committedCount - 1;
    let latestT = 1;
    for (let i = this.committedCount; i < n && start[i] <= elapsed; i++) {
      const t = (elapsed - start[i]) / (end[i] - start[i] || 1);
      style.draw(live, i, t, mmPerPx);
      latest = i;
      latestT = t;
    }
    if (this.committedCount === n && !this.sealed) {
      this.sealed = true;
      style.finish?.(cctx);
    }
    if (style.incremental) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.committed, 0, 0);
    }

    // The brush is on the most recently started stroke, at the point it has reached.
    if (latest >= 0) {
      pointAt(geomOf(plan, latest), latestT, this.brush);
      const toCss = this.cssW / plan.widthMm;
      this.brush.x = Math.min(Math.max(this.brush.x * toCss, 0), this.cssW);
      this.brush.y = Math.min(Math.max(this.brush.y * toCss, 0), this.cssH);
    } else {
      this.brush.x = this.cssW / 2;
      this.brush.y = this.cssH / 2;
    }
  }
}
