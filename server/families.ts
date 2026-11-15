/**
 * Display names for the visual families. The names stored with the collection
 * were machine-made and several are wrong, so these replace them. Each was
 * written from the family's most typical works.
 *
 * A name is tied to one typical artwork, not to a cluster number: whichever
 * family that artwork is in gets the name. Cluster numbers are reassigned when
 * the collection is reclustered, and a name keyed by number would then land on
 * the wrong family without any error. A family holding none of these artworks
 * keeps its stored name.
 */
export interface FamilyName {
  /** ID of an artwork that typifies the family. */
  anchor: string;
  name: string;
}

export const FAMILY_NAMES: readonly FamilyName[] = [
  { anchor: 'nga:46060', name: 'Old master history paintings' },
  { anchor: 'nga:166491', name: 'Cubist and geometric painting' },
  { anchor: 'nga:68635', name: 'Modern figure sketches' },
  { anchor: 'nga:46616', name: 'Flower still lifes' },
  { anchor: 'colbase:39142', name: 'Japanese narrative scrolls' },
  { anchor: 'nga:133640', name: 'Harbour and coastal views' },
  { anchor: 'nga:127213', name: 'Contemporary figurative painting' },
  { anchor: 'nga:67983', name: 'Watercolour landscape sketches' },
  { anchor: 'moma:80393', name: 'Modernist nudes and bathers' },
  { anchor: 'moma:36720', name: 'Mixed-media prints and collage' },
  { anchor: 'cleveland:160717', name: 'Old master figure drawings' },
  { anchor: 'met:379930', name: 'Carriage design drawings' },
  { anchor: 'kz:b3b9dbb497973b4b', name: 'Urban and social scenes' },
  { anchor: 'cleveland:123183', name: 'Ukiyo-e beauties and actors' },
  { anchor: 'cleveland:109240', name: 'Barbizon and Impressionist landscapes' },
  { anchor: 'smk:KMS4177', name: 'Early modernist landscapes' },
  { anchor: 'cleveland:329353', name: 'Early landscape drawings' },
  { anchor: 'cleveland:136959', name: 'Indian miniature paintings' },
  { anchor: 'cleveland:135265', name: 'Portrait paintings' },
  { anchor: 'moma:35047', name: 'Hard-edge abstraction' },
  { anchor: 'nga:206133', name: 'Italianate and ruin landscapes' },
  { anchor: 'colbase:183766', name: 'Ukiyo-e landscape prints' },
  { anchor: 'smk:KKSgb7536', name: 'Architectural views and interiors' },
  { anchor: 'moma:79032', name: 'Industrial and mining scenes' },
  { anchor: 'colbase:48465', name: 'Japanese folding screens' },
  { anchor: 'nga:72881', name: 'Romantic pastoral landscapes' },
  { anchor: 'cleveland:135625', name: 'Botanical flower illustrations' },
  { anchor: 'nga:7303', name: 'Narrative prints and drawings' },
  { anchor: 'jessica_silverman:22f2382daa59109175', name: 'Contemporary abstract painting' },
  { anchor: 'nga:59925', name: 'Naive and genre scenes' },
];
