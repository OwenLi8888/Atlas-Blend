/**
 * A database that lives in memory, optionally saved to one JSON file. Used by
 * the tests (memory only) and by `npm run dev:local` (with a file), so the
 * gallery can be built and demoed without Supabase and still keeps its
 * profiles, hearts and blends when the server restarts.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Heart, Profile } from '../src/rec/api';
import { generateBlendCode, type BlendRecord, type Db, type NewBlend } from './db';
import { ApiError } from './errors';

type StoredBlendRow = NewBlend & { id: string; created_at: string };

export interface MemoryDb extends Db {
  readonly blends: readonly StoredBlendRow[];
}

interface Snapshot {
  profiles: Profile[];
  hearts: Record<string, Heart[]>;
  blends: StoredBlendRow[];
}

export interface MemoryDbOptions {
  /** Where to keep the data between restarts. Without it nothing is saved. */
  file?: string;
}

export function createMemoryDb(options: MemoryDbOptions = {}): MemoryDb {
  const { file } = options;
  const saved = file ? readSnapshot(file) : null;
  const profiles = new Map<string, Profile>((saved?.profiles ?? []).map(profile => [profile.id, profile]));
  const hearts = new Map<string, Heart[]>(Object.entries(saved?.hearts ?? {}));
  const blends: StoredBlendRow[] = saved?.blends ?? [];

  // Timestamps always move forward, so "newest first" is well defined even within one millisecond.
  let lastTime = 0;
  const timestamp = () => {
    lastTime = Math.max(Date.now(), lastTime + 1);
    return new Date(lastTime).toISOString();
  };

  const persist = () => {
    if (!file) return;
    const snapshot: Snapshot = { profiles: [...profiles.values()], hearts: Object.fromEntries(hearts), blends };
    mkdirSync(path.dirname(file), { recursive: true });
    // Written to a temporary name first, so a crash mid-write never leaves half a file.
    writeFileSync(file + '.tmp', JSON.stringify(snapshot));
    renameSync(file + '.tmp', file);
  };

  const toRecord = (blend: StoredBlendRow): BlendRecord => ({
    id: blend.id,
    created_at: blend.created_at,
    userA: blend.userA,
    userB: blend.userB,
    result: blend.result,
  });

  return {
    blends,
    async createProfile(name, code) {
      if (code !== undefined && [...profiles.values()].some(profile => profile.blend_code === code)) {
        throw new ApiError(409, 'That blend code is already taken');
      }
      const profile: Profile = { id: randomUUID(), name, blend_code: code ?? generateBlendCode(), created_at: timestamp() };
      profiles.set(profile.id, profile);
      hearts.set(profile.id, []);
      persist();
      return profile;
    },
    async findProfile(id) {
      return profiles.get(id) ?? null;
    },
    async findProfiles(ids) {
      return ids.flatMap(id => { const profile = profiles.get(id); return profile ? [profile] : []; });
    },
    async findProfileByCode(code) {
      return [...profiles.values()].find(profile => profile.blend_code === code) ?? null;
    },
    async deleteProfile(id) {
      profiles.delete(id);
      hearts.delete(id);
      for (let i = blends.length - 1; i >= 0; i--) {
        if (blends[i].userA === id || blends[i].userB === id) blends.splice(i, 1);
      }
      persist();
    },
    async listHearts(userId, limit) {
      const list = hearts.get(userId) ?? [];
      return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
    },
    async saveHeart(userId, artId, why) {
      const list = hearts.get(userId);
      if (!list) throw new ApiError(404, 'Profile not found');
      let heart = list.find(existing => existing.art_id === artId);
      if (heart) {
        if (why !== undefined) heart.why = why;
      } else {
        heart = { art_id: artId, why: why ?? null, created_at: timestamp() };
        list.push(heart);
      }
      persist();
      return heart;
    },
    async removeHeart(userId, artId) {
      const list = hearts.get(userId) ?? [];
      hearts.set(userId, list.filter(heart => heart.art_id !== artId));
      persist();
    },
    async saveBlend(blend) {
      const row: StoredBlendRow = { ...blend, id: randomUUID(), created_at: timestamp() };
      blends.push(row);
      persist();
      return { id: row.id, created_at: row.created_at };
    },
    async findBlend(id) {
      const blend = blends.find(row => row.id === id);
      return blend ? toRecord(blend) : null;
    },
    async listBlends(userId, limit) {
      return blends
        .filter(blend => blend.userA === userId || blend.userB === userId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map(toRecord);
    },
  };
}

/** The saved data, or null when there is none yet or the file cannot be read. */
function readSnapshot(file: string): Snapshot | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { profiles, hearts, blends } = parsed as Partial<Snapshot>;
    if (!Array.isArray(profiles) || typeof hearts !== 'object' || hearts === null || !Array.isArray(blends)) return null;
    return { profiles, hearts, blends };
  } catch {
    // No file yet, or an unreadable one: start empty.
    return null;
  }
}
