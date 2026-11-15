import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  BlendResponse,
  HeartResponse,
  OnboardingResponse,
  PainterResponse,
  Profile,
  ProfileResponse,
  RecsResponse,
} from '../src/rec/api';
import { blendStory, createApp } from './app';
import { BLEND_CODE_LENGTH } from './db';
import { createMemoryDb } from './memory-db';
import { testCatalog, type TestWork } from './testing';

/**
 * Three visual families along three axes, plus works between families 0 and 1.
 * "mid-foil" scores highest for a blend of families 0 and 1 but is not painterly.
 */
const WORKS: TestWork[] = [
  { id: 'a:1', vector: [1, 0, 0], cluster_id: 0 },
  { id: 'a:2', vector: [0.99, 0.1, 0], cluster_id: 0 },
  { id: 'a:3', vector: [0.98, 0.15, 0], cluster_id: 0 },
  { id: 'b:1', vector: [0, 1, 0], cluster_id: 1 },
  { id: 'b:2', vector: [0.1, 0.99, 0], cluster_id: 1 },
  { id: 'b/3', vector: [0.15, 0.98, 0], cluster_id: 1 },
  { id: 'c:1', vector: [0, 0, 1], cluster_id: 2 },
  { id: 'c:2', vector: [0, 0.1, 0.99], cluster_id: 2 },
  { id: 'mid-foil', vector: [1, 1, 0], cluster_id: 0, medium: 'Screenprint, gold foil' },
  { id: 'mid-oil', vector: [1, 0.9, 0], cluster_id: 0, medium: 'Oil on canvas' },
  { id: 'mid-plain', vector: [0.9, 1, 0], cluster_id: 1 },
];

const db = createMemoryDb();
const imageRequests: string[] = [];
const fetchImage = async (url: string) => {
  imageRequests.push(url);
  if (url.includes('b:1')) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
};
const server = createApp(testCatalog(WORKS), db, { fetchImage }).listen(0, '127.0.0.1');
let base = '';

beforeAll(async () => {
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.close();
});

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

/** A profile with exactly these hearts, made directly so tests can start from fewer than sign-up allows. */
async function newProfile(name: string, artIds: string[] = []): Promise<Profile> {
  const profile = await db.createProfile({ name });
  for (const art_id of artIds) await call('POST', '/api/heart', { user_id: profile.id, art_id });
  return profile;
}

const MISSING_USER = '00000000-0000-4000-8000-000000000000';

describe('profiles', () => {
  const PICKS = ['a:1', 'b:1', 'c:1'];

  it('signs up with a six-letter blend code and the chosen works already hearted', async () => {
    const id = randomUUID();
    const { status, body } = await call<ProfileResponse>('POST', '/api/profile', { id, name: '  Ada  ', picks: [...PICKS, 'a:1'] });
    expect(status).toBe(201);
    expect(body.profile.id).toBe(id);
    expect(body.profile.name).toBe('Ada');
    expect(body.profile.blend_code).toMatch(new RegExp('^[A-Z]{' + BLEND_CODE_LENGTH + '}$'));
    expect(body.hearts.map(heart => heart.work.id).sort()).toEqual(PICKS);

    const saved = await call<ProfileResponse>('GET', '/api/profile/' + body.profile.id);
    expect(saved.body.hearts).toHaveLength(3);
  });

  it('opens a gallery again by its own code, in either case', async () => {
    const ada = await newProfile('Ada', ['a:1']);
    const { status, body } = await call<ProfileResponse>('POST', '/api/sign-in', { code: ada.blend_code.toLowerCase() });
    expect(status).toBe(200);
    expect(body.profile.id).toBe(ada.id);
    expect(body.hearts.map(heart => heart.work.id)).toEqual(['a:1']);
    expect((await call('POST', '/api/sign-in', { code: 'ZZZZZZ' })).status).toBe(404);
    expect((await call('POST', '/api/sign-in', {})).status).toBe(400);
  });

  it('asks for the passcode once one is set, and keeps only its hash', async () => {
    const ada = await newProfile('Ada', ['a:1']);
    const route = '/api/profile/' + ada.id + '/passcode';
    expect((await call('POST', route, { passcode: 'abc' })).status).toBe(400);
    expect((await call('POST', route, {})).status).toBe(400);
    expect((await call('POST', '/api/profile/' + MISSING_USER + '/passcode', { passcode: 'open sesame' })).status).toBe(404);
    expect((await call('POST', route, { passcode: 'open sesame' })).status).toBe(204);
    expect(await db.passcodeOf(ada.id)).not.toContain('open sesame');

    expect((await call('POST', '/api/sign-in', { code: ada.blend_code })).status).toBe(401);
    expect((await call('POST', '/api/sign-in', { code: ada.blend_code, passcode: 'Open Sesame' })).status).toBe(401);
    const opened = await call<ProfileResponse>('POST', '/api/sign-in', { code: ada.blend_code, passcode: 'open sesame' });
    expect(opened.status).toBe(200);
    expect(opened.body.profile.id).toBe(ada.id);
    // Blending with the code alone still works: the passcode guards the gallery, not the blend.
  });

  it('rejects a missing, empty or oversized name', async () => {
    const id = randomUUID();
    expect((await call('POST', '/api/profile', { id, picks: PICKS })).status).toBe(400);
    expect((await call('POST', '/api/profile', { id, name: '   ', picks: PICKS })).status).toBe(400);
    expect((await call('POST', '/api/profile', { id, name: 'x'.repeat(81), picks: PICKS })).status).toBe(400);
  });

  it('answers a repeated sign-up with the profile already made, not a second one', async () => {
    const request = { id: randomUUID(), name: 'Ivy', picks: PICKS };
    const first = await call<ProfileResponse>('POST', '/api/profile', request);
    const again = await call<ProfileResponse>('POST', '/api/profile', { ...request, name: 'Someone else', picks: ['a:2', 'b:2', 'c:2'] });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.profile).toEqual(first.body.profile);
    expect(again.body.hearts.map(heart => heart.work.id).sort()).toEqual(PICKS);
  });

  it('rejects a sign-up without a valid ID', async () => {
    expect((await call('POST', '/api/profile', { name: 'Jo', picks: PICKS })).status).toBe(400);
    expect((await call('POST', '/api/profile', { id: 'not-a-uuid', name: 'Jo', picks: PICKS })).status).toBe(400);
  });

  it('makes no profile when the picks are too few, unknown or malformed', async () => {
    const createProfile = vi.spyOn(db, 'createProfile');
    const id = randomUUID();
    expect((await call('POST', '/api/profile', { id, name: 'Flo' })).status).toBe(400);
    expect((await call('POST', '/api/profile', { id, name: 'Flo', picks: 'a:1' })).status).toBe(400);
    expect((await call('POST', '/api/profile', { id, name: 'Flo', picks: ['a:1', 'b:1'] })).status).toBe(400);
    // The same work three times is one pick.
    expect((await call('POST', '/api/profile', { id, name: 'Flo', picks: ['a:1', 'a:1', 'a:1'] })).status).toBe(400);
    expect((await call('POST', '/api/profile', { id, name: 'Flo', picks: ['a:1', 'b:1', 7] })).status).toBe(400);
    expect((await call('POST', '/api/profile', { id, name: 'Flo', picks: ['a:1', 'b:1', 'nope'] })).status).toBe(404);
    expect(createProfile).not.toHaveBeenCalled();
    createProfile.mockRestore();
  });

  it('lets someone with no hearts choose again, under the same minimum', async () => {
    const profile = await newProfile('Gus');
    const route = '/api/profile/' + profile.id + '/picks';
    expect((await call('POST', route, { picks: ['a:1', 'b:1'] })).status).toBe(400);
    expect((await call<ProfileResponse>('GET', '/api/profile/' + profile.id)).body.hearts).toHaveLength(0);

    const { status, body } = await call<ProfileResponse>('POST', route, { picks: PICKS });
    expect(status).toBe(200);
    expect(body.hearts.map(heart => heart.work.id).sort()).toEqual(PICKS);
    expect((await call('POST', '/api/profile/' + MISSING_USER + '/picks', { picks: PICKS })).status).toBe(404);
  });

  it('signs up with the painter chosen at the entrance, or with none', async () => {
    const chose = await call<ProfileResponse>('POST', '/api/profile', { id: randomUUID(), name: 'Ada', picks: PICKS, painter_id: 'dot' });
    expect(chose.body.profile.painter).toEqual({ id: 'dot', name: '' });
    const skipped = await call<ProfileResponse>('POST', '/api/profile', { id: randomUUID(), name: 'Bo', picks: PICKS });
    expect(skipped.body.profile.painter).toBeNull();
    expect((await call('POST', '/api/profile', { id: randomUUID(), name: 'Cy', picks: PICKS, painter_id: 'blob' })).status).toBe(400);
  });

  it('keeps a choice of painter and what it is called on the profile', async () => {
    const profile = await newProfile('Di');
    const route = '/api/profile/' + profile.id + '/painter';
    const { status, body } = await call<PainterResponse>('POST', route, { id: 'hue', name: '  Moss  ' });
    expect(status).toBe(200);
    expect(body.painter).toEqual({ id: 'hue', name: 'Moss' });
    expect((await call<ProfileResponse>('GET', '/api/profile/' + profile.id)).body.profile.painter).toEqual({ id: 'hue', name: 'Moss' });

    // An empty name gives the painter its own name back.
    expect((await call<PainterResponse>('POST', route, { id: 'ivory', name: '' })).body.painter).toEqual({ id: 'ivory', name: '' });
  });

  it('rejects an unknown painter, a bad name, and a profile that is not there', async () => {
    const profile = await newProfile('Ed');
    const route = '/api/profile/' + profile.id + '/painter';
    expect((await call('POST', route, { id: 'blob', name: '' })).status).toBe(400);
    expect((await call('POST', route, { name: 'Moss' })).status).toBe(400);
    expect((await call('POST', route, { id: 'hue' })).status).toBe(400);
    expect((await call('POST', route, { id: 'hue', name: 'x'.repeat(17) })).status).toBe(400);
    expect((await call('POST', '/api/profile/' + MISSING_USER + '/painter', { id: 'hue', name: '' })).status).toBe(404);
    expect((await call<ProfileResponse>('GET', '/api/profile/' + profile.id)).body.profile.painter).toBeNull();
  });

  it('keeps the reason on a work that was already hearted when choosing again', async () => {
    const profile = await newProfile('Hal');
    await call('POST', '/api/heart', { user_id: profile.id, art_id: 'a:1', why: 'the light' });
    const { body } = await call<ProfileResponse>('POST', '/api/profile/' + profile.id + '/picks', { picks: PICKS });
    expect(body.hearts).toHaveLength(3);
    expect(body.hearts.find(heart => heart.work.id === 'a:1')?.why).toBe('the light');
  });

  it('returns a profile with its hearts, newest first', async () => {
    const profile = await newProfile('Bo', ['a:1', 'b:1']);
    const { body } = await call<ProfileResponse>('GET', '/api/profile/' + profile.id);
    expect(body.profile.id).toBe(profile.id);
    expect(body.hearts.map(heart => heart.work.id)).toEqual(['b:1', 'a:1']);
  });

  it('answers 404 for an unknown profile and 400 for a malformed ID', async () => {
    expect((await call('GET', '/api/profile/' + MISSING_USER)).status).toBe(404);
    expect((await call('GET', '/api/profile/not-a-uuid')).status).toBe(400);
  });
});

describe('onboarding', () => {
  it('shows one tile per visual family and never sends vectors', async () => {
    const { body } = await call<OnboardingResponse>('GET', '/api/onboarding');
    expect(new Set(body.works.map(work => work.cluster_id)).size).toBe(3);
    expect(body.works).toHaveLength(3);
    expect(body.min_picks).toBe(3);
    expect(JSON.stringify(body)).not.toContain('image_vec');
  });
});

describe('hearts', () => {
  it('saves a heart with a reason and keeps the reason when hearted again without one', async () => {
    const profile = await newProfile('Cy');
    const first = await call<HeartResponse>('POST', '/api/heart', { user_id: profile.id, art_id: 'a:1', why: 'the light' });
    expect(first.body.heart.why).toBe('the light');
    await call('POST', '/api/heart', { user_id: profile.id, art_id: 'a:1' });
    const { body } = await call<ProfileResponse>('GET', '/api/profile/' + profile.id);
    expect(body.hearts).toHaveLength(1);
    expect(body.hearts[0].why).toBe('the light');
  });

  it('removes a heart, including IDs with colons and slashes', async () => {
    const profile = await newProfile('Di', ['a:1', 'b/3']);
    const query = '?user_id=' + profile.id + '&art_id=' + encodeURIComponent('b/3');
    expect((await call('DELETE', '/api/heart' + query)).status).toBe(204);
    const { body } = await call<ProfileResponse>('GET', '/api/profile/' + profile.id);
    expect(body.hearts.map(heart => heart.work.id)).toEqual(['a:1']);
  });

  it('rejects unknown artworks, unknown profiles and bad input', async () => {
    const profile = await newProfile('Ed');
    expect((await call('POST', '/api/heart', { user_id: profile.id, art_id: 'nope' })).status).toBe(404);
    expect((await call('POST', '/api/heart', { user_id: MISSING_USER, art_id: 'a:1' })).status).toBe(404);
    expect((await call('POST', '/api/heart', { user_id: profile.id, art_id: 'a:1', why: 7 })).status).toBe(400);
    expect((await call('POST', '/api/heart', { user_id: 'x', art_id: 'a:1' })).status).toBe(400);
  });
});

describe('recommendations', () => {
  it('returns an empty wall before any hearts', async () => {
    const profile = await newProfile('Flo');
    const { body } = await call<RecsResponse>('GET', '/api/recs/' + profile.id);
    expect(body).toEqual({ works: [], taste_count: 0 });
  });

  it('recommends unhearted works across both tastes, each with the heart it came from', async () => {
    const profile = await newProfile('Gus', ['a:1', 'c:1']);
    const { body } = await call<RecsResponse>('GET', '/api/recs/' + profile.id);
    const ids = body.works.map(rec => rec.work.id);
    expect(body.taste_count).toBe(2);
    expect(ids).not.toContain('a:1');
    expect(ids).not.toContain('c:1');
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(body.works.slice(0, 2).map(rec => rec.because.id))).toEqual(new Set(['a:1', 'c:1']));
    expect(body.works.find(rec => rec.work.id === 'c:2')?.because.id).toBe('c:1');
  });
});

describe('blend', () => {
  it('shows each person the painter the other chose', async () => {
    const me = await newProfile('Ann', ['a:1']);
    const friend = await newProfile('Ben', ['b:1']);
    await call('POST', '/api/profile/' + friend.id + '/painter', { id: 'pop', name: 'Fizz' });

    const made = await call<BlendResponse>('POST', '/api/blend', { user_id: me.id, code: friend.blend_code });
    expect(made.body.friend).toEqual({ name: 'Ben', painter: { id: 'pop', name: 'Fizz' } });

    // Chosen after the blend was made, and still what the friend sees when they open it.
    await call('POST', '/api/profile/' + me.id + '/painter', { id: 'ember', name: '' });
    const reopened = await call<BlendResponse>('GET', '/api/blend/' + made.body.id + '?user_id=' + friend.id);
    expect(reopened.body.friend).toEqual({ name: 'Ann', painter: { id: 'ember', name: '' } });
  });

  it('reveals a painterly work between the two people and tells the story', async () => {
    const me = await newProfile('Hal');
    await call('POST', '/api/heart', { user_id: me.id, art_id: 'a:1', why: 'so calm' });
    const friend = await newProfile('Ivy', ['b:1']);

    const { status, body } = await call<BlendResponse>('POST', '/api/blend', {
      user_id: me.id,
      code: friend.blend_code.toLowerCase(),
    });
    expect(status).toBe(200);
    // "mid-foil" scores highest, but "foil" must not count as oil paint.
    expect(body.top_artwork.id).toBe('mid-oil');
    // The friend as they are shown: their name and painter, never their profile's ID.
    expect(body.friend).toEqual({ name: 'Ivy', painter: null });
    expect(body.trends.you).toEqual([
      expect.objectContaining({ family: 'Family 0', share: 1, why: 'so calm', works: [expect.objectContaining({ id: 'a:1' })] }),
    ]);
    expect(body.trends.friend[0]).toMatchObject({ family: 'Family 1', why: null });
    expect(body.story).toBe('You lean toward family 0. Ivy leans toward family 1. “Title of mid-oil” is where the two of you meet.');

    const wallIds = body.wall.map(item => item.work.id);
    expect(wallIds).not.toContain('mid-oil');
    expect(new Set(wallIds).size).toBe(wallIds.length);
    expect(body.wall.find(item => item.work.id === 'a:1')?.from).toBe('you');
    expect(body.wall.find(item => item.work.id === 'b:1')?.from).toBe('friend');
    expect(body.wall.filter(item => item.from === 'new').length).toBeGreaterThan(0);
    expect(body.wall.filter(item => item.from === 'new').length).toBeLessThanOrEqual(6);
    expect(body.score).toBeGreaterThanOrEqual(0);
    expect(body.score).toBeLessThanOrEqual(100);

    const saved = db.blends.find(blend => blend.id === body.id);
    expect(saved).toMatchObject({ userA: me.id, userB: friend.id, topArtId: 'mid-oil', pickIds: wallIds });
  });

  it('scores identical tastes 100 and hangs the works both hearted first', async () => {
    const me = await newProfile('Jo', ['a:1', 'a:2']);
    const friend = await newProfile('Kit', ['a:1', 'c:1']);
    const { body } = await call<BlendResponse>('POST', '/api/blend', { user_id: me.id, code: friend.blend_code });
    expect(body.wall[0]).toMatchObject({ work: { id: 'a:1' }, from: 'both' });
    expect(body.wall.filter(item => item.work.id === 'a:1')).toHaveLength(1);
    expect(body.wall.find(item => item.work.id === 'a:2')?.from).toBe('you');
    expect(body.wall.find(item => item.work.id === 'c:1')?.from).toBe('friend');

    const twin = await newProfile('Lee', ['a:1']);
    const same = await call<BlendResponse>('POST', '/api/blend', { user_id: twin.id, code: (await newProfile('Max', ['a:1'])).blend_code });
    expect(same.body.score).toBe(100);
  });

  it('rejects your own code, unknown codes, malformed codes and empty profiles', async () => {
    const me = await newProfile('Lu', ['a:1']);
    const empty = await newProfile('Mo');
    const blend = (code: string) => call('POST', '/api/blend', { user_id: me.id, code });
    expect((await blend(me.blend_code)).status).toBe(400);
    expect((await blend('ZZZZZZ')).status).toBe(404);
    expect((await blend('no!')).status).toBe(400);
    expect((await blend(empty.blend_code)).status).toBe(409);
  });
});

describe('image pass-through', () => {
  it('serves an artwork image from this origin, cacheable', async () => {
    const response = await fetch(base + '/api/image?id=' + encodeURIComponent('a:1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(imageRequests.at(-1)).toBe('https://example.test/a:1.jpg');
  });

  it('answers 404 for an unknown artwork and 502 when the host fails', async () => {
    expect((await call('GET', '/api/image?id=nope')).status).toBe(404);
    expect((await call('GET', '/api/image?id=' + encodeURIComponent('b:1'))).status).toBe(502);
    expect((await call('GET', '/api/image')).status).toBe(400);
  });
});

describe('request handling', () => {
  it('blocks cross-site requests', async () => {
    const { status } = await call('GET', '/api/onboarding', undefined, { 'sec-fetch-site': 'cross-site' });
    expect(status).toBe(403);
  });

  it('answers malformed JSON and unknown routes cleanly', async () => {
    const response = await fetch(base + '/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(response.status).toBe(400);
    expect((await call('GET', '/api/nothing')).status).toBe(404);
  });
});

describe('blendStory', () => {
  const work = (title: string) => testCatalog([{ id: title, vector: [1, 0] }]).works[0];

  const trend = (family: string) => ({ family, share: 0.5, works: [], why: null });

  it('falls back to a neutral name when the friend has none', () => {
    expect(blendStory(work('r'), [trend('Flower still lifes')], [trend('Hard-edge abstraction')], '  ')).toContain(
      'Your friend leans toward hard-edge abstraction',
    );
  });

  it('lists each family once and keeps proper names capitalised', () => {
    const story = blendStory(
      work('r'),
      [trend('Japanese folding screens'), trend('Flower still lifes'), trend('Japanese folding screens')],
      [trend('Portrait paintings'), trend('Harbour and coastal views'), trend('Indian miniature paintings')],
      'Juno',
    );
    expect(story).toContain('You lean toward Japanese folding screens and flower still lifes.');
    expect(story).toContain('Juno leans toward portrait paintings, harbour and coastal views and Indian miniature paintings.');
  });
});
