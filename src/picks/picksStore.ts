/**
 * Where photo picks are saved and read. This is the only file that knows how: today it is the
 * /api/picks endpoint in server/picksApi.mjs (a JSON file), with a copy on the device. To move to
 * Supabase or another API, rewrite the three functions below and nothing else changes.
 *
 * For the recommendation step:
 *
 *   import { getSessionPicks } from './picks/picksStore';
 *   const records = await getSessionPicks(session.sessionId);   // both users once both have picked
 */
import { deviceStore, type Session, type UserNumber } from './session';

/** One record per user per session. `picks` is in the order the user selected them. */
export interface PicksRecord {
  sessionId: string;
  user: UserNumber;
  characterId: string;
  /** The 25 photo ids this user was shown. */
  shown: string[];
  /** The 5 photo ids they picked, first pick first. */
  picks: string[];
  /** ISO timestamp. */
  pickedAt: string;
  /** The player's name, as typed on page 1. */
  name?: string;
  /** Their profile in the Gallery API (server/), when it was reachable: lets the other device blend with them. */
  profileId?: string;
  blendCode?: string;
}

const API = 'api/picks';

async function request<T>(query: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + query, { cache: 'no-store', ...init });
  if (!res.ok) throw new Error(`${API}: ${res.status}`);
  return (await res.json()) as T;
}

function deviceCopy(session: Session): PicksRecord | null {
  try {
    return JSON.parse(deviceStore.get(session, 'picks') ?? 'null') as PicksRecord | null;
  } catch {
    return null;
  }
}

/** This user's saved picks as this device remembers them, without asking the server: for coming back after a refresh. */
export function recallPicks(session: Session): PicksRecord | null {
  const record = deviceCopy(session);
  return record && Array.isArray(record.picks) && Array.isArray(record.shown) ? record : null;
}

/**
 * Saves a user's picks, replacing any earlier record for that user in that session.
 * Resolves to 'server' when the shared store has it, or 'device' when the server could not be
 * reached and the record is only on this device (the other user's device will not see it).
 */
export async function savePicks(record: PicksRecord): Promise<'server' | 'device'> {
  deviceStore.set(record, 'picks', JSON.stringify(record));
  try {
    await request<PicksRecord>('', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) });
    return 'server';
  } catch (err) {
    console.warn('Picks were saved on this device only:', err);
    return 'device';
  }
}

/** One user's saved picks, or null when they have not finished picking. */
export async function getPicks(sessionId: string, user: UserNumber): Promise<PicksRecord | null> {
  try {
    return await request<PicksRecord | null>(`?session=${encodeURIComponent(sessionId)}&user=${user}`);
  } catch {
    return deviceCopy({ sessionId, user });
  }
}

/** Both users' records for a session, user 1 first. Shorter than 2 while someone is still picking. */
export async function getSessionPicks(sessionId: string): Promise<PicksRecord[]> {
  try {
    return await request<PicksRecord[]>(`?session=${encodeURIComponent(sessionId)}`);
  } catch {
    const users: UserNumber[] = [1, 2];
    return users.map((user) => deviceCopy({ sessionId, user })).filter((r): r is PicksRecord => r !== null);
  }
}

// ---- Picks in progress: kept on the device so a refresh does not lose them ----

export function loadDraft(session: Session, shown: string[]): string[] {
  try {
    const ids: unknown = JSON.parse(deviceStore.get(session, 'draft') ?? '[]');
    if (!Array.isArray(ids)) return [];
    return [...new Set(ids.filter((id): id is string => typeof id === 'string' && shown.includes(id)))];
  } catch {
    return [];
  }
}

export function saveDraft(session: Session, picks: string[]): void {
  deviceStore.set(session, 'draft', JSON.stringify(picks));
}
