/**
 * The two-device session. Both devices open the same link with a different `user`:
 *
 *   …/?session=abc123&user=1      and      …/?session=abc123&user=2
 *
 * A visit without `session` gets a new one written into the address bar, as user 1; send that link
 * with `user=2` to the second device. Nothing here talks to a server.
 */

export type UserNumber = 1 | 2;

export interface Session {
  sessionId: string;
  user: UserNumber;
}

const SESSION = /^[A-Za-z0-9_-]{1,64}$/;

function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
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

/** The character this user chose on page 1, kept so a refresh on page 2 still knows it. */
export const recallCharacter = (session: Session) => deviceStore.get(session, 'character');
export const rememberCharacter = (session: Session, characterId: string) => deviceStore.set(session, 'character', characterId);

/** Whether this user was on the photo-picks screen, so a refresh returns there instead of page 1. */
export const wasPicking = (session: Session) => deviceStore.get(session, 'screen') === 'picks';
export const setPicking = (session: Session, on: boolean) => deviceStore.set(session, 'screen', on ? 'picks' : null);
