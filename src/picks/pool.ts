import { hashString, mulberry32 } from '../engine/rng';
import type { Session } from './session';

/** An entry of public/pool/pool.json (written by scripts/build-pool.mjs). */
export interface PoolPhoto {
  id: string;
  /** Full-size photo and thumbnail, relative to public/pool/. */
  file: string;
  thumb: string;
  width: number;
  height: number;
  title?: string;
  artist?: string;
  year?: string;
  /** The atlas id of the artwork, e.g. "smk:KMS4209". */
  artId?: string;
}

/** Photos each user is shown, and how many they pick. */
export const SHOWN = 25;
export const PICKS = 5;

let pool: Promise<PoolPhoto[]> | null = null;

export function loadPool(): Promise<PoolPhoto[]> {
  pool ??= fetch('pool/pool.json')
    .then((res) => {
      if (!res.ok) throw new Error(`pool.json: ${res.status}`);
      return res.json() as Promise<PoolPhoto[]>;
    })
    .catch((err) => {
      pool = null; // let the next call try again
      throw err;
    });
  return pool;
}

export const photoUrl = (path: string) => `pool/${path}`;

/**
 * The 25 photo ids this user sees. The whole pool is shuffled with the session id as the seed, then
 * user 1 takes items 0 to 24 and user 2 takes items 25 to 49: both devices work this out on their
 * own, always get the same answer, and never share a photo.
 */
export function shownIds(allIds: string[], session: Session): string[] {
  const ids = [...allIds].sort();
  const random = mulberry32(hashString(`atlas-picks:${session.sessionId}`));
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const start = (session.user - 1) * SHOWN;
  return ids.slice(start, start + SHOWN);
}
