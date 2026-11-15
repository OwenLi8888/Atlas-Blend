import type { SKRSContext2D } from "@napi-rs/canvas";

/** The 2D context the renderers draw on: @napi-rs/canvas in Node (same API as the browser's). */
export type Ctx2D = SKRSContext2D;
import type { ImpastoStroke } from "../vendor/impasto/snapshot.ts";
import type { StrokeSpace } from "./strokeGeometry.ts";

/** What a renderer knows about the layer it is drawing on. */
export interface RenderFrame {
  /** Preview layer size in pixels (the loop's bounding box at image resolution). */
  width: number;
  height: number;
  /** Maps the plan's millimetres to preview pixels. */
  space: StrokeSpace;
  /** Longer side of the whole photo in pixels, for sizes that should read the same on any region. */
  imageSide: number;
  /** Number of layers in the plan (ImpastoStroke.layer runs from 0 to layers - 1). */
  layers: number;
}

/**
 * One painting tradition's way of drawing the shared stroke plan (F8). All three renderers get
 * exactly the same ImpastoStrokes in the same order from the stroke player; only the marks differ.
 * The context arrives clipped to the loop, with its origin at the preview layer's top-left.
 * Renderers must leave the context's state as they found it.
 */
export interface StrokeRenderer {
  /** Lays the ground before the first stroke (paper, a dark field), if the tradition has one. */
  begin(ctx: Ctx2D, frame: RenderFrame): void;
  /** Draws one planned stroke. */
  stroke(ctx: Ctx2D, stroke: ImpastoStroke, frame: RenderFrame): void;
}
