/**
 * Built-in stroke planner (painter's order: big shapes first, details last).
 *
 * Layered curved-brush-stroke planning in the style of Hertzmann (1998): for each brush radius
 * from coarse to fine, blur the target, walk a grid, and wherever the running canvas differs
 * from the blurred target, start a stroke at the worst pixel and let it follow the image's
 * isophotes (perpendicular to the luminance gradient) until the color no longer fits.
 *
 * Used when no external engine is configured via PAINT_ENGINE.
 */
export type RGB = [number, number, number];
export interface Stroke {
  points: [number, number][];
  width: number;
  color: RGB;
  layer: number;
}
export interface Plan {
  width: number;
  height: number;
  layers: number;
  strokes: Stroke[];
}

export interface Img {
  width: number;
  height: number;
  data: Float32Array; // RGB, 0..255, length w*h*3
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

function boxBlur(src: Img, r: number): Img {
  const { width: w, height: h } = src;
  if (r < 1) return { width: w, height: h, data: src.data.slice() };
  const tmp = new Float32Array(w * h * 3);
  const out = new Float32Array(w * h * 3);
  // three box passes approximate a gaussian
  let a = src.data.slice();
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += a[(y * w + Math.min(w - 1, Math.max(0, x))) * 3 + c];
        for (let x = 0; x < w; x++) {
          tmp[(y * w + x) * 3 + c] = acc / (2 * r + 1);
          const xa = Math.min(w - 1, x + r + 1);
          const xr = Math.max(0, x - r);
          acc += a[(y * w + xa) * 3 + c] - a[(y * w + xr) * 3 + c];
        }
      }
    }
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 3 + c];
        for (let y = 0; y < h; y++) {
          out[(y * w + x) * 3 + c] = acc / (2 * r + 1);
          const ya = Math.min(h - 1, y + r + 1);
          const yr = Math.max(0, y - r);
          acc += tmp[(ya * w + x) * 3 + c] - tmp[(yr * w + x) * 3 + c];
        }
      }
    }
    a = out.slice();
  }
  return { width: w, height: h, data: a };
}

function luminance(img: Img): Float32Array {
  const n = img.width * img.height;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.299 * img.data[i * 3] + 0.587 * img.data[i * 3 + 1] + 0.114 * img.data[i * 3 + 2];
  return L;
}

export interface PlanOptions {
  radii?: number[];
  threshold?: number;
  maxLen?: number;
  seed?: number;
  paper?: RGB;
}

export function planStrokes(target: Img, opts: PlanOptions = {}): Plan {
  const { width: w, height: h } = target;
  const s = Math.max(w, h) / 512;
  const radii = (opts.radii ?? [20, 10, 5, 2.5]).map((r) => Math.max(1.5, r * s));
  const T = opts.threshold ?? 22;
  const maxLen = opts.maxLen ?? 14;
  const rand = mulberry32(opts.seed ?? 7);
  const paper = opts.paper ?? [240, 234, 220];

  const canvas = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) canvas.set(paper, i * 3);
  const strokes: Stroke[] = [];

  radii.forEach((R, layer) => {
    const ref = boxBlur(target, Math.max(1, Math.round(R / 2)));
    const L = luminance(ref);
    const grid = Math.max(2, Math.round(R));
    const layerStrokes: Stroke[] = [];
    const diff = (i: number) => {
      const dr = canvas[i * 3] - ref.data[i * 3];
      const dg = canvas[i * 3 + 1] - ref.data[i * 3 + 1];
      const db = canvas[i * 3 + 2] - ref.data[i * 3 + 2];
      return Math.sqrt(dr * dr + dg * dg + db * db);
    };
    for (let gy = 0; gy < h; gy += grid) {
      for (let gx = 0; gx < w; gx += grid) {
        let sum = 0, n = 0, best = -1, bx = gx, by = gy;
        for (let y = gy; y < Math.min(h, gy + grid); y++) {
          for (let x = gx; x < Math.min(w, gx + grid); x++) {
            const d = diff(y * w + x);
            sum += d; n++;
            if (d > best) { best = d; bx = x; by = y; }
          }
        }
        if (layer > 0 && sum / n < T) continue;
        layerStrokes.push(makeStroke(bx, by, R, layer));
      }
    }
    // shuffle within a layer so strokes don't sweep like a scanline
    for (let i = layerStrokes.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [layerStrokes[i], layerStrokes[j]] = [layerStrokes[j], layerStrokes[i]];
    }
    for (const st of layerStrokes) stamp(st);
    strokes.push(...layerStrokes);

    function makeStroke(x0: number, y0: number, R: number, layer: number): Stroke {
      const i0 = y0 * w + x0;
      const color: RGB = [ref.data[i0 * 3], ref.data[i0 * 3 + 1], ref.data[i0 * 3 + 2]];
      const pts: [number, number][] = [[x0, y0]];
      let x = x0, y = y0, ldx = 0, ldy = 0;
      for (let k = 1; k < maxLen; k++) {
        const xi = Math.min(w - 2, Math.max(1, Math.round(x)));
        const yi = Math.min(h - 2, Math.max(1, Math.round(y)));
        const i = yi * w + xi;
        const cd = Math.hypot(ref.data[i * 3] - color[0], ref.data[i * 3 + 1] - color[1], ref.data[i * 3 + 2] - color[2]);
        if (k > 3 && cd > diff(i)) break;
        const gx = L[i + 1] - L[i - 1];
        const gy = L[i + w] - L[i - w];
        if (Math.hypot(gx, gy) < 0.5) {
          if (k === 1) { ldx = rand() - 0.5; ldy = rand() - 0.5; } // flat area: random direction
        } else {
          let dx = -gy, dy = gx;
          if (ldx * dx + ldy * dy < 0) { dx = -dx; dy = -dy; }
          // low-pass the direction for smooth curves
          ldx = 0.6 * dx + 0.4 * ldx;
          ldy = 0.6 * dy + 0.4 * ldy;
        }
        const m = Math.hypot(ldx, ldy) || 1;
        x += (ldx / m) * R;
        y += (ldy / m) * R;
        if (x < 0 || y < 0 || x >= w || y >= h) break;
        pts.push([x, y]);
      }
      return { points: pts, width: R * 2, color, layer };
    }
  });

  function stamp(st: Stroke) {
    const r = st.width / 2;
    const r2 = r * r;
    for (const [px, py] of st.points) {
      const x0 = Math.max(0, Math.floor(px - r)), x1 = Math.min(w - 1, Math.ceil(px + r));
      const y0 = Math.max(0, Math.floor(py - r)), y1 = Math.min(h - 1, Math.ceil(py + r));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          if ((x - px) ** 2 + (y - py) ** 2 <= r2) canvas.set(st.color, (y * w + x) * 3);
    }
  }

  return { width: w, height: h, layers: radii.length, strokes };
}
