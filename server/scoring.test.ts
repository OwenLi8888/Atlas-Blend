import { describe, expect, it } from 'vitest';
import {
  allocateSlots,
  blendScores,
  calibrate,
  findTastes,
  nearest,
  overlapPercent,
  recommend,
  selectDiverse,
  similaritiesTo,
  similarity,
  topIndices,
  type Corpus,
  type Taste,
} from '../src/rec/scoring';

function corpusOf(rows: number[][]): Corpus {
  const dim = rows[0].length;
  const vectors = new Float32Array(rows.length * dim);
  rows.forEach((row, index) => {
    const length = Math.hypot(...row);
    vectors.set(row.map(x => x / length), index * dim);
  });
  return { count: rows.length, dim, vectors };
}

const noArtist = () => null;
const single = (medoid: number): Taste => ({ medoid, members: [medoid], weight: 1 });

describe('similarity', () => {
  const corpus = corpusOf([[1, 0], [0, 1], [1, 1]]);

  it('is the cosine between two works', () => {
    expect(similarity(corpus, 0, 0)).toBeCloseTo(1);
    expect(similarity(corpus, 0, 1)).toBeCloseTo(0);
    expect(similarity(corpus, 0, 2)).toBeCloseTo(Math.SQRT1_2);
  });

  it('scores the whole corpus against one work', () => {
    expect([...similaritiesTo(corpus, 0)].map(x => +x.toFixed(3))).toEqual([1, 0, 0.707]);
  });
});

describe('findTastes', () => {
  it('returns nothing for no hearts', () => {
    expect(findTastes(corpusOf([[1, 0]]), [])).toEqual([]);
  });

  it('keeps near-identical hearts as one taste', () => {
    const corpus = corpusOf([[1, 0, 0], [0.99, 0.05, 0], [0.98, 0, 0.05]]);
    const tastes = findTastes(corpus, [0, 1, 2]);
    expect(tastes).toHaveLength(1);
    expect(tastes[0].weight).toBe(1);
    expect(tastes[0].members).toHaveLength(3);
  });

  it('keeps different interests apart and weights them by share of hearts', () => {
    const corpus = corpusOf([[1, 0, 0], [0.99, 0.05, 0], [0.98, 0, 0.05], [0, 1, 0], [0, 0, 1]]);
    const tastes = findTastes(corpus, [0, 1, 2, 3, 4]);
    expect(tastes).toHaveLength(3);
    expect(tastes[0].weight).toBeCloseTo(0.6);
    expect([...tastes[0].members].sort()).toEqual([0, 1, 2]);
    expect(tastes.reduce((sum, taste) => sum + taste.weight, 0)).toBeCloseTo(1);
  });

  it('represents each taste by one of the hearts, never an average', () => {
    const corpus = corpusOf([[1, 0], [0, 1], [1, 0.1], [0.1, 1]]);
    for (const taste of findTastes(corpus, [0, 1, 2, 3])) expect(taste.members).toContain(taste.medoid);
  });

  it('gives a real second interest a group before a lone stray heart', () => {
    // Two interests of three hearts each, plus one stray, with room for only two tastes.
    const corpus = corpusOf([
      [1, 0, 0], [0.99, 0.1, 0], [0.99, 0, 0.1],
      [0, 1, 0], [0.1, 0.99, 0], [0, 0.99, 0.1],
      [0, 0, 1],
    ]);
    const tastes = findTastes(corpus, [0, 1, 2, 3, 4, 5, 6], 2);
    expect(tastes).toHaveLength(2);
    expect(tastes.map(taste => taste.medoid)).not.toContain(6);
  });

  it('ignores duplicate hearts and never exceeds the maximum', () => {
    const corpus = corpusOf([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
    expect(findTastes(corpus, [0, 0, 0])).toHaveLength(1);
    expect(findTastes(corpus, [0, 1, 2, 3])).toHaveLength(3);
  });
});

describe('allocateSlots', () => {
  it('shares slots by weight and gives every taste at least one', () => {
    expect(allocateSlots([0.9, 0.05, 0.05], 12)).toEqual([10, 1, 1]);
    expect(allocateSlots([0.5, 0.3, 0.2], 12)).toEqual([6, 4, 2]);
    expect(allocateSlots([1], 12)).toEqual([12]);
  });

  it('always hands out exactly the total', () => {
    for (const weights of [[1 / 3, 1 / 3, 1 / 3], [0.7, 0.3], [0.34, 0.33, 0.33]]) {
      expect(allocateSlots(weights, 12).reduce((a, b) => a + b, 0)).toBe(12);
    }
  });

  it('handles fewer slots than tastes and empty input', () => {
    expect(allocateSlots([0.5, 0.3, 0.2], 2)).toEqual([1, 1, 0]);
    expect(allocateSlots([], 12)).toEqual([]);
    expect(allocateSlots([1], 0)).toEqual([0]);
  });
});

describe('recommend', () => {
  // Works 0 and 4 are the hearts; 1-3 sit near heart 0, 5-6 near heart 4.
  const corpus = corpusOf([
    [1, 0], [0.99, 0.1], [0.98, 0.15], [0.97, 0.2],
    [0, 1], [0.1, 0.99], [0.15, 0.98],
  ]);
  const tastes = findTastes(corpus, [0, 4]);

  it('never recommends a hearted work or repeats one', () => {
    const picks = recommend(corpus, tastes, { count: 5, exclude: new Set([0, 4]), artistOf: noArtist });
    const indices = picks.map(pick => pick.index);
    expect(indices).not.toContain(0);
    expect(indices).not.toContain(4);
    expect(new Set(indices).size).toBe(indices.length);
    expect(indices).toHaveLength(5);
  });

  it('takes turns between tastes', () => {
    const picks = recommend(corpus, tastes, { count: 4, exclude: new Set([0, 4]), artistOf: noArtist });
    expect(picks.map(pick => pick.taste)).toEqual([0, 1, 0, 1]);
  });

  it('gives the bigger taste more of the wall', () => {
    const uneven: Taste[] = [
      { medoid: 0, members: [0], weight: 0.75 },
      { medoid: 4, members: [4], weight: 0.25 },
    ];
    const picks = recommend(corpus, uneven, { count: 4, exclude: new Set([0, 4]), artistOf: noArtist });
    expect(picks.filter(pick => pick.taste === 0)).toHaveLength(3);
  });

  it('returns nothing for a person with no tastes', () => {
    expect(recommend(corpus, [], { count: 12, exclude: new Set(), artistOf: noArtist })).toEqual([]);
  });
});

describe('selectDiverse', () => {
  const corpus = corpusOf([[1, 0], [1, 0.01], [1, 0.02], [0.6, 0.8], [0, 1]]);

  it('caps works per artist but not works with no known artist', () => {
    const sameArtist = (index: number) => (index < 3 ? 'same' : null);
    const options = { count: 5, relevance: () => 1 };
    expect(selectDiverse(corpus, [0, 1, 2, 3, 4], { ...options, artistOf: sameArtist }).filter(i => i < 3)).toHaveLength(2);
    expect(selectDiverse(corpus, [0, 1, 2, 3, 4], { ...options, artistOf: noArtist })).toHaveLength(5);
  });

  it('prefers variety between equally relevant works', () => {
    const picked = selectDiverse(corpus, [1, 2, 4], { count: 1, relevance: () => 1, shown: [0], artistOf: noArtist });
    expect(picked).toEqual([4]);
  });

  it('never returns a work that is already shown', () => {
    const picked = selectDiverse(corpus, [0, 1], { count: 2, relevance: () => 1, shown: [0], artistOf: noArtist });
    expect(picked).toEqual([1]);
  });
});

describe('blend', () => {
  // A likes work 0, B likes work 1; work 2 sits between them, work 3 is A's alone.
  const corpus = corpusOf([[1, 0], [0, 1], [1, 1], [0.99, 0.05]]);
  const a = [single(0)];
  const b = [single(1)];

  it('scores a shared match above a one-sided one', () => {
    const scores = blendScores(corpus, a, b);
    expect(scores[2]).toBeGreaterThan(scores[3]);
    expect(topIndices(scores, 1, new Set([0, 1]))).toEqual([2]);
  });

  it('weighs the whole of each taste, so a main interest counts for more than a side one', () => {
    // A mostly likes work 0 and a little likes work 2; B likes work 1.
    const three = corpusOf([[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1]]);
    const mixed: Taste[] = [
      { medoid: 0, members: [0], weight: 0.75 },
      { medoid: 2, members: [2], weight: 0.25 },
    ];
    const scores = blendScores(three, mixed, [single(1)]);
    // Works 3 and 4 are equally between B and one of A's tastes; the main taste wins.
    expect(scores[3]).toBeGreaterThan(scores[4]);
    expect(scores[3]).toBeCloseTo(0.75 * Math.SQRT1_2);
  });

  it('gives a near copy of a heart no credit over a merely close work', () => {
    const near = corpusOf([[1, 0], [1, 0.02], [1, 0.3]]);
    const scores = blendScores(near, [single(0)], [single(0)]);
    expect(scores[1]).toBeCloseTo(0.85);
    expect(scores[2]).toBeCloseTo(0.85);
  });

  it('is the same whichever person asks', () => {
    expect([...blendScores(corpus, a, b)]).toEqual([...blendScores(corpus, b, a)]);
  });

  it('finds the heart closest to the reveal', () => {
    expect(nearest(corpus, 3, [1, 0, 2])).toBe(0);
    expect(nearest(corpus, 3, [])).toBeNull();
  });
});

describe('overlapPercent', () => {
  const corpus = corpusOf([[1, 0], [0, 1], [1, 1], [1, 0.2]]);
  const calibration = { stranger: 0.2, kindred: 0.9 };

  it('is 100 for identical tastes, 50 for unrelated ones and 0 when someone has no hearts', () => {
    expect(overlapPercent(corpus, [single(0)], [single(0)], calibration)).toBe(100);
    expect(overlapPercent(corpus, [single(0)], [single(1)], calibration)).toBe(50);
    expect(overlapPercent(corpus, [single(0)], [], calibration)).toBe(0);
  });

  it('rescales between the two anchors and is symmetric', () => {
    const score = overlapPercent(corpus, [single(0)], [single(2)], calibration);
    const overlap = (Math.SQRT1_2 - 0.2) / 0.7;
    expect(score).toBe(Math.round(100 * (0.5 + 0.5 * Math.pow(overlap, 0.6))));
    expect(overlapPercent(corpus, [single(2)], [single(0)], calibration)).toBe(score);
  });

  it('keeps the order of pairs: a closer pair never scores lower', () => {
    const near = overlapPercent(corpus, [single(0)], [single(3)], calibration);
    const mid = overlapPercent(corpus, [single(0)], [single(2)], calibration);
    const far = overlapPercent(corpus, [single(0)], [single(1)], calibration);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
  });

  it('does not divide by zero on a degenerate calibration', () => {
    expect(overlapPercent(corpus, [single(0)], [single(3)], { stranger: 0.5, kindred: 0.5 })).toBe(0);
  });
});

describe('calibrate', () => {
  it('measures unrelated and nearest-neighbour similarity', () => {
    const corpus = corpusOf([[1, 0], [1, 0.1], [0, 1], [0.1, 1]]);
    const { stranger, kindred } = calibrate(corpus);
    expect(kindred).toBeGreaterThan(0.99);
    expect(stranger).toBeLessThan(kindred);
  });

  it('falls back safely on a corpus too small to measure', () => {
    expect(calibrate(corpusOf([[1, 0]]))).toEqual({ stranger: 0, kindred: 1 });
  });
});

// Ranking ties and exclusions must be identical to the former full-sort selection.
describe('bounded top-k', () => {
  it('matches a full sort across ties, exclusions and boundary sizes', () => {
    const scores = Float32Array.from({ length: 6674 }, (_, i) => Math.sin(i * 17) > 0 ? i % 13 : -i % 19);
    const exclude = new Set([0, 7, 44, 100]);
    const sorted = [...scores.keys()].filter(i => !exclude.has(i)).sort((a,b) => scores[b] - scores[a] || a-b);
    for (const k of [0, 1, 20, 200, 7000]) expect(topIndices(scores, k, exclude)).toEqual(sorted.slice(0,k));
  });
});
