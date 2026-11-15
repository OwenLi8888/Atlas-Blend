import type { ImpastoStroke } from "../vendor/impasto/snapshot.ts";
import { css, hash01, mix, ribbon, shade, strokePath, tracePolygon } from "./strokeGeometry.ts";
import type { RenderFrame, StrokeRenderer } from "./types.ts";

/** TUNE: the look of the watercolor renderer. */
const WATERCOLOR = {
  /** Cotton rag paper, laid over the photo before the first wash. A little photo shows through. */
  paper: [0.965, 0.95, 0.91] as const,
  paperAlpha: 0.93,
  /** Strokes are thinned toward paper, then given back some saturation: pigment in water. */
  thin: 0.1, // painting on blank paper here (magic-brush: 0.3 over the photo)
  saturate: 1.3,
  /**
   * Each stroke is a translucent wash laid in two passes: first at `wash` opacity with normal
   * blending, then a `glaze` with multiply blending, which darkens where washes overlap. The
   * plan stacks about seven layers on every spot; the first pass is what stops seven layers of
   * multiply from sinking into mud, so the stack settles near the stroke's own colour.
   */
  wash: 0.55,
  glaze: 0.15,
  /** A wider, fainter multiply pass under each stroke: the wash bleeding into damp paper. */
  bleedWidth: 1.3,
  bleedAlpha: 0.14,
  /** Pigment pools where a wash dries: a darker multiply line round each stroke's edge. */
  edgeDarken: 0.7,
  edgeAlpha: 0.09, // lighter pooled edge on blank paper (magic-brush: 0.22), else washes read as a mosaic
  /** Edge line width as a share of the stroke's width. */
  edgeShare: 0.07,
  /** How uneven a wash's edge is, as a share of its width. */
  wobble: 0.2,
};

/** Pushes a colour away from its own grey by `amount` (1 = unchanged). */
function saturate(color: readonly number[], amount: number): [number, number, number] {
  const grey = 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2];
  const c = (v: number): number => Math.min(1, Math.max(0, grey + (v - grey) * amount));
  return [c(color[0]), c(color[1]), c(color[2])];
}

/**
 * Watercolor (procedural): each planned stroke becomes a translucent wash along its path over
 * paper, glazed with multiply blending, with a faint bleed around it and a darker pooled edge.
 */
export const watercolorRenderer: StrokeRenderer = {
  begin(ctx, frame) {
    ctx.save();
    ctx.fillStyle = css(WATERCOLOR.paper, WATERCOLOR.paperAlpha);
    ctx.fillRect(0, 0, frame.width, frame.height);
    ctx.restore();
  },

  stroke(ctx, stroke: ImpastoStroke, frame: RenderFrame) {
    const { space } = frame;
    const path = strokePath(stroke, space);
    const widthPx = stroke.widthMm * space.pxPerMm;
    const step = Math.max(2, widthPx * 0.35);
    const wobble = (i: number): number => 1 + (hash01(stroke.index, i) - 0.5) * 2 * WATERCOLOR.wobble;
    const body = ribbon(stroke, path, space, step, 1, 1.5, wobble);
    const bleed = ribbon(stroke, path, space, step, WATERCOLOR.bleedWidth, 2, wobble);
    const wash = saturate(mix(stroke.color, WATERCOLOR.paper, WATERCOLOR.thin), WATERCOLOR.saturate);

    ctx.save();
    ctx.lineJoin = "round";

    // The wash: translucent, so what is underneath still shows through it.
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = css(wash, WATERCOLOR.wash);
    tracePolygon(ctx, body);
    ctx.fill();

    // Bleed and glaze: multiply, so overlaps darken the way layered washes do.
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = css(wash, WATERCOLOR.bleedAlpha);
    tracePolygon(ctx, bleed);
    ctx.fill();
    ctx.fillStyle = css(wash, WATERCOLOR.glaze);
    tracePolygon(ctx, body);
    ctx.fill();

    // Pooled edge: a darker line where the wash stopped.
    ctx.strokeStyle = css(shade(wash, WATERCOLOR.edgeDarken), WATERCOLOR.edgeAlpha);
    ctx.lineWidth = Math.min(4, Math.max(0.75, widthPx * WATERCOLOR.edgeShare));
    ctx.stroke();

    ctx.restore();
  },
};
