/**
 * The painters from the studio flow (src/characters.tsx on main): the same six
 * characters, colours and artwork (public/studio/). Each person has one. Until
 * they choose, it is picked for them and stays the same.
 */
export interface Painter {
  id: string;
  name: string;
  /** Its paint colour: the puddle it stands on. */
  color: string;
  /** The name of its artwork files in public/studio/, when that is not its ID. */
  art?: string;
}

export const PAINTERS: readonly Painter[] = [
  { id: 'ember', name: 'Ember', color: '#EF5A26' },
  { id: 'sunny', name: 'Sunny', color: '#FFC62E' },
  { id: 'pop', name: 'Pop', color: '#E2337F' },
  { id: 'dot', name: 'Dot', color: '#2F55D8' },
  { id: 'hue', name: 'Hue', color: '#1F9E6E' },
  // Ivory's own artwork, with the heavy paint ridges under the mouth smoothed; the studio's file is untouched.
  { id: 'ivory', name: 'Ivory', color: '#EFE8DA', art: 'ivory-soft' },
];

export const MAX_PAINTER_NAME_LENGTH = 16;

/** A visitor's own choice of painter. */
export interface PainterChoice {
  painterId: string;
  /** What the visitor calls their painter; empty to use the painter's own name. */
  name: string;
}

/** Where the choice is kept: a preference of this visitor's on this device. */
const STORAGE_KEY = 'gallery-blend.painter';

const artOf = (painter: Painter) => './studio/' + (painter.art ?? painter.id);
export const painterImage = (painter: Painter) => artOf(painter) + '.webp';
export const painterBlinkImage = (painter: Painter) => artOf(painter) + '-blink.webp';

/** The painter someone has before they choose one: always the same for the same person. */
export function defaultPainter(seed: string): Painter {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PAINTERS[hash % PAINTERS.length];
}

export function savedPainterChoice(): PainterChoice | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { painterId, name } = parsed as Partial<PainterChoice>;
    if (typeof painterId !== 'string' || !PAINTERS.some(painter => painter.id === painterId)) return null;
    return { painterId, name: typeof name === 'string' ? name.slice(0, MAX_PAINTER_NAME_LENGTH) : '' };
  } catch {
    // Storage is blocked or holds something else: the default painter is used.
    return null;
  }
}

export function savePainterChoice(choice: PainterChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Without storage the choice lasts for this visit only.
  }
}

/** This visitor's painter and what they call it. */
export function myPainter(seed: string): { painter: Painter; name: string } {
  const choice = savedPainterChoice();
  const painter = PAINTERS.find(candidate => candidate.id === choice?.painterId) ?? defaultPainter(seed);
  return { painter, name: choice?.name.trim() || painter.name };
}

/** A friend's painter: never the same one as the visitor's. */
export function friendPainter(seed: string, mine: Painter): Painter {
  const painter = defaultPainter(seed);
  return painter.id === mine.id ? PAINTERS[(PAINTERS.indexOf(painter) + 1) % PAINTERS.length] : painter;
}
