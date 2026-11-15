/** The two ways the curator can look through the catalog: by words, and by likeness to a work. */
import type { Artwork } from '../src/rec/api';
import { selectDiverse, similaritiesTo, topIndices } from '../src/rec/scoring';
import type { Catalog } from './catalog';
import type { Collection } from './curator';

/** How much a word counts when it appears in each part of a work's label. */
const TITLE_WEIGHT = 3;
const LABEL_WEIGHT = 2;
const CAPTION_WEIGHT = 1;
/** Likeness results are picked for variety from this many nearest neighbours. */
const LIKENESS_CANDIDATES = 60;
const MIN_WORD_LENGTH = 3;

const STOP_WORDS = new Set([
  'the', 'and', 'with', 'for', 'from', 'that', 'this', 'into', 'over', 'under', 'near', 'like', 'art', 'work', 'works',
  'painting', 'paintings', 'picture', 'pictures', 'image', 'images', 'piece', 'pieces', 'scene', 'scenes',
]);

interface Label {
  title: string;
  /** Artist, medium and family together. */
  label: string;
  caption: string;
}

export function createCollection(catalog: Catalog, artistOf: (index: number) => string | null): Collection {
  const { works, corpus } = catalog;
  const labels: Label[] = works.map(work => ({
    title: work.title.toLowerCase(),
    label: [work.artist, work.medium ?? '', work.cluster].join(' ').toLowerCase(),
    caption: (work.caption ?? '').toLowerCase(),
  }));

  return {
    search(query, limit) {
      const words = [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u))].filter(
        word => word.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word),
      );
      if (words.length === 0) return [];

      const scored: { index: number; score: number }[] = [];
      labels.forEach((label, index) => {
        let score = 0;
        for (const word of words) {
          if (label.title.includes(word)) score += TITLE_WEIGHT;
          if (label.label.includes(word)) score += LABEL_WEIGHT;
          if (label.caption.includes(word)) score += CAPTION_WEIGHT;
        }
        if (score > 0) scored.push({ index, score });
      });
      scored.sort((a, b) => b.score - a.score || a.index - b.index);

      // No more than two works by one known artist, so a search is not one artist's catalogue.
      const perArtist = new Map<string, number>();
      const found: Artwork[] = [];
      for (const { index } of scored) {
        const artist = artistOf(index);
        if (artist !== null) {
          const count = perArtist.get(artist) ?? 0;
          if (count >= 2) continue;
          perArtist.set(artist, count + 1);
        }
        found.push(works[index]);
        if (found.length === limit) break;
      }
      return found;
    },

    moreLike(artId, limit) {
      const index = catalog.indexOf(artId);
      if (index === undefined) return [];
      const scores = similaritiesTo(corpus, index);
      const nearest = topIndices(scores, LIKENESS_CANDIDATES, new Set([index]));
      return selectDiverse(corpus, nearest, {
        count: limit,
        relevance: candidate => scores[candidate],
        shown: [index],
        artistOf,
      }).map(candidate => works[candidate]);
    },
  };
}
