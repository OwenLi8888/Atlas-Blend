/**
 * The art catalog, held in memory.
 *
 * At 6,674 works the whole collection is about 30 MB of vectors, so every
 * recommendation and blend is scored exactly against all of it in well under
 * 100 ms. Typesense is only read once, to fill a local cache file; after that
 * the server starts from disk and keeps working if Typesense is unreachable.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Artwork } from '../src/rec/api';
import { FAMILY_NAMES } from './families';
import {
  calibrate,
  similarity,
  type Calibration,
  type Corpus,
} from '../src/rec/scoring';

export interface Catalog {
  readonly works: readonly Artwork[];
  readonly corpus: Corpus;
  /** Row of a work in `works` and `corpus`, or undefined for an unknown ID. */
  indexOf(id: string): number | undefined;
  /** Onboarding tiles: one typical work from each distinct visual family. */
  readonly onboarding: readonly number[];
  readonly calibration: Calibration;
}

export interface CatalogSource {
  host: string;
  apiKey: string;
  collection: string;
  cacheDir: string;
}

export interface CatalogData {
  works: Artwork[];
  dim: number;
  vectors: Float32Array;
}

const PAGE_SIZE = 250;
const PAGE_CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 60_000;
const COUNT_TIMEOUT_MS = 4_000;
const CACHE_VERSION = 1;

const MAX_ONBOARDING_TILES = 24;
/** A family smaller than this share of the collection is too thin to recommend from. */
const MIN_FAMILY_SHARE = 0.015;

export async function loadCatalog(source: CatalogSource): Promise<Catalog> {
  const cached = await readCache(source);
  let liveCount: number | null = null;
  try {
    liveCount = await fetchCount(source);
  } catch (error) {
    if (!cached) throw new Error('Art catalog unavailable and no local cache: ' + describe(error));
    console.warn('Typesense unreachable, using cached catalog: ' + describe(error));
  }

  if (cached && (liveCount === null || liveCount === cached.works.length)) return buildCatalog(curate(cached));

  const fresh = await fetchAll(source, liveCount ?? 0);
  await writeCache(source, fresh);
  return buildCatalog(curate(fresh));
}

/** Media that are drawn or printed in one colour: pencil, ink, etching and the like. */
const MONOCHROME_MEDIUM =
  /\b(graphite|pencil|chalk|charcoal|crayon|conté|silverpoint|metalpoint|pen and|pen,|ink|etching|engraving|drypoint|lithograph|mezzotint|aquatint|woodcut|wood engraving|linocut|linoleum cut|monotype|photogravure|gelatin silver|albumen|letterpress|offset|transfer drawing|book|illustrated)/i;
/** Any sign of colour keeps a work, e.g. "pen and ink with watercolor" or "color lithograph". */
const COLOUR_MEDIUM =
  /\b(oil|watercolou?r|gouache|tempera|acrylic|pastel|colou?r|gold|polychrome|nishiki|enamel|fresco|encaustic|synthetic polymer|screenprint|silkscreen|pigment)|錦絵/i;

/**
 * Shapes the raw collection for the gallery: leaves out monochrome works on
 * paper (about one in six), which read as pale sketches on a wall of paintings,
 * and gives each visual family its display name. The cache keeps everything, so
 * this can change without refetching.
 */
export function curate(data: CatalogData): CatalogData {
  const kept: number[] = [];
  data.works.forEach((work, index) => {
    const monochrome = work.medium !== null && MONOCHROME_MEDIUM.test(work.medium) && !COLOUR_MEDIUM.test(work.medium);
    if (!monochrome) kept.push(index);
  });

  const vectors = new Float32Array(kept.length * data.dim);
  const works = kept.map((index, row) => {
    vectors.set(data.vectors.subarray(index * data.dim, (index + 1) * data.dim), row * data.dim);
    const work = data.works[index];
    return { ...work, cluster: FAMILY_NAMES[work.cluster_id] ?? work.cluster };
  });
  return { works, dim: data.dim, vectors };
}

export function buildCatalog(data: CatalogData): Catalog {
  const { works, dim, vectors } = data;
  if (vectors.length !== works.length * dim) throw new Error('Catalog vectors do not match its works');

  const corpus: Corpus = { count: works.length, dim, vectors };
  const rows = new Map(works.map((work, index) => [work.id, index]));
  if (rows.size !== works.length) throw new Error('Catalog contains duplicate artwork IDs');

  const calibration = calibrate(corpus);
  return {
    works,
    corpus,
    indexOf: id => rows.get(id),
    // Two tiles as alike as a work and its nearest neighbour would be the same choice twice.
    onboarding: chooseOnboarding(corpus, works, calibration.kindred),
    calibration,
  };
}

/**
 * Picks the onboarding grid from the visual families already assigned to each
 * work. Each family is shown by its most typical work. Families are added most
 * different first, up to the grid size, and one is left out when its tile is at
 * least `duplicateSimilarity` to a tile already on the grid, so every tile
 * tells us something new about the person.
 */
export function chooseOnboarding(corpus: Corpus, works: readonly Artwork[], duplicateSimilarity: number): number[] {
  const families = new Map<number, number[]>();
  works.forEach((work, index) => {
    const family = families.get(work.cluster_id);
    if (family) family.push(index);
    else families.set(work.cluster_id, [index]);
  });

  const minSize = Math.max(1, Math.ceil(works.length * MIN_FAMILY_SHARE));
  const tiles = [...families.values()]
    .filter(members => members.length >= minSize)
    .sort((a, b) => b.length - a.length)
    .map(members => mostTypical(corpus, members));
  if (tiles.length === 0) return [];

  const chosen = [tiles[0]];
  const remaining = tiles.slice(1);
  while (remaining.length > 0 && chosen.length < MAX_ONBOARDING_TILES) {
    let pick = 0;
    let pickSameness = Infinity;
    remaining.forEach((tile, position) => {
      const sameness = Math.max(...chosen.map(shown => similarity(corpus, tile, shown)));
      if (sameness < pickSameness) {
        pick = position;
        pickSameness = sameness;
      }
    });
    if (pickSameness >= duplicateSimilarity) break;
    chosen.push(remaining.splice(pick, 1)[0]);
  }
  return chosen;
}

/** The member closest to the average of its family. */
function mostTypical(corpus: Corpus, members: readonly number[]): number {
  const { dim, vectors } = corpus;
  const mean = new Float64Array(dim);
  for (const member of members) {
    const row = member * dim;
    for (let d = 0; d < dim; d++) mean[d] += vectors[row + d];
  }
  let best = members[0];
  let bestScore = -Infinity;
  for (const member of members) {
    const row = member * dim;
    let score = 0;
    for (let d = 0; d < dim; d++) score += vectors[row + d] * mean[d];
    if (score > bestScore) {
      best = member;
      bestScore = score;
    }
  }
  return best;
}

// --- Typesense -------------------------------------------------------------

interface SearchResult {
  found: number;
  hits: { document: unknown }[];
}

async function search(source: CatalogSource, params: Record<string, unknown>, timeoutMs: number): Promise<SearchResult> {
  const response = await fetch(source.host.replace(/\/$/, '') + '/multi_search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-TYPESENSE-API-KEY': source.apiKey },
    body: JSON.stringify({ searches: [{ collection: source.collection, q: '*', ...params }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error('Typesense responded ' + response.status);

  const payload: unknown = await response.json();
  const result = isRecord(payload) && Array.isArray(payload.results) ? payload.results[0] : undefined;
  if (!isRecord(result)) throw new Error('Unexpected Typesense response');
  if (typeof result.error === 'string') throw new Error('Typesense error: ' + result.error);
  if (typeof result.found !== 'number' || !Array.isArray(result.hits)) throw new Error('Unexpected Typesense response');

  const hits = result.hits.map(hit => {
    if (!isRecord(hit)) throw new Error('Unexpected Typesense hit');
    return { document: hit.document };
  });
  return { found: result.found, hits };
}

async function fetchCount(source: CatalogSource): Promise<number> {
  return (await search(source, { per_page: 0 }, COUNT_TIMEOUT_MS)).found;
}

async function fetchAll(source: CatalogSource, expected: number): Promise<CatalogData> {
  const total = expected > 0 ? expected : await fetchCount(source);
  if (total === 0) throw new Error('Art collection is empty');

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const pages: unknown[][] = new Array(pageCount);
  let nextPage = 0;
  const worker = async () => {
    while (nextPage < pageCount) {
      const page = nextPage++;
      const result = await search(source, { per_page: PAGE_SIZE, page: page + 1 }, FETCH_TIMEOUT_MS);
      pages[page] = result.hits.map(hit => hit.document);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, pageCount) }, worker));

  const documents = pages.flat();
  if (documents.length !== total) {
    throw new Error('Expected ' + total + ' artworks from Typesense, received ' + documents.length);
  }

  const first = parseDocument(documents[0]);
  const dim = first.vector.length;
  const works: Artwork[] = [];
  const vectors = new Float32Array(total * dim);
  documents.forEach((document, index) => {
    const { work, vector } = index === 0 ? first : parseDocument(document);
    if (vector.length !== dim) throw new Error('Artwork ' + work.id + ' has a vector of the wrong size');
    works.push(work);
    vectors.set(unitVector(vector, work.id), index * dim);
  });
  return { works, dim, vectors };
}

function parseDocument(document: unknown): { work: Artwork; vector: number[] } {
  if (!isRecord(document)) throw new Error('Artwork document is not an object');
  const id = requiredString(document, 'id', '?');
  const vector = document.image_vec;
  if (!Array.isArray(vector) || vector.length === 0 || !vector.every(x => typeof x === 'number' && Number.isFinite(x))) {
    throw new Error('Artwork ' + id + ' has no usable image vector');
  }
  if (typeof document.cluster_id !== 'number') throw new Error('Artwork ' + id + ' has no cluster_id');

  const work: Artwork = {
    id,
    title: requiredString(document, 'title', id),
    artist: optionalString(document, 'artist') ?? '',
    date: optionalString(document, 'date'),
    medium: optionalString(document, 'medium'),
    source: optionalString(document, 'source') ?? '',
    cluster: optionalString(document, 'cluster') ?? '',
    cluster_id: document.cluster_id,
    image_url: requiredString(document, 'image_url', id),
    caption: optionalString(document, 'caption'),
  };
  return { work, vector: vector as number[] };
}

function unitVector(vector: readonly number[], id: string): Float32Array {
  let squared = 0;
  for (const x of vector) squared += x * x;
  const length = Math.sqrt(squared);
  if (length === 0) throw new Error('Artwork ' + id + ' has a zero image vector');
  return Float32Array.from(vector, x => x / length);
}

// --- Disk cache ------------------------------------------------------------

interface CacheManifest {
  version: number;
  collection: string;
  dim: number;
  works: Artwork[];
}

function cachePaths(source: CatalogSource) {
  const base = path.join(source.cacheDir, source.collection);
  return { manifest: base + '.json', vectors: base + '.f32' };
}

async function readCache(source: CatalogSource): Promise<CatalogData | null> {
  const paths = cachePaths(source);
  try {
    const manifest = JSON.parse(await readFile(paths.manifest, 'utf8')) as CacheManifest;
    if (manifest.version !== CACHE_VERSION || manifest.collection !== source.collection) return null;
    if (!Array.isArray(manifest.works) || !Number.isInteger(manifest.dim) || manifest.dim <= 0) return null;

    const bytes = await readFile(paths.vectors);
    const expectedBytes = manifest.works.length * manifest.dim * Float32Array.BYTES_PER_ELEMENT;
    if (bytes.byteLength !== expectedBytes) return null;

    // Copy into a fresh buffer: a file Buffer may sit at an offset Float32Array cannot view.
    const vectors = new Float32Array(manifest.works.length * manifest.dim);
    new Uint8Array(vectors.buffer).set(bytes);
    return { works: manifest.works, dim: manifest.dim, vectors };
  } catch {
    // A missing or unreadable cache is rebuilt from Typesense.
    return null;
  }
}

async function writeCache(source: CatalogSource, data: CatalogData): Promise<void> {
  const paths = cachePaths(source);
  const manifest: CacheManifest = {
    version: CACHE_VERSION,
    collection: source.collection,
    dim: data.dim,
    works: data.works,
  };
  await mkdir(source.cacheDir, { recursive: true });
  // Write to temporary names first so an interrupted write never leaves a half cache.
  await writeFile(paths.vectors + '.tmp', new Uint8Array(data.vectors.buffer, data.vectors.byteOffset, data.vectors.byteLength));
  await writeFile(paths.manifest + '.tmp', JSON.stringify(manifest));
  await rename(paths.vectors + '.tmp', paths.vectors);
  await rename(paths.manifest + '.tmp', paths.manifest);
}

// --- Small parsing helpers -------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function requiredString(record: Record<string, unknown>, key: string, id: string): string {
  const value = optionalString(record, key);
  if (value === null) throw new Error('Artwork ' + id + ' is missing ' + key);
  return value;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
