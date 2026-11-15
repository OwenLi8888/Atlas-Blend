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
  /** Width / height of the picture. */
  aspect: number;
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
  dispose(): void;
}

export interface StudioSceneOptions {
  base: string;
  cast: CastMember[];
  reducedMotion?: boolean;
  /**
   * 'pick' (default): the room arrives and a painter is chosen.
   * 'paint': the same room; `painterId` takes a brush and paints `works` (up to three) in turn.
   */
  mode?: 'pick' | 'paint';
  onPick?: (id: string) => void;
  painterId?: string | null;
  works?: Work[];
  /** The painter stands at canvas `index` with its brush up: start drawing on `works[index].canvas`. */
  onReady?: (index: number) => void;
  onAllDone?: () => void;
}

export function createStudioScene(canvas: HTMLCanvasElement, options: StudioSceneOptions): StudioScene;
