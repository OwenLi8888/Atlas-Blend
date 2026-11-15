import './PaintStudio.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Artwork, BlendResponse, Commission, WallSource } from '../rec/api';
import { Player } from '../engine/player';
import { getPlan } from '../plan/planStore';
import type { StudioScene } from '../scene/studioScene';
import type { StrokePlan } from '../types';
import { possessive } from './format';
import { revealUrl } from './images';
import { PAINTERS, type Painter } from './painter';

interface Props {
  blend: BlendResponse;
  /** The piece being made for the two people, as it stands now: it can arrive while the sides are painted. */
  commission: Commission;
  /** The visitor's painter, who does the painting, and what they call it. */
  painter: { painter: Painter; name: string };
  /** The friend's name, as it reads in a sentence. */
  friend: string;
  /** Every canvas is painted (or the studio could not open): the room takes over. */
  onDone: () => void;
}

/** One picture for an easel. */
interface Subject {
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
/** How long the painter waits at the centre easel for the new piece before painting the collection work instead. */
const PIECE_WAIT_MS = 8000;
/** The pause on the finished studio before the room opens. */
const HANDOFF_MS = 900;

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
  return { planId: 'blend:' + work.id, source: revealUrl(work.id), title: work.title, credit: work.artist, note };
}

/**
 * The studio a new blend opens in. The visitor's painter takes a brush and paints three canvases:
 * two works that bring the two people together on the side easels, then the piece made for them
 * both in the centre. Each one is painted stroke by stroke and settles into the picture itself.
 * Nothing is asked of the visitor: when the last canvas is done the room opens by itself.
 *
 * Every picture is planned from the moment the studio opens, while the painter fetches its brush,
 * so no easel waits on its own picture.
 */
export function PaintStudio({ blend, commission, painter, friend, onDone }: Props) {
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const sheetsRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const commissionRef = useRef(commission);
  commissionRef.current = commission;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
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

  /** The picture on the easel being worked at; null while the painter fetches its brush. */
  const [now, setNow] = useState<Subject | null>(null);
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
      [LEFT]: blend.wall[0] && workSubject(blend.wall[0].work, notes[blend.wall[0].from]),
      [RIGHT]: blend.wall[1] && workSubject(blend.wall[1].work, notes[blend.wall[1].from]),
    };
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
      const ctx = sheet.getContext('2d', { alpha: false });
      if (ctx) {
        ctx.fillStyle = BLANK;
        ctx.fillRect(0, 0, sheet.width, sheet.height);
      }
      scene?.setAspect(i, aspect);
    };
    shape(LEFT, 0.8);
    shape(CENTRE, 1.25);
    shape(RIGHT, 0.8);

    const progress = (value: number) => {
      if (barRef.current) barRef.current.style.transform = 'scaleX(' + value + ')';
    };
    progress(0);

    /** The centre easel's picture: the new piece if it is ready or arrives shortly, else the meeting work. */
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
    const paintAt = async (i: number) => {
      started.add(i);
      const subject = i === CENTRE ? await centreSubject() : sides[i];
      if (cancelled) return;
      if (!subject) return void scene?.workDone();
      setNow(subject);
      const ready = await prepared(subject);
      if (cancelled) return;
      const aspect = aspectOf(ready);
      // Neither the strokes nor the picture could be had: the canvas stays blank and the painter moves on.
      if (aspect === null) return void scene?.workDone();
      shape(i, aspect);
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
    };

    const leave = () => {
      if (!cancelled) doneRef.current();
    };

    import('../scene/studioScene').then(
      ({ createStudioScene }) => {
        if (cancelled) return;
        try {
          scene = createStudioScene(canvas, {
            base: './studio/',
            cast: PAINTERS.map(({ id, color }) => ({ id, color, src: id + '.webp', blink: id + '-blink.webp' })),
            mode: 'paint',
            painterId: painter.painter.id,
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
  }, [blend, friend, painter.painter.id, prepared]);

  const status = finished
    ? 'Hanging them in your room…'
    : waitingForPiece
      ? 'The piece for you both is nearly ready…'
      : now
        ? painter.name + ' is painting…'
        : painter.name + ' is fetching a brush…';

  return (
    <main className="paint-studio">
      <canvas ref={sceneRef} className="paint-studio-scene" role="img" aria-label={'The studio, where ' + painter.name + ' paints three canvases for you and ' + friend} />
      <div ref={sheetsRef} className="paint-studio-sheets" aria-hidden="true" />
      <div className="paint-studio-caption">
        <span className="eyebrow">{now ? now.note : 'You & ' + friend}</span>
        <h1>{now ? now.title : 'Three paintings for the two of you'}</h1>
        {now?.credit && <p className="paint-studio-credit">{now.credit}</p>}
        <div className="paint-studio-progress" aria-hidden="true">
          <div ref={barRef} />
        </div>
        <p className="paint-studio-status" role="status">
          {status}
        </p>
      </div>
      <button type="button" className="text-link paint-studio-skip" onClick={onDone}>
        Skip to the room
      </button>
    </main>
  );
}

function pieceSubject(blendId: string, imageUrl: string, title: string | null): Subject {
  return {
    planId: 'commission:' + blendId,
    source: imageUrl,
    title: title ?? 'A piece made for the two of you',
    credit: '',
    note: 'Made for you both',
  };
}
