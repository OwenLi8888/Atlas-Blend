import type { Artwork } from '../rec/api';

const MUSEUMS: Readonly<Record<string, string>> = {
  moma: 'The Museum of Modern Art',
  nga: 'National Gallery of Art',
  cleveland: 'Cleveland Museum of Art',
  met: 'The Metropolitan Museum of Art',
  smk: 'SMK, Copenhagen',
  colbase: 'National Museums of Japan',
  smithsonian: 'Smithsonian',
  rijksmuseum: 'Rijksmuseum',
};

/** Where a work is held, as a visitor would read it on a wall label. */
export function museumName(source: string): string {
  const known = MUSEUMS[source];
  if (known) return known;
  return source
    .split(/[_-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** "Artist, date", leaving out whichever is missing. */
export function byline(work: Artwork): string {
  return [work.artist, work.date].filter(Boolean).join(', ');
}

/** "Maya's", or "Your friend's" when the name is blank. */
export function possessive(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Your friend’s';
  return trimmed + (/s$/i.test(trimmed) ? '’' : '’s');
}
