/**
 * What goes on the three easels of the studio, and why. Left: one of your picks. Right: one of your
 * friend's picks. Centre: the piece that blends the two of you.
 *
 * With the Gallery API running (server/), the centre is the artwork commissioned for the pair, with
 * the wall label its agent wrote. Without it, the centre is a plain half-and-half mix of the two
 * first picks made in the browser, and the label says so.
 */
import type { PicksRecord } from '../picks/picksStore';
import { photoUrl, type PoolPhoto } from '../picks/pool';
import type { BlendResponse } from '../rec/api';
import type { Painting, StyleId } from '../types';
import { artworkImageUrl, blendWith, waitForCommission, type GalleryPlayer } from './gallery';

/** A picture for an easel, with the words shown when it is tapped. */
export interface Slot {
  painting: Painting;
  /** Width / height. */
  aspect: number;
  /** Whose it is, short: "Yours", "Sam's", "Blend". */
  tag: string;
  /** Why this picture is here and why it looks the way it does. */
  why: string;
  /** Present on the blend: the taste match, 50 to 100. */
  score?: number;
}

const STYLE_NOTE: Record<StyleId, string> = {
  swirl: 'in short curling strokes that follow the shapes, the way Van Gogh worked',
  shapes: 'in flat angular planes, the way cubism breaks a picture up',
  mosaic: 'as a mosaic of small broken tiles, like Gaudí’s trencadís',
};

export const styleNote = (style: StyleId) => STYLE_NOTE[style];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

function painting(id: string, src: string, title: string, artist = '', year = ''): Painting {
  // `uploaded`: planned in the browser, there is no precomputed plan beside these images
  return { id, file: '', title: title || 'Untitled', artist, year, credit: '', widthMm: 200, src, uploaded: true };
}

const fromPhoto = (p: PoolPhoto): Pick<Slot, 'painting' | 'aspect'> => ({
  painting: painting(`pick-${p.id}`, photoUrl(p.file), p.title ?? '', p.artist, p.year),
  aspect: p.width / p.height,
});

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth'];

/** One of the player's own picks. */
export function ownSlot(photo: PoolPhoto, nth: number, note = ''): Slot {
  return { ...fromPhoto(photo), tag: 'Yours', why: `Your ${ORDINAL[nth] ?? 'next'} pick.${note ? ' ' + note : ''}` };
}

/** The friend's first pick. */
export function friendSlot(photo: PoolPhoto, friendName: string): Slot {
  return { ...fromPhoto(photo), tag: `${friendName}’s`, why: `${friendName}’s first pick.` };
}

/** Draws `img` to cover the whole canvas. */
function cover(g: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  g.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
}

/** A half-and-half mix of two pictures: the first on the left, melting into the second on the right. */
async function mix(aSrc: string, bSrc: string): Promise<{ src: string; aspect: number }> {
  const [a, b] = await Promise.all([loadImage(aSrc), loadImage(bSrc)]);
  const aspect = Math.min(1.4, Math.max(0.72, Math.sqrt((a.width / a.height) * (b.width / b.height))));
  const w = 768, h = Math.round(w / aspect);
  const base = document.createElement('canvas');
  base.width = w; base.height = h;
  const g = base.getContext('2d')!;
  cover(g, a, w, h);
  const top = document.createElement('canvas');
  top.width = w; top.height = h;
  const t = top.getContext('2d')!;
  cover(t, b, w, h);
  t.globalCompositeOperation = 'destination-in';
  const fade = t.createLinearGradient(w * 0.25, 0, w * 0.75, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  t.fillStyle = fade;
  t.fillRect(0, 0, w, h);
  g.drawImage(top, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => base.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('could not mix the pictures');
  return { src: URL.createObjectURL(blob), aspect };
}

export interface BlendResult {
  slot: Slot;
  /** The Gallery API's answer, when it made the blend: its shared wall feeds the gallery. */
  response: BlendResponse | null;
}

/**
 * The piece between the two players. Asks the Gallery API when both have a profile there; otherwise
 * mixes their two first picks here.
 */
export async function blendSlot(opts: {
  mine: PoolPhoto;
  theirs: PoolPhoto;
  friendName: string;
  player: GalleryPlayer | null;
  friend: PicksRecord;
}): Promise<BlendResult> {
  const { mine, theirs, friendName, player, friend } = opts;
  if (player && friend.blendCode) {
    const response = await blendWith(player, friend.blendCode);
    if (response) {
      const piece = await waitForCommission(response.id, response.commission);
      const made = piece.status === 'ready' && piece.image_url;
      const src = made ? piece.image_url! : artworkImageUrl(response.top_artwork.id);
      try {
        const img = await loadImage(src);
        const title = made ? (piece.label?.title ?? piece.title ?? 'Made for the two of you') : response.top_artwork.title;
        const why = made
          ? (piece.label?.story ?? response.story)
          : `${response.story} This work from the collection sits closest to both of your tastes.`;
        return {
          response,
          slot: {
            painting: painting(`blend-${response.id}`, src, title, made ? `For you and ${friendName}` : response.top_artwork.artist, made ? '' : (response.top_artwork.date ?? '')),
            aspect: img.width / img.height,
            tag: 'Blend',
            why,
            score: response.score,
          },
        };
      } catch {
        // the image could not be fetched: fall through to the mix made here
      }
    }
  }
  const mixed = await mix(photoUrl(mine.file), photoUrl(theirs.file));
  return {
    response: null,
    slot: {
      painting: painting(`mix-${mine.id}-${theirs.id}`, mixed.src, 'Half you, half ' + friendName, 'Mixed in the studio'),
      aspect: mixed.aspect,
      tag: 'Blend',
      why: `A half-and-half mix of your “${mine.title || 'pick'}” and ${friendName}’s “${theirs.title || 'pick'}”: yours on the left, melting into theirs on the right.`,
    },
  };
}
