/**
 * The visual families: which works belong together, and what each group is called.
 *
 * Membership comes from `families.json`, made by `npm run recluster` from the
 * image vectors of the works on the walls. Works added to the collection since
 * then join the family whose average they are closest to, so a new work never
 * goes without a family.
 *
 * Names are written by hand, each from its family's most typical works. A name
 * is tied to one artwork that typifies the family, not to a family number:
 * whichever family that artwork is in gets the name. Family numbers change
 * whenever the collection is reclustered, and a name keyed by number would then
 * land on the wrong family without any error.
 */
import { readFile } from 'node:fs/promises';
import type { Artwork } from '../src/rec/api';
import type { CatalogData } from './catalog';

export interface FamilyName {
  /** ID of an artwork that typifies the family. */
  anchor: string;
  name: string;
}

export const FAMILY_NAMES: readonly FamilyName[] = [
  { anchor: 'colbase:39142', name: 'Japanese scroll painting' },
  { anchor: 'cleveland:123183', name: 'Ukiyo-e prints' },
  { anchor: 'cleveland:136959', name: 'Indian miniature painting' },
  { anchor: 'cleveland:111479', name: 'Old master figure painting' },
  { anchor: 'markel:8648', name: 'Contemporary abstract painting' },
  { anchor: 'nga:71590', name: 'Italianate and classical landscapes' },
  { anchor: 'nga:5687', name: 'Watercolour landscapes' },
  { anchor: 'nga:176848', name: 'Barbizon and Impressionist landscapes' },
  { anchor: 'smk:KMS8520', name: 'Contemporary painting and illustration' },
  { anchor: 'smk:KKS1984-23/348', name: 'Collage and prints' },
  { anchor: 'smk:KKSgb7698', name: 'Coastal and harbour views' },
  { anchor: 'colbase:48465', name: 'Japanese gold screens' },
  { anchor: 'cleveland:135265', name: 'Impressionist and modern portraits' },
  { anchor: 'artistics:78044', name: 'Expressive modern figures' },
  { anchor: 'smk:KMS7187/5', name: 'Geometric abstraction' },
  { anchor: 'met:441104', name: 'Fruit and flower still lifes' },
  { anchor: 'cleveland:148765', name: 'Architectural interiors and ruins' },
  { anchor: 'cleveland:329353', name: 'Watercolour town and village views' },
  { anchor: 'moma:78371', name: 'Fauve and modernist landscapes' },
  { anchor: 'moma:78742', name: 'Surreal and visionary painting' },
  { anchor: 'jessica_silverman:c80bb303ae24671169', name: 'Contemporary nature painting' },
  { anchor: 'smk:KKSgb2950/46', name: 'Botanical flower studies' },
  { anchor: 'moma:80393', name: 'Modernist nudes and bathers' },
  { anchor: 'nga:56937', name: 'Cubism and early abstraction' },
  { anchor: 'moma:78426', name: 'Street life and crowds' },
  { anchor: 'install_fabric:eva_hesse_no_title', name: 'Installations and objects' },
  { anchor: 'nga:109732', name: 'Rural scenes' },
  { anchor: 'smk:KMS8346', name: 'Modern interiors and still lifes' },
  { anchor: 'nga:227846', name: 'Folk and social realist painting' },
  { anchor: 'nga:67985', name: 'Modernist watercolours' },
  { anchor: 'nga:65351', name: 'Watercolour sketches and studies' },
];

/** Each family as the IDs of its works, most typical first. */
export type Families = readonly (readonly string[])[];

/**
 * A work less alike than this to its family's average is shown without a
 * family name: it went to the nearest family only because every work has to go
 * somewhere, and the name would describe it wrongly (a Belle Époque poster
 * filed with collage, a painted vase among watercolour sketches). Measured after removing
 * what all the works share, as the clustering does; about 1% of works fall below.
 */
export const MIN_FAMILY_LIKENESS = 0.25;

const FAMILIES_FILE = new URL('./families.json', import.meta.url);

/** Reads `families.json`; throws if it is missing or malformed. */
export async function readFamilies(): Promise<Families> {
  return parseFamilies(JSON.parse(await readFile(FAMILIES_FILE, 'utf8')));
}

export function parseFamilies(value: unknown): Families {
  const families = typeof value === 'object' && value !== null ? (value as { families?: unknown }).families : undefined;
  if (!Array.isArray(families) || families.length === 0) throw new Error('families.json has no families');
  const seen = new Set<string>();
  return families.map((members, family) => {
    if (!Array.isArray(members) || members.length === 0) throw new Error('Family ' + family + ' in families.json is empty');
    return members.map(id => {
      if (typeof id !== 'string' || id === '') throw new Error('Family ' + family + ' in families.json has an invalid ID');
      if (seen.has(id)) throw new Error('Artwork ' + id + ' is in more than one family in families.json');
      seen.add(id);
      return id;
    });
  });
}

/**
 * Puts every work in a family and names it. `cluster_id` is the family's
 * position in `families`; `cluster` is its name, or empty for a work that
 * hardly resembles its family. When none of the listed works is in the data
 * (a different collection, or a hand-built test catalog) the stored families
 * are kept unchanged.
 */
export function assignFamilies(
  data: CatalogData,
  families: Families,
  names: readonly FamilyName[] = FAMILY_NAMES,
): CatalogData {
  const { works, dim, vectors } = data;
  const listed = new Map<string, number>();
  families.forEach((members, family) => members.forEach(id => listed.set(id, family)));
  const familyOf = works.map(work => listed.get(work.id));
  if (familyOf.every(family => family === undefined)) return data;

  // Likeness is measured on vectors with the collection average taken away:
  // what every artwork shares says nothing about which family a work is in.
  const mean = new Float64Array(dim);
  for (let row = 0; row < works.length; row++) {
    for (let d = 0; d < dim; d++) mean[d] += vectors[row * dim + d];
  }
  for (let d = 0; d < dim; d++) mean[d] /= works.length;
  const centred = (row: number, d: number) => vectors[row * dim + d] - mean[d];

  const centroids = families.map(() => new Float64Array(dim));
  familyOf.forEach((family, row) => {
    if (family === undefined) return;
    for (let d = 0; d < dim; d++) centroids[family][d] += centred(row, d);
  });
  for (const centroid of centroids) {
    const length = Math.hypot(...centroid);
    if (length > 0) for (let d = 0; d < dim; d++) centroid[d] /= length;
  }
  const present = centroids.flatMap((centroid, family) => (centroid.some(x => x !== 0) ? [family] : []));

  /** Cosine likeness of a work to a family's average. */
  const likeness = (row: number, family: number): number => {
    let dot = 0;
    let squared = 0;
    for (let d = 0; d < dim; d++) {
      const x = centred(row, d);
      dot += x * centroids[family][d];
      squared += x * x;
    }
    return squared === 0 ? 0 : dot / Math.sqrt(squared);
  };

  const nameOf = new Map<number, string>();
  for (const { anchor, name } of names) {
    const family = listed.get(anchor);
    if (family !== undefined && !nameOf.has(family)) nameOf.set(family, name);
  }

  const assigned: Artwork[] = works.map((work, row) => {
    let family = familyOf[row];
    if (family === undefined) {
      family = present[0];
      let best = -Infinity;
      for (const candidate of present) {
        const score = likeness(row, candidate);
        if (score > best) {
          best = score;
          family = candidate;
        }
      }
    }
    const name = likeness(row, family) >= MIN_FAMILY_LIKENESS ? (nameOf.get(family) ?? '') : '';
    return { ...work, cluster: name, cluster_id: family };
  });
  return { works: assigned, dim, vectors };
}
