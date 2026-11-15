import type { ImpastoStroke } from "../vendor/impasto/snapshot.ts";
import { css, hash01, pointAlong, shade, strokePath, widthAt } from "./strokeGeometry.ts";
import type { RenderFrame, StrokeRenderer } from "./types.ts";

/** TUNE: the look of the dot-style renderer. Sizes in mm are on the planned canvas. */
const DOTS = {
  /** The dark, warm field the dots sit on, over the photo. */
  ground: "rgba(34, 21, 14, 0.94)",
  /** Dot diameter as a share of the stroke's blade width, and its limits in mm. */
  widthShare: 0.42,
  minMm: 1.4,
  maxMm: 4.6,
  /** Dots are never smaller than this share of the photo's longer side, so small loops still read as dots. */
  minImageShare: 0.0055,
  /** Centre-to-centre spacing as a multiple of the diameter. */
  spacing: 1.28,
  /** Random offset of each dot, as a share of its diameter. */
  jitter: 0.1,
};

/**
 * Dot-style (procedural): round dots stamped at intervals along each planned path in the stroke's
 * colour, in as many rows as fit across the blade. Broad early strokes leave large dots, the fine
 * later layers small ones on top.
 */
export const dotsRenderer: StrokeRenderer = {
  begin(ctx, frame) {
    ctx.save();
    ctx.fillStyle = DOTS.ground;
    ctx.fillRect(0, 0, frame.width, frame.height);
    ctx.restore();
  },

  stroke(ctx, stroke: ImpastoStroke, frame: RenderFrame) {
    const { space } = frame;
    const path = strokePath(stroke, space);
    const diameter = Math.max(
      Math.min(DOTS.maxMm, Math.max(DOTS.minMm, stroke.widthMm * DOTS.widthShare)) * space.pxPerMm,
      DOTS.minImageShare * frame.imageSide,
    );
    const radius = diameter / 2, pitch = diameter * DOTS.spacing;
    const along = Math.max(1, Math.round(path.length / pitch));

    ctx.save();
    // Two passes share one path each: most dots in the stroke's colour, some a little lighter.
    const light: number[] = [];
    ctx.fillStyle = css(stroke.color);
    ctx.beginPath();
    let segment = 0, n = 0;
    for (let k = 0; k <= along; k++) {
      const p = pointAlong(path, (path.length * k) / along, segment);
      segment = p.segment;
      const rows = Math.max(1, Math.round(widthAt(stroke, p.t, space) / pitch));
      for (let r = 0; r < rows; r++, n++) {
        const across = (r - (rows - 1) / 2) * pitch;
        const jx = (hash01(stroke.index, n * 2) - 0.5) * 2 * DOTS.jitter * diameter;
        const jy = (hash01(stroke.index, n * 2 + 1) - 0.5) * 2 * DOTS.jitter * diameter;
        const x = p.x + p.dy * across + jx, y = p.y - p.dx * across + jy;
        if (hash01(stroke.index + 7919, n) < 0.3) { light.push(x, y); continue; }
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    if (light.length) {
      ctx.fillStyle = css(shade(stroke.color, 1.14));
      ctx.beginPath();
      for (let i = 0; i < light.length; i += 2) {
        ctx.moveTo(light[i] + radius, light[i + 1]);
        ctx.arc(light[i], light[i + 1], radius, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  },
};
