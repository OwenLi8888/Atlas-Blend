import type { ImpastoStroke } from "../vendor/impasto/snapshot.ts";
import { css, hash01, mix, pointAlong, resample, ribbon, shade, strokePath, tracePolygon, widthAt } from "./strokeGeometry.ts";
import type { RenderFrame, StrokeRenderer } from "./types.ts";

/** TUNE: the look of the oil renderer. */
const OIL = {
  /** The warm toned ground under the paint, over the photo. Knife strokes cover nearly all of it. */
  ground: "rgba(92, 70, 52, 0.55)",
  /**
   * Relief: every ribbon is drawn three times, offset toward the light, away from it, then in
   * place, which leaves a lit rim on one side of the paint and a shadow under the other. The
   * offset grows with the paint thickness the plan gives the stroke.
   */
  reliefPerMm: 2.2,
  reliefMin: 0.7,
  reliefMax: 3.5,
  lightAlpha: 0.5,
  shadowAlpha: 0.42,
  /** Drag lines along the stroke: how many per stroke, and how strongly they differ from the paint. */
  streaksMax: 9,
  streakContrast: 0.16,
  /** The ridge left where the blade lifts, for strokes whose plan says they end in a heap. */
  heapMin: 0.25,
};

/** Light comes from the upper left, as impasto's own renders are lit. */
const LIGHT_X = -0.64, LIGHT_Y = -0.77;

function translated(polygon: Float64Array, dx: number, dy: number): Float64Array {
  const out = new Float64Array(polygon.length);
  for (let i = 0; i < polygon.length; i += 2) { out[i] = polygon[i] + dx; out[i + 1] = polygon[i + 1] + dy; }
  return out;
}

/**
 * Oil (stroke planner): each planned stroke is drawn as the planner describes it, a thick opaque
 * ribbon the width of the blade's contact along its path, in the stroke's paint colour. The
 * colours the plan loaded across the blade become streaks, drag lines run along the stroke, the
 * edges catch light and cast shadow, and loaded strokes end in a ridge where the blade lifted.
 * The underpainting, which the plan makes with a bristle brush, is drawn thinner and flatter.
 */
export const oilRenderer: StrokeRenderer = {
  begin(ctx, frame) {
    ctx.save();
    ctx.fillStyle = OIL.ground;
    ctx.fillRect(0, 0, frame.width, frame.height);
    ctx.restore();
  },

  stroke(ctx, stroke: ImpastoStroke, frame: RenderFrame) {
    const { space } = frame;
    const path = strokePath(stroke, space);
    const widthPx = stroke.widthMm * space.pxPerMm;
    const step = Math.max(2, widthPx * 0.3);
    const body = ribbon(stroke, path, space, step, 1, 1.5);
    const knife = stroke.tool === "knife";
    const relief = knife ? Math.min(OIL.reliefMax, Math.max(OIL.reliefMin, stroke.thicknessMm * space.pxPerMm * OIL.reliefPerMm)) : 0;

    ctx.save();
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";

    // Relief: shadow under the far edge, light on the near one.
    if (relief > 0) {
      ctx.fillStyle = `rgba(0,0,0,${OIL.shadowAlpha})`;
      tracePolygon(ctx, translated(body, -LIGHT_X * relief, -LIGHT_Y * relief));
      ctx.fill();
      ctx.fillStyle = css(mix(stroke.color, [1, 1, 1], 0.55), OIL.lightAlpha);
      tracePolygon(ctx, translated(body, LIGHT_X * relief * 0.7, LIGHT_Y * relief * 0.7));
      ctx.fill();
    }

    // The paint itself: opaque.
    ctx.fillStyle = css(stroke.color);
    tracePolygon(ctx, body);
    ctx.fill();

    // Everything from here stays inside the ribbon.
    ctx.clip();
    const pts = resample(path, step);
    const line = (across: number, color: string, lineWidth: number): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], off = across * widthAt(stroke, p.t, space);
        const x = p.x + p.dy * off, y = p.y - p.dx * off;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    // Streaked loads: the colours the plan put across the blade, as bands along the stroke.
    if (stroke.colors && stroke.colors.length > 1) {
      const bands = stroke.colors.length, blend = Math.min(1, Math.max(0, stroke.mix ?? 1));
      for (let b = 0; b < bands; b++) {
        const across = (b + 0.5) / bands - 0.5;
        line(across, css(mix(stroke.colors[b], stroke.color, blend * 0.7), 0.85), Math.max(1, (widthPx / bands) * 1.05));
      }
    }

    // Drag lines: fine light and dark streaks left by the blade or the bristles.
    const streaks = Math.min(OIL.streaksMax, Math.max(2, Math.round(widthPx / 3)));
    for (let k = 0; k < streaks; k++) {
      const across = (k + 0.2 + 0.6 * hash01(stroke.index, k)) / streaks - 0.5;
      const lighter = hash01(stroke.index, k + 31) > 0.5;
      const amount = OIL.streakContrast * (0.4 + 0.6 * hash01(stroke.index, k + 67)) * (knife ? 1 : 1.5);
      line(across, css(shade(stroke.color, lighter ? 1 + amount : 1 - amount), 0.7), Math.max(0.6, (widthPx / streaks) * (0.25 + 0.3 * hash01(stroke.index, k + 101))));
    }

    // The heap: a lit ridge across the stroke where the blade lifted off.
    if (knife && stroke.heap >= OIL.heapMin && path.length > widthPx * 0.5) {
      const end = pointAlong(path, path.length * 0.93);
      const half = (widthAt(stroke, end.t, space) / 2) * 0.9, ridge = Math.max(1, relief * (0.8 + stroke.heap * 0.5));
      const across = (dx: number, dy: number, color: string): void => {
        ctx.strokeStyle = color;
        ctx.lineWidth = ridge;
        ctx.beginPath();
        ctx.moveTo(end.x + end.dy * half + dx, end.y - end.dx * half + dy);
        ctx.lineTo(end.x - end.dy * half + dx, end.y + end.dx * half + dy);
        ctx.stroke();
      };
      across(-LIGHT_X * ridge * 0.8, -LIGHT_Y * ridge * 0.8, `rgba(0,0,0,${OIL.shadowAlpha * 0.8})`);
      across(0, 0, css(mix(stroke.color, [1, 1, 1], 0.4), 0.8));
    }

    ctx.restore();
  },
};
