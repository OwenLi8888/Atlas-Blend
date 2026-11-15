/**
 * The commissioned piece: a new artwork made for two people from what each of
 * them loves. It is made in the background after a blend, so the blend itself
 * answers at once and the screen can show something while the piece is made.
 */
import type { Commission, CommissionLabel, Trend } from '../src/rec/api';
import type { Atelier } from './atelier';
import { isSafePieceId, type PieceStore } from './pieces';

export interface ImageData {
  bytes: Buffer;
  mimeType: string;
}

/** Makes one image from a written brief and a set of reference images. */
export type ImageMaker = (brief: string, references: readonly ImageData[]) => Promise<ImageData>;

export interface Patron {
  name: string;
  trends: readonly Trend[];
  /** What the curator has noted about this person, including things they said; null when it has nothing. */
  notes?: string | null;
}

export interface CommissionRequest {
  blendId: string;
  you: Patron;
  friend: Patron;
}

export interface Commissions {
  /** Starts making a piece and returns its state straight away. */
  start(request: CommissionRequest): Commission;
  /** The current state of a piece, or null if none was ever made for this blend. */
  status(blendId: string): Promise<Commission | null>;
  /** The finished image, or null until it is ready. */
  image(blendId: string): Promise<ImageData | null>;
}

interface Options {
  makeImage: ImageMaker;
  /** Fetches a reference artwork from where it is hosted. */
  fetchImage: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  /**
   * Writes the brief and the wall label for each piece. Without it the brief
   * is a fixed template and there is no label.
   */
  atelier?: Atelier;
  /** How long to wait for the atelier's brief before painting from the template instead. */
  briefTimeoutMs?: number;
  /**
   * Where finished pieces are kept, so a saved blend still has its piece after
   * the server restarts, and on every server that shares the store. Without it
   * pieces live in memory only.
   */
  store?: PieceStore;
  /** How long a blend found to have no kept piece is not looked up again. */
  missTtlMs?: number;
  /** How many pieces are held in memory; the oldest are dropped past this many. */
  maxKept?: number;
}

interface Piece {
  status: Commission['status'];
  title: string;
  /** Null until it is made. For a piece found in the store, null until it is first asked for. */
  image: ImageData | null;
  labelStatus: Commission['label_status'];
  label: CommissionLabel | null;
  /** The last write of this piece to the store; writes queue behind it so they never overlap. */
  saving: Promise<void>;
}

const DEFAULT_MAX_KEPT = 40;
const DEFAULT_MISS_TTL_MS = 15_000;
/** How many blends without a kept piece are remembered at once. */
const MAX_MISSES = 500;
const DEFAULT_BRIEF_TIMEOUT_MS = 10_000;
const REFERENCE_TIMEOUT_MS = 15_000;
const MAX_CAPTION_LENGTH = 320;

/** Used when no image model is configured: the blend then reveals a work from the collection. */
export const noCommissions: Commissions = {
  start: () => ({ status: 'unavailable', image_url: null, title: null, label_status: 'unavailable', label: null }),
  status: async () => null,
  image: async () => null,
};

export function createCommissions(options: Options): Commissions {
  const {
    makeImage,
    fetchImage,
    atelier,
    store,
    briefTimeoutMs = DEFAULT_BRIEF_TIMEOUT_MS,
    maxKept = DEFAULT_MAX_KEPT,
    missTtlMs = DEFAULT_MISS_TTL_MS,
  } = options;
  const pieces = new Map<string, Piece>();
  /**
   * Blends the store had no piece for, with when to look again. A list of saved
   * blends asks about every one of them, and most were made without a piece.
   */
  const misses = new Map<string, number>();
  const problem = (error: unknown) => (error instanceof Error ? error.message : String(error));

  const view = (blendId: string, piece: Piece): Commission => ({
    status: piece.status,
    image_url: piece.status === 'ready' ? '/api/blend/' + blendId + '/commission/image' : null,
    title: piece.label?.title ?? piece.title,
    label_status: piece.labelStatus,
    label: piece.label,
  });

  /**
   * The brief to paint from. With an atelier, its art director writes it and the
   * label follows later; if the atelier is slow or fails, the template is used
   * so the piece is still made.
   */
  function briefFor(request: CommissionRequest, piece: Piece): Promise<string> {
    const template = commissionBrief(request.you, request.friend);
    if (!atelier) return Promise.resolve(template);

    return new Promise<string>(resolve => {
      const fallback = setTimeout(() => resolve(template), briefTimeoutMs);
      atelier
        .make(request.you, request.friend, brief => {
          clearTimeout(fallback);
          resolve(brief + '\n\n' + PAINTING_RULES);
        })
        .then(
          label => {
            piece.label = label;
            piece.labelStatus = 'ready';
            // The label can arrive after the image was saved: save again so it is kept too.
            if (piece.image) void keep(request.blendId, piece);
          },
          error => {
            piece.labelStatus = 'failed';
            console.error('Atelier failed for ' + request.blendId + ': ' + (error instanceof Error ? error.message : String(error)));
          },
        )
        .finally(() => {
          clearTimeout(fallback);
          resolve(template);
        });
    });
  }

  async function make(request: CommissionRequest, piece: Piece): Promise<void> {
    const started = performance.now();
    try {
      const [brief, references] = await Promise.all([
        briefFor(request, piece).then(text => {
          console.log('Commission ' + request.blendId + ' briefed after ' + Math.round(performance.now() - started) + ' ms');
          return text;
        }),
        referenceImages([...request.you.trends, ...request.friend.trends], fetchImage),
      ]);
      piece.image = await makeImage(brief, references);
      // Kept before it is announced, so a piece that reads as ready is already in the store.
      await keep(request.blendId, piece);
      piece.status = 'ready';
      console.log('Commission ' + request.blendId + ' ready in ' + Math.round(performance.now() - started) + ' ms');
    } catch (error) {
      piece.status = 'failed';
      console.error('Commission ' + request.blendId + ' failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  const remember = (blendId: string, piece: Piece) => {
    pieces.set(blendId, piece);
    for (const oldest of pieces.keys()) {
      if (pieces.size <= maxKept) break;
      pieces.delete(oldest);
    }
  };

  /** Writes a finished piece to the store. A failure only costs the kept copy, never the blend. */
  function keep(blendId: string, piece: Piece): Promise<void> {
    if (!store || !isSafePieceId(blendId)) return Promise.resolve();
    piece.saving = piece.saving.then(async () => {
      if (!piece.image) return;
      try {
        await store.save(blendId, { title: piece.title, label: piece.label }, piece.image);
      } catch (error) {
        console.error('Could not keep commission ' + blendId + ': ' + problem(error));
      }
    });
    return piece.saving;
  }

  const rememberMiss = (blendId: string) => {
    if (misses.size >= MAX_MISSES) misses.clear();
    misses.set(blendId, Date.now() + missTtlMs);
  };

  /** A piece from memory, or one kept in the store by another server or an earlier run of this one. */
  async function find(blendId: string): Promise<Piece | null> {
    const held = pieces.get(blendId);
    if (held) return held;
    if (!store || !isSafePieceId(blendId)) return null;
    if ((misses.get(blendId) ?? 0) > Date.now()) return null;

    let kept;
    try {
      kept = await store.read(blendId);
    } catch (error) {
      // Not remembered as a miss: the store may answer the next time.
      console.error('Could not look up commission ' + blendId + ': ' + problem(error));
      return null;
    }
    if (!kept) {
      rememberMiss(blendId);
      return null;
    }
    // Made here while the store was being asked: that one is the piece.
    const made = pieces.get(blendId);
    if (made) return made;
    misses.delete(blendId);
    const piece: Piece = {
      status: 'ready',
      title: kept.title,
      image: null,
      labelStatus: kept.label ? 'ready' : 'unavailable',
      label: kept.label,
      saving: Promise.resolve(),
    };
    remember(blendId, piece);
    return piece;
  }

  /** The image of a finished piece; one found in the store is fetched the first time it is asked for. */
  async function imageOf(blendId: string): Promise<ImageData | null> {
    const piece = await find(blendId);
    if (!piece || piece.status !== 'ready') return null;
    if (piece.image || !store) return piece.image;
    try {
      piece.image = await store.image(blendId);
    } catch (error) {
      console.error('Could not fetch the image of commission ' + blendId + ': ' + problem(error));
    }
    return piece.image;
  }

  return {
    start(request) {
      const piece: Piece = {
        status: 'pending',
        title: commissionTitle(request.you.name, request.friend.name),
        image: null,
        labelStatus: atelier ? 'pending' : 'unavailable',
        label: null,
        saving: Promise.resolve(),
      };
      remember(request.blendId, piece);
      misses.delete(request.blendId);
      void make(request, piece);
      return view(request.blendId, piece);
    },
    async status(blendId) {
      const piece = await find(blendId);
      return piece ? view(blendId, piece) : null;
    },
    image: imageOf,
  };
}

/**
 * The brief for the image model. It describes each person's leanings in words
 * and says which reference images are whose, and asks for one new work that
 * fuses them: a chimera, not a collage and not a copy.
 */
export function commissionBrief(you: Patron, friend: Patron): string {
  const first = you.name.trim() || 'The first person';
  const second = friend.name.trim() || 'The second person';
  const describe = (name: string, patron: Patron) =>
    name + ' loves:\n' +
    patron.trends
      .map(trend => {
        const example = trend.works[0];
        const caption = example?.caption ? ' For example: ' + clip(example.caption) : '';
        const reason = trend.why ? ' In their words: "' + trend.why + '".' : '';
        return '- ' + trend.family + ' (' + Math.round(trend.share * 100) + '% of what they love).' + caption + reason;
      })
      .join('\n');

  return [
    'Paint one new artwork for two people. It should be a chimera of the things each of them loves: a single, ' +
      'coherent image in which both would recognise something of their own.',
    describe(first, you),
    describe(second, friend),
    'The reference images are works they love: the first ' + you.trends.length + ' belong to ' + first +
      ', the rest to ' + second + '. Use them for subject, palette, mark-making and mood only.',
    'Fuse the two tastes into one composition. Take subjects and motifs from both; let the palette and surface of ' +
      'one run through the forms of the other. Weigh each leaning by its share.',
    PAINTING_RULES,
  ].join('\n\n');
}

/** Rules every piece follows, whoever wrote the brief. */
const PAINTING_RULES =
  'The reference images are works the two people love; use them for subject, palette, mark-making and mood only. ' +
  'Paint one coherent scene: do not place the references side by side, do not make a collage or a split image, and ' +
  'do not copy any single reference. It must look made by hand, with a visible painted or drawn surface. ' +
  'No text, lettering, signature, frame or border.';

export function commissionTitle(yourName: string, friendName: string): string {
  const names = [yourName.trim(), friendName.trim()].filter(Boolean);
  return names.length === 2 ? 'For ' + names[0] + ' and ' + names[1] : 'For the two of you';
}

/** The central heart of each leaning, as image bytes. A reference that cannot be fetched is left out. */
async function referenceImages(trends: readonly Trend[], fetchImage: Options['fetchImage']): Promise<ImageData[]> {
  const fetched = await Promise.all(
    trends.map(async (trend): Promise<ImageData | null> => {
      const work = trend.works[0];
      if (!work) return null;
      try {
        const response = await fetchImage(work.image_url, { signal: AbortSignal.timeout(REFERENCE_TIMEOUT_MS) });
        const mimeType = response.headers.get('content-type') ?? '';
        if (!response.ok || !mimeType.startsWith('image/')) return null;
        return { bytes: Buffer.from(await response.arrayBuffer()), mimeType };
      } catch {
        return null;
      }
    }),
  );
  return fetched.filter((image): image is ImageData => image !== null);
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_CAPTION_LENGTH ? flat : flat.slice(0, MAX_CAPTION_LENGTH).replace(/\s+\S*$/, '') + '…';
}
