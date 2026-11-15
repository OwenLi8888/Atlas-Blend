/**
 * A style is one way of drawing the shared stroke list. The player owns timing; a style only
 * knows how to draw stroke `index` from its start up to progress `t`.
 */
export interface StyleRenderer {
  /** Colour the canvas starts as. */
  ground: string;
  /**
   * Draws stroke `index` up to progress t (0 to 1; 1 is the whole stroke). `ctx` is scaled so one
   * unit is 1 mm of canvas. `mmPerPx` is the size of a CSS pixel in mm, for hairline widths.
   * Must be deterministic: the same index and t always draw the same thing.
   */
  draw(ctx: CanvasRenderingContext2D, index: number, t: number, mmPerPx: number): void;
  /** Drawn over the whole canvas every frame, in device pixels (paper grain). */
  overlay?(ctx: CanvasRenderingContext2D, widthPx: number, heightPx: number): void;
}
