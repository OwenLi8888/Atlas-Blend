import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import type { CuratorNoteResponse, CuratorResponse, Profile } from '../src/rec/api';
import { createApp } from './app';
import { createCollection } from './collection';
import { ROOMS_MIN_SAVED, type Curator, type CuratorPerson } from './curator';
import { createMemoryDb } from './memory-db';
import { testCatalog } from './testing';

const catalog = testCatalog([
  { id: 'harbour-dawn', vector: [1, 0, 0] },
  { id: 'harbour-dusk', vector: [0.98, 0.1, 0] },
  { id: 'rose', vector: [0, 1, 0] },
  { id: 'portrait', vector: [0, 0, 1] },
]);

describe('collection', () => {
  const collection = createCollection(catalog, () => null);

  it('finds works by words in their label, best match first', () => {
    // Test works are titled "Title of <id>", so the ID words are in the title.
    expect(collection.search('harbour dawn', 5).map(work => work.id)).toEqual(['harbour-dawn', 'harbour-dusk']);
    expect(collection.search('rose', 5).map(work => work.id)).toEqual(['rose']);
    expect(collection.search('harbour', 1)).toHaveLength(1);
  });

  it('ignores filler words and finds nothing for words that are not there', () => {
    expect(collection.search('the painting of a', 5)).toEqual([]);
    expect(collection.search('zeppelin', 5)).toEqual([]);
  });

  it('finds works that look like another, never the work itself', () => {
    expect(collection.moreLike('harbour-dawn', 2).map(work => work.id)[0]).toBe('harbour-dusk');
    expect(collection.moreLike('harbour-dawn', 5).map(work => work.id)).not.toContain('harbour-dawn');
    expect(collection.moreLike('nope', 5)).toEqual([]);
  });
});

describe('curator endpoints', () => {
  const seen: CuratorPerson[] = [];
  const stub: Curator = {
    async view(person) {
      seen.push(person);
      return {
        status: 'ready',
        portrait: 'You are drawn to harbours.',
        question: { text: 'The water, or the light?', answers: ['The water', 'The light'] },
        rooms: [{ title: 'Harbours', text: 'Two harbours.', workIds: ['harbour-dawn', 'gone-from-catalog', 'harbour-dusk'] }],
      };
    },
    async note(_person, text, question) {
      if (text === 'fail') throw new Error('model is down');
      return 'I see: ' + text + (question ? ' (to: ' + question + ')' : '');
    },
    async notesOn() {
      return null;
    },
  };
  const start = (curator?: Curator) => {
    const db = createMemoryDb();
    const server = createApp(catalog, db, { curator }).listen(0, '127.0.0.1');
    return { server, db, base: () => 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
  };
  const withCurator = start(stub);
  const without = start();
  afterAll(() => {
    withCurator.server.close();
    without.server.close();
  });

  async function call<T>(base: string, method: string, route: string, body?: unknown) {
    const response = await fetch(base + route, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as T };
  }
  async function person({ db, base }: ReturnType<typeof start>): Promise<Profile> {
    const profile = await db.createProfile('Ada');
    await call(base(), 'POST', '/api/heart', { user_id: profile.id, art_id: 'rose', why: 'the pink' });
    return profile;
  }

  it('returns the portrait and rooms, with artworks looked up and missing ones dropped', async () => {
    const ada = await person(withCurator);
    const { body } = await call<CuratorResponse>(withCurator.base(), 'GET', '/api/curator/' + ada.id);
    expect(body.status).toBe('ready');
    expect(body.portrait).toBe('You are drawn to harbours.');
    expect(body.question).toEqual({ text: 'The water, or the light?', answers: ['The water', 'The light'] });
    expect(body.rooms).toHaveLength(1);
    expect(body.rooms[0].works.map(work => work.id)).toEqual(['harbour-dawn', 'harbour-dusk']);
    expect(body.saves_until_rooms).toBe(ROOMS_MIN_SAVED - 1);
    // The curator was told who the person is and what they saved, with their reason.
    expect(seen.at(-1)).toMatchObject({ id: ada.id, name: 'Ada', saved: [{ work: { id: 'rose' }, why: 'the pink' }] });
  });

  it('passes a note to the curator and returns its answer', async () => {
    const ada = await person(withCurator);
    const route = '/api/curator/' + ada.id + '/note';
    const { status, body } = await call<CuratorNoteResponse>(withCurator.base(), 'POST', route, { text: '  early mornings  ' });
    expect(status).toBe(200);
    expect(body.reply).toBe('I see: early mornings');
    const answered = await call<CuratorNoteResponse>(withCurator.base(), 'POST', route, { text: 'The light', question: 'The water, or the light?' });
    expect(answered.body.reply).toBe('I see: The light (to: The water, or the light?)');
    expect((await call(withCurator.base(), 'POST', route, { text: '   ' })).status).toBe(400);
    expect((await call(withCurator.base(), 'POST', route, { text: 'x'.repeat(601) })).status).toBe(400);
    expect((await call(withCurator.base(), 'POST', route, { text: 'fail' })).status).toBe(502);
  });

  it('says so when there is no curator, and still counts saves', async () => {
    const ada = await person(without);
    const { body } = await call<CuratorResponse>(without.base(), 'GET', '/api/curator/' + ada.id);
    expect(body).toEqual({ status: 'unavailable', portrait: null, question: null, rooms: [], saves_until_rooms: ROOMS_MIN_SAVED - 1 });
    expect((await call(without.base(), 'POST', '/api/curator/' + ada.id + '/note', { text: 'hello' })).status).toBe(503);
  });

  it('answers 404 for an unknown person', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await call(withCurator.base(), 'GET', '/api/curator/' + unknown)).status).toBe(404);
    expect((await call(withCurator.base(), 'POST', '/api/curator/' + unknown + '/note', { text: 'hi' })).status).toBe(404);
  });
});
