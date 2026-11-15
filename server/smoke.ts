import assert from 'node:assert/strict';
import { createApp } from './app';
import { createServices } from './services';
const services = createServices();
const server = createApp(services).listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No local address');
const base = 'http://127.0.0.1:' + address.port;
const users: string[] = [];
async function request(path: string, body?: unknown) {
  const r = await fetch(base + path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await r.json();
  assert.ok(r.ok, path + ' ' + r.status + ' ' + JSON.stringify(json));
  return json;
}
try {
  const onboarding = await request('/api/onboarding');
  assert.equal(onboarding.works.length, 20);
  assert.equal(new Set(onboarding.works.map((w: {cluster_id: number}) => w.cluster_id)).size, 20);
  const docs = await services.documents([onboarding.works[0].id]);
  assert.equal(docs[0].image_vec.length, 1152);
  console.log('Live Typesense OK: 20 distinct clusters, colon-safe ID lookup, 1152d vector');
  const a = await request('/api/profile', {name: 'TEMP smoke A'});
  users.push(a.id);
  const b = await request('/api/profile', {name: 'TEMP smoke B'});
  users.push(b.id);
  for (const [user, indices] of [[a, [0, 1, 2]], [b, [3, 4, 5]]] as const)
    for (const i of indices) await request('/api/heart', {user_id: user.id, art_id: onboarding.works[i].id, why: 'smoke test'});
  await request('/api/heart', {user_id: a.id, art_id: onboarding.works[0].id});
  const recs = await request('/api/recs/' + a.id);
  assert.ok(recs.works.length > 0 && recs.works.length <= 12);
  assert.ok(recs.works.every((w: {id: string; image_vec?: number[]}) =>
    !w.image_vec && !onboarding.works.slice(0, 3).some((h: {id: string}) => h.id === w.id)));
  const blend = await request('/api/blend', {user_id: a.id, code: b.blend_code});
  assert.ok(blend.id && blend.top_artwork && blend.bridge.a && blend.bridge.b);
  assert.ok(blend.picks.length > 0 && blend.picks.length <= 8);
  assert.ok(!onboarding.works.slice(0, 6).some((h: {id: string}) => h.id === blend.top_artwork.id));
  const saved = await services.db.from('blends').select('id').eq('id', blend.id).single();
  assert.ok(!saved.error && saved.data.id === blend.id);
  console.log(JSON.stringify({recs: recs.works.length, tastes: recs.taste_count, picks: blend.picks.length, score: blend.score, saved: true}));
} finally {
  for (const id of users) {
    const { error } = await services.db.from('profiles').delete().eq('id', id);
    if (error) console.error('Temporary profile cleanup failed', id, error.message);
  }
  server.close();
}
