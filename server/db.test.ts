import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseDb } from './db';

/**
 * Signing up against Supabase, with PostgREST played by a stub: a tiny
 * database of profiles and hearts that answers the requests `db.ts` makes.
 */
interface Rest {
  profiles: { id: string; name: string; blend_code: string; created_at: string; painter_id?: string | null; painter_name?: string | null }[];
  hearts: { user_id: string; art_id: string }[];
  /** Paths requested, in order. */
  calls: string[];
}

const ID = '11111111-1111-4111-8111-111111111111';

/** `hasPainterColumns: false` plays a database where 003_profile_painter.sql has not been run. */
function stubRest(options: { hasFunction: boolean; failHearts?: boolean; hasPainterColumns?: boolean }): Rest {
  const hasPainterColumns = options.hasPainterColumns ?? true;
  const rest: Rest = { profiles: [], hearts: [], calls: [] };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const duplicate = () => json(409, { code: '23505', message: 'duplicate key value violates unique constraint' });
  const missingColumn = (code: string) => json(400, { code, message: 'column profiles.painter_id does not exist' });
  const addProfile = (row: { id: string; name: string; blend_code: string; painter_id?: string | null }) => {
    if (rest.profiles.some(profile => profile.id === row.id || profile.blend_code === row.blend_code)) return null;
    const profile = { ...row, created_at: '2026-11-15T00:00:00Z' };
    rest.profiles.push(profile);
    return profile;
  };

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const route = method + ' ' + url.pathname.replace('/rest/v1', '');
    rest.calls.push(route);

    if (route === 'POST /rpc/create_profile') {
      // The function that takes a painter arrives with the painter columns.
      if (!options.hasFunction || !hasPainterColumns) return json(404, { code: 'PGRST202', message: 'Could not find the function' });
      const args = body as { p_id: string; p_name: string; p_blend_code: string; p_art_ids: string[]; p_painter_id: string | null };
      if (options.failHearts) return json(500, { code: 'XX000', message: 'hearts refused' });
      const profile = addProfile({ id: args.p_id, name: args.p_name, blend_code: args.p_blend_code, painter_id: args.p_painter_id });
      if (!profile) return duplicate();
      rest.hearts.push(...args.p_art_ids.map(art_id => ({ user_id: profile.id, art_id })));
      return json(200, profile);
    }
    const namesPainter = (url.searchParams.get('select') ?? '').includes('painter_id');
    if (route === 'POST /profiles') {
      if (!hasPainterColumns && (namesPainter || 'painter_id' in (body as object))) return missingColumn('PGRST204');
      const profile = addProfile(body as { id: string; name: string; blend_code: string; painter_id?: string });
      return profile ? json(201, profile) : duplicate();
    }
    if (route === 'POST /hearts') {
      if (options.failHearts) return json(500, { code: 'XX000', message: 'hearts refused' });
      rest.hearts.push(...(body as { user_id: string; art_id: string }[]));
      return json(201, null);
    }
    if (route === 'DELETE /profiles') {
      const id = (url.searchParams.get('id') ?? '').replace('eq.', '');
      rest.profiles = rest.profiles.filter(profile => profile.id !== id);
      return new Response(null, { status: 204 });
    }
    if (route === 'PATCH /profiles') {
      if (!hasPainterColumns) return missingColumn('PGRST204');
      const id = (url.searchParams.get('id') ?? '').replace('eq.', '');
      const changed = rest.profiles.filter(profile => profile.id === id);
      for (const profile of changed) Object.assign(profile, body);
      return json(200, changed.map(profile => ({ id: profile.id })));
    }
    if (route === 'GET /profiles') {
      if (!hasPainterColumns && namesPainter) return missingColumn('42703');
      const id = (url.searchParams.get('id') ?? '').replace('eq.', '');
      return json(200, rest.profiles.filter(profile => profile.id === id));
    }
    return json(500, { code: 'XX000', message: 'unexpected request ' + route });
  });
  return rest;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('signing up with Supabase', () => {
  const connect = () => createSupabaseDb('https://example.test', 'secret');

  it('makes the profile and its hearts in one call to create_profile', async () => {
    const rest = stubRest({ hasFunction: true });
    const profile = await connect().createProfile({ id: ID, name: 'Ada', artIds: ['a', 'b', 'c'] });
    expect(profile).toMatchObject({ id: ID, name: 'Ada' });
    expect(rest.calls).toEqual(['POST /rpc/create_profile']);
    expect(rest.hearts.map(heart => heart.art_id)).toEqual(['a', 'b', 'c']);
  });

  it('returns the profile already made when the same ID signs up again', async () => {
    const rest = stubRest({ hasFunction: true });
    const db = connect();
    const first = await db.createProfile({ id: ID, name: 'Ada', artIds: ['a', 'b', 'c'] });
    const again = await db.createProfile({ id: ID, name: 'Someone else', artIds: ['d', 'e', 'f'] });
    expect(again).toEqual(first);
    expect(rest.profiles).toHaveLength(1);
    expect(rest.hearts).toHaveLength(3);
  });

  it('tries another blend code when the generated one is taken, and answers 409 for a fixed one', async () => {
    const rest = stubRest({ hasFunction: true });
    const db = connect();
    await db.createProfile({ name: 'Ada', code: 'CANVAS' });
    await expect(db.createProfile({ name: 'Bo', code: 'CANVAS' })).rejects.toMatchObject({ status: 409 });
    expect(rest.profiles).toHaveLength(1);
  });

  it('falls back to two steps when the function is missing, and asks for it only once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rest = stubRest({ hasFunction: false });
    const db = connect();
    await db.createProfile({ id: ID, name: 'Ada', artIds: ['a', 'b', 'c'] });
    await db.createProfile({ name: 'Bo', artIds: ['d'] });
    expect(rest.calls).toEqual(['POST /rpc/create_profile', 'POST /profiles', 'POST /hearts', 'POST /profiles', 'POST /hearts']);
    expect(rest.hearts).toHaveLength(4);
  });

  it('leaves no profile behind when the hearts cannot be saved', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const hasFunction of [true, false]) {
      const rest = stubRest({ hasFunction, failHearts: true });
      await expect(connect().createProfile({ id: ID, name: 'Ada', artIds: ['a', 'b', 'c'] })).rejects.toMatchObject({ status: 502 });
      expect(rest.profiles).toEqual([]);
      expect(rest.hearts).toEqual([]);
    }
  });
});

describe('a painter on a Supabase profile', () => {
  const connect = () => createSupabaseDb('https://example.test', 'secret');

  it('keeps the painter chosen at sign-up, and a later choice', async () => {
    const rest = stubRest({ hasFunction: true });
    const db = connect();
    expect((await db.createProfile({ id: ID, name: 'Ada', artIds: ['a'], painterId: 'dot' })).painter).toEqual({ id: 'dot', name: '' });
    expect(rest.calls).toEqual(['POST /rpc/create_profile']);

    await db.savePainter(ID, { id: 'hue', name: 'Moss' });
    expect((await db.findProfile(ID))?.painter).toEqual({ id: 'hue', name: 'Moss' });
    await expect(db.savePainter('22222222-2222-4222-8222-222222222222', { id: 'hue', name: '' })).rejects.toMatchObject({ status: 404 });
  });

  it('reads a profile with no painter, or one this server does not know, as not having chosen', async () => {
    const rest = stubRest({ hasFunction: true });
    const db = connect();
    expect((await db.createProfile({ id: ID, name: 'Ada' })).painter).toBeNull();
    rest.profiles[0].painter_id = 'retired';
    expect((await db.findProfile(ID))?.painter).toBeNull();
  });

  it('still signs up and reads profiles before the painter columns exist, asking for them only once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rest = stubRest({ hasFunction: true, hasPainterColumns: false });
    const db = connect();
    const profile = await db.createProfile({ id: ID, name: 'Ada', artIds: ['a'], painterId: 'dot' });
    expect(profile).toMatchObject({ id: ID, name: 'Ada', painter: null });
    expect(await db.findProfile(ID)).toEqual(profile);
    // The function is tried once and each newer set of columns once; after that every request goes without them.
    expect(rest.calls).toEqual(['POST /rpc/create_profile', 'POST /profiles', 'POST /profiles', 'POST /profiles', 'POST /hearts', 'GET /profiles']);
    await expect(db.savePainter(ID, { id: 'hue', name: '' })).rejects.toMatchObject({ status: 503 });
  });
});
