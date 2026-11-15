/** One painter as the studio scene draws it. Paths are relative to `base`. */
export interface CastMember {
  id: string;
  /** Paint colour: tints its puddle, its brush and the wet edge while it is being painted on. */
  color: string;
  /** Painted sprite, transparent background. */
  src: string;
  /** The same sprite with closed eyes, for blinking. */
  blink?: string;
  /** How much the little hands wave, 0..1. */
  arms?: number;
}

/** One canvas to paint in paint mode: a 2D canvas the screen draws on, shown on an easel. */
export interface Work {
  canvas: HTMLCanvasElement;
  /** Width / height of the picture, if known yet. `setAspect` can set it later. */
  aspect?: number;
}

/** A rectangle on screen, in CSS pixels. */
export interface CanvasBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface StudioScene {
  /** Highlight a painter (glow, a hop), or none. Pick mode. */
  select(id: string | null): void;
  /** Width in px of a UI column over the left of the canvas; wide screens shift the picture right of it. */
  setPanel(px: number): void;
  /** Play the arrival animation again. Pick mode. */
  replay(): void;
  /** Where the stroke is on the canvas being painted, 0..1 from its top-left corner. Paint mode. */
  setBrush(u: number, v: number): void;
  /** The canvas being painted is finished: the painter moves on. Paint mode. */
  workDone(): void;
  /** Reshape canvas `index` for a picture of this aspect (width / height). Paint mode. */
  setAspect(index: number, aspect: number): void;
  /** Bring the camera in on canvas `index` to look at it, or null to step back. Paint mode. */
  view(index: number | null): void;
  /** Where canvas `index` is on screen as last drawn, in CSS pixels from the scene's top-left corner. Null before the scene is ready. */
  box(index: number): CanvasBox | null;
  /** Stop drawing while something covers the scene (the gallery), and start again after. */
  pause(on: boolean): void;
  dispose(): void;
}

export interface StudioSceneOptions {
  base: string;
  cast: CastMember[];
  reducedMotion?: boolean;
  /**
   * 'pick' (default): the room arrives and a painter is chosen.
   * 'paint': the same room with the cast on the floor; they paint `works` (up to three) in turn.
   */
  mode?: 'pick' | 'paint';
  onPick?: (id: string) => void;
  /** Paint mode: who paints when `painters` does not say. */
  painterId?: string | null;
  /** Paint mode: who paints each canvas of `sequence`, by cast ID, in the same order. The brush is tossed between them. */
  painters?: string[];
  /** One per easel, left to right. */
  works?: Work[];
  /** The order the easels are painted in, as indexes into `works`. Default: left to right. */
  sequence?: number[];
  /** The painter stands at canvas `index` with its brush up: start drawing on `works[index].canvas`. */
  onReady?: (index: number) => void;
  onAllDone?: () => void;
  /** A canvas was tapped. */
  onCanvas?: (index: number) => void;
}

export function createStudioScene(canvas: HTMLCanvasElement, options: StudioSceneOptions): StudioScene;
