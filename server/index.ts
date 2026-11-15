import path from 'node:path';
import { createApp } from './app';
import { createAtelier, DEFAULT_AGENT_MODEL } from './atelier';
import { loadCatalog } from './catalog';
import { createCommissions, noCommissions, type Commissions } from './commission';
import { createSupabaseDb, type Db } from './db';
import { seedDemoProfile } from './demo';
import { createGeminiImageMaker, DEFAULT_IMAGE_MODEL } from './gemini';
import { createMemoryDb } from './memory-db';

const DEFAULT_PORT = 43871;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('Missing environment variable ' + name);
  return value;
}

function portFromEnv(): number {
  const raw = process.env.PORT;
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT: ' + raw);
  return port;
}

const port = portFromEnv();
const host = process.env.HOST || '127.0.0.1';

/** GALLERY_DB=memory runs without Supabase: profiles and hearts last until the server stops. */
function databaseFromEnv(): Db {
  if (process.env.GALLERY_DB === 'memory') {
    console.warn('Using the in-memory database: nothing is saved when the server stops.');
    return createMemoryDb();
  }
  return createSupabaseDb(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SECRET_KEY'));
}

const db = databaseFromEnv();

// The catalog is loaded before the server accepts requests, so no request ever
// sees a half-ready index. First start reads Typesense (about 15 s); later
// starts read the local cache.
const started = performance.now();
const catalog = await loadCatalog({
  host: requiredEnv('TYPESENSE_HOST'),
  apiKey: requiredEnv('TYPESENSE_KEY'),
  collection: process.env.TYPESENSE_COLLECTION || 'art_v1',
  cacheDir: path.join(import.meta.dirname, '.cache'),
});
console.log(
  'Catalog ready: ' + catalog.works.length + ' works, ' + catalog.onboarding.length + ' onboarding tiles, ' +
    Math.round(performance.now() - started) + ' ms',
);

// A missing demo profile should not stop the real gallery from opening.
await seedDemoProfile(db, catalog).catch(error => {
  console.error('Could not prepare the demo profile:', error instanceof Error ? error.message : error);
});

/** With GEMINI_API_KEY set, every blend gets a piece made for it; without, blends reveal a collection work. */
function commissionsFromEnv(): Commissions {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY is not set: blends will reveal a work from the collection instead of a new piece.');
    return noCommissions;
  }
  const imageModel = process.env.GEMINI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const agentModel = process.env.GEMINI_AGENT_MODEL || DEFAULT_AGENT_MODEL;
  console.log('Commissioned pieces: briefed and labelled by ' + agentModel + ', painted by ' + imageModel + '.');
  return createCommissions({
    makeImage: createGeminiImageMaker({ apiKey, model: imageModel }),
    fetchImage: (url, init) => fetch(url, init),
    atelier: createAtelier({ apiKey, model: agentModel }),
  });
}

createApp(catalog, db, { commissions: commissionsFromEnv() }).listen(port, host, () => {
  console.log('Gallery API listening on http://' + host + ':' + port);
});
