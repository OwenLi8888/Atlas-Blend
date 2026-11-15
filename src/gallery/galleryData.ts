/**
 * Everything the gallery room reads: the painting the two users made, the two painters, and the
 * sample paintings that fill the rest of the ring. The room only talks to this file.
 */
import { characters, type Character } from '../characters';
import { getSessionPicks } from '../picks/picksStore';
import { deviceStore, type Session } from '../picks/session';

export interface FinalPainting {
  imageUrl: string;
  title?: string;
  /** The look it was painted in, e.g. "Swirl". */
  style: string;
  /** ISO timestamp. */
  createdAt: string;
}

/** An entry of public/gallery/samples/samples.json. */
export interface SamplePainting {
  id: string;
  /** File name inside public/gallery/samples/. */
  file: string;
  title: string;
  style: string;
  credit: string;
}

const PLACEHOLDER = './gallery/placeholder.jpg';
const finalKey = (sessionId: string) => `atlas:final:${sessionId}`;

/**
 * Keeps the painting this device just finished, so the gallery can hang it (and still has it after
 * a refresh). Called by the hand-off from the painting page. Storage that is full or blocked is
 * ignored: the gallery then shows the placeholder.
 */
export function rememberFinalPainting(sessionId: string, painting: FinalPainting): void {
  try {
    window.localStorage.setItem(finalKey(sessionId), JSON.stringify(painting));
  } catch {
    // Nothing to do.
  }
}

/**
 * The painting the two users made together. The one place the gallery gets it from.
 *
 * TODO(painting page): return the session's shared final painting here once it is saved somewhere
 * both devices can read. Until then this is what THIS device's painter finished (kept by
 * rememberFinalPainting), or the placeholder image when there is none, e.g. on a direct link.
 */
export async function getFinalPainting(sessionId: string): Promise<FinalPainting> {
  try {
    const kept = JSON.parse(window.localStorage.getItem(finalKey(sessionId)) ?? 'null') as FinalPainting | null;
    if (kept && typeof kept.imageUrl === 'string' && kept.imageUrl) return kept;
  } catch {
    // Fall through to the placeholder.
  }
  return { imageUrl: PLACEHOLDER, title: 'Our Painting', style: 'Swirl', createdAt: new Date().toISOString() };
}

export const sampleUrl = (file: string) => `./gallery/samples/${file}`;

/**
 * The sample paintings, in the order of samples.json. Nothing in the app saves finished paintings
 * from earlier sessions yet; when something does, put the most recent ones first here and let the
 * samples fill the rest of the ring.
 */
export async function loadSamples(): Promise<SamplePainting[]> {
  try {
    const res = await fetch('./gallery/samples/samples.json');
    if (!res.ok) return [];
    const list: unknown = await res.json();
    if (!Array.isArray(list)) return [];
    return list.filter((s): s is SamplePainting => !!s && typeof s.file === 'string' && typeof s.title === 'string');
  } catch {
    return [];
  }
}

/** The two painters of a session: user 1's first, user 2's second. */
export type Duo = [Character, Character];

const byId = (id: string | null | undefined) => characters.find((c) => c.id === id);

/**
 * Both users' characters. This user's comes from the device (page 1); the partner's from their
 * saved picks record. When the partner's is not known (they have not picked yet, or there is no
 * picks server), the next painter of the cast stands in so the two are never the same.
 */
export async function getDuo(session: Session, ownId: string | null): Promise<Duo> {
  const mine = byId(ownId) ?? characters[0];
  let theirs: Character | undefined;
  try {
    const records = await getSessionPicks(session.sessionId);
    theirs = byId(records.find((r) => r.user !== session.user)?.characterId);
  } catch {
    // Not known: stand-in below.
  }
  theirs ??= characters[(characters.indexOf(mine) + 1) % characters.length];
  return session.user === 1 ? [mine, theirs] : [theirs, mine];
}

// ---- Coming back to the gallery after a refresh ----

/** Whether this user was in the gallery, so a refresh returns there instead of page 1. */
export const wasInGallery = (session: Session) =>
  deviceStore.get(session, 'screen') === 'gallery' || new URL(window.location.href).searchParams.get('view') === 'gallery';
export const setInGallery = (session: Session, on: boolean) => {
  if (on) deviceStore.set(session, 'screen', 'gallery');
  else if (deviceStore.get(session, 'screen') === 'gallery') deviceStore.set(session, 'screen', null);
};
