/**
 * End-to-end check against the live Typesense catalog and the real Supabase
 * project. Creates two temporary profiles and always deletes them afterwards.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { BlendResponse, OnboardingResponse, Profile, ProfileResponse, RecsResponse } from '../src/rec/api';
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

  const a = await request<Profile>('POST', '/api/profile', { name: 'TEMP smoke A' });
  temporaryProfiles.push(a.id);
  const b = await request<Profile>('POST', '/api/profile', { name: 'TEMP smoke B' });
  temporaryProfiles.push(b.id);

  const picksA = onboarding.works.slice(0, 3);
  const picksB = onboarding.works.slice(3, 6);
  for (const work of picksA) await request('POST', '/api/heart', { user_id: a.id, art_id: work.id, why: 'smoke test' });
  for (const work of picksB) await request('POST', '/api/heart', { user_id: b.id, art_id: work.id });

  // Hearting again without a reason keeps the saved reason.
  await request('POST', '/api/heart', { user_id: a.id, art_id: picksA[0].id });
  const profile = await request<ProfileResponse>('GET', '/api/profile/' + a.id);
  assert.equal(profile.hearts.length, 3);
  assert.ok(profile.hearts.every(heart => heart.why === 'smoke test'));

  const recs = await request<RecsResponse>('GET', '/api/recs/' + a.id);
  assert.equal(recs.works.length, 12);
  assert.ok(recs.works.every(rec => !picksA.some(work => work.id === rec.work.id)), 'recs should not repeat hearts');

  const hearted = new Set([...picksA, ...picksB].map(work => work.id));

  const blend = await request<BlendResponse>('POST', '/api/blend', { user_id: a.id, code: b.blend_code });
  assert.ok(!hearted.has(blend.top_artwork.id), 'the reveal should be new to both people');
  assert.ok(blend.wall.some(item => item.from === 'you') && blend.wall.some(item => item.from === 'friend'));
  assert.ok(blend.wall.every(item => item.work.id !== blend.top_artwork.id));
  assert.equal(blend.bridge.a.why, 'smoke test');
  assert.ok(blend.score >= 0 && blend.score <= 100);

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
