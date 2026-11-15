/**
 * The art catalog, held in memory.
 *
 * At 6,727 works the whole collection is about 31 MB of vectors, so every
 * recommendation and blend is scored exactly against all of it in well under
 * 100 ms. Typesense is only read once, to fill a local cache file; after that
 * the server starts from disk and keeps working if Typesense is unreachable.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Artwork } from '../src/rec/api';
import { assignFamilies, readFamilies, type Families } from './families';
import {
  calibrate,
  SAME_TASTE_SIMILARITY,
  similarity,
  type Calibration,
  type Corpus,
} from '../src/rec/scoring';

export interface Catalog {
  readonly works: readonly Artwork[];
  readonly corpus: Corpus;
  /** Row of a work in `works` and `corpus`, or undefined for an unknown ID. */
  indexOf(id: string): number | undefined;
  /** Onboarding tiles: one typical work from each visual family, no two alike enough to be one taste. */
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

/** What the collection looks like from outside: how many works, and how many in each family. */
type Fingerprint = string;

const PAGE_SIZE = 250;
const PAGE_CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 60_000;
const FINGERPRINT_TIMEOUT_MS = 4_000;
const CACHE_VERSION = 2;

/** Upper bound on visual families, for the one request that counts works per family. */
const MAX_FAMILIES = 1000;

/** Six rows of five: more tiles than this is more than anyone looks through. */
const MAX_ONBOARDING_TILES = 30;
/** How far down a family's most typical works to look for a tile unlike those already shown. */
const TILE_CANDIDATES_PER_FAMILY = 10;
/** A family smaller than this share of the collection is too thin to recommend from. */
const MIN_FAMILY_SHARE = 0.015;

export async function loadCatalog(source: CatalogSource): Promise<Catalog> {
  const [data, families] = await Promise.all([loadCatalogData(source), readFamilies()]);
  return buildCatalog(curate(data, families));
}

/**
 * The whole collection as stored, before curation: from the local cache while
 * the collection is unchanged, otherwise freshly from Typesense.
 */
export async function loadCatalogData(source: CatalogSource): Promise<CatalogData> {
  const cached = await readCache(source);
  let live: Fingerprint | null = null;
  try {
    live = await fetchFingerprint(source);
  } catch (error) {
    if (!cached) throw new Error('Art catalog unavailable and no local cache: ' + describe(error));
    console.warn('Typesense unreachable, using cached catalog: ' + describe(error));
  }

  // The cache is reused only while the collection is unchanged. Works being
  // added or the stored families being reassigned both change the fingerprint.
  if (cached && (live === null || live === cached.fingerprint)) return cached.data;

  try {
    const fresh = await fetchAll(source);
    await writeCache(source, fresh, live ?? fingerprintOf(fresh.works));
    return fresh;
  } catch (error) {
    if (!cached) throw error;
    // A changed fingerprint is not proof that every export page is reachable.
    console.warn('Catalog refresh failed, using cached catalog: ' + describe(error));
    return cached.data;
  }
}

/** Media that are drawn or printed in one colour: pencil, ink, etching and the like. */
const MONOCHROME_MEDIUM =
  /\b(graphite|pencil|chalk|charcoal|crayon|conté|silverpoint|metalpoint|pen and|pen,|ink|etching|engraving|drypoint|lithograph|mezzotint|aquatint|woodcut|wood engraving|linocut|linoleum cut|monotype|photogravure|gelatin silver|albumen|letterpress|offset|transfer drawing|book|illustrated)/i;
/** Any sign of colour keeps a work, e.g. "pen and ink with watercolor" or "color lithograph". */
const COLOUR_MEDIUM =
  /\b(oil|watercolou?r|gouache|tempera|acrylic|pastel|colou?r|gold|polychrome|nishiki|enamel|fresco|encaustic|synthetic polymer|screenprint|silkscreen|pigment)|錦絵/i;

/**
 * The carriage maker Brewster & Co.'s design drawings, plus one periodical
 * engraving of a cart. There are 45, all alike: together they form a visual
 * family of their own and take an onboarding tile from real painting. These
 * two stay, as a curiosity among the watercolours.
 */
const CARRIAGE_DESIGNS_KEPT: ReadonlySet<string> = new Set([
  'met:378555', // Roof Seat Break #4147: red and black
  'met:378491', // Victoria #4032: green on mint paper
]);
const isCarriageDesign = (work: Artwork) => work.artist.startsWith('Brewster & Co.') || work.id === 'met:379998';

/**
 * Whether a work belongs on the walls. Monochrome works on paper read as pale
 * sketches among paintings, and only two of the carriage designs are kept.
 */
export function isShown(work: Artwork): boolean {
  if (isCarriageDesign(work) && !CARRIAGE_DESIGNS_KEPT.has(work.id)) return false;
  return work.medium === null || !MONOCHROME_MEDIUM.test(work.medium) || COLOUR_MEDIUM.test(work.medium);
}

/**
 * Shapes the raw collection for the gallery: leaves out monochrome works on
 * paper (about one in six) and most carriage designs, and puts every work in
 * its visual family. The cache
 * keeps everything, so this can change without refetching.
 */
export function curate(data: CatalogData, families: Families): CatalogData {
  const kept: number[] = [];
  data.works.forEach((work, index) => {
    if (isShown(work)) kept.push(index);
  });

  const vectors = new Float32Array(kept.length * data.dim);
  const works = kept.map((index, row) => {
    vectors.set(data.vectors.subarray(index * data.dim, (index + 1) * data.dim), row * data.dim);
    return data.works[index];
  });
  return assignFamilies({ works, dim: data.dim, vectors }, families);
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
    onboarding: chooseOnboarding(corpus, works, SAME_TASTE_SIMILARITY),
    calibration,
  };
}

/**
 * Picks the onboarding grid: one tile from each visual family, every tile a
 * different taste from every other.
 *
 * A family is shown by one of its most typical works. Families are added
 * most-different first; each puts forward its most typical work that is less
 * than `sameTaste` alike to every tile already on the grid, looking no deeper
 * than `TILE_CANDIDATES_PER_FAMILY`. Two tiles that alike would be grouped as
 * one taste if both were chosen, so the second would tell us nothing new. A
 * family with no such work is left out.
 */
export function chooseOnboarding(corpus: Corpus, works: readonly Artwork[], sameTaste: number): number[] {
  const families = new Map<number, number[]>();
  works.forEach((work, index) => {
    const family = families.get(work.cluster_id);
    if (family) family.push(index);
    else families.set(work.cluster_id, [index]);
  });

  const minSize = Math.max(1, Math.ceil(works.length * MIN_FAMILY_SHARE));
  const collectionMean = meanVector(corpus);
  const remaining = [...families.values()]
    .filter(members => members.length >= minSize)
    .sort((a, b) => b.length - a.length)
    .map(members => mostTypical(corpus, members, collectionMean, TILE_CANDIDATES_PER_FAMILY));
  const first = remaining.shift();
  if (!first) return [];

  const chosen = [first[0]];
  while (remaining.length > 0 && chosen.length < MAX_ONBOARDING_TILES) {
    let pick: { family: number; tile: number; sameness: number } | null = null;
    remaining.forEach((candidates, family) => {
      for (const tile of candidates) {
        const sameness = Math.max(...chosen.map(shown => similarity(corpus, tile, shown)));
        if (sameness >= sameTaste) continue;
        if (pick === null || sameness < pick.sameness) pick = { family, tile, sameness };
        break;
      }
    });
    if (pick === null) break;
    const { family, tile }: { family: number; tile: number } = pick;
    chosen.push(tile);
    remaining.splice(family, 1);
  }
  return chosen;
}

/** The average of every vector in the corpus. */
function meanVector(corpus: Corpus): Float64Array {
  const { count, dim, vectors } = corpus;
  const mean = new Float64Array(dim);
  for (let row = 0; row < count; row++) {
    const offset = row * dim;
    for (let d = 0; d < dim; d++) mean[d] += vectors[offset + d];
  }
  for (let d = 0; d < dim; d++) mean[d] /= count;
  return mean;
}

/**
 * The `limit` members most like their family's average, most typical first.
 * Likeness is the cosine measured after taking away the collection average, as
 * the families themselves are made (see `recluster.ts`): what every artwork
 * shares says nothing about which family a work typifies, and measured with it
 * the most generic-looking member wins.
 */
function mostTypical(corpus: Corpus, members: readonly number[], collectionMean: Float64Array, limit: number): number[] {
  const { dim, vectors } = corpus;
  const familyMean = new Float64Array(dim);
  for (const member of members) {
    const row = member * dim;
    for (let d = 0; d < dim; d++) familyMean[d] += vectors[row + d] - collectionMean[d];
  }
  return members
    .map(member => {
      const row = member * dim;
      let dot = 0;
      let squared = 0;
      for (let d = 0; d < dim; d++) {
        const x = vectors[row + d] - collectionMean[d];
        dot += x * familyMean[d];
        squared += x * x;
      }
      return { member, likeness: squared === 0 ? 0 : dot / Math.sqrt(squared) };
    })
    .sort((a, b) => b.likeness - a.likeness)
    .slice(0, limit)
    .map(entry => entry.member);
}

// --- Typesense -------------------------------------------------------------

interface SearchResult {
  found: number;
  hits: { document: unknown }[];
  /** Number of works per value of each faceted field, when facets were asked for. */
  facets: Map<string, number>;
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
  const facets = new Map<string, number>();
  const facetCounts = Array.isArray(result.facet_counts) ? result.facet_counts : [];
  for (const facet of facetCounts) {
    if (!isRecord(facet) || !Array.isArray(facet.counts)) continue;
    for (const entry of facet.counts) {
      if (isRecord(entry) && typeof entry.value === 'string' && typeof entry.count === 'number') {
        facets.set(entry.value, entry.count);
      }
    }
  }
  return { found: result.found, hits, facets };
}

/** One cheap request: the number of works and how they are spread over the families. */
async function fetchFingerprint(source: CatalogSource): Promise<Fingerprint> {
  const result = await search(
    source,
    { per_page: 0, facet_by: 'cluster_id', max_facet_values: MAX_FAMILIES },
    FINGERPRINT_TIMEOUT_MS,
  );
  return fingerprint(result.found, result.facets);
}

function fingerprintOf(works: readonly Artwork[]): Fingerprint {
  const sizes = new Map<string, number>();
  for (const work of works) {
    const family = String(work.cluster_id);
    sizes.set(family, (sizes.get(family) ?? 0) + 1);
  }
  return fingerprint(works.length, sizes);
}

function fingerprint(total: number, familySizes: ReadonlyMap<string, number>): Fingerprint {
  const sizes = [...familySizes].sort(([a], [b]) => Number(a) - Number(b)).map(([family, size]) => family + ':' + size);
  return total + '|' + sizes.join(',');
}

async function fetchAll(source: CatalogSource): Promise<CatalogData> {
  const total = (await search(source, { per_page: 0 }, FINGERPRINT_TIMEOUT_MS)).found;
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
  fingerprint: Fingerprint;
  dim: number;
  works: Artwork[];
}

function cachePaths(source: CatalogSource) {
  const base = path.join(source.cacheDir, source.collection);
  return { manifest: base + '.json', vectors: base + '.f32' };
}

async function readCache(source: CatalogSource): Promise<{ data: CatalogData; fingerprint: Fingerprint } | null> {
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
    return { data: { works: manifest.works, dim: manifest.dim, vectors }, fingerprint: manifest.fingerprint };
  } catch {
    // A missing or unreadable cache is rebuilt from Typesense.
    return null;
  }
}

async function writeCache(source: CatalogSource, data: CatalogData, fingerprint: Fingerprint): Promise<void> {
  const paths = cachePaths(source);
  const manifest: CacheManifest = {
    version: CACHE_VERSION,
    collection: source.collection,
    fingerprint,
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
