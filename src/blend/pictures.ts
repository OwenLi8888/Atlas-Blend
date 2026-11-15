/**
 * What goes on the three easels of the studio, and why. None of them is a picture the players
 * were shown: left, a new work for you; right, a new work for your friend; centre, the piece
 * between the two of you.
 *
 * With the Gallery API running (server/), these are its recommendations for each player and, in the
 * centre, the artwork commissioned for the pair (or the collection work closest to both). Without
 * it, they are pool works neither player was shown, chosen by how close they look to the picks
 * (look.ts).
 *
 * A canvas looks right on its easel only within a range of shapes. Each choice prefers a work that
 * fits its easel, and a work that does not fit is cropped to it.
 */
import type { PicksRecord } from '../picks/picksStore';
import { photoUrl, shownIds, type PoolPhoto } from '../picks/pool';
import type { Session } from '../picks/session';
import type { Artwork } from '../rec/api';
import type { Painting, StyleId } from '../types';
import { artworkImageUrl, blendWith, heartPicks, recommendations, waitForCommission, waitForHearts, type GalleryPlayer } from './gallery';
import { distance, loadLook } from './look';

/** Which part of the gallery a finished painting hangs in. */
export type Group = 'yours' | 'together';

/** A picture for an easel, with the words shown when it is tapped. */
export interface Slot {
  painting: Painting;
  /** Width / height. */
  aspect: number;
  /** Who it is for, short: "For you", "For Sam", "Blend". */
  tag: string;
  /** Why this picture is here. */
  why: string;
  /** Present on a blend made by the Gallery API: the taste match, 50 to 100. */
  score?: number;
  group: Group;
}

/** The narrowest and widest picture (width / height) an easel's canvas takes. */
export type Shape = readonly [number, number];
/** The two side easels hold upright canvases, the big centre easel a wide one. */
export const SIDE: Shape = [0.72, 0.95];
export const CENTRE: Shape = [1.1, 1.45];

/** How much a badly shaped work loses against a well shaped one, in units of `distance`. */
const MISFIT_COST = 250;

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

/** 0 when a picture of this aspect fits the easel; grows with how much would be cropped away. */
function misfit(aspect: number, [lo, hi]: Shape): number {
  return Math.abs(Math.log(aspect / Math.min(hi, Math.max(lo, aspect))));
}

/**
 * The picture as its easel takes it: untouched when its shape fits, otherwise cropped around its
 * centre to the nearest shape that does (an object URL; the caller revokes it).
 */
async function fit(src: string, shape: Shape): Promise<{ src: string; aspect: number }> {
  const img = await loadImage(src);
  const natural = img.width / img.height;
  if (misfit(natural, shape) === 0) return { src, aspect: natural };
  const aspect = natural < shape[0] ? shape[0] : shape[1];
  const sw = natural > aspect ? img.height * aspect : img.width;
  const sh = natural > aspect ? img.height : img.width / aspect;
  const scale = Math.min(1, 1024 / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext('2d')!.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) throw new Error('could not crop the picture');
  return { src: URL.createObjectURL(blob), aspect };
}

const quote = (title?: string | null) => (title ? `“${title}”` : 'pick');

/** Chooses the three pictures of one visit to the studio. No work is chosen twice. */
export interface Pictures {
  /** Left easel: a new work for this player. */
  forYou(): Promise<Slot | null>;
  /** Right easel: a new work for the friend, or another for this player while there is no friend. */
  forFriend(friend: PicksRecord | null): Promise<Slot | null>;
  /** Centre easel: the piece between the two players, or a third work for this player alone. */
  between(friend: PicksRecord | null): Promise<Slot | null>;
}

export function createPictures(opts: {
  pool: PoolPhoto[];
  session: Session;
  /** This player's saved picks. */
  record: PicksRecord;
  /** Their Gallery API profile, when that server is running. */
  player: GalleryPlayer | null;
}): Pictures {
  const { pool, session, record, player } = opts;
  const byId = new Map(pool.map((p) => [p.id, p]));
  const photos = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is PoolPhoto => !!p);
  const mine = photos(record.picks);
  // what either player was shown: both devices work the other's 25 out from the room code
  const other: Session = { sessionId: session.sessionId, user: session.user === 1 ? 2 : 1 };
  const seen = new Set([...record.shown, ...shownIds(pool.map((p) => p.id), other)]);
  /** Pool ids and artwork ids already on an easel. */
  const taken = new Set<string>();
  const look = loadLook();
  // the Gallery API learns this player's taste from their picks; a pick it does not hold is skipped
  const hearted = player ? heartPicks(player, mine.map((p) => p.artId).filter((id): id is string => !!id)) : Promise.resolve();

  /**
   * The pool work neither player was shown that looks nearest to these picks. With two sets of
   * picks it is the work nearest to both: a work counts as far from the pair as it is from the
   * set it is further from. Also returns the pick of each set it is nearest to.
   */
  async function nearest(sets: PoolPhoto[][], shape: Shape): Promise<{ photo: PoolPhoto; because: PoolPhoto[] } | null> {
    const data = await look;
    let best: { photo: PoolPhoto; because: PoolPhoto[] } | null = null;
    let bestCost = Infinity;
    for (const photo of pool) {
      if (seen.has(photo.id) || taken.has(photo.id) || (photo.artId && taken.has(photo.artId))) continue;
      const because: PoolPhoto[] = [];
      let furthest = 0;
      for (const picks of sets) {
        let near = picks[0], nearD = Infinity;
        for (const pick of picks) {
          const d = distance(data, photo.id, pick.id);
          if (d < nearD) [near, nearD] = [pick, d];
        }
        because.push(near);
        furthest = Math.max(furthest, nearD);
      }
      const cost = furthest + MISFIT_COST * misfit(photo.width / photo.height, shape);
      if (cost < bestCost) [best, bestCost] = [{ photo, because }, cost];
    }
    if (best) {
      taken.add(best.photo.id);
      if (best.photo.artId) taken.add(best.photo.artId);
    }
    return best;
  }

  async function photoSlot(photo: PoolPhoto, shape: Shape, rest: Pick<Slot, 'tag' | 'why' | 'group'>): Promise<Slot> {
    const fitted = await fit(photoUrl(photo.file), shape);
    return { painting: painting(`pool-${photo.id}`, fitted.src, photo.title ?? '', photo.artist, photo.year), aspect: fitted.aspect, ...rest };
  }

  /** The Gallery API's best recommendation for a profile that suits the easel: the first of its top four that fits, else the one cropped least. */
  async function recommended(profileId: string, shape: Shape): Promise<{ work: Artwork; because: Artwork } | null> {
    const top = (await recommendations(profileId)).filter((r) => !taken.has(r.work.id)).slice(0, 4);
    const sized = await Promise.all(
      top.map((rec) =>
        loadImage(artworkImageUrl(rec.work.id)).then(
          (img) => ({ rec, off: misfit(img.width / img.height, shape) }),
          () => null,
        ),
      ),
    );
    let choice: { rec: (typeof top)[number]; off: number } | null = null;
    for (const s of sized) {
      if (s && !taken.has(s.rec.work.id) && (!choice || (choice.off > 0 && s.off < choice.off))) choice = s;
    }
    if (!choice) return null;
    taken.add(choice.rec.work.id);
    return choice.rec;
  }

  async function workSlot(work: Artwork, shape: Shape, rest: Pick<Slot, 'tag' | 'why' | 'group' | 'score'>): Promise<Slot> {
    const fitted = await fit(artworkImageUrl(work.id), shape);
    return { painting: painting(`work-${work.id}`, fitted.src, work.title, work.artist, work.date ?? ''), aspect: fitted.aspect, ...rest };
  }

  const family = (work: Artwork) => (work.cluster ? ` It belongs to the ${work.cluster} family.` : '');

  /** A new work for this player. `note` is added when it stands in on another easel. */
  async function forMe(shape: Shape, note = ''): Promise<Slot | null> {
    const tail = note ? ' ' + note : '';
    await hearted;
    try {
      const rec = player && (await recommended(player.profileId, shape));
      if (rec) {
        return await workSlot(rec.work, shape, {
          tag: 'For you',
          group: 'yours',
          why: `New for you: of everything in the gallery, this sits closest to your pick ${quote(rec.because.title)}.${family(rec.work)}${tail}`,
        });
      }
    } catch {
      // the Gallery API's image could not be read: choose from the pool instead
    }
    const near = await nearest([mine], shape);
    if (!near) return null;
    return photoSlot(near.photo, shape, {
      tag: 'For you',
      group: 'yours',
      why: `New for you. Of the works you were not shown, this one looks closest in colour and light to your pick ${quote(near.because[0].title)}.${tail}`,
    });
  }

  return {
    forYou: () => forMe(SIDE),

    async forFriend(friend) {
      if (!friend) return forMe(SIDE, 'Your friend has not picked yet, so this easel is yours too.');
      const name = friend.name || 'your friend';
      const tag = `For ${name}`;
      try {
        if (player && friend.profileId && (await waitForHearts(friend.profileId))) {
          const rec = await recommended(friend.profileId, SIDE);
          if (rec) {
            return await workSlot(rec.work, SIDE, {
              tag,
              group: 'together',
              why: `New for ${name}: of everything in the gallery, this sits closest to their pick ${quote(rec.because.title)}.${family(rec.work)}`,
            });
          }
        }
      } catch {
        // fall through to the pool
      }
      const near = await nearest([photos(friend.picks)], SIDE);
      if (!near) return null;
      return photoSlot(near.photo, SIDE, {
        tag,
        group: 'together',
        why: `New for ${name}. Of the works they were not shown, this one looks closest in colour and light to their pick ${quote(near.because[0].title)}.`,
      });
    },

    async between(friend) {
      if (!friend) return forMe(CENTRE, 'With a friend in your room, this easel holds the piece between the two of you.');
      const name = friend.name || 'your friend';
      try {
        if (player && friend.blendCode) {
          await hearted;
          if (friend.profileId) await waitForHearts(friend.profileId);
          const response = await blendWith(player, friend.blendCode);
          if (response) {
            const piece = await waitForCommission(response.id, response.commission);
            if (piece.status === 'ready' && piece.image_url) {
              const fitted = await fit(piece.image_url, CENTRE);
              const title = piece.label?.title ?? piece.title ?? 'Made for the two of you';
              return {
                painting: painting(`blend-${response.id}`, fitted.src, title, `For you and ${name}`),
                aspect: fitted.aspect,
                tag: 'Blend',
                group: 'together',
                why: piece.label?.story ?? response.story,
                score: response.score,
              };
            }
            taken.add(response.top_artwork.id);
            return await workSlot(response.top_artwork, CENTRE, {
              tag: 'Blend',
              group: 'together',
              why: `${response.story} Of everything in the gallery, this work sits closest to both of your tastes.`,
              score: response.score,
            });
          }
        }
      } catch {
        // fall through to the pool
      }
      const near = await nearest([mine, photos(friend.picks)], CENTRE);
      if (!near) return null;
      return photoSlot(near.photo, CENTRE, {
        tag: 'Blend',
        group: 'together',
        why: `Between the two of you. Of the works neither of you was shown, this one looks as close to your pick ${quote(near.because[0].title)} as to ${name}’s pick ${quote(near.because[1]?.title)}.`,
      });
    },
  };
}
