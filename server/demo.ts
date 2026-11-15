/**
 * The demo profile: a ready-made gallery with a fixed blend code, so a blend
 * can be shown without a second person. It is created when the server starts
 * and topped up if any of its hearts are missing.
 *
 * Its taste is three clear leanings, each grown from one artwork by hearting
 * that work's nearest neighbours. Nothing here depends on the visual families,
 * so reclustering the collection never changes the demo's hearts.
 */
import { similaritiesTo, topIndices } from '../src/rec/scoring';
import type { Catalog } from './catalog';
import type { Db } from './db';

export const DEMO_NAME = 'Juno';
/** Enter this on the blend screen. */
export const DEMO_BLEND_CODE = 'CANVAS';

interface Leaning {
  /** ID of the artwork the leaning grows from. */
  seed: string;
  /** How many works to heart: the seed and its nearest neighbours. */
  hearts: number;
  /** The reason given for the seed work, quoted in the blend. */
  why: string;
}

const LEANINGS: readonly Leaning[] = [
  // Flowers, Birds and Insects of the Four Seasons: a gold folding screen.
  { seed: 'colbase:48465', hearts: 10, why: 'gold that still feels quiet' },
  // Hélio Oiticica, Metaesquema No. 179: hard-edge abstraction.
  { seed: 'moma:35047', hearts: 7, why: 'nothing wasted' },
  // Pancham Raga: an Indian miniature.
  { seed: 'cleveland:136959', hearts: 5, why: 'a whole story in one small page' },
];

const MAX_HEARTS = 300;

export async function seedDemoProfile(db: Db, catalog: Catalog): Promise<void> {
  const wanted = new Map<string, string | undefined>();
  for (const leaning of LEANINGS) {
    const seed = catalog.indexOf(leaning.seed);
    if (seed === undefined) {
      console.warn('Demo profile: artwork ' + leaning.seed + ' is not in the catalog, skipping that leaning.');
      continue;
    }
    // The seed is its own nearest neighbour, so it comes first and carries the reason.
    topIndices(similaritiesTo(catalog.corpus, seed), leaning.hearts).forEach((index, position) => {
      const id = catalog.works[index].id;
      if (!wanted.has(id)) wanted.set(id, position === 0 ? leaning.why : undefined);
    });
  }

  const profile = (await db.findProfileByCode(DEMO_BLEND_CODE)) ?? (await db.createProfile({ name: DEMO_NAME, code: DEMO_BLEND_CODE }));
  const existing = new Set((await db.listHearts(profile.id, MAX_HEARTS)).map(heart => heart.art_id));
  let added = 0;
  for (const [artId, why] of wanted) {
    if (existing.has(artId)) continue;
    await db.saveHeart(profile.id, artId, why);
    added++;
  }
  console.log(
    'Demo profile "' + profile.name + '" is ready: blend code ' + DEMO_BLEND_CODE + ', ' +
      (existing.size + added) + ' hearts' + (added > 0 ? ' (' + added + ' added)' : '') + '.',
  );
}
