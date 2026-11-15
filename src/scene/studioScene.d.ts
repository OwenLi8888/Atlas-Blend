/** One painter as the studio scene draws it. Paths are relative to `base`. */
export interface CastMember {
  id: string;
  /** Paint colour: tints its puddle and the wet edge while it is being painted on. */
  color: string;
  /** Painted sprite, transparent background. */
  src: string;
  /** The same sprite with closed eyes, for blinking. */
  blink?: string;
  /** How much the little hands wave, 0..1. */
  arms?: number;
}

export interface StudioScene {
  /** Highlight a painter (glow, a hop), or none. */
  select(id: string | null): void;
  /** Width in px of a UI column over the left of the canvas; wide screens shift the picture right of it. */
  setPanel(px: number): void;
  /** Play the arrival animation again. */
  replay(): void;
  dispose(): void;
}

export function createStudioScene(
  canvas: HTMLCanvasElement,
  options: { base: string; cast: CastMember[]; onPick?: (id: string) => void; reducedMotion?: boolean },
): StudioScene;
