/**
 * Brush sets, chosen by the dominant medium of the reference artworks:
 * watercolor, ink, gouache, pastel, oil. Each renders a planned stroke onto a 2D canvas.
 */
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { RGB, Stroke } from "./planner.js";

export type BrushName = "watercolor" | "ink" | "gouache" | "pastel" | "oil";
export const BRUSHES: BrushName[] = ["watercolor", "ink", "gouache", "pastel", "oil"];

export interface Brush {
  paper: RGB;
  /** called once before any stroke (paper texture etc.) */
  prepare(ctx: SKRSContext2D, w: number, h: number, rand: () => number): void;
  draw(ctx: SKRSContext2D, s: Stroke, layers: number, rand: () => number): void;
}

const rgba = (c: RGB, a: number, d = 0) =>
  `rgba(${clamp(c[0] + d)},${clamp(c[1] + d)},${clamp(c[2] + d)},${a})`;
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

function path(ctx: SKRSContext2D, pts: [number, number][], jitter = 0, rand?: () => number) {
  ctx.beginPath();
  const j = () => (rand ? (rand() - 0.5) * jitter : 0);
  ctx.moveTo(pts[0][0] + j(), pts[0][1] + j());
  if (pts.length === 1) {
    ctx.lineTo(pts[0][0] + 0.1, pts[0][1] + 0.1);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0] + j(), pts[i][1] + j(), mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0] + j(), last[1] + j());
}

function paperTexture(ctx: SKRSContext2D, w: number, h: number, base: RGB, rand: () => number, amount: number) {
  ctx.fillStyle = rgba(base, 1);
  ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    img.data[i] = clamp(img.data[i] + n);
    img.data[i + 1] = clamp(img.data[i + 1] + n);
    img.data[i + 2] = clamp(img.data[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
}

const oil: Brush = {
  paper: [214, 200, 178],
  prepare(ctx, w, h, rand) { paperTexture(ctx, w, h, this.paper, rand, 10); },
  draw(ctx, s, layers, rand) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // body of the stroke
    ctx.strokeStyle = rgba(s.color, 0.95);
    ctx.lineWidth = s.width;
    path(ctx, s.points);
    ctx.stroke();
    // bristle ridges: thin lighter/darker lines inside the stroke (thick-paint look)
    const n = Math.max(2, Math.round(s.width / 3));
    for (let k = 0; k < n; k++) {
      const off = (k / (n - 1 || 1) - 0.5) * s.width * 0.8;
      const pts = offset(s.points, off);
      ctx.strokeStyle = rgba(s.color, 0.35, (rand() - 0.5) * 36);
      ctx.lineWidth = Math.max(0.6, s.width / n / 1.6);
      path(ctx, pts);
      ctx.stroke();
    }
    // impasto highlight on one edge
    ctx.strokeStyle = rgba(s.color, 0.25, 40);
    ctx.lineWidth = Math.max(0.6, s.width * 0.12);
    path(ctx, offset(s.points, -s.width * 0.35));
    ctx.stroke();
  },
};

const gouache: Brush = {
  paper: [236, 230, 216],
  prepare(ctx, w, h, rand) { paperTexture(ctx, w, h, this.paper, rand, 6); },
  draw(ctx, s, _layers, rand) {
    ctx.lineCap = "butt";
    ctx.lineJoin = "bevel";
    ctx.strokeStyle = rgba(s.color, 0.92, (rand() - 0.5) * 8);
    ctx.lineWidth = s.width;
    path(ctx, s.points);
    ctx.stroke();
    ctx.strokeStyle = rgba(s.color, 0.18, -30); // faint dry edge
    ctx.lineWidth = s.width * 1.04;
    path(ctx, s.points);
    ctx.stroke();
  },
};

const watercolor: Brush = {
  paper: [246, 243, 234],
  prepare(ctx, w, h, rand) { paperTexture(ctx, w, h, this.paper, rand, 8); },
  draw(ctx, s, layers, rand) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const fine = s.layer >= layers - 1;
    const passes = fine ? 1 : 3;
    for (let p = 0; p < passes; p++) {
      ctx.strokeStyle = rgba(lighten(s.color, 0.08), fine ? 0.45 : 0.22);
      ctx.lineWidth = s.width * (1.1 + rand() * 0.5);
      path(ctx, s.points, s.width * 0.4, rand);
      ctx.stroke();
    }
    // pigment pooling at the wet edge
    ctx.globalCompositeOperation = "multiply";
    ctx.strokeStyle = rgba(s.color, fine ? 0.0 : 0.06, 20);
    ctx.lineWidth = Math.max(0.8, s.width * 0.08);
    path(ctx, offset(s.points, s.width * 0.6));
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  },
};

const ink: Brush = {
  paper: [242, 236, 222],
  prepare(ctx, w, h, rand) { paperTexture(ctx, w, h, this.paper, rand, 7); },
  draw(ctx, s, layers, rand) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const coarse = s.layer < layers - 2;
    if (coarse) {
      // diluted ink wash
      ctx.strokeStyle = rgba(s.color, 0.5);
      ctx.lineWidth = s.width * 1.2;
      path(ctx, s.points, s.width * 0.2, rand);
      ctx.stroke();
    } else {
      // crisp line work with pressure taper
      const pts = s.points;
      for (let i = 1; i < pts.length; i++) {
        const t = i / pts.length;
        ctx.strokeStyle = rgba(darken(s.color, 0.12), 0.85);
        ctx.lineWidth = Math.max(0.5, s.width * 0.45 * Math.sin(Math.PI * Math.min(0.95, t + 0.1)));
        ctx.beginPath();
        ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
        ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
      if (pts.length === 1) {
        ctx.fillStyle = rgba(darken(s.color, 0.12), 0.85);
        ctx.fillRect(pts[0][0], pts[0][1], s.width * 0.4, s.width * 0.4);
      }
    }
  },
};

const pastel: Brush = {
  paper: [222, 214, 196],
  prepare(ctx, w, h, rand) { paperTexture(ctx, w, h, this.paper, rand, 22); },
  draw(ctx, s, _layers, rand) {
    // grainy: many short dabs scattered along the stroke, paper tooth shows through
    const r = s.width / 2;
    for (let i = 0; i < s.points.length; i++) {
      const [x, y] = s.points[i];
      const dabs = Math.max(4, Math.round(r * 2.2));
      for (let k = 0; k < dabs; k++) {
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * r;
        ctx.fillStyle = rgba(s.color, 0.55, (rand() - 0.5) * 30);
        const sz = Math.max(0.7, r * 0.35 * rand());
        ctx.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, sz * 1.8, sz);
      }
    }
  },
};

export const brushes: Record<BrushName, Brush> = { oil, gouache, watercolor, ink, pastel };

function offset(pts: [number, number][], d: number): [number, number][] {
  if (pts.length < 2) return pts.map(([x, y]) => [x + d * 0.7, y + d * 0.7]);
  return pts.map(([x, y], i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const m = Math.hypot(dx, dy) || 1;
    return [x + (-dy / m) * d, y + (dx / m) * d];
  });
}
const lighten = (c: RGB, t: number): RGB => [c[0] + (255 - c[0]) * t, c[1] + (255 - c[1]) * t, c[2] + (255 - c[2]) * t];
const darken = (c: RGB, t: number): RGB => [c[0] * (1 - t), c[1] * (1 - t), c[2] * (1 - t)];
