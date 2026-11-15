/** Shared between the hand-off on the painting page and the gallery room: the painting's flight. */

/** The finished painting lifts off its canvas before it flies. */
export const LIFT_MS = 420;
/** From the painting page into the gallery's frame. */
export const FLIGHT_MS = 900;
/** view-transition-name of the painting on both pages, so the browser flies it from one to the other. */
export const HUNG_NAME = 'hung-painting';
/** Set on <html> while the hand-off's view transition runs (its timing is in Gallery.css). */
export const HANGING_CLASS = 'hanging';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
