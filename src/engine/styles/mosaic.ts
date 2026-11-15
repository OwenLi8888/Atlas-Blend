import type { StrokePlan } from '../../types';
import { hslCss, rgbToHsl } from '../color';
import { geomOf } from '../geometry';
import { hashString } from '../rng';
import { buildPalette, nearestIndex } from './shapes';
import type { StyleRenderer } from './types';

/**
 * Mosaic, inspired by Roman and Byzantine tile work: the canvas is a grid of small square tiles
 * (tesserae) set in grout. A stroke colours every cell it passes over, later strokes replacing
 * earlier ones as paint would. Strokes of the last two (detail) layers split the cells they touch
 * into 2 x 2 half-size tiles, so faces stay readable.
 *
 * The grid is in device pixels and lives here, not on the canvas: draw() works out which cells a
 * stroke newly covers and redraws only those.
 */

const GROUT = '#CFC6B4';
/** Tiles along the canvas's long side. */
const TILES_LONG_SIDE = 80;
const GROUT_SHARE = 0.12;
const PALETTE_SIZE = 24;
const MAX_TURN = (4 * Math.PI) / 180;
const SIZE_JITTER = 0.06;
const LIGHT_JITTER = 0.04;
const HUE_JITTER = 3 / 360;
const BEVEL_LIGHT = 'rgba(255, 255, 255, 0.24)';
const BEVEL_DARK = 'rgba(0, 0, 0, 0.2)';
const GROUT_SHADOW = 'rgba(64, 52, 34, 0.3)';
/** Below this size in device pixels a 1px bevel would swallow the tile. */
const MIN_BEVEL_TILE = 6;
/** Tiles on a pitch under this many device pixels are set square to the pixel grid: turning them would only blur them. */
const MIN_TURNED_PITCH = 8;
/** Glazed tile is cleaner in colour than averaged paint. */
const SATURATION_LIFT = 1.2;

export function createMosaic(plan: StrokePlan): StyleRenderer {
  const seed = hashString(plan.id) ^ 0x7e55e2a;
  const n = plan.strokes.length;

  // A real tile set: about 24 colours taken from the painting.
  const paletteRgb = buildPalette(plan, PALETTE_SIZE);
  const palette = paletteRgb.map(rgbToHsl);
  const strokeColor = new Uint8Array(n);
  let maxLayer = 0;
  for (let i = 0; i < n; i++) {
    strokeColor[i] = nearestIndex(paletteRgb, plan.strokes[i].color);
    if (plan.strokes[i].layer > maxLayer) maxLayer = plan.strokes[i].layer;
  }
  const isDetail = (index: number) => plan.strokes[index].layer >= maxLayer - 1;

  // ---- The grid. Rebuilt by begin(). ----
  let cell = 2; // tile pitch, device px: a whole even number, so half-tiles land on pixels too
  let sub = 1;
  /** Where the grid starts: it is centred, so the cut tiles at the edges match. */
  let originX = 0;
  let originY = 0;
  let cols = 0;
  let rows = 0;
  let pxPerMm = 1;
  /** The stroke each quarter of a cell belongs to (-1: bare grout). An unsplit cell has four equal owners. */
  let owner = new Int32Array(0);
  let split = new Uint8Array(0);
  /** How far along each stroke has been laid, 0 to 1. */
  const laid = new Float32Array(n);
  let dirty = new Int32Array(0);
  let dirtyCount = 0;
  let marked = new Uint8Array(0);

  /** A fixed random number in 0..1 for tile `id`: the same on every replay. */
  const rand = (id: number, salt: number) => {
    let h = Math.imul(id ^ seed, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  };

  // A tile's placement: slightly turned, slightly off-size, always inside its own cell.
  let tileCos = 1;
  let tileSin = 0;
  let tileHalf = 0;
  const place = (ctx: CanvasRenderingContext2D, cx: number, cy: number, pitch: number, id: number) => {
    const gap = Math.max(pitch * GROUT_SHARE, 1);
    if (pitch < MIN_TURNED_PITCH) {
      const whole = Math.max(Math.round(gap), 1);
      tileCos = 1;
      tileSin = 0;
      tileHalf = (pitch - whole) / 2;
      ctx.setTransform(1, 0, 0, 1, cx - whole / 2, cy - whole / 2);
      return;
    }
    const turn = (rand(id, 0) * 2 - 1) * MAX_TURN;
    tileCos = Math.cos(turn);
    tileSin = Math.sin(turn);
    const wanted = ((pitch - gap) * (1 + (rand(id, 1) * 2 - 1) * SIZE_JITTER)) / 2;
    // A turned square reaches further than its half-width: never past the cell's own edge.
    tileHalf = Math.max(Math.min(wanted, pitch / 2 / (tileCos + Math.abs(tileSin)) - 0.2), 0.5);
    ctx.setTransform(tileCos, tileSin, -tileSin, tileCos, cx, cy);
  };

  const drawTile = (ctx: CanvasRenderingContext2D, cx: number, cy: number, pitch: number, id: number, stroke: number) => {
    place(ctx, cx, cy, pitch, id);
    const [h, s, l] = palette[strokeColor[stroke]];
    ctx.fillStyle = hslCss(h + (rand(id, 2) * 2 - 1) * HUE_JITTER, s * SATURATION_LIFT, l + (rand(id, 3) * 2 - 1) * LIGHT_JITTER);
    const size = tileHalf * 2;
    ctx.fillRect(-tileHalf, -tileHalf, size, size);
    if (size >= MIN_BEVEL_TILE) {
      // Glazed stone: light catches the top-left edge, the bottom-right falls away.
      ctx.fillStyle = BEVEL_LIGHT;
      ctx.fillRect(-tileHalf, -tileHalf, size, 1);
      ctx.fillRect(-tileHalf, -tileHalf + 1, 1, size - 1);
      ctx.fillStyle = BEVEL_DARK;
      ctx.fillRect(-tileHalf, tileHalf - 1, size, 1);
      ctx.fillRect(tileHalf - 1, -tileHalf, 1, size - 1);
    }
  };

  /** Calls `each` for every tile now on the grid. */
  const eachTile = (c: number, each: (cx: number, cy: number, pitch: number, id: number, stroke: number) => void) => {
    const x0 = originX + (c % cols) * cell;
    const y0 = originY + Math.floor(c / cols) * cell;
    if (!split[c]) {
      if (owner[c * 4] >= 0) each(x0 + cell / 2, y0 + cell / 2, cell, c, owner[c * 4]);
      return;
    }
    for (let k = 0; k < 4; k++) {
      const stroke = owner[c * 4 + k];
      // Sub-tile ids follow the whole-cell ids, so each has its own fixed jitter.
      if (stroke >= 0) each(x0 + (k & 1) * sub + sub / 2, y0 + (k >> 1) * sub + sub / 2, sub, cols * rows + c * 4 + k, stroke);
    }
  };

  const drawCell = (ctx: CanvasRenderingContext2D, c: number) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = GROUT;
    ctx.fillRect(originX + (c % cols) * cell, originY + Math.floor(c / cols) * cell, cell, cell);
    eachTile(c, (cx, cy, pitch, id, stroke) => drawTile(ctx, cx, cy, pitch, id, stroke));
  };

  const touch = (c: number) => {
    if (marked[c]) return;
    marked[c] = 1;
    dirty[dirtyCount++] = c;
  };

  /**
   * Stroke `index` covers the point (x, y), device px. A detail stroke takes the quarter-cell it
   * landed in and splits the cell; any other stroke takes the whole cell. The highest stroke
   * index always wins, so the picture does not depend on the order strokes arrive in.
   */
  const claim = (index: number, detail: boolean, px: number, py: number) => {
    const x = px - originX;
    const y = py - originY;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
    const c = cy * cols + cx;
    const o = c * 4;
    if (detail) {
      if (!split[c]) {
        split[c] = 1;
        touch(c);
      }
      const k = (Math.floor(x / sub) & 1) | ((Math.floor(y / sub) & 1) << 1);
      if (index > owner[o + k]) {
        owner[o + k] = index;
        touch(c);
      }
    } else {
      for (let k = 0; k < 4; k++) {
        if (index > owner[o + k]) {
          owner[o + k] = index;
          touch(c);
        }
      }
    }
  };

  return {
    ground: GROUT,
    incremental: true,

    begin(widthPx, heightPx) {
      sub = Math.max(1, Math.round(Math.max(widthPx, heightPx) / TILES_LONG_SIDE / 2));
      cell = sub * 2;
      cols = Math.ceil(widthPx / cell);
      rows = Math.ceil(heightPx / cell);
      originX = Math.floor((widthPx - cols * cell) / 2);
      originY = Math.floor((heightPx - rows * cell) / 2);
      pxPerMm = widthPx / plan.widthMm;
      const cells = cols * rows;
      if (owner.length !== cells * 4) {
        owner = new Int32Array(cells * 4);
        split = new Uint8Array(cells);
        dirty = new Int32Array(cells);
        marked = new Uint8Array(cells);
      }
      owner.fill(-1);
      split.fill(0);
      marked.fill(0);
      laid.fill(0);
      dirtyCount = 0;
    },

    draw(ctx, index, t) {
      const from = laid[index];
      if (t <= from) return;
      laid[index] = t;

      const g = geomOf(plan, index);
      const detail = isDetail(index);
      // Sample twice per tile across and along, so no cell under the stroke is stepped over.
      const step = (detail ? sub : cell) * 0.5;
      const alongSteps = Math.max(1, Math.ceil(((t - from) * g.length * pxPerMm) / step));
      for (let a = 0; a <= alongSteps; a++) {
        const u = from + ((t - from) * a) / alongSteps;
        const fi = u * (g.n - 1);
        const i = Math.min(Math.floor(fi), g.n - 2);
        const k = fi - i;
        const x = (g.x[i] + (g.x[i + 1] - g.x[i]) * k) * pxPerMm;
        const y = (g.y[i] + (g.y[i + 1] - g.y[i]) * k) * pxPerMm;
        const nx = -(g.ty[i] + (g.ty[i + 1] - g.ty[i]) * k);
        const ny = g.tx[i] + (g.tx[i + 1] - g.tx[i]) * k;
        const half = (g.hw[i] + (g.hw[i + 1] - g.hw[i]) * k) * pxPerMm;
        const acrossSteps = Math.ceil((half * 2) / step);
        if (acrossSteps === 0) {
          claim(index, detail, x, y);
          continue;
        }
        for (let b = 0; b <= acrossSteps; b++) {
          const lat = -half + (half * 2 * b) / acrossSteps;
          claim(index, detail, x + nx * lat, y + ny * lat);
        }
      }

      // Only the cells that changed are redrawn.
      for (let d = 0; d < dirtyCount; d++) {
        drawCell(ctx, dirty[d]);
        marked[dirty[d]] = 0;
      }
      dirtyCount = 0;
    },

    finish(ctx) {
      // Grout shadow: a 1px darker line under and to the right of every tile, for depth.
      ctx.fillStyle = GROUT_SHADOW;
      for (let c = 0, cells = cols * rows; c < cells; c++) {
        eachTile(c, (cx, cy, pitch, id) => {
          place(ctx, cx, cy, pitch, id);
          ctx.fillRect(-tileHalf + 1, tileHalf, tileHalf * 2, 1);
          ctx.fillRect(tileHalf, -tileHalf + 1, 1, tileHalf * 2 - 1);
        });
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
}
