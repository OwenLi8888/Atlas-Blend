/**
 * End-to-end check against the live Typesense catalog and the real Supabase
 * project. Creates two temporary profiles and always deletes them afterwards.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type {
  BlendResponse,
  BlendsResponse,
  DiscoverResponse,
  OnboardingResponse,
  Profile,
  ProfileResponse,
  RecsResponse,
  SimilarResponse,
} from '../src/rec/api';
import { createApp } from './app';
import { loadCatalog } from './catalog';
import { createSupabaseDb } from './db';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('Missing environment variable ' + name);
  return value;
}

const db = createSupabaseDb(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SECRET_KEY'));
const catalog = await loadCatalog({
  host: requiredEnv('TYPESENSE_HOST'),
  apiKey: requiredEnv('TYPESENSE_KEY'),
  collection: process.env.TYPESENSE_COLLECTION || 'art_v1',
  cacheDir: path.join(import.meta.dirname, '.cache'),
});
const server = createApp(catalog, db).listen(0, '127.0.0.1');
if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;

async function request<T>(method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(base + route, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  assert.ok(response.ok, method + ' ' + route + ' answered ' + response.status + ' ' + text);
  return (text ? JSON.parse(text) : null) as T;
}

const temporaryProfiles: string[] = [];
try {
  const onboarding = await request<OnboardingResponse>('GET', '/api/onboarding');
  assert.ok(onboarding.works.length >= 12, 'expected a full onboarding grid');
  const families = new Set(onboarding.works.map(work => work.cluster_id));
  assert.equal(families.size, onboarding.works.length, 'onboarding tiles should each be a different family');

  const picksA = onboarding.works.slice(0, 3);
  const picksB = onboarding.works.slice(3, 6);
  const signUp = async (name: string, picks: readonly { id: string }[]) => {
    const { profile } = await request<ProfileResponse>('POST', '/api/profile', { name, picks: picks.map(work => work.id) });
    temporaryProfiles.push(profile.id);
    return profile;
  };
  const a = await signUp('TEMP smoke A', picksA);
  const b = await signUp('TEMP smoke B', picksB);
  for (const work of picksA) await request('POST', '/api/heart', { user_id: a.id, art_id: work.id, why: 'smoke test' });

  // Hearting again without a reason keeps the saved reason.
  await request('POST', '/api/heart', { user_id: a.id, art_id: picksA[0].id });
  const profile = await request<ProfileResponse>('GET', '/api/profile/' + a.id);
  assert.equal(profile.hearts.length, 3);
  assert.ok(profile.hearts.every(heart => heart.why === 'smoke test'));

  const recs = await request<RecsResponse>('GET', '/api/recs/' + a.id);
  assert.equal(recs.works.length, 24);
  assert.ok(recs.works.every(rec => !picksA.some(work => work.id === rec.work.id)), 'recs should not repeat hearts');

  const hearted = new Set([...picksA, ...picksB].map(work => work.id));

  const blend = await request<BlendResponse>('POST', '/api/blend', { user_id: a.id, code: b.blend_code });
  assert.ok(!hearted.has(blend.top_artwork.id), 'the reveal should be new to both people');
  assert.ok(blend.wall.some(item => item.from === 'you') && blend.wall.some(item => item.from === 'friend'));
  assert.ok(blend.wall.every(item => item.work.id !== blend.top_artwork.id));
  assert.equal(blend.trends.you[0].why, 'smoke test');
  assert.ok(blend.score >= 0 && blend.score <= 100);

  // A blend is kept, for both people, and can be opened again.
  const listed = await request<BlendsResponse>('GET', '/api/blends/' + b.id);
  assert.ok(
    listed.blends.some(saved => saved.id === blend.id),
    'the blend was not kept: run supabase/migrations/001_blend_result.sql in the Supabase SQL editor',
  );
  const reopened = await request<BlendResponse>('GET', '/api/blend/' + blend.id + '?user_id=' + b.id);
  assert.equal(reopened.score, blend.score);
  assert.equal(reopened.friend.name, 'TEMP smoke A');
  assert.deepEqual(reopened.trends.you, blend.trends.friend);

  const stroll = await request<DiscoverResponse>('GET', '/api/discover?seed=1&limit=20');
  assert.equal(stroll.works.length, 20);
  const similar = await request<SimilarResponse>('GET', '/api/similar?id=' + encodeURIComponent(picksA[0].id));
  assert.ok(similar.similar.length > 0 && similar.similar.every(work => work.id !== picksA[0].id));

  await request('DELETE', '/api/heart?user_id=' + a.id + '&art_id=' + encodeURIComponent(picksA[0].id));
  const afterRemoval = await request<ProfileResponse>('GET', '/api/profile/' + a.id);
  assert.equal(afterRemoval.hearts.length, 2);

  console.log('Smoke test passed:', {
    onboarding: onboarding.works.length,
    tastes: recs.taste_count,
    reveal: blend.top_artwork.title,
    score: blend.score,
  });
} finally {
  for (const id of temporaryProfiles) {
    await db.deleteProfile(id).catch(error => console.error('Could not delete temporary profile ' + id, error));
  }
  server.close();
}
