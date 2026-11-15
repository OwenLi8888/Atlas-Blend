import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BlendResponse,
  BlendsResponse,
  DiscoverResponse,
  Profile,
  RecsResponse,
  SimilarResponse,
} from '../src/rec/api';
import { createApp } from './app';
import { createMemoryDb } from './memory-db';
import { testCatalog, type TestWork } from './testing';

/** Three families of eight works each, on three axes, plus two works between families 0 and 1. */
const WORKS: TestWork[] = [
  ...[0, 1, 2].flatMap(family =>
    Array.from({ length: 8 }, (_, n): TestWork => ({
      id: 'f' + family + '-' + n,
      vector: [0, 1, 2].map(axis => (axis === family ? 1 : 0.02 * (n + 1) * (axis + 1))),
      cluster_id: family,
    })),
  ),
  { id: 'mid-a', vector: [1, 1, 0], cluster_id: 0 },
  { id: 'mid-b', vector: [1, 0.9, 0], cluster_id: 1 },
];

const server = createApp(testCatalog(WORKS), createMemoryDb()).listen(0, '127.0.0.1');
let base = '';
beforeAll(async () => {
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.close();
});

async function call<T>(method: string, route: string, body?: unknown) {
  const response = await fetch(base + route, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

async function person(name: string, artIds: string[]): Promise<Profile> {
  const { body: profile } = await call<Profile>('POST', '/api/profile', { name });
  for (const art_id of artIds) await call('POST', '/api/heart', { user_id: profile.id, art_id });
  return profile;
}

describe('saved blends', () => {
  it('lists a blend for both people and reopens it from each point of view', async () => {
    const ada = await person('Ada', ['f0-0', 'f0-1']);
    const bo = await person('Bo', ['f1-0']);
    const made = (await call<BlendResponse>('POST', '/api/blend', { user_id: ada.id, code: bo.blend_code })).body;

    const adaList = (await call<BlendsResponse>('GET', '/api/blends/' + ada.id)).body.blends;
    expect(adaList).toHaveLength(1);
    expect(adaList[0]).toMatchObject({ id: made.id, friend: { name: 'Bo' }, score: made.score, image_url: null });
    expect(adaList[0].top_artwork.id).toBe(made.top_artwork.id);

    const again = (await call<BlendResponse>('GET', '/api/blend/' + made.id + '?user_id=' + ada.id)).body;
    expect(again).toEqual({ ...made, commission: again.commission });

    // Bo did not make it, but it is his too, and "yours" means his hearts.
    const boList = (await call<BlendsResponse>('GET', '/api/blends/' + bo.id)).body.blends;
    expect(boList[0]).toMatchObject({ id: made.id, friend: { name: 'Ada' } });
    const boView = (await call<BlendResponse>('GET', '/api/blend/' + made.id + '?user_id=' + bo.id)).body;
    expect(boView.friend.name).toBe('Ada');
    expect(boView.trends.you).toEqual(made.trends.friend);
    expect(boView.wall.find(item => item.work.id === 'f1-0')?.from).toBe('you');
    expect(boView.wall.find(item => item.work.id === 'f0-0')?.from).toBe('friend');
    expect(boView.story).toContain('Ada leans toward');
  });

  it('keeps every blend, newest first', async () => {
    const cy = await person('Cy', ['f2-0']);
    const first = await person('Di', ['f0-3']);
    const second = await person('Ed', ['f1-3']);
    const one = (await call<BlendResponse>('POST', '/api/blend', { user_id: cy.id, code: first.blend_code })).body;
    const two = (await call<BlendResponse>('POST', '/api/blend', { user_id: cy.id, code: second.blend_code })).body;
    const list = (await call<BlendsResponse>('GET', '/api/blends/' + cy.id)).body.blends;
    expect(list.map(blend => blend.id)).toEqual([two.id, one.id]);
    expect(list.map(blend => blend.friend.name)).toEqual(['Ed', 'Di']);
  });

  it('shows a blend only to the two people in it', async () => {
    const flo = await person('Flo', ['f0-0']);
    const gus = await person('Gus', ['f1-0']);
    const stranger = await person('Hal', ['f2-0']);
    const made = (await call<BlendResponse>('POST', '/api/blend', { user_id: flo.id, code: gus.blend_code })).body;
    expect((await call('GET', '/api/blend/' + made.id + '?user_id=' + stranger.id)).status).toBe(404);
    expect((await call('GET', '/api/blend/' + made.id)).status).toBe(400);
    expect((await call('GET', '/api/blend/00000000-0000-4000-8000-000000000000?user_id=' + flo.id)).status).toBe(404);
    expect((await call<BlendsResponse>('GET', '/api/blends/' + stranger.id)).body.blends).toEqual([]);
  });
});

describe('recommendations size', () => {
  it('hangs as many works as asked for, within limits', async () => {
    const ida = await person('Ida', ['f0-0', 'f1-0']);
    expect((await call<RecsResponse>('GET', '/api/recs/' + ida.id + '?count=5')).body.works).toHaveLength(5);
    expect((await call<RecsResponse>('GET', '/api/recs/' + ida.id)).body.works.length).toBeGreaterThan(12);
    expect((await call('GET', '/api/recs/' + ida.id + '?count=0')).status).toBe(400);
    expect((await call('GET', '/api/recs/' + ida.id + '?count=999')).status).toBe(400);
  });
});

describe('discover', () => {
  it('pages through the whole collection once, in an order fixed by the seed', async () => {
    const seen: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page: DiscoverResponse = (await call<DiscoverResponse>('GET', '/api/discover?seed=7&limit=10&offset=' + offset)).body;
      seen.push(...page.works.map(work => work.id));
      offset = page.next_offset;
    }
    expect(seen).toHaveLength(WORKS.length);
    expect(new Set(seen).size).toBe(WORKS.length);

    const again = (await call<DiscoverResponse>('GET', '/api/discover?seed=7&limit=10')).body;
    expect(again.works.map(work => work.id)).toEqual(seen.slice(0, 10));
    const other = (await call<DiscoverResponse>('GET', '/api/discover?seed=8&limit=10')).body;
    expect(other.works.map(work => work.id)).not.toEqual(seen.slice(0, 10));
  });

  it('mixes the families: the first works are not all one kind', async () => {
    const { body } = await call<DiscoverResponse>('GET', '/api/discover?seed=3&limit=6');
    expect(new Set(body.works.map(work => work.cluster_id)).size).toBe(3);
  });

  it('rejects bad paging', async () => {
    expect((await call('GET', '/api/discover?offset=-1')).status).toBe(400);
    expect((await call('GET', '/api/discover?limit=1000')).status).toBe(400);
    expect((await call('GET', '/api/discover?seed=abc')).status).toBe(400);
  });
});

describe('similar', () => {
  it('returns works near the one asked about, never the work itself', async () => {
    const { body } = await call<SimilarResponse>('GET', '/api/similar?id=f0-0&limit=5');
    expect(body.work.id).toBe('f0-0');
    expect(body.similar).toHaveLength(5);
    expect(body.similar.map(work => work.id)).not.toContain('f0-0');
    expect(body.similar.filter(work => work.cluster_id === 0).length).toBeGreaterThanOrEqual(3);
  });

  it('answers 404 for an unknown work', async () => {
    expect((await call('GET', '/api/similar?id=nope')).status).toBe(404);
  });
});

describe('local database file', () => {
  it('keeps profiles, hearts and blends across a restart', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gallery-db-'));
    const file = path.join(dir, 'nested', 'db.json');

    const first = createMemoryDb({ file });
    const ada = await first.createProfile('Ada');
    const bo = await first.createProfile('Bo', 'CANVAS');
    await first.saveHeart(ada.id, 'f0-0', 'the light');
    await first.saveHeart(ada.id, 'f0-1', undefined);
    await first.removeHeart(ada.id, 'f0-1');
    const blend = await first.saveBlend({
      userA: ada.id,
      userB: bo.id,
      topArtId: 'mid-a',
      pickIds: [],
      story: 's',
      result: { score: 80, revealId: 'mid-a', wall: [], trends: { a: [], b: [] } },
    });

    const second = createMemoryDb({ file });
    expect(await second.findProfile(ada.id)).toEqual(ada);
    expect((await second.findProfileByCode('CANVAS'))?.id).toBe(bo.id);
    expect(await second.listHearts(ada.id, 10)).toMatchObject([{ art_id: 'f0-0', why: 'the light' }]);
    expect((await second.listBlends(bo.id, 10)).map(record => record.id)).toEqual([blend.id]);
    expect((await second.findBlend(blend.id))?.result?.score).toBe(80);
    await rm(dir, { recursive: true });
  });

  it('starts empty when the file is missing or unreadable', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gallery-db-'));
    const db = createMemoryDb({ file: path.join(dir, 'none.json') });
    expect(await db.findProfileByCode('CANVAS')).toBeNull();
    await rm(dir, { recursive: true });
  });
});
