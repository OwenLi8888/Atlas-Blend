/**
 * The paintings this device has made, kept in localStorage so the gallery still has them on the
 * next visit: small JPEG copies (data URLs), newest first, at most MAX of them.
 */
import type { Group } from './pictures';

export interface Work {
  /** Room code, player, round of picks and easel: painting the same canvas again replaces the earlier copy. */
  id: string;
  /** Data URL of the painted canvas. */
  src: string;
  /** Width / height. */
  aspect: number;
  title: string;
  /** Who painted it and how. */
  sub: string;
  /** Who it is for: "For you", "For Sam", "Blend". */
  tag: string;
  /** Why this picture was chosen. */
  why: string;
  group: Group;
  /** ISO timestamp. */
  at: string;
}

const KEY = 'atlas:gallery';
/** With copies of about 80 KB this stays well inside a phone browser's storage, which the name and picks share. */
const MAX = 18;

export function loadWorks(): Work[] {
  try {
    const works: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(works) ? works.filter((w): w is Work => !!w && typeof w.id === 'string' && typeof w.src === 'string') : [];
  } catch {
    return [];
  }
}

export function saveWork(work: Work): void {
  let works = [work, ...loadWorks().filter((w) => w.id !== work.id)].slice(0, MAX);
  while (works.length) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(works));
      return;
    } catch {
      works = works.slice(0, -1); // storage is full (or blocked): let the oldest go and try again
    }
  }
}

/** A small copy of a canvas, for keeping or for hanging while it is still being painted. */
export function snapshot(sheet: HTMLCanvasElement, width = 420): string {
  const copy = document.createElement('canvas');
  copy.width = width;
  copy.height = Math.max(1, Math.round((width * sheet.height) / sheet.width));
  copy.getContext('2d')!.drawImage(sheet, 0, 0, copy.width, copy.height);
  return copy.toDataURL('image/jpeg', 0.76);
}
