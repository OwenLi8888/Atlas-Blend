import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { BlendResponse, Commission, Profile, Trend } from '../src/rec/api';
import { createApp } from './app';
import { commissionBrief, commissionTitle, createCommissions, type ImageData, type ImageMaker } from './commission';
import { createMemoryDb } from './memory-db';
import { testCatalog } from './testing';

const jpeg = (bytes: number[]): ImageData => ({ bytes: Buffer.from(bytes), mimeType: 'image/jpeg' });
const referenceHost = async () => new Response(new Uint8Array([9]), { headers: { 'content-type': 'image/jpeg' } });

function trend(family: string, share: number, why: string | null = null): Trend {
  const work = testCatalog([{ id: family, vector: [1, 0] }]).works[0];
  return { family, share, why, works: [{ ...work, caption: 'A caption about ' + family + '.' }] };
}

const request = (blendId: string) => ({
  blendId,
  you: { name: 'Ada', trends: [trend('Flower still lifes', 0.7, 'the light'), trend('Harbour views', 0.3)] },
  friend: { name: 'Bo', trends: [trend('Japanese folding screens', 1)] },
});

async function settled(check: () => Promise<Commission | null>): Promise<Commission> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const commission = await check();
    if (commission && commission.status !== 'pending') return commission;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('The commission never settled');
}

describe('createCommissions', () => {
  it('answers pending at once, then holds the finished image', async () => {
    const calls: { brief: string; references: number }[] = [];
    const makeImage: ImageMaker = async (brief, references) => {
      calls.push({ brief, references: references.length });
      return jpeg([1, 2, 3]);
    };
    const commissions = createCommissions({ makeImage, fetchImage: referenceHost });

    expect(commissions.start(request('b1'))).toEqual({
      status: 'pending',
      image_url: null,
      title: 'For Ada and Bo',
      label_status: 'unavailable',
      label: null,
    });
    expect(await commissions.image('b1')).toBeNull();

    const ready = await settled(() => commissions.status('b1'));
    expect(ready).toMatchObject({ status: 'ready', image_url: '/api/blend/b1/commission/image', title: 'For Ada and Bo' });
    expect(await commissions.image('b1')).toEqual(jpeg([1, 2, 3]));
    // One reference per leaning: two of Ada's, one of Bo's.
    expect(calls).toHaveLength(1);
    expect(calls[0].references).toBe(3);
  });

  it('reports a failure instead of throwing', async () => {
    const commissions = createCommissions({
      makeImage: async () => {
        throw new Error('model is down');
      },
      fetchImage: referenceHost,
    });
    commissions.start(request('b2'));
    expect((await settled(() => commissions.status('b2'))).status).toBe('failed');
    expect(await commissions.image('b2')).toBeNull();
  });

  it('still makes the piece when a reference image cannot be fetched', async () => {
    let references = -1;
    const commissions = createCommissions({
      makeImage: async (_brief, given) => {
        references = given.length;
        return jpeg([4]);
      },
      fetchImage: async () => new Response('gone', { status: 404 }),
    });
    commissions.start(request('b3'));
    expect((await settled(() => commissions.status('b3'))).status).toBe('ready');
    expect(references).toBe(0);
  });

  it('drops the oldest pieces past its limit and knows nothing of unknown blends', async () => {
    const commissions = createCommissions({ makeImage: async () => jpeg([1]), fetchImage: referenceHost, maxKept: 2 });
    for (const id of ['old', 'mid', 'new']) commissions.start(request(id));
    expect(await commissions.status('old')).toBeNull();
    expect(await commissions.status('mid')).not.toBeNull();
    expect(await commissions.status('never')).toBeNull();
  });
});

describe('kept pieces', () => {
  it('finds a finished piece again after a restart, with its label', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'commissions-'));
    const atelier = {
      make: async (_you: unknown, _friend: unknown, onBrief: (brief: string) => void) => {
        onBrief('a brief');
        return { title: 'Harbour on gold', story: 'Ada and Bo\'s piece holds a harbour.' };
      },
    };
    const first = createCommissions({ makeImage: async () => jpeg([5, 6]), fetchImage: referenceHost, atelier, dir });
    first.start(request('aaaaaaaa-0000-4000-8000-000000000001'));
    await settled(() => first.status('aaaaaaaa-0000-4000-8000-000000000001'));

    // A new server process has nothing in memory, only the folder.
    const second = createCommissions({ makeImage: async () => jpeg([0]), fetchImage: referenceHost, dir });
    const found = await second.status('aaaaaaaa-0000-4000-8000-000000000001');
    expect(found).toMatchObject({ status: 'ready', title: 'Harbour on gold', label_status: 'ready' });
    expect(found?.label?.story).toContain('harbour');
    expect(await second.image('aaaaaaaa-0000-4000-8000-000000000001')).toEqual(jpeg([5, 6]));
    expect(await second.status('aaaaaaaa-0000-4000-8000-000000000002')).toBeNull();
    await rm(dir, { recursive: true });
  });

  it('refuses IDs that could escape its folder', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'commissions-'));
    const commissions = createCommissions({ makeImage: async () => jpeg([1]), fetchImage: referenceHost, dir });
    expect(await commissions.status('../../etc/passwd')).toBeNull();
    await rm(dir, { recursive: true });
  });
});

describe('commissionBrief', () => {
  const brief = commissionBrief(request('x').you, request('x').friend);

  it('describes both people by their leanings, shares and own words', () => {
    expect(brief).toContain('Ada loves:\n- Flower still lifes (70% of what they love).');
    expect(brief).toContain('In their words: "the light".');
    expect(brief).toContain('Bo loves:\n- Japanese folding screens (100% of what they love).');
    expect(brief).toContain('A caption about Harbour views.');
  });

  it('says which references are whose and asks for one fused work', () => {
    expect(brief).toContain('the first 2 belong to Ada, the rest to Bo');
    expect(brief).toContain('chimera');
    expect(brief).toContain('do not make a collage');
  });

  it('titles the piece for both people, or neutrally when a name is missing', () => {
    expect(commissionTitle('Ada', 'Bo')).toBe('For Ada and Bo');
    expect(commissionTitle('Ada', '  ')).toBe('For the two of you');
  });
});

describe('commission endpoints', () => {
  const catalog = testCatalog([
    { id: 'a', vector: [1, 0, 0] },
    { id: 'b', vector: [0, 1, 0] },
    { id: 'mid', vector: [1, 1, 0] },
    { id: 'other', vector: [0, 0, 1] },
  ]);
  const start = (commissions?: ReturnType<typeof createCommissions>) => {
    const db = createMemoryDb();
    const server = createApp(catalog, db, { commissions }).listen(0, '127.0.0.1');
    return { server, db, base: () => 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
  };
  const made = start(createCommissions({ makeImage: async () => jpeg([7, 7]), fetchImage: referenceHost }));
  const plain = start();
  afterAll(() => {
    made.server.close();
    plain.server.close();
  });

  async function blend({ db, base: baseOf }: ReturnType<typeof start>): Promise<BlendResponse> {
    const base = baseOf();
    const post = (path: string, body: unknown) =>
      fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    const me = await db.createProfile({ name: 'Ada' });
    const friend = await db.createProfile({ name: 'Bo' });
    await post('/api/heart', { user_id: me.id, art_id: 'a' });
    await post('/api/heart', { user_id: friend.id, art_id: 'b' });
    return (await post('/api/blend', { user_id: me.id, code: friend.blend_code })) as BlendResponse;
  }

  it('starts a piece with the blend and serves it when ready', async () => {
    const result = await blend(made);
    expect(result.commission).toMatchObject({ status: 'pending', title: 'For Ada and Bo' });

    let commission = result.commission;
    for (let attempt = 0; attempt < 100 && commission.status === 'pending'; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      commission = (await fetch(made.base() + '/api/blend/' + result.id + '/commission').then(r => r.json())) as Commission;
    }
    expect(commission.status).toBe('ready');

    const image = await fetch(made.base() + commission.image_url!);
    expect(image.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([7, 7]));
  });

  it('answers 404 for a blend it never made a piece for, and 400 for a malformed ID', async () => {
    const unknown = '/api/blend/00000000-0000-4000-8000-000000000000/commission';
    expect((await fetch(made.base() + unknown)).status).toBe(404);
    expect((await fetch(made.base() + unknown + '/image')).status).toBe(404);
    expect((await fetch(made.base() + '/api/blend/nope/commission')).status).toBe(400);
  });

  it('marks the piece unavailable when no image model is configured', async () => {
    const result = await blend(plain);
    expect(result.commission).toEqual({ status: 'unavailable', image_url: null, title: null, label_status: 'unavailable', label: null });
    expect(result.top_artwork.id).toBe('mid');
  });
});
