/**
 * Profiles, hearts and saved blends. `Db` is the contract the routes use;
 * `createSupabaseDb` is the real implementation. The server holds the secret
 * key and is the only thing that talks to Supabase (RLS is on with no policies).
 */
import { randomInt, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { ChosenPainter, Heart, PainterId, Profile, WallSource } from '../src/rec/api';
import { ApiError } from './errors';

/** One leaning as it is stored: artworks by ID, so a saved blend survives changes to the catalog. */
export interface StoredTrend {
  family: string;
  share: number;
  why: string | null;
  workIds: string[];
}

/**
 * Everything needed to show a blend again later, from the point of view of the
 * person who made it (A). Read back, it can be shown to either person.
 */
export interface StoredBlend {
  score: number;
  /** The collection work that best fits both people. */
  revealId: string;
  /** The shared wall in hanging order; `from` is relative to person A. */
  wall: { id: string; from: WallSource }[];
  trends: { a: StoredTrend[]; b: StoredTrend[] };
}

export interface NewBlend {
  userA: string;
  userB: string;
  topArtId: string;
  pickIds: string[];
  story: string;
  result: StoredBlend;
}

export interface BlendRecord {
  id: string;
  created_at: string;
  userA: string;
  userB: string;
  /** Null for blends saved before results were kept; those cannot be reopened. */
  result: StoredBlend | null;
}

export interface SavedBlend {
  id: string;
  created_at: string;
}

export interface NewProfile {
  name: string;
  /**
   * Chosen by whoever is signing up, so that asking again after a lost answer
   * finds the profile already made. Generated when left out.
   */
  id?: string;
  /** Fixes the blend code; otherwise a free one is generated. */
  code?: string;
  /** Works hearted from the start. */
  artIds?: readonly string[];
  /** The painter chosen at the entrance, if one was. */
  painterId?: PainterId;
}

export interface Db {
  /**
   * Creates a profile with its first hearts: either the profile exists with
   * all of them or it does not exist. When a profile with `id` already exists
   * it is returned as it is and nothing is changed.
   */
  createProfile(profile: NewProfile): Promise<Profile>;
  findProfile(id: string): Promise<Profile | null>;
  findProfiles(ids: readonly string[]): Promise<Profile[]>;
  findProfileByCode(code: string): Promise<Profile | null>;
  deleteProfile(id: string): Promise<void>;
  /** Keeps a person's choice of painter. Answers 404 when there is no such profile. */
  savePainter(userId: string, painter: ChosenPainter): Promise<void>;
  /** Newest first. */
  listHearts(userId: string, limit: number): Promise<Heart[]>;
  /** Saves a heart. When `why` is undefined an existing reason is kept. */
  saveHeart(userId: string, artId: string, why: string | undefined): Promise<Heart>;
  /** Hearts several works at once, all or none. A work already hearted keeps its reason and date. */
  saveHearts(userId: string, artIds: readonly string[]): Promise<void>;
  removeHeart(userId: string, artId: string): Promise<void>;
  saveBlend(blend: NewBlend): Promise<SavedBlend>;
  findBlend(id: string): Promise<BlendRecord | null>;
  /** Blends a person made or was blended into, newest first. */
  listBlends(userId: string, limit: number): Promise<BlendRecord[]>;
}

/** Mirrors supabase/schema.sql. */
interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: ProfileWrite;
        Update: ProfileWrite;
        Relationships: [];
      };
      hearts: {
        Row: { user_id: string; art_id: string; why: string | null; created_at: string | null };
        Insert: { user_id: string; art_id: string; why?: string | null; created_at?: string | null };
        Update: { user_id?: string; art_id?: string; why?: string | null; created_at?: string | null };
        Relationships: [];
      };
      blends: {
        Row: {
          id: string;
          user_a: string | null;
          user_b: string | null;
          top_art_id: string | null;
          picks: string[] | null;
          story: string | null;
          result: StoredBlend | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_a: string;
          user_b: string;
          top_art_id: string;
          picks: string[];
          story: string;
          result?: StoredBlend | null;
          created_at?: string | null;
        };
        Update: { story?: string | null };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      /** Mirrors supabase/migrations/003_profile_painter.sql. */
      create_profile: {
        Args: { p_id: string; p_name: string; p_blend_code: string; p_art_ids: string[]; p_painter_id: string | null };
        Returns: ProfileRow;
      };
    };
  };
}

/** The painter columns are absent from rows read before 003_profile_painter.sql has been run. */
type ProfileRow = {
  id: string;
  name: string | null;
  blend_code: string | null;
  created_at: string | null;
  painter_id?: string | null;
  painter_name?: string | null;
};
type ProfileWrite = {
  id?: string;
  name?: string | null;
  blend_code?: string | null;
  created_at?: string | null;
  painter_id?: string | null;
  painter_name?: string | null;
};
type HeartRow = Database['public']['Tables']['hearts']['Row'];
type BlendRow = Database['public']['Tables']['blends']['Row'];
type HeartInsert = Database['public']['Tables']['hearts']['Insert'];

const PROFILE_COLUMNS = 'id,name,blend_code,created_at,painter_id,painter_name';
/** What a profiles table has before 003_profile_painter.sql. */
const PROFILE_COLUMNS_WITHOUT_PAINTER = 'id,name,blend_code,created_at';
const HEART_COLUMNS = 'user_id,art_id,why,created_at';
const BLEND_COLUMNS = 'id,created_at,user_a,user_b,result';
const REQUEST_TIMEOUT_MS = 15_000;

export const BLEND_CODE_LENGTH = 6;
/** Letters only, without I and O, which are easy to misread when a code is shared aloud. */
const BLEND_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const BLEND_CODE_ATTEMPTS = 5;

const POSTGRES_UNIQUE_VIOLATION = '23505';
const POSTGRES_FOREIGN_KEY_VIOLATION = '23503';
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01']);
/** PostgREST and Postgres codes for a column the table does not have. */
const MISSING_COLUMN_CODES = new Set(['PGRST204', '42703']);
/** PostgREST and Postgres codes for a function the database does not have. */
const MISSING_FUNCTION_CODES = new Set(['PGRST202', '42883']);

const PAINTERS: Record<PainterId, true> = { ember: true, sunny: true, pop: true, dot: true, hue: true, ivory: true };
export const MAX_PAINTER_NAME_LENGTH = 16;

export function isPainterId(value: unknown): value is PainterId {
  return typeof value === 'string' && Object.hasOwn(PAINTERS, value);
}

export function generateBlendCode(): string {
  let code = '';
  for (let i = 0; i < BLEND_CODE_LENGTH; i++) code += BLEND_CODE_ALPHABET[randomInt(BLEND_CODE_ALPHABET.length)];
  return code;
}

export function createSupabaseDb(url: string, secretKey: string): Db {
  const client = createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
    },
  });

  type RestError = { message: string; code?: string };
  type InsertResult = { row: ProfileRow; error: null } | { row: null; error: RestError };
  /** False once the database is found not to have the current `create_profile`. */
  let hasCreateProfile = true;
  /** False once the profiles table is found not to have the painter columns. */
  let hasPainterColumns = true;

  /**
   * Runs a request that names the painter columns. Against a table that
   * predates them it runs once more without, and so does every request after.
   */
  async function withPainterColumns<Result extends { error: RestError | null }>(
    run: (columns: string, painter: boolean) => PromiseLike<Result>,
  ): Promise<Result> {
    if (!hasPainterColumns) return run(PROFILE_COLUMNS_WITHOUT_PAINTER, false);
    const result = await run(PROFILE_COLUMNS, true);
    if (!result.error?.code || !MISSING_COLUMN_CODES.has(result.error.code)) return result;
    hasPainterColumns = false;
    console.warn('profiles.painter_id is missing: run supabase/migrations/003_profile_painter.sql so painters are kept on the profile.');
    return run(PROFILE_COLUMNS_WITHOUT_PAINTER, false);
  }

  /** Saves a profile and its first hearts, all or nothing, or answers with what Postgres refused. */
  async function insertProfile(
    profile: { id: string; name: string; blend_code: string },
    artIds: readonly string[],
    painterId: PainterId | undefined,
  ): Promise<InsertResult> {
    if (hasCreateProfile) {
      const { data, error } = await client.rpc('create_profile', {
        p_id: profile.id,
        p_name: profile.name,
        p_blend_code: profile.blend_code,
        p_art_ids: [...artIds],
        p_painter_id: painterId ?? null,
      });
      if (!error) return { row: data, error: null };
      if (!error.code || !MISSING_FUNCTION_CODES.has(error.code)) return { row: null, error };
      hasCreateProfile = false;
      console.warn('create_profile is missing or out of date: run supabase/migrations/003_profile_painter.sql so signing up is one transaction.');
    }

    // Without the function there is no transaction across the two tables. The
    // hearts go in as one insert, and if it fails the profile is taken back.
    const made = await withPainterColumns((columns, painter) => {
      const row: ProfileWrite = painter && painterId ? { ...profile, painter_id: painterId } : profile;
      return client.from('profiles').insert(row).select(columns).single<ProfileRow>();
    });
    if (made.error) return { row: null, error: made.error };
    if (artIds.length > 0) {
      const hearts = await client.from('hearts').insert(artIds.map(artId => ({ user_id: profile.id, art_id: artId })));
      if (hearts.error) {
        const undo = await client.from('profiles').delete().eq('id', profile.id);
        if (undo.error) console.error('Could not remove half-made profile ' + profile.id + ': ' + undo.error.message);
        return { row: null, error: hearts.error };
      }
    }
    return { row: made.data, error: null };
  }

  return {
    async createProfile({ name, id = randomUUID(), code, artIds = [], painterId }) {
      const attempts = code === undefined ? BLEND_CODE_ATTEMPTS : 1;
      const hearted = [...new Set(artIds)];
      for (let attempt = 0; attempt < attempts; attempt++) {
        const { row, error } = await insertProfile({ id, name, blend_code: code ?? generateBlendCode() }, hearted, painterId);
        if (row) return toProfile(row);
        if (error.code !== POSTGRES_UNIQUE_VIOLATION) throw storageError(error);
        // Either the ID is taken, which means this sign-up already went through, or the blend code is.
        const existing = await this.findProfile(id);
        if (existing) return existing;
      }
      if (code !== undefined) throw new ApiError(409, 'That blend code is already taken');
      throw new ApiError(503, 'Could not create a blend code. Please try again.');
    },

    async findProfile(id) {
      const { data, error } = await withPainterColumns(columns =>
        client.from('profiles').select(columns).eq('id', id).maybeSingle<ProfileRow>(),
      );
      if (error) throw storageError(error);
      return data ? toProfile(data) : null;
    },

    async findProfiles(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await withPainterColumns(columns =>
        client.from('profiles').select(columns).in('id', [...ids]).overrideTypes<ProfileRow[], { merge: false }>(),
      );
      if (error) throw storageError(error);
      return data.map(toProfile);
    },

    async findProfileByCode(code) {
      const { data, error } = await withPainterColumns(columns =>
        client.from('profiles').select(columns).eq('blend_code', code).maybeSingle<ProfileRow>(),
      );
      if (error) throw storageError(error);
      return data ? toProfile(data) : null;
    },

    async savePainter(userId, painter) {
      const { data, error } = await client
        .from('profiles')
        .update({ painter_id: painter.id, painter_name: painter.name })
        .eq('id', userId)
        .select('id');
      if (error?.code && MISSING_COLUMN_CODES.has(error.code)) {
        console.warn('profiles.painter_id is missing: run supabase/migrations/003_profile_painter.sql so painters are kept on the profile.');
        throw new ApiError(503, 'Painters cannot be saved yet. Run supabase/migrations/003_profile_painter.sql first.');
      }
      if (error) throw storageError(error);
      if (data.length === 0) throw new ApiError(404, 'Profile not found');
    },

    async deleteProfile(id) {
      const { error } = await client.from('profiles').delete().eq('id', id);
      if (error) throw storageError(error);
    },

    async listHearts(userId, limit) {
      const { data, error } = await client
        .from('hearts')
        .select(HEART_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw storageError(error);
      return data.map(toHeart);
    },

    async saveHeart(userId, artId, why) {
      // Leaving `why` out of the row keeps the stored reason when the heart already exists.
      const row: HeartInsert = { user_id: userId, art_id: artId };
      if (why !== undefined) row.why = why;
      const { data, error } = await client
        .from('hearts')
        .upsert(row, { onConflict: 'user_id,art_id' })
        .select(HEART_COLUMNS)
        .single();
      if (error?.code === POSTGRES_FOREIGN_KEY_VIOLATION) throw new ApiError(404, 'Profile not found');
      if (error) throw storageError(error);
      return toHeart(data);
    },

    async saveHearts(userId, artIds) {
      if (artIds.length === 0) return;
      const { error } = await client
        .from('hearts')
        .upsert(artIds.map(artId => ({ user_id: userId, art_id: artId })), { onConflict: 'user_id,art_id', ignoreDuplicates: true });
      if (error?.code === POSTGRES_FOREIGN_KEY_VIOLATION) throw new ApiError(404, 'Profile not found');
      if (error) throw storageError(error);
    },

    async removeHeart(userId, artId) {
      const { error } = await client.from('hearts').delete().eq('user_id', userId).eq('art_id', artId);
      if (error) throw storageError(error);
    },

    async saveBlend(blend) {
      const row = {
        user_a: blend.userA,
        user_b: blend.userB,
        top_art_id: blend.topArtId,
        picks: blend.pickIds,
        story: blend.story,
      };
      let { data, error } = await client.from('blends').insert({ ...row, result: blend.result }).select('id,created_at').single();
      if (error?.code && MISSING_COLUMN_CODES.has(error.code)) {
        // The blends table predates the `result` column. The blend still works now; it just cannot be reopened later.
        console.warn('blends.result is missing: run supabase/migrations/001_blend_result.sql so blends can be reopened.');
        ({ data, error } = await client.from('blends').insert(row).select('id,created_at').single());
      }
      if (error?.code === POSTGRES_FOREIGN_KEY_VIOLATION) throw new ApiError(404, 'Profile not found');
      if (error || !data) throw storageError(error ?? { message: 'Blend was not saved' });
      return { id: data.id, created_at: data.created_at ?? new Date().toISOString() };
    },

    async findBlend(id) {
      const { data, error } = await client.from('blends').select(BLEND_COLUMNS).eq('id', id).maybeSingle();
      if (error?.code && MISSING_COLUMN_CODES.has(error.code)) return null;
      if (error) throw storageError(error);
      return data ? toBlendRecord(data) : null;
    },

    async listBlends(userId, limit) {
      const { data, error } = await client
        .from('blends')
        .select(BLEND_COLUMNS)
        .or('user_a.eq.' + userId + ',user_b.eq.' + userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error?.code && MISSING_COLUMN_CODES.has(error.code)) return [];
      if (error) throw storageError(error);
      return data.flatMap(row => toBlendRecord(row) ?? []);
    },
  };
}

function toProfile(row: ProfileRow): Profile {
  if (!row.blend_code) throw new ApiError(502, 'Profile has no blend code');
  return {
    id: row.id,
    name: row.name ?? '',
    blend_code: row.blend_code,
    created_at: row.created_at ?? new Date().toISOString(),
    painter: isPainterId(row.painter_id) ? { id: row.painter_id, name: row.painter_name ?? '' } : null,
  };
}

/** A stored blend, or null when it has lost one of its two people. */
function toBlendRecord(row: Pick<BlendRow, 'id' | 'created_at' | 'user_a' | 'user_b' | 'result'>): BlendRecord | null {
  if (!row.user_a || !row.user_b) return null;
  return {
    id: row.id,
    created_at: row.created_at ?? new Date().toISOString(),
    userA: row.user_a,
    userB: row.user_b,
    result: row.result,
  };
}

function toHeart(row: HeartRow): Heart {
  return { art_id: row.art_id, why: row.why, created_at: row.created_at ?? new Date().toISOString() };
}

function storageError(error: { message: string; code?: string }): ApiError {
  if (error.code && MISSING_TABLE_CODES.has(error.code)) {
    return new ApiError(503, 'Database tables are missing. Run supabase/schema.sql first.');
  }
  console.error('Supabase error ' + (error.code ?? '') + ': ' + error.message);
  return new ApiError(502, 'Profile storage is unavailable');
}
