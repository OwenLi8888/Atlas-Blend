import type { Painting } from './types';

export const SLOTS = 4;
/** Canvas width for a new upload: 240 mm for a portrait of a person (finer detail), else 200. */
export const WIDTH_MM = { standard: 200, portrait: 240 } as const;

function emptySlot(index: number): Painting {
  return {
    id: `slot-${index + 1}`,
    file: '',
    title: '',
    artist: '',
    year: '',
    credit: '',
    widthMm: WIDTH_MM.standard,
    src: '',
    missing: true,
  };
}

/** Reads public/paintings/paintings.json into exactly four slots. Never throws: a bad file gives empty slots. */
export async function loadPaintings(): Promise<Painting[]> {
  let entries: Partial<Painting>[] = [];
  try {
    const res = await fetch('paintings/paintings.json', { cache: 'no-cache' });
    const json: unknown = res.ok ? await res.json() : [];
    if (Array.isArray(json)) entries = json;
  } catch {
    // Fall through to empty slots: the picker shows "Add painting" cards.
  }
  return Array.from({ length: SLOTS }, (_, i) => {
    const e = entries[i];
    if (!e || typeof e.id !== 'string' || typeof e.file !== 'string' || !e.file) return emptySlot(i);
    return {
      id: e.id,
      file: e.file,
      title: e.title ?? 'Untitled',
      artist: e.artist ?? '',
      year: e.year ?? '',
      credit: e.credit ?? '',
      widthMm: typeof e.widthMm === 'number' ? e.widthMm : WIDTH_MM.standard,
      src: `paintings/${e.file}`,
    };
  });
}

let uploads = 0;

/** A slot filled from Museum setup. Lives until the page is reloaded. */
export function uploadedPainting(
  file: File,
  details: { title: string; artist: string; year: string; credit: string; portrait: boolean },
): Painting {
  uploads++;
  return {
    id: `upload-${uploads}-${Date.now().toString(36)}`,
    file: file.name,
    title: details.title.trim() || file.name.replace(/\.[^.]+$/, ''),
    artist: details.artist.trim(),
    year: details.year.trim(),
    credit: details.credit.trim(),
    widthMm: details.portrait ? WIDTH_MM.portrait : WIDTH_MM.standard,
    src: URL.createObjectURL(file),
    uploaded: true,
  };
}
