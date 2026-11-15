/**
 * A database that lives in memory. Used by the tests and by `npm run dev:local`,
 * so the screens can be built and demoed without Supabase. Everything is lost
 * when the server stops.
 */
import { randomUUID } from 'node:crypto';
import type { Heart, Profile } from '../src/rec/api';
import { generateBlendCode, type Db, type NewBlend } from './db';
import { ApiError } from './errors';

export interface MemoryDb extends Db {
  readonly blends: (NewBlend & { id: string })[];
}

export function createMemoryDb(): MemoryDb {
  const profiles = new Map<string, Profile>();
  const hearts = new Map<string, Heart[]>();
  const blends: (NewBlend & { id: string })[] = [];
  let clock = 0;
  const timestamp = () => new Date(Date.UTC(2026, 0, 1) + clock++ * 1000).toISOString();

  return {
    blends,
    async createProfile(name, code) {
      if (code !== undefined && [...profiles.values()].some(profile => profile.blend_code === code)) {
        throw new ApiError(409, 'That blend code is already taken');
      }
      const profile: Profile = { id: randomUUID(), name, blend_code: code ?? generateBlendCode(), created_at: timestamp() };
      profiles.set(profile.id, profile);
      hearts.set(profile.id, []);
      return profile;
    },
    async findProfile(id) {
      return profiles.get(id) ?? null;
    },
    async findProfileByCode(code) {
      return [...profiles.values()].find(profile => profile.blend_code === code) ?? null;
    },
    async deleteProfile(id) {
      profiles.delete(id);
      hearts.delete(id);
    },
    async listHearts(userId, limit) {
      const list = hearts.get(userId) ?? [];
      return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
    },
    async saveHeart(userId, artId, why) {
      const list = hearts.get(userId);
      if (!list) throw new ApiError(404, 'Profile not found');
      const existing = list.find(heart => heart.art_id === artId);
      if (existing) {
        if (why !== undefined) existing.why = why;
        return existing;
      }
      const heart: Heart = { art_id: artId, why: why ?? null, created_at: timestamp() };
      list.push(heart);
      return heart;
    },
    async removeHeart(userId, artId) {
      const list = hearts.get(userId) ?? [];
      hearts.set(userId, list.filter(heart => heart.art_id !== artId));
    },
    async saveBlend(blend) {
      const saved = { ...blend, id: randomUUID() };
      blends.push(saved);
      return { id: saved.id, created_at: timestamp() };
    },
  };
}
