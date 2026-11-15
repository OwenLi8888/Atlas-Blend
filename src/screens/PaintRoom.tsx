import './PaintRoom.css';
import { useEffect, useRef, useState } from 'react';
import { heartPicks, type GalleryPlayer } from '../blend/gallery';
import { blendSlot, friendSlot, ownSlot, styleNote, type BlendResult, type Slot } from '../blend/pictures';
import { studioCast, type Character } from '../characters';
import { Player } from '../engine/player';
import { getSessionPicks, type PicksRecord } from '../picks/picksStore';
import { loadPool, photoUrl, type PoolPhoto } from '../picks/pool';
import type { Session } from '../picks/session';
import { getPlan } from '../plan/planStore';
import type { StudioScene } from '../scene/studioScene';
import { STYLE_MENU, type StyleId } from '../types';
import type { GalleryItem } from './Gallery';
import { Studio } from './Studio';

interface Props {
  character: Character;
  session: Session;
  /** This player's saved picks. */
  record: PicksRecord;
  /** This player's Gallery API profile, when that server is running. */
  player: GalleryPlayer | null;
  onBack: () => void;
  /** Next: the gallery, hung with what was painted and what the two players picked. */
  onGallery: (items: GalleryItem[]) => void;
}

/** The three easels, left to right, and what each one is for. */
const MINE = 0;
const BLEND = 1;
const FRIEND = 2;
/** Painted in this order: yours, your friend's, then the blend on the big centre easel. */
const SEQUENCE = [MINE, FRIEND, BLEND];
const STYLE: Record<number, StyleId> = { [MINE]: 'shapes', [FRIEND]: 'mosaic', [BLEND]: 'swirl' };
const styleLabel = (i: number) => STYLE_MENU.find((s) => s.id === STYLE[i])?.label ?? '';

/** CSS width of the hidden canvases the stroke players draw on; the 3D room shows them as textures. */
const SHEET = 420;
const SECONDS_EACH = 9;
/** How long the painter waits at an easel for the friend to finish picking before painting one of yours instead. */
const FRIEND_WAIT_MS = 15000;

const hasWebGL = () => !!document.createElement('canvas').getContext('webgl2');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Screen 3, in the painted studio. The chosen painter takes a brush and paints three canvases: one
 * of your picks, one of your friend's, and in the centre the piece that blends the two of you.
 * Tap a finished canvas to come in close and read why it looks the way it does; Next leads on to
 * the gallery. Without WebGL it falls back to the flat Studio screen with your first pick.
 */
export function PaintRoom(props: Props) {
  const [webgl] = useState(hasWebGL);
  const [pool, setPool] = useState<PoolPhoto[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadPool().then((p) => !cancelled && setPool(p), () => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (!pool) return <main className="paint-room" />;
  const first = pool.find((p) => p.id === props.record.picks[0]);
  if (!first) return null;
  if (!webgl) return <Studio painting={ownSlot(first, 0).painting} character={props.character} onBack={props.onBack} />;
  return <Room {...props} pool={pool} />;
}

function Room({ character, session, record, player, onBack, onGallery, pool }: Props & { pool: PoolPhoto[] }) {
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const studio = useRef<StudioScene | null>(null);
  const sheetsRef = useRef<HTMLCanvasElement[]>([]);
  const blendRef = useRef<BlendResult | null>(null);
  const friendRef = useRef<PicksRecord | null>(null);
  const playerRef = useRef(player);
  playerRef.current = player;
  /** What is on each easel, once decided. */
  const [slots, setSlots] = useState<(Slot | null)[]>([null, null, null]);
  /** The easel being worked at, or -1 while the painter fetches its brush. */
  const [index, setIndex] = useState(-1);
  /** What the painter is waiting for at that easel, if anything. */
  const [waiting, setWaiting] = useState<'friend' | 'blend' | 'plan' | null>(null);
  const [painted, setPainted] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  /** The finished canvas being looked at up close. */
  const [viewing, setViewing] = useState<number | null>(null);
  const [friendName, setFriendName] = useState('your friend');
  const [run, setRun] = useState(0);

  useEffect(() => {
    const canvas = sceneRef.current;
    const host = hostRef.current;
    const panel = panelRef.current;
    if (!canvas || !host) return;
    let cancelled = false;
    let scene: StudioScene | null = null;
    let ro: ResizeObserver | null = null;
    let current = -1;
    const players: Player[] = [];
    const objectUrls: string[] = [];
    const byId = new Map(pool.map((p) => [p.id, p]));
    const mine = record.picks.map((id) => byId.get(id)).filter((p): p is PoolPhoto => !!p);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sheets = [0, 1, 2].map(() => {
      const sheet = document.createElement('canvas');
      host.append(sheet);
      return sheet;
    });
    sheetsRef.current = sheets;
    /** Gives a sheet its final size before anything draws on it (a texture cannot change size later). */
    const sizeSheet = (i: number, aspect: number) => {
      const sheet = sheets[i], h = Math.round(SHEET / aspect);
      sheet.style.width = `${SHEET}px`;
      sheet.style.height = `${h}px`;
      sheet.width = Math.max(1, Math.round(SHEET * dpr));
      sheet.height = Math.max(1, Math.round(h * dpr));
      const g = sheet.getContext('2d', { alpha: false });
      if (g) {
        g.fillStyle = '#f4efe6';
        g.fillRect(0, 0, sheet.width, sheet.height);
      }
    };
    for (const i of [0, 1, 2]) sizeSheet(i, i === BLEND ? 1.25 : 0.8);
    setSlots([null, null, null]);
    setIndex(-1);
    setWaiting(null);
    setPainted([]);
    setDone(false);
    setViewing(null);
    blendRef.current = null;
    const bar = (progress: number) => {
      if (barRef.current) barRef.current.style.transform = `scaleX(${progress})`;
    };
    bar(0);

    // ---- The other player: watched from the start, so the blend can be under way early ----
    let friend: PicksRecord | null = null;
    let blend: Promise<BlendResult> | null = null;
    // the profile is read once, here: one arriving later must not restart the painting
    const me = playerRef.current;
    const hearted = me ? heartPicks(me, mine.map((p) => p.artId).filter((id): id is string => !!id)) : Promise.resolve();
    const startBlend = (f: PicksRecord) => {
      const theirs = byId.get(f.picks[0]);
      if (!theirs || !mine[0]) return null;
      return hearted.then(() => blendSlot({ mine: mine[0], theirs, friendName: f.name || 'your friend', player: me, friend: f }));
    };
    (async () => {
      const until = Date.now() + 180000;   // then stop asking: this is a one-player visit
      while (!cancelled && !friend && Date.now() < until) {
        const all = await getSessionPicks(session.sessionId);
        friend = all.find((r) => r.user !== session.user) ?? null;
        if (!friend) await sleep(1500);
      }
      if (cancelled || !friend) return;
      friendRef.current = friend;
      setFriendName(friend.name || 'your friend');
      blend = startBlend(friend);
      blend?.catch(() => {});
    })();
    const friendWithin = async (ms: number) => {
      const end = Date.now() + ms;
      while (!friend && !cancelled && Date.now() < end) await sleep(300);
      return friend;
    };

    /** Decides what goes on easel `i`. Each fallback is one of the player's own picks. */
    const slotFor = async (i: number): Promise<Slot | null> => {
      if (i === MINE) return mine[0] ? ownSlot(mine[0], 0) : null;
      setWaiting('friend');
      const f = await friendWithin(FRIEND_WAIT_MS);
      if (i === FRIEND) {
        const theirs = f && byId.get(f.picks[0]);
        if (f && theirs) return friendSlot(theirs, f.name || 'your friend');
        return mine[1] ? ownSlot(mine[1], 1, 'Your friend has not picked yet, so this easel is yours too.') : null;
      }
      if (f && blend) {
        setWaiting('blend');
        try {
          const result = await blend;
          if (result.slot.painting.src.startsWith('blob:')) objectUrls.push(result.slot.painting.src);
          blendRef.current = result;
          return result.slot;
        } catch {
          // fall through to one of the player's own picks
        }
      }
      return mine[2] ? ownSlot(mine[2], 2, 'With a friend in the same session, this easel holds the blend of the two of you.') : null;
    };

    const paintAt = async (i: number) => {
      current = i;
      setIndex(i);
      const slot = await slotFor(i);
      if (cancelled || i !== current) return;
      if (!slot) {
        setWaiting(null);
        return void scene?.workDone();
      }
      setSlots((s) => s.map((old, k) => (k === i ? slot : old)));
      sizeSheet(i, slot.aspect);
      scene?.setAspect(i, slot.aspect);
      setWaiting('plan');
      let plan;
      try {
        plan = await getPlan(slot.painting);
      } catch {
        plan = null;
      }
      if (cancelled || i !== current) return;
      setWaiting(null);
      if (!plan) return void scene?.workDone();   // could not be planned: the canvas stays blank
      const sheet = sheets[i];
      const order = SEQUENCE.indexOf(i);
      const player2d = new Player(sheet, plan, {
        style: STYLE[i],
        durationMs: SECONDS_EACH * 1000,
        onFrame: (f) => {
          if (i !== current) return;
          scene?.setBrush(f.x / sheet.clientWidth, f.y / sheet.clientHeight);
          bar((order + f.progress) / SEQUENCE.length);
        },
        onDone: () => {
          player2d.destroy(); // the finished picture stays on its canvas
          players.splice(players.indexOf(player2d), 1);
          setPainted((p) => [...p, i]);
          if (i === current) scene?.workDone();
        },
      });
      players.push(player2d);
    };

    import('../scene/studioScene').then(({ createStudioScene }) => {
      if (cancelled) return;
      scene = createStudioScene(canvas, {
        base: './studio/',
        cast: studioCast,
        mode: 'paint',
        painterId: character.id,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        works: sheets.map((sheet) => ({ canvas: sheet })),
        sequence: SEQUENCE,
        onReady: (i) => void paintAt(i),
        onAllDone: () => {
          current = -1;
          bar(1);
          setDone(true);
        },
        onCanvas: (i) => setViewing((v) => (v === i ? null : i)),
      });
      studio.current = scene;
      ro = new ResizeObserver(() => {
        const wide = window.matchMedia('(min-width: 900px) and (min-aspect-ratio: 1/1)').matches;
        scene?.setPanel(wide && panel ? panel.getBoundingClientRect().right : 0);
      });
      if (panel) ro.observe(panel);
      ro.observe(canvas);
    });
    return () => {
      cancelled = true;
      ro?.disconnect();
      for (const p of players) p.destroy();
      scene?.dispose();
      studio.current = null;
      for (const sheet of sheets) sheet.remove();
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [pool, record, session, character.id, run]);

  // Only a finished canvas can be looked at; the camera follows the choice.
  const shown = viewing !== null && painted.includes(viewing) && slots[viewing] ? viewing : null;
  useEffect(() => {
    studio.current?.view(shown);
  }, [shown]);

  const openGallery = () => {
    const items: GalleryItem[] = [];
    for (const i of [BLEND, MINE, FRIEND]) {
      const slot = slots[i], sheet = sheetsRef.current[i];
      if (!slot || !sheet || !painted.includes(i)) continue;
      items.push({
        src: sheet.toDataURL('image/jpeg', 0.9),
        aspect: slot.aspect,
        title: slot.painting.title,
        sub: `Painted by ${character.name} in ${styleLabel(i)}`,
        tag: slot.tag,
      });
    }
    const byId = new Map(pool.map((p) => [p.id, p]));
    const hang = (ids: string[], tag: string) => {
      for (const id of ids) {
        const p = byId.get(id);
        if (p) items.push({ src: photoUrl(p.thumb), aspect: p.width / p.height, title: p.title || 'Untitled', sub: [p.artist, p.year].filter(Boolean).join(', '), tag });
      }
    };
    // the two players' picks take turns down the wall
    const theirs = friendRef.current?.picks ?? [];
    for (let k = 0; k < Math.max(record.picks.length, theirs.length); k++) {
      if (record.picks[k]) hang([record.picks[k]], 'Yours');
      if (theirs[k]) hang([theirs[k]], `${friendName}’s`);
    }
    onGallery(items);
  };

  const now = index >= 0 && !done ? slots[index] : null;
  const card = shown !== null ? slots[shown] : null;
  const status = done
    ? 'Tap a painting to see why it looks this way.'
    : index < 0
      ? `${character.name} is fetching a brush…`
      : waiting === 'friend'
        ? `${character.name} is waiting for ${friendName} to pick…`
        : waiting === 'blend'
          ? `${character.name} is mixing your tastes…`
          : waiting === 'plan' || !now
            ? `${character.name} is studying the picture…`
            : `${character.name} is painting in ${styleLabel(index)}…`;
  const chip = (i: number) => (i === MINE ? 'Yours' : i === FRIEND ? (slots[i]?.tag ?? 'Friend') : 'Blend');
  const nextAfter = shown === null ? null : SEQUENCE.slice(SEQUENCE.indexOf(shown) + 1).find((i) => painted.includes(i) && slots[i]);

  return (
    <main className={`paint-room${card ? ' viewing' : ''}`}>
      <canvas ref={sceneRef} className="paint-scene" aria-label="The studio. Tap a finished painting to look closer." />
      <div ref={hostRef} className="paint-sheets" aria-hidden="true" />
      <div ref={panelRef} className="paint-panel">
        <header className="paint-head">
          <button type="button" className="btn ghost back" onClick={onBack}>
            <span aria-hidden="true">←</span> Back
          </button>
          <div className="paint-title">
            <h1>{card ? card.painting.title : now ? now.painting.title : 'Your studio'}</h1>
            <p>
              {card || now
                ? [(card ?? now)!.painting.artist, (card ?? now)!.painting.year].filter(Boolean).join(', ')
                : `${character.name} paints for you and ${friendName}`}
            </p>
          </div>
        </header>

        {card && shown !== null ? (
          <section className="paint-card" aria-label="About this painting">
            <div className="paint-card-top">
              <span className="paint-tag">{card.tag}</span>
              {card.score !== undefined && <span className="paint-score">{Math.round(card.score)}% match</span>}
              <button type="button" className="text-btn" onClick={() => setViewing(null)}>
                Close
              </button>
            </div>
            <p className="paint-why">{card.why}</p>
            <p className="paint-how">
              {character.name} painted it {styleNote(STYLE[shown])}.
            </p>
            <div className="paint-card-actions">
              {nextAfter !== undefined && nextAfter !== null ? (
                <button type="button" className="btn primary" onClick={() => setViewing(nextAfter)}>
                  Next painting
                </button>
              ) : (
                <button type="button" className="btn primary" onClick={openGallery}>
                  Open the gallery
                </button>
              )}
            </div>
          </section>
        ) : (
          <section className="paint-foot" aria-label="Painting progress">
            <ol className="paint-steps">
              {SEQUENCE.map((i) => (
                <li key={i} className={painted.includes(i) ? 'done' : i === index ? 'now' : undefined}>
                  {chip(i)}
                </li>
              ))}
            </ol>
            <div className="progress" aria-hidden="true">
              <div className="progress-fill" ref={barRef} />
            </div>
            <p className="status" role="status">
              {status}
            </p>
            {done && (
              <div className="paint-done">
                <button type="button" className="btn primary" onClick={() => setViewing(SEQUENCE.find((i) => painted.includes(i)) ?? null)}>
                  See the paintings
                </button>
                <button type="button" className="btn secondary" onClick={() => setRun((n) => n + 1)}>
                  Paint again
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
