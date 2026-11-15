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
  /**
   * True for a style that keeps its own picture (Mosaic's shards). The player then always hands
   * draw() the committed canvas, strokes in progress included, and draw() adds only what is new
   * since its last call for that stroke. The result must not depend on the order of the calls.
   */
  incremental?: boolean;
  /** The canvas was just cleared to `ground` at this size in device pixels: forget everything drawn. */
  begin?(widthPx: number, heightPx: number): void;
  /** Every stroke is down: one last pass over the committed canvas. */
  finish?(ctx: CanvasRenderingContext2D): void;
}
