import { describe, it, expect } from 'vitest';
import { normalize, cosine, taste, blendScore, recommend, diversify, bridge, overlap, publicWork, type Work } from '../src/rec/scoring';
const w = (id: string, v: number[], artist = id): Work => ({ id, title: id, artist, image_vec: v });
describe('taste and scoring', () => {
  it('normalizes and rejects invalid vectors', () => {
    expect(normalize([3, 4])).toEqual([0.6, 0.8]);
    expect(() => normalize([0, 0])).toThrow();
    expect(() => normalize([NaN])).toThrow();
    expect(() => cosine([1], [1, 2])).toThrow();
  });
  it('keeps distinct interests instead of averaging them away', () => {
    const t = taste([[1, 0, 0], [.99, .01, 0], [0, 1, 0], [0, 0, 1]]);
    expect(t).toHaveLength(3);
    expect(t.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1);
    expect(taste([])).toEqual([]);
    expect(taste([[1, 0], [1, 0]])).toHaveLength(1);
  });
  it('rewards mutual matches, not one-sided ones; symmetric', () => {
    const a = taste([[1, 0]]), b = taste([[0, 1]]);
    expect(blendScore([1, 1], a, b)).toBeGreaterThan(blendScore([1, 0], a, b));
    expect(blendScore([1, 1], a, b)).toEqual(blendScore([1, 1], b, a));
    expect(overlap(a, a)).toBe(100);
    expect(overlap(a, [])).toBe(0);
  });
  it('round robins interests and excludes hearts and duplicates', () => {
    const a = w('a', [1, 0]), b = w('b', [.99, .01]), c = w('c', [0, 1]);
    const result = recommend([[a, b], [a, c]], taste([[1, 0], [0, 1]]), new Set(['a']));
    expect(result.map(x => x.id)).toEqual(['b', 'c']);
  });
  it('caps artists, excludes initial selection, strips vectors, selects bridge', () => {
    const pool = [w('1', [1, 0], 'same'), w('2', [1, .1], 'same'), w('3', [1, .2], 'same'), w('4', [0, 1])];
    const result = diversify(pool, () => 1, 9);
    expect(result.filter(x => x.artist === 'same')).toHaveLength(2);
    expect(diversify(pool, () => 1, 2, [pool[0]]).map(x => x.id)).not.toContain('1');
    expect(bridge(pool[0], [pool[3], pool[1]])?.id).toBe('2');
    expect(publicWork(pool[0])).not.toHaveProperty('image_vec');
  });
});
