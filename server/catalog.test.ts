import { describe, expect, it } from 'vitest';
import type { Artwork } from '../src/rec/api';
import { curate } from './catalog';
import { FAMILY_NAMES } from './families';

function work(id: string, cluster_id: number, medium: string | null): Artwork {
  return {
    id,
    title: id,
    artist: '',
    date: null,
    medium,
    source: 'test',
    cluster: 'stored name ' + cluster_id,
    cluster_id,
    image_url: 'https://example.test/' + id + '.jpg',
    caption: null,
  };
}

function curated(works: Artwork[]) {
  const vectors = Float32Array.from(works.flatMap((_, index) => [index, 1]));
  return curate({ works, dim: 2, vectors });
}

describe('curate', () => {
  it('leaves out monochrome works on paper and keeps anything with colour', () => {
    const result = curated([
      work('pencil', 0, 'graphite on wove paper'),
      work('etching', 0, 'Etching and drypoint'),
      work('oil', 0, 'Oil on canvas'),
      work('tinted', 0, 'pen and brown ink with watercolor'),
      work('print', 0, 'color lithograph'),
      work('unknown', 0, null),
    ]);
    expect(result.works.map(w => w.id)).toEqual(['oil', 'tinted', 'print', 'unknown']);
  });

  it('keeps each kept work paired with its own vector', () => {
    const result = curated([work('a', 0, 'chalk'), work('b', 0, 'Oil on canvas'), work('c', 0, 'ink on paper'), work('d', 0, null)]);
    expect([...result.vectors]).toEqual([1, 1, 3, 1]);
  });

  it('names a family after its anchor artwork, whatever number the family has', () => {
    const { anchor, name } = FAMILY_NAMES[0];
    const result = curated([work(anchor, 41, 'Oil on canvas'), work('sibling', 41, null), work('other', 7, null)]);
    expect(result.works.find(w => w.id === 'sibling')?.cluster).toBe(name);
    expect(result.works.find(w => w.id === 'other')?.cluster).toBe('stored name 7');
  });

  it('gives every family a different name', () => {
    expect(new Set(FAMILY_NAMES.map(family => family.name)).size).toBe(FAMILY_NAMES.length);
    expect(new Set(FAMILY_NAMES.map(family => family.anchor)).size).toBe(FAMILY_NAMES.length);
  });
});
