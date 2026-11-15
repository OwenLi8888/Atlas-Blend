import './PaintStudio.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Artwork, BlendResponse, Commission, WallItem, WallSource } from '../rec/api';
import { Player } from '../engine/player';
import { getPlan } from '../plan/planStore';
import type { StudioScene } from '../scene/studioScene';
import type { StrokePlan } from '../types';
import { possessive } from './format';
import { revealUrl } from './images';
import type { RoomArrival, RoomPainter } from './AtlasRoom';

/** The two works painted on the side easels: one from each person's side of the shared wall. */
export interface StudioPair {
  /** Painted by the visitor's painter, on the left easel. */
  mine?: WallItem;
  /** Painted by the friend's painter, on the right easel. */
  theirs?: WallItem;
}

/** One work from each person's side of the shared wall, falling back to the next best work when a side has none. */
export function studioPair(wall: readonly WallItem[]): StudioPair {
  const pick = (from: readonly WallItem[], order: readonly WallSource[]) => {
    for (const source of order) {
      const found = from.find(item => item.from === source);
      if (found) return found;
    }
    return undefined;
  };
  const mine = pick(wall, ['you', 'both', 'new', 'friend']);
  const theirs = pick(wall.filter(item => item !== mine), ['friend', 'both', 'new', 'you']);
  return { mine, theirs };
}

interface Props {
  blend: BlendResponse;
  /** The piece being made for the two people, as it stands now: it can arrive while the sides are painted. */
  commission: Commission;
  pair: StudioPair;
  /** The visitor's painter, who paints their side and the piece for both, and what they call it. */
  painter: RoomPainter;
  /** The friend's painter, who paints the friend's side. */
  friendPainter: RoomPainter;
  /** The friend's name, as it reads in a sentence. */
  friend: string;
  /**
   * The studio is finished with: the room takes over. `arrivals` are the painted canvases and
   * where each was on screen, so the room can fly them to their frames; empty when the studio
   * was skipped or could not open.
   */
  onDone: (arrivals: readonly RoomArrival[]) => void;
}

/** One picture for an easel. */
interface Subject {
  /** The work's key in the room, where it hangs afterwards. */
  key: string;
  /** Names the stroke plan, so one image is only planned once (shared with the room's own canvas). */
  planId: string;
  /** Same-origin address of the image: the planner has to read its pixels. */
  source: string;
  title: string;
  /** The line under the title, such as the artist. */
  credit: string;
  /** Why this picture is here, in a few words. */
  note: string;
}

/** What an easel needs before its first stroke. Either part can be missing if it could not be loaded. */
interface Prepared {
  plan: StrokePlan | null;
  image: HTMLImageElement | null;
}

/** The room's key for the piece made for the two people. */
export const PIECE_KEY = 'piece';

/** The three easels, left to right. The piece made for the two people goes on the big centre easel. */
const LEFT = 0;
const CENTRE = 1;
const RIGHT = 2;

/** CSS width of the hidden canvases the strokes are drawn on; the studio shows them as textures. */
const SHEET_PX = 520;
const BLANK = '#f4efe6';
/** Physical width the stroke planner works at: coarse, since each painting settles into the real image. */
const PAINTING_WIDTH_MM = 60;
const PAINT_MS = 8000;
/** How long a painted canvas takes to settle into the picture itself. */
const SETTLE_MS = 1500;
/**
 * The longest the painter waits at the centre easel for the new piece. It is normally ready well
 * before the side easels are done; past this something has gone wrong, and the collection work
 * the two already meet at is painted instead.
 */
const PIECE_WAIT_MS = 45_000;
/** The pause on the three finished canvases before they are hung in the room. */
const HANDOFF_MS = 700;

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

/** Whether this browser can draw the studio at all. */
export function canOpenStudio(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => void image.decode().then(() => resolve(image), reject);
    image.onerror = () => reject(new Error('The image could not be loaded'));
    image.src = src;
  });
}

/** The stroke plan and the decoded image for a picture, fetched side by side. Never rejects. */
async function prepare(subject: Subject): Promise<Prepared> {
  const [plan, image] = await Promise.allSettled([
    getPlan({
      id: subject.planId,
      file: '',
      title: subject.title,
      artist: '',
      year: '',
      credit: '',
      widthMm: PAINTING_WIDTH_MM,
      src: subject.source,
      // Planned in the browser from the image; there is no precomputed plan to fetch.
      uploaded: true,
    }),
    loadImage(subject.source),
  ]);
  return {
    plan: plan.status === 'fulfilled' ? plan.value : null,
    image: image.status === 'fulfilled' ? image.value : null,
  };
}

function aspectOf({ plan, image }: Prepared): number | null {
  if (plan) return plan.widthMm / plan.heightMm;
  if (image && image.naturalHeight > 0) return image.naturalWidth / image.naturalHeight;
  return null;
}

function workSubject(work: Artwork, note: string): Subject {
  return { key: work.id, planId: 'blend:' + work.id, source: revealUrl(work.id), title: work.title, credit: work.artist, note };
}

/**
 * The studio a new blend opens in, on the first easel. Three canvases are painted: the visitor's
 * painter paints a work from the visitor's side, tosses the brush to the friend's painter for one
 * from the friend's side, and takes it back for the piece made for them both in the centre. Each
 * one is painted stroke by stroke and settles into the picture itself. Nothing is asked of the
 * visitor: when the last canvas is done the three are hung in the room.
 *
 * Every picture is planned from the moment the studio opens, so no easel waits on its own picture.
 */
export function PaintStudio({ blend, commission, pair, painter, friendPainter, friend, onDone }: Props) {
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const sheetsRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const commissionRef = useRef(commission);
  commissionRef.current = commission;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  // Read when the studio opens. It reopens only if a painter or a picture changes, not on every render.
  const castRef = useRef({ pair, painter, friendPainter });
  castRef.current = { pair, painter, friendPainter };
  const painterId = painter.painter.id;
  const friendPainterId = friendPainter.painter.id;
  const mineId = pair.mine?.work.id;
  const theirsId = pair.theirs?.work.id;
  /** One preparation per picture, started as early as the picture is known. */
  const preparedRef = useRef(new Map<string, Promise<Prepared>>());
  const prepared = useCallback((subject: Subject): Promise<Prepared> => {
    let entry = preparedRef.current.get(subject.planId);
    if (!entry) {
      entry = prepare(subject);
      preparedRef.current.set(subject.planId, entry);
    }
    return entry;
  }, []);

  /** The picture on the easel being worked at, and who is painting it; null before the first stroke and after the last. */
  const [now, setNow] = useState<{ subject: Subject; by: string } | null>(null);
  const [waitingForPiece, setWaitingForPiece] = useState(false);
  const [finished, setFinished] = useState(false);

  const pieceUrl = commission.status === 'ready' ? commission.image_url : null;
  const pieceTitle = commission.title;
  // The new piece is planned the moment it arrives, usually while a side easel is still being painted.
  useEffect(() => {
    if (pieceUrl) void prepared(pieceSubject(blend.id, pieceUrl, pieceTitle));
  }, [blend.id, pieceUrl, pieceTitle, prepared]);

  useEffect(() => {
    const canvas = sceneRef.current;
    const host = sheetsRef.current;
    if (!canvas || !host) return;

    const { pair, painter, friendPainter } = castRef.current;
    let cancelled = false;
    let scene: StudioScene | null = null;
    let player: Player | null = null;
    let frame = 0;
    let handoff = 0;
    const calm = prefersReducedMotion();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const notes: Record<WallSource, string> = {
      both: 'You both saved this',
      you: 'One of yours, close to ' + possessive(friend) + ' taste',
      friend: 'One of ' + possessive(friend) + ', close to your taste',
      new: 'New to you both',
    };
    const sides: Record<number, Subject | undefined> = {
      [LEFT]: pair.mine && workSubject(pair.mine.work, notes[pair.mine.from]),
      [RIGHT]: pair.theirs && workSubject(pair.theirs.work, notes[pair.theirs.from]),
    };
    /** Who paints each easel: each person's painter their own side, the visitor's the piece for both. */
    const artists: Record<number, RoomPainter> = { [LEFT]: painter, [RIGHT]: friendPainter, [CENTRE]: painter };
    /** Painted in the centre if the new piece does not arrive: the collection work the two already meet at. */
    const meeting = workSubject(blend.top_artwork, 'Where you already meet');
    const sequence = [LEFT, RIGHT].filter(i => sides[i] !== undefined).concat(CENTRE);

    // Everything is asked for now. The planner takes them in this order, so the first easel is first.
    for (const i of sequence) {
      const side = sides[i];
      if (side) void prepared(side);
    }
    if (commissionRef.current.status !== 'ready') void prepared(meeting);

    const sheets = [LEFT, CENTRE, RIGHT].map(() => {
      const sheet = document.createElement('canvas');
      host.append(sheet);
      return sheet;
    });
    /** Bare canvas. A sheet is opaque, so resizing one leaves it black until something is drawn. */
    const blank = (sheet: HTMLCanvasElement) => {
      const ctx = sheet.getContext('2d', { alpha: false });
      if (!ctx) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BLANK;
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      ctx.restore();
    };
    const shaped: (number | undefined)[] = [];
    /** Gives easel `i` its picture's proportions. Only before its first stroke: a resize clears the sheet. */
    const shape = (i: number, aspect: number) => {
      if (shaped[i] === aspect) return;
      shaped[i] = aspect;
      const sheet = sheets[i];
      const height = Math.round(SHEET_PX / aspect);
      sheet.style.width = SHEET_PX + 'px';
      sheet.style.height = height + 'px';
      sheet.width = Math.max(1, Math.round(SHEET_PX * dpr));
      sheet.height = Math.max(1, Math.round(height * dpr));
      blank(sheet);
      scene?.setAspect(i, aspect);
    };
    shape(LEFT, 0.8);
    shape(CENTRE, 1.25);
    shape(RIGHT, 0.8);

    const progress = (value: number) => {
      if (barRef.current) barRef.current.style.transform = 'scaleX(' + value + ')';
    };
    progress(0);

    /** The centre easel's picture: the new piece, waited for if need be; the meeting work only if it could not be made. */
    const centreSubject = async (): Promise<Subject> => {
      const until = performance.now() + PIECE_WAIT_MS;
      if (commissionRef.current.status === 'pending') setWaitingForPiece(true);
      while (!cancelled && commissionRef.current.status === 'pending' && performance.now() < until) await sleep(200);
      setWaitingForPiece(false);
      const { status, image_url, title } = commissionRef.current;
      return status === 'ready' && image_url ? pieceSubject(blend.id, image_url, title) : meeting;
    };

    /** Lets the painted sheet settle into the picture itself, as the room's own canvas does. */
    const settle = (sheet: HTMLCanvasElement, image: HTMLImageElement | null) =>
      new Promise<void>(resolve => {
        const ctx = sheet.getContext('2d', { alpha: false });
        if (!ctx || !image) return resolve();
        const painted = document.createElement('canvas');
        painted.width = sheet.width;
        painted.height = sheet.height;
        painted.getContext('2d')?.drawImage(sheet, 0, 0);
        const draw = (amount: number) => {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1;
          ctx.drawImage(painted, 0, 0);
          ctx.globalAlpha = amount;
          ctx.drawImage(image, 0, 0, sheet.width, sheet.height);
          ctx.restore();
        };
        if (calm) {
          draw(1);
          return resolve();
        }
        const start = performance.now();
        const step = (time: number) => {
          if (cancelled) return resolve();
          const k = Math.min(1, Math.max(0, (time - start) / SETTLE_MS));
          draw(k * k * (3 - 2 * k));
          if (k < 1) frame = requestAnimationFrame(step);
          else resolve();
        };
        frame = requestAnimationFrame(step);
      });

    /** Easels the painter has reached: from then on only the painter's own picture shapes the sheet. */
    const started = new Set<number>();
    /** What ended up on each easel, for hanging in the room. */
    const painted = new Map<number, Subject>();
    const paintAt = async (i: number) => {
      started.add(i);
      const subject = i === CENTRE ? await centreSubject() : sides[i];
      if (cancelled) return;
      if (!subject) return void scene?.workDone();
      setNow({ subject, by: artists[i].name });
      const ready = await prepared(subject);
      if (cancelled) return;
      const aspect = aspectOf(ready);
      // Neither the strokes nor the picture could be had: the canvas stays blank and the painter moves on.
      if (aspect === null) return void scene?.workDone();
      shape(i, aspect);
      if (ready.image) painted.set(i, subject);
      const sheet = sheets[i];
      const order = sequence.indexOf(i);
      const finish = async () => {
        await settle(sheet, ready.image);
        if (cancelled) return;
        progress((order + 1) / sequence.length);
        scene?.workDone();
      };
      if (!ready.plan) return void finish();
      const strokes = new Player(sheet, ready.plan, {
        style: 'swirl',
        durationMs: PAINT_MS,
        onFrame: ({ x, y, progress: done }) => {
          scene?.setBrush(x / sheet.clientWidth, y / sheet.clientHeight);
          progress((order + done) / sequence.length);
        },
        onDone: () => {
          // The finished picture stays on its sheet.
          strokes.destroy();
          if (player === strokes) player = null;
          void finish();
        },
      });
      player = strokes;
      // The player sizes the sheet for itself, which can clear it: it stays bare canvas, never black, until the first stroke.
      blank(sheet);
    };

    /** The room takes over, with each painted canvas and where it stands on screen right now. */
    const leave = () => {
      if (cancelled) return;
      const origin = canvas.getBoundingClientRect();
      const arrivals: RoomArrival[] = [];
      // Reduced motion: nothing flies, the room simply opens with everything hung.
      if (!calm) {
        for (const [i, subject] of painted) {
          const box = scene?.box(i);
          if (!box || box.width < 1 || box.height < 1) continue;
          arrivals.push({
            key: subject.key,
            src: subject.source,
            from: { left: origin.left + box.left, top: origin.top + box.top, width: box.width, height: box.height },
          });
        }
      }
      doneRef.current(arrivals);
    };

    import('../scene/studioScene').then(
      ({ createStudioScene }) => {
        if (cancelled) return;
        try {
          scene = createStudioScene(canvas, {
            base: './studio/',
            // Only the two people's painters are in the studio.
            cast: [painter.painter, friendPainter.painter].map(({ id, color, art = id }) => ({ id, color, src: art + '.webp', blink: art + '-blink.webp' })),
            mode: 'paint',
            painterId: painter.painter.id,
            painters: sequence.map(i => artists[i].painter.id),
            reducedMotion: calm,
            works: sheets.map((sheet, i) => ({ canvas: sheet, aspect: shaped[i] })),
            sequence,
            onReady: i => void paintAt(i),
            onAllDone: () => {
              progress(1);
              setNow(null);
              setFinished(true);
              handoff = window.setTimeout(leave, HANDOFF_MS);
            },
          });
        } catch {
          // The studio could not be drawn on this device: go straight to the room.
          return leave();
        }
        // The side easels take their pictures' proportions as soon as those are known, before the painter gets there.
        for (const i of [LEFT, RIGHT]) {
          const side = sides[i];
          if (!side) continue;
          void prepared(side).then(ready => {
            const aspect = aspectOf(ready);
            if (!cancelled && aspect !== null && shaped[i] !== aspect && !started.has(i)) shape(i, aspect);
          });
        }
      },
      // The studio's code could not be fetched: go straight to the room.
      leave,
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(handoff);
      player?.destroy();
      scene?.dispose();
      for (const sheet of sheets) sheet.remove();
    };
  }, [blend, friend, painterId, friendPainterId, mineId, theirsId, prepared]);

  const status = finished
    ? 'Hanging them in your room…'
    : waitingForPiece
      ? 'The piece for you both is nearly ready…'
      : now
        ? now.by + ' is painting…'
        : painter.name + ' is picking up a brush…';

  return (
    <main className="paint-studio">
      <canvas
        ref={sceneRef}
        className="paint-studio-scene"
        role="img"
        aria-label={'The studio, where ' + painter.name + ' and ' + friendPainter.name + ' paint three canvases for you and ' + friend}
      />
      <div ref={sheetsRef} className="paint-studio-sheets" aria-hidden="true" />
      <div className="paint-studio-caption">
        <span className="eyebrow">{now ? now.subject.note : 'You & ' + friend}</span>
        <h1>{now ? now.subject.title : 'Three paintings for the two of you'}</h1>
        {now?.subject.credit && <p className="paint-studio-credit">{now.subject.credit}</p>}
        <div className="paint-studio-progress" aria-hidden="true">
          <div ref={barRef} />
        </div>
        <p className="paint-studio-status" role="status">
          {status}
        </p>
      </div>
      <button type="button" className="text-link paint-studio-skip" onClick={() => onDone([])}>
        Skip to the room
      </button>
    </main>
  );
}

function pieceSubject(blendId: string, imageUrl: string, title: string | null): Subject {
  return {
    key: PIECE_KEY,
    planId: 'commission:' + blendId,
    source: imageUrl,
    title: title ?? 'A piece made for the two of you',
    credit: '',
    note: 'Made for you both',
  };
}
