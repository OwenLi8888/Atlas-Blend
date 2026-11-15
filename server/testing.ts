/** A small hand-built catalog for tests. */
import type { Artwork } from '../src/rec/api';
import { buildCatalog, type Catalog } from './catalog';

export interface TestWork {
  id: string;
  vector: number[];
  artist?: string;
  medium?: string;
  cluster_id?: number;
}

export function testCatalog(entries: readonly TestWork[]): Catalog {
  const dim = entries[0].vector.length;
  const vectors = new Float32Array(entries.length * dim);
  const works: Artwork[] = entries.map((entry, index) => {
    const length = Math.hypot(...entry.vector);
    vectors.set(entry.vector.map(x => x / length), index * dim);
    return {
      id: entry.id,
      title: 'Title of ' + entry.id,
      artist: entry.artist ?? 'Artist of ' + entry.id,
      date: null,
      medium: entry.medium ?? null,
      source: 'test',
      cluster: 'Family ' + (entry.cluster_id ?? 0),
      cluster_id: entry.cluster_id ?? 0,
      image_url: 'https://example.test/' + entry.id + '.jpg',
      caption: null,
    };
  });
  return buildCatalog({ works, dim, vectors });
}
