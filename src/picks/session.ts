/**
 * The two-device session: a room. Both devices open the same plain address. Each gets a room of its
 * own with a four-digit code, as player 1; typing a friend's code on page 1 moves the device into
 * that room as player 2 (`joinRoom`). The room is kept in the address bar, so a refresh stays in it:
 *
 *   …/?session=4821&user=1      and      …/?session=4821&user=2
 *
 * Nothing here talks to a server, and a code is not a secret: anyone who types it is in the room.
 */

export type UserNumber = 1 | 2;

export interface Session {
  sessionId: string;
  user: UserNumber;
}

const SESSION = /^[A-Za-z0-9_-]{1,64}$/;

/** What a room code looks like: four digits, easy to say and to type on a phone. */
export const ROOM_CODE = /^\d{4}$/;

function newSessionId(): string {
  return String(1000 + (crypto.getRandomValues(new Uint16Array(1))[0] % 9000));
}

/** Reads the session from the URL, creating one (and putting it in the URL) when there is none. */
export function getSession(): Session {
  const url = new URL(window.location.href);
  const given = url.searchParams.get('session') ?? '';
  const sessionId = SESSION.test(given) ? given : newSessionId();
  const user: UserNumber = url.searchParams.get('user') === '2' ? 2 : 1;
  if (given !== sessionId || url.searchParams.get('user') !== String(user)) {
    url.searchParams.set('session', sessionId);
    url.searchParams.set('user', String(user));
    window.history.replaceState(window.history.state, '', url);
  }
  return { sessionId, user };
}

/** localStorage that never throws (private windows, blocked storage). Keys are per session and user. */
export const deviceStore = {
  get(session: Session, name: string): string | null {
    try {
      return window.localStorage.getItem(`atlas:${name}:${session.sessionId}:${session.user}`);
    } catch {
      return null;
    }
  },
  set(session: Session, name: string, value: string | null): void {
    try {
      const key = `atlas:${name}:${session.sessionId}:${session.user}`;
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      // Nothing to do: the page still works, it just forgets on refresh.
    }
  },
};

/** Moves this device into a friend's room as player 2, keeping the name and painter. Reloads the page. */
export function joinRoom(from: Session, code: string): void {
  const to: Session = { sessionId: code, user: 2 };
  for (const key of ['name', 'character']) {
    const value = deviceStore.get(from, key);
    if (value !== null) deviceStore.set(to, key, value);
  }
  const url = new URL(window.location.href);
  url.searchParams.set('session', code);
  url.searchParams.set('user', '2');
  window.location.assign(url);
}

/** Leaves a friend's room for a new room of this device's own, as player 1. Reloads the page. */
export function newRoom(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('session');
  url.searchParams.delete('user');
  window.location.assign(url);
}

/** The character this user chose on page 1, kept so a refresh on page 2 still knows it. */
export const recallCharacter = (session: Session) => deviceStore.get(session, 'character');
export const rememberCharacter = (session: Session, characterId: string) => deviceStore.set(session, 'character', characterId);

/** Whether this user was on the photo-picks screen, so a refresh returns there instead of page 1. */
export const wasPicking = (session: Session) => deviceStore.get(session, 'screen') === 'picks';
export const setPicking = (session: Session, on: boolean) => deviceStore.set(session, 'screen', on ? 'picks' : null);

/** Whether this user was in the studio, so a refresh returns there (with their saved picks) instead of page 1. */
export const wasPainting = (session: Session) => deviceStore.get(session, 'screen') === 'studio';
export const setPainting = (session: Session, on: boolean) => {
  if (on) deviceStore.set(session, 'screen', 'studio');
  else if (deviceStore.get(session, 'screen') === 'studio') deviceStore.set(session, 'screen', null);
};

/**
 * The player's name. Kept for the room (so a refresh has it) and for the device (so the next room,
 * after Play again or Leave room, starts with it filled in).
 */
const DEVICE_NAME = 'atlas:name';
export function recallName(session: Session): string {
  const here = deviceStore.get(session, 'name');
  if (here !== null) return here;
  try {
    return window.localStorage.getItem(DEVICE_NAME) ?? '';
  } catch {
    return '';
  }
}
export function rememberName(session: Session, name: string): void {
  deviceStore.set(session, 'name', name || null);
  try {
    if (name) window.localStorage.setItem(DEVICE_NAME, name);
  } catch {
    // Nothing to do: the next room asks for the name again.
  }
}
