/** Repeatable local audit: real cached vectors, isolated DB, no paid models. */
import { readFile } from 'node:fs/promises';
import { createApp } from './app';
import { buildCatalog, curate } from './catalog';
import { readFamilies } from './families';
import { createMemoryDb } from './memory-db';
import { seedDemoProfile } from './demo';

const start = performance.now();
const manifest = JSON.parse(await readFile(new URL('./.cache/art_v1.json', import.meta.url), 'utf8'));
const bytes = await readFile(new URL('./.cache/art_v1.f32', import.meta.url));
const vectors = new Float32Array(bytes.byteLength / 4);
new Uint8Array(vectors.buffer).set(bytes);
const catalog = buildCatalog(curate({ works: manifest.works, dim: manifest.dim, vectors }, await readFamilies()));
console.log(JSON.stringify({ catalogMs: performance.now() - start, works: catalog.works.length, dim: catalog.corpus.dim }));
const db = createMemoryDb();
await seedDemoProfile(db, catalog);
const server = createApp(catalog, db).listen(process.argv.includes('--serve') ? 43872 : 0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw Error('No port');
const base = 'http://127.0.0.1:' + address.port;
async function call(path: string, body?: unknown, method = body ? 'POST' : 'GET') {
  const t = performance.now();
  const r = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = r.status === 204 ? null : await r.json();
  if (!r.ok) throw Error(JSON.stringify(data));
  return { ms: performance.now() - t, data };
}
const rows: Record<string, number[]> = {};
let blendId = '';
for (let i = 0; i < 6; i++) {
  const measure = async (name: string, path: string, body?: unknown, method?: string) => {
    const result = await call(path, body, method);
    (rows[name] ??= []).push(result.ms);
    return result.data;
  };
  await measure('onboarding', '/onboarding');
  const picks = catalog.onboarding.slice(0, 3).map(row => catalog.works[row].id);
  const { profile: p } = await measure('sign up', '/profile', { name: 'Audit', picks });
  await measure('heart', '/heart', { user_id: p.id, art_id: catalog.works[catalog.onboarding[3]].id });
  await measure('profile', '/profile/' + p.id);
  await measure('recs', '/recs/' + p.id);
  const blend = await measure('blend', '/blend', { user_id: p.id, code: 'CANVAS' });
  blendId = blend.id;
  await measure('saved reveal', '/blend/' + blend.id + '?user_id=' + p.id);
  await measure('blends list', '/blends/' + p.id);
  await measure('discover', '/discover?seed=1&user_id=' + p.id);
  await measure('similar', '/similar?id=' + encodeURIComponent(catalog.works[0].id));
  await measure('unheart', '/heart?user_id=' + p.id + '&art_id=' + encodeURIComponent(catalog.works[catalog.onboarding[0]].id), undefined, 'DELETE');
}
// Without a model commission returns 404; measure that explicitly.
const t = performance.now();
const commission = await fetch(base + '/api/blend/' + blendId + '/commission');
console.log(JSON.stringify({ commission: { ms: performance.now() - t, status: commission.status } }));
console.log(JSON.stringify(Object.fromEntries(Object.entries(rows).map(([name, times]) => [name, { cold: times[0], warm: times.slice(1).sort((a,b) => a-b)[Math.floor((times.length-1)/2)] }])), null, 2));
if (!process.argv.includes('--serve')) server.close();
else console.log('Audit server ready on ' + base);
