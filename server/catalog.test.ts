import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Artwork } from '../src/rec/api';
import { curate, loadCatalog } from './catalog';
import { assignFamilies, FAMILY_NAMES, parseFamilies, readFamilies, type Families } from './families';
import { SAME_TASTE_SIMILARITY, similarity } from '../src/rec/scoring';
import { testCatalog } from './testing';

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

function curated(works: Artwork[], families: Families = []) {
  const vectors = Float32Array.from(works.flatMap((_, index) => [index, 1]));
  return curate({ works, dim: 2, vectors }, families);
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

  it('keeps two of the carriage design drawings and leaves out the rest', () => {
    const carriage = (id: string) => ({ ...work(id, 0, 'Pen and black ink, watercolor and gouache'), artist: 'Brewster & Co.' });
    const result = curated([carriage('met:378555'), carriage('met:378295'), carriage('met:378491'), work('oil', 0, 'Oil on canvas')]);
    expect(result.works.map(w => w.id)).toEqual(['met:378555', 'met:378491', 'oil']);
  });

  it('keeps each kept work paired with its own vector', () => {
    const result = curated([work('a', 0, 'chalk'), work('b', 0, 'Oil on canvas'), work('c', 0, 'ink on paper'), work('d', 0, null)]);
    expect([...result.vectors]).toEqual([1, 1, 3, 1]);
  });

  it('keeps the stored families when none of the listed works is in the collection', () => {
    const result = curated([work('a', 4, null)], [['elsewhere']]);
    expect(result.works[0]).toMatchObject({ cluster: 'stored name 4', cluster_id: 4 });
  });
});

describe('assignFamilies', () => {
  /** Two tight groups along two axes. Vectors are centred before comparing, so each group sits on its own side. */
  function grouped(extra: { id: string; vector: [number, number] }[] = []) {
    const entries: { id: string; vector: [number, number] }[] = [
      { id: 'red-1', vector: [1, 0.05] },
      { id: 'red-2', vector: [1, -0.05] },
      { id: 'blue-1', vector: [0.05, 1] },
      { id: 'blue-2', vector: [-0.05, 1] },
      ...extra,
    ];
    const works = entries.map(entry => work(entry.id, 99, null));
    const vectors = Float32Array.from(entries.flatMap(entry => {
      const length = Math.hypot(...entry.vector);
      return entry.vector.map(x => x / length);
    }));
    return { works, dim: 2, vectors };
  }
  const families: Families = [['blue-1', 'blue-2'], ['red-1', 'red-2']];
  const names = [
    { anchor: 'red-2', name: 'Reds' },
    { anchor: 'blue-1', name: 'Blues' },
  ];

  it('puts each listed work in its family and names the family after its anchor, whatever its position', () => {
    const result = assignFamilies(grouped(), families, names);
    expect(result.works.map(w => [w.id, w.cluster_id, w.cluster])).toEqual([
      ['red-1', 1, 'Reds'],
      ['red-2', 1, 'Reds'],
      ['blue-1', 0, 'Blues'],
      ['blue-2', 0, 'Blues'],
    ]);
  });

  it('puts a work added since the last recluster in the family it is most like', () => {
    const result = assignFamilies(grouped([{ id: 'new-red', vector: [0.9, 0.1] }]), families, names);
    expect(result.works.find(w => w.id === 'new-red')).toMatchObject({ cluster_id: 1, cluster: 'Reds' });
  });

  it('keeps a work that hardly resembles its family in it, but without the name', () => {
    // Halfway between the groups: closer to neither average than the threshold allows.
    const result = assignFamilies(grouped([{ id: 'between', vector: [1, 1] }]), [['blue-1', 'blue-2'], ['red-1', 'red-2', 'between']], names);
    expect(result.works.find(w => w.id === 'between')).toMatchObject({ cluster_id: 1, cluster: '' });
    expect(result.works.find(w => w.id === 'red-1')?.cluster).toBe('Reds');
  });

  it('leaves the vectors untouched', () => {
    const data = grouped();
    expect(assignFamilies(data, families, names).vectors).toBe(data.vectors);
  });
});

describe('families.json', () => {
  it('rejects a work listed in two families', () => {
    expect(() => parseFamilies({ families: [['a', 'b'], ['b']] })).toThrow('more than one family');
    expect(() => parseFamilies({ families: [] })).toThrow('no families');
  });

  it('gives every family exactly one name, and every name a different family', async () => {
    const families = await readFamilies();
    const familyOf = new Map(families.flatMap((members, family) => members.map(id => [id, family] as const)));
    const named = FAMILY_NAMES.map(({ anchor }) => familyOf.get(anchor));
    expect(named.every(family => family !== undefined)).toBe(true);
    expect(new Set(named).size).toBe(families.length);
    expect(new Set(FAMILY_NAMES.map(family => family.name)).size).toBe(FAMILY_NAMES.length);
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

describe('chooseOnboarding', () => {
  /** Unit vectors at the given angles (degrees) in a plane, one family per group. */
  const plane = (families: readonly (readonly number[])[]) => {
    const entries = families.flatMap((angles, family) =>
      angles.map((angle, n) => ({ id: family + '-' + n, vector: [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180), 0.2], cluster_id: family })),
    );
    const catalog = testCatalog(entries);
    return { catalog, ids: (rows: readonly number[]) => rows.map(row => catalog.works[row].id) };
  };

  it('shows each family by the work at its centre, not at its edge', () => {
    const { catalog, ids } = plane([[0, 10, 20], [120, 130, 140], [240, 250, 260]]);
    expect(ids(catalog.onboarding).sort()).toEqual(['0-1', '1-1', '2-1']);
  });

  it('never shows two tiles alike enough to count as one taste', () => {
    // Family 1 sits right beside family 0; family 2 is far from both.
    const { catalog } = plane([[0, 4, 8, 12], [14, 16, 18], [180, 184, 188]]);
    const tiles = catalog.onboarding;
    expect(tiles.length).toBeGreaterThan(0);
    for (const a of tiles) for (const b of tiles) if (a !== b) expect(similarity(catalog.corpus, a, b)).toBeLessThan(SAME_TASTE_SIMILARITY);
    expect(new Set(tiles.map(row => catalog.works[row].cluster_id)).size).toBe(tiles.length);
  });

  it('passes over a typical work that repeats a tile for a less typical one that does not', () => {
    // Most of family 1 lies inside family 0, so its typical works repeat that tile; its far end (70°) does not.
    const { catalog, ids } = plane([[0, 5, 10, 15, 20], [10, 12, 14, 70], [200, 210, 220]]);
    const shown = ids(catalog.onboarding);
    expect(shown).toHaveLength(3);
    expect(shown).toContain('1-3');
  });
});
