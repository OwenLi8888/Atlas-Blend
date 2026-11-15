import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Artwork } from '../src/rec/api';
import { curate, loadCatalog } from './catalog';
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

it('serves the last cache when a changed catalog cannot be downloaded', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'gallery-cache-'));
  await writeFile(path.join(cacheDir,'art_v1.json'), JSON.stringify({version:2,collection:'art_v1',fingerprint:'old',dim:2,works:[work('cached',0,'Oil')]}));
  await writeFile(path.join(cacheDir,'art_v1.f32'), new Uint8Array(new Float32Array([1,0]).buffer));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({results:[{found:2,hits:[]}]}))).mockRejectedValue(new Error('offline')));
  try {
    const catalog=await loadCatalog({cacheDir,collection:'art_v1',host:'https://example.test',apiKey:'test'});
    expect(catalog.works[0].id).toBe('cached');
  } finally { vi.unstubAllGlobals(); await rm(cacheDir,{recursive:true,force:true}); }
});
