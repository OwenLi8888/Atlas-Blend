/**
 * The painters from the studio flow (src/characters.tsx on main): the same six
 * characters, colours and artwork (public/studio/). Each person has one, kept
 * on their profile. Until they choose, it is picked for them and stays the same.
 */
import type { Friend, PainterId, Profile } from '../rec/api';

export interface Painter {
  id: PainterId;
  name: string;
  /** Its paint colour: the puddle it stands on. */
  color: string;
  /** The name of its artwork files in public/studio/, when that is not its ID. */
  art?: string;
}

/** A person's painter and what they call it. */
export interface NamedPainter {
  painter: Painter;
  name: string;
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

/** The most the server keeps of a painter's name. */
export const MAX_PAINTER_NAME_LENGTH = 16;

const artOf = (painter: Painter) => './studio/' + (painter.art ?? painter.id);
export const painterImage = (painter: Painter) => artOf(painter) + '.webp';
export const painterBlinkImage = (painter: Painter) => artOf(painter) + '-blink.webp';

/** The painter someone has before they choose one: always the same for the same seed. */
export function defaultPainter(seed: string): Painter {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PAINTERS[hash % PAINTERS.length];
}

/** A person's own painter: the one on their profile, or the one their profile's ID picks. */
export function painterOf(profile: Pick<Profile, 'id' | 'painter'>): NamedPainter {
  const painter = PAINTERS.find(candidate => candidate.id === profile.painter?.id) ?? defaultPainter(profile.id);
  return { painter, name: profile.painter?.name.trim() || painter.name };
}

/**
 * A friend's painter as it stands in the visitor's room: the one the friend
 * chose, or one picked from their name. The room needs two different painters,
 * so a friend with the visitor's own is shown as the next one along.
 */
export function friendPainter(friend: Friend, mine: Painter): NamedPainter {
  const theirs = PAINTERS.find(candidate => candidate.id === friend.painter?.id) ?? defaultPainter(friend.name);
  const painter = theirs.id === mine.id ? PAINTERS[(PAINTERS.indexOf(theirs) + 1) % PAINTERS.length] : theirs;
  return { painter, name: friend.painter?.name.trim() || painter.name };
}
