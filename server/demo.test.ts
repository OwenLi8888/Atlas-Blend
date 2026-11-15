import { describe, expect, it } from 'vitest';
import type { Artwork } from '../src/rec/api';
import { buildCatalog } from './catalog';
import { DEMO_BLEND_CODE, DEMO_NAME, seedDemoProfile } from './demo';
import { FAMILY_NAMES } from './families';
import { createMemoryDb } from './memory-db';

/** A catalog holding the three seed artworks, each with a few close neighbours, plus unrelated works. */
function demoCatalog() {
  const seeds = ['Japanese folding screens', 'Hard-edge abstraction', 'Indian miniature paintings'].map(
    name => FAMILY_NAMES.find(family => family.name === name)!.anchor,
  );
  const works: Artwork[] = [];
  const rows: number[][] = [];
  const add = (id: string, vector: number[]) => {
    works.push({ id, title: id, artist: '', date: null, medium: null, source: 't', cluster: 'c', cluster_id: 0, image_url: 'u', caption: null });
    const length = Math.hypot(...vector);
    rows.push(vector.map(x => x / length));
  };
  seeds.forEach((seed, axis) => {
    const direction = [0, 0, 0, 0].map((_, d) => (d === axis ? 1 : 0));
    add(seed, direction);
    for (let n = 1; n <= 12; n++) add('near-' + axis + '-' + n, direction.map((x, d) => (d === 3 ? n * 0.01 : x)));
  });
  for (let n = 0; n < 5; n++) add('far-' + n, [0.1 * n, 0.1, 0.1, 1]);
  return { catalog: buildCatalog({ works, dim: 4, vectors: Float32Array.from(rows.flat()) }), seeds };
}

describe('seedDemoProfile', () => {
  it('creates the profile with its fixed code and hearts around each seed', async () => {
    const db = createMemoryDb();
    const { catalog, seeds } = demoCatalog();
    await seedDemoProfile(db, catalog);

    const profile = await db.findProfileByCode(DEMO_BLEND_CODE);
    expect(profile?.name).toBe(DEMO_NAME);
    const hearts = await db.listHearts(profile!.id, 300);
    expect(hearts).toHaveLength(22);
    expect(hearts.filter(heart => heart.art_id.startsWith('far-'))).toHaveLength(0);
    for (const seed of seeds) expect(hearts.find(heart => heart.art_id === seed)?.why).toBeTruthy();
  });

  it('does nothing the second time', async () => {
    const db = createMemoryDb();
    const { catalog } = demoCatalog();
    await seedDemoProfile(db, catalog);
    const first = await db.findProfileByCode(DEMO_BLEND_CODE);
    await seedDemoProfile(db, catalog);
    const second = await db.findProfileByCode(DEMO_BLEND_CODE);
    expect(second?.id).toBe(first!.id);
    expect(await db.listHearts(second!.id, 300)).toHaveLength(22);
  });
});
