import './Gallery.css';
import './SpeechCloud.css';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FLIGHT_MS, HUNG_NAME } from '../gallery/flight';
import { getDuo, getFinalPainting, loadWall, type Duo } from '../gallery/galleryData';
import { PainterSprite } from '../gallery/PainterSprite';
import { savePainting } from '../gallery/savePainting';
import type { Session } from '../picks/session';
import { SpeechCloud } from './SpeechCloud';

/** How the visitor got here. */
export type Arrival =
  /**
   * From the painting page. `from` is where the finished painting was on screen. `shared` means a
   * view transition is carrying the painting into the frame, so the room must not fly it itself.
   */
  | { kind: 'handoff'; from: DOMRect | null; shared: boolean }
  /** A refresh or a direct link: the painting flies in from the distance. */
  | { kind: 'direct' };

interface Props {
  session: Session;
  /** This user's painter (page 1). */
  characterId: string | null;
  arrival: Arrival;
  /** The new painting is in its frame and laid out: a view transition can take its picture of the room. */
  onFrontReady?: () => void;
  onPlayAgain: () => void;
}

/** One canvas on the wall. */
interface Item {
  key: string;
  imageUrl: string;
  title: string;
  style: string;
  /** The pictures around the new one: the year for a pool photo, the credit for a sample. */
  credit?: string;
  /** The painting the two users just made. */
  isNew: boolean;
  createdAt?: string;
}

/**
 * The arrival moment, in order. `fly`: the painting is on its way to the frame. `land`: it settles,
 * the spotlight warms up. `enter`: the painters pop up in the corners. `meet`: they hop together.
 * `clap`: the high five. `speak`: the cloud. `settled`: the room is the visitor's.
 */
type Phase = 'loading' | 'fly' | 'land' | 'enter' | 'meet' | 'clap' | 'speak' | 'settled';
/** ms after the painting lands. About 5 s with the flight. */
const STEPS: [Phase, number][] = [
  ['land', 0],
  ['enter', 600],
  ['meet', 1250],
  ['clap', 1950],
  ['speak', 2300],
  ['settled', 4300],
];
/** How long the cloud stays once the room is the visitor's. */
const CLOUD_LINGER_MS = 4500;

const SLOTS = 12;
const STEP_DEG = 360 / SLOTS;
/** Idle time before the room starts to turn by itself, and how fast it turns. */
const IDLE_MS = 8000;
const AUTO_DEG_PER_S = 3.2;
/** Canvases further round than this are behind the visitor and not drawn. */
const HIDE_DEG = 72;

const DEFAULT_LINE = 'We made this *together!*';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const STAR = 'M0,-1C0.12,-0.3 0.3,-0.12 1,0C0.3,0.12 0.12,0.3 0,1C-0.12,0.3 -0.3,0.12 -1,0C-0.3,-0.12 -0.12,-0.3 0,-1Z';

interface Dims {
  /** Radius of the ring. The ring's centre is this far behind the screen plane, so the canvas in front is drawn flat and at its true size. */
  r: number;
  /** Perspective: the visitor stands half a radius behind the centre, which keeps the neighbouring canvases from looming. */
  p: number;
  slotW: number;
  slotH: number;
  char: number;
  /** Where the canvases start, from the top of the screen. */
  top: number;
}

function measure(el: HTMLElement): Dims {
  const vw = el.clientWidth, vh = el.clientHeight;
  // Narrow screens stand closer to the wall, so the edges of the neighbouring canvases stay in view.
  const r = Math.min(900, Math.max(520, vw * 1.45));
  const p = r * 1.5;
  // 12 canvases share the circle: each gets 30 degrees of wall, and 84% of that is canvas.
  const slotW = Math.floor(2 * r * Math.tan(Math.PI / SLOTS) * 0.84);
  const char = Math.round(Math.min(120, Math.max(76, vw * 0.2)));
  const head = vw < 600 ? 104 : 96, plaque = 92, below = char + 30;
  const room = vh - head - plaque - below;
  const slotH = Math.floor(Math.max(160, Math.min(slotW * 1.2, room)));
  return { r, p, slotW, slotH, char, top: Math.round(head + Math.max(0, room - slotH) / 2) };
}

/**
 * The last page: a small round gallery. The visitor stands in the middle; the wall around them is
 * a ring of 12 framed canvases, the new painting first and pictures from the photo pool after it. Drag, swipe,
 * wheel or use the arrow keys to turn; tap a canvas to see it up close.
 */
export function Gallery({ session, characterId, arrival, onFrontReady, onPlayAgain }: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const flyerRef = useRef<HTMLImageElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [duo, setDuo] = useState<Duo | null>(null);
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const [dims, setDims] = useState<Dims | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [skipped, setSkipped] = useState(false);
  const [cloud, setCloud] = useState(false);
  const [front, setFront] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);
  const [calm] = useState(reducedMotion);
  const shared = arrival.kind === 'handoff' && arrival.shared;

  // ---- What hangs here ----
  useEffect(() => {
    let cancelled = false;
    getFinalPainting(session.sessionId).then((final) => {
      if (cancelled) return;
      const mine: Item = { key: 'new', imageUrl: final.imageUrl, title: final.title || 'Our Painting', style: final.style, isNew: true, createdAt: final.createdAt };
      setItems((list) => [mine, ...list.filter((i) => !i.isNew)]);
    });
    loadWall(session.sessionId, SLOTS - 1).then((wall) => {
      if (cancelled) return;
      const rest = wall.map((s): Item => ({ key: s.id, imageUrl: s.imageUrl, title: s.title, style: s.style, credit: s.credit, isNew: false }));
      setItems((list) => [...list.filter((i) => i.isNew), ...rest]);
    });
    getDuo(session, characterId).then((d) => {
      if (!cancelled) setDuo(d);
    });
    return () => {
      cancelled = true;
    };
  }, [session, characterId]);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => setDims((d) => {
      const n = measure(el);
      return d && d.r === n.r && d.slotW === n.slotW && d.slotH === n.slotH && d.char === n.char && d.top === n.top ? d : n;
    });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- Turning the room ----
  // Kept out of React state: the ring is moved by hand every frame.
  const eng = useRef({ angle: 0, target: 0, vel: 0, mode: 'rest' as 'rest' | 'drag' | 'spring' | 'auto', raf: 0, last: 0, idle: 0, front: 0 });
  const dimsRef = useRef(dims);
  dimsRef.current = dims;
  const canAuto = useRef(false);
  canAuto.current = phase === 'settled' && focus === null && !calm;

  const apply = useCallback(() => {
    const e = eng.current, ring = ringRef.current, d = dimsRef.current;
    if (!ring || !d) return;
    ring.style.transform = `translateZ(${d.r}px) rotateY(${e.angle.toFixed(3)}deg)`;
    let nearest = 0, best = 999;
    for (const el of ring.children as HTMLCollectionOf<HTMLElement>) {
      const i = Number(el.dataset.index);
      // Degrees round from straight ahead, -180..180.
      const off = ((((e.angle - i * STEP_DEG) % 360) + 540) % 360) - 180;
      const far = Math.abs(off);
      el.style.visibility = far > HIDE_DEG ? 'hidden' : 'visible';
      el.style.setProperty('--far', Math.min(1, far / 60).toFixed(3));
      if (far < best) {
        best = far;
        nearest = i;
      }
    }
    if (nearest !== e.front) {
      e.front = nearest;
      setFront(nearest);
    }
  }, []);

  const tick = useCallback(
    (now: number) => {
      const e = eng.current;
      const dt = Math.min(0.05, (now - e.last) / 1000);
      e.last = now;
      if (e.mode === 'spring') {
        const diff = e.target - e.angle;
        if (Math.abs(diff) < 0.03) {
          e.angle = e.target;
          e.mode = 'rest';
        } else e.angle += diff * (1 - Math.exp(-dt * 8.5));
      } else if (e.mode === 'auto') {
        e.angle += AUTO_DEG_PER_S * dt;
        e.target = e.angle;
      }
      apply();
      if (e.mode === 'spring' || e.mode === 'auto') e.raf = requestAnimationFrame(tick);
      else e.raf = 0;
    },
    [apply],
  );

  const run = useCallback(() => {
    const e = eng.current;
    if (e.raf) return;
    e.last = performance.now();
    e.raf = requestAnimationFrame(tick);
  }, [tick]);

  /** Any input: the room stops turning by itself, and waits 8 s before it starts again. */
  const touch = useCallback(() => {
    const e = eng.current;
    window.clearTimeout(e.idle);
    if (e.mode === 'auto') {
      e.target = Math.round(e.angle / STEP_DEG) * STEP_DEG;
      e.mode = 'spring';
      run();
    }
    e.idle = window.setTimeout(() => {
      if (!canAuto.current || e.mode !== 'rest') return touch();
      e.mode = 'auto';
      run();
    }, IDLE_MS);
  }, [run]);

  const springTo = useCallback(
    (target: number) => {
      const e = eng.current;
      e.target = target;
      if (reducedMotion()) {
        e.angle = target;
        e.mode = 'rest';
        apply();
        return;
      }
      e.mode = 'spring';
      run();
    },
    [apply, run],
  );

  /** One canvas to the right (+1) or left (-1). */
  const step = useCallback(
    (dir: number) => {
      touch();
      const e = eng.current;
      const base = e.mode === 'spring' ? e.target : Math.round(e.angle / STEP_DEG) * STEP_DEG;
      springTo(base + dir * STEP_DEG);
    },
    [springTo, touch],
  );

  /** Turn to canvas `i` the short way round. */
  const face = useCallback(
    (i: number) => {
      const e = eng.current;
      const want = i * STEP_DEG;
      springTo(want + Math.round((e.angle - want) / 360) * 360);
    },
    [springTo],
  );

  useLayoutEffect(apply, [apply, dims, items.length]);
  useEffect(() => {
    const e = eng.current;
    return () => {
      cancelAnimationFrame(e.raf);
      window.clearTimeout(e.idle);
      e.raf = 0;
    };
  }, []);
  // The 8 s idle clock starts when the room becomes the visitor's.
  useEffect(() => {
    if (phase === 'settled') touch();
  }, [phase, touch]);

  // ---- The arrival moment ----
  const timers = useRef<number[]>([]);
  const flight = useRef<Animation | null>(null);
  const [frontLoaded, setFrontLoaded] = useState(false);
  const started = useRef(false);
  const ready = frontLoaded && !!dims && !!duo && items.length > 0 && items[0].isNew;

  // A view transition takes its picture of the room once the new painting is in its frame.
  const told = useRef(false);
  useLayoutEffect(() => {
    if (!frontLoaded || !dims || told.current) return;
    told.current = true;
    onFrontReady?.();
  }, [frontLoaded, dims, onFrontReady]);

  const play = useCallback(() => {
    for (const [p, at] of STEPS) timers.current.push(window.setTimeout(() => setPhase(p), at));
    timers.current.push(window.setTimeout(() => setCloud(true), STEPS.find(([p]) => p === 'speak')![1]));
  }, []);

  const settle = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    flight.current?.cancel();
    flight.current = null;
    setSkipped(true);
    setCloud(false);
    setPhase('settled');
  }, []);

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    if (calm) {
      // No flight and no confetti: the painting is there, the painters fade in, the line is whole.
      setPhase('settled');
      setCloud(true);
      return;
    }
    setPhase('fly');
    if (shared) {
      // The view transition is flying the painting; the room waits for it to land.
      timers.current.push(window.setTimeout(play, FLIGHT_MS));
      return;
    }
    const flyer = flyerRef.current;
    const target = ringRef.current?.querySelector<HTMLElement>('.gal-panel.is-new .gal-art');
    if (!flyer || !target) return play();
    const to = target.getBoundingClientRect();
    Object.assign(flyer.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
    const from = arrival.kind === 'handoff' ? arrival.from : null;
    const frames: Keyframe[] = from
      ? [
          // FLIP: from where it hung on the painting page to its frame.
          { transform: `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: 1 },
          { transform: 'none', opacity: 1 },
        ]
      : [
          // From the distance: a speck ahead that grows into the frame.
          { transform: `translate(0, ${-to.height * 0.12}px) scale(0.04)`, opacity: 0 },
          { opacity: 1, offset: 0.3 },
          { transform: 'none', opacity: 1 },
        ];
    const anim = flyer.animate(frames, { duration: FLIGHT_MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'both' });
    flight.current = anim;
    anim.finished.then(
      () => {
        flight.current = null;
        play();
      },
      () => {},
    );
  }, [ready, calm, shared, arrival, play]);

  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
      flight.current?.cancel();
    },
    [],
  );

  // The cloud lingers a little once the room is the visitor's, then leaves.
  useEffect(() => {
    if (phase !== 'settled' || !cloud) return;
    const t = window.setTimeout(() => setCloud(false), CLOUD_LINGER_MS);
    return () => window.clearTimeout(t);
  }, [phase, cloud]);

  const arriving = phase !== 'settled' && phase !== 'loading';
  const arrived = phase !== 'loading' && phase !== 'fly';
  const clapped = phase === 'clap' || phase === 'speak' || phase === 'settled';

  // ---- Input ----
  const drag = useRef<{ id: number; x: number; angle: number; moved: boolean; panel: number | null; t: number; lastX: number } | null>(null);

  const onPointerDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (ev.button > 0) return;
    if (arriving) return settle(); // a tap skips the arrival
    if (phase !== 'settled') return;
    touch();
    const e = eng.current;
    const panel = (ev.target as HTMLElement).closest<HTMLElement>('.gal-panel');
    drag.current = { id: ev.pointerId, x: ev.clientX, angle: e.angle, moved: false, panel: panel ? Number(panel.dataset.index) : null, t: performance.now(), lastX: ev.clientX };
    e.mode = 'drag';
    e.vel = 0;
    ev.currentTarget.setPointerCapture(ev.pointerId);
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current, dm = dimsRef.current;
    if (!d || d.id !== ev.pointerId || !dm) return;
    const dx = ev.clientX - d.x;
    if (Math.abs(dx) > 6) d.moved = true;
    if (!d.moved) return;
    const e = eng.current;
    // One radius of wall per radian: this keeps the canvas in front under the finger.
    const degPerPx = 180 / (Math.PI * dm.r);
    const now = performance.now();
    const dt = Math.max(1, now - d.t) / 1000;
    e.vel = e.vel * 0.6 + ((-(ev.clientX - d.lastX) * degPerPx) / dt) * 0.4;
    d.t = now;
    d.lastX = ev.clientX;
    e.angle = d.angle - dx * degPerPx;
    apply();
  };

  const onPointerUp = (ev: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== ev.pointerId) return;
    drag.current = null;
    const e = eng.current;
    touch();
    if (!d.moved) {
      e.mode = 'rest';
      if (ev.type === 'pointerup' && d.panel !== null) {
        face(d.panel);
        setFocus(d.panel);
      }
      return;
    }
    // Inertia: carry on the way it was thrown (two canvases at most), then come to rest on a canvas.
    const stale = performance.now() - d.t > 80;
    const throwDeg = stale ? 0 : Math.max(-2 * STEP_DEG, Math.min(2 * STEP_DEG, e.vel * 0.22));
    springTo(Math.round((e.angle + throwDeg) / STEP_DEG) * STEP_DEG);
  };

  const wheelAt = useRef(0);
  const onWheel = (ev: React.WheelEvent<HTMLDivElement>) => {
    if (phase !== 'settled' || focus !== null) return;
    const delta = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    const now = performance.now();
    // One canvas per notch: a trackpad sends a stream of small events for one gesture.
    if (Math.abs(delta) < 4 || now - wheelAt.current < 320) return;
    wheelAt.current = now;
    step(delta > 0 ? 1 : -1);
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && focus !== null) return setFocus(null);
      if (phase !== 'settled') {
        if (arriving && (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Escape')) settle();
        return;
      }
      if (focus !== null) return;
      if (ev.key === 'ArrowRight') step(1);
      else if (ev.key === 'ArrowLeft') step(-1);
      else return;
      ev.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, focus, arriving, settle, step]);

  // ---- Drawing ----
  const byline = duo ? `by ${duo[0].name} & ${duo[1].name}` : '';
  const line = duo ? (duo[0].galleryLine ?? duo[1].galleryLine ?? DEFAULT_LINE) : DEFAULT_LINE;
  const vars = dims
    ? ({ '--p': `${dims.p}px`, '--slot-w': `${dims.slotW}px`, '--slot-h': `${dims.slotH}px`, '--char': `${dims.char}px`, '--top': `${dims.top}px` } as CSSProperties)
    : undefined;
  const sparkles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2 + (i % 2) * 0.2;
        return { x: 50 + Math.cos(a) * 54, y: 50 + Math.sin(a) * 54, dx: Math.cos(a) * (40 + (i % 3) * 22), dy: Math.sin(a) * (40 + (i % 3) * 22), s: 7 + (i % 4) * 2.5, gold: i % 2 === 0, delay: (i % 5) * 40 };
      }),
    [],
  );
  const confetti = useMemo(() => {
    const colors = ['var(--rose)', 'var(--teal)', 'var(--navy)', 'var(--olive)', duo?.[0].color ?? 'var(--rose)', duo?.[1].color ?? 'var(--teal)'];
    return Array.from({ length: 18 }, (_, i) => {
      const a = -Math.PI / 2 + ((i / 17) * 2 - 1) * 1.25;
      const reach = 70 + ((i * 37) % 60);
      return { dx: Math.cos(a) * reach, dy: Math.sin(a) * reach, spin: ((i * 73) % 360) - 180, color: colors[i % colors.length], delay: (i % 4) * 25, wide: i % 3 === 0 };
    });
  }, [duo]);
  const shown = focus !== null ? items[focus] : null;
  const current = items[front];

  return (
    <main
      ref={rootRef}
      className={`gallery${arrived ? ' arrived' : ''}${clapped ? ' clapped' : ''}${skipped ? ' skipped' : ''}${shared ? ' shared' : ''}${focus !== null ? ' focused' : ''}`}
      data-phase={phase}
      style={vars}
    >
      <div className="gal-wall" aria-hidden="true" />
      <div className="gal-lamp" aria-hidden="true" />
      <div className="gal-floor" aria-hidden="true" />

      <div
        className="gal-stage"
        role="group"
        aria-roledescription="carousel"
        aria-label="The gallery room. Use the left and right arrow keys to turn."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <div ref={ringRef} className="gal-ring">
          {dims &&
            items.map((item, i) => {
              const ar = aspects[item.key] ?? 0.8;
              const hidden = item.isNew && phase === 'fly' && !shared;
              return (
                <figure
                  key={item.key}
                  className={`gal-panel${item.isNew ? ' is-new' : ''}${aspects[item.key] ? ' loaded' : ''}${i === front ? ' front' : ''}`}
                  data-index={i}
                  style={{ transform: `rotateY(${-i * STEP_DEG}deg) translateZ(${-dims.r}px)`, ['--ar' as string]: ar }}
                >
                  {item.isNew && <span className="gal-spot" aria-hidden="true" />}
                  <div className="gal-frame">
                    <img
                      className="gal-art"
                      src={item.imageUrl}
                      alt={item.isNew ? `${item.title}, the painting you made together` : `${item.title}, ${item.style}`}
                      draggable={false}
                      style={{
                        visibility: hidden ? 'hidden' : undefined,
                        viewTransitionName: item.isNew && shared && !arrived ? HUNG_NAME : undefined,
                      }}
                      onLoad={(ev) => {
                        const img = ev.currentTarget;
                        const done = () => {
                          if (img.naturalWidth && img.naturalHeight) setAspects((a) => ({ ...a, [item.key]: img.naturalWidth / img.naturalHeight }));
                          if (item.isNew) setFrontLoaded(true);
                        };
                        img.decode().then(done, done);
                      }}
                      onError={() => item.isNew && setFrontLoaded(true)}
                    />
                    {item.isNew && (
                      <span className="gal-sparkles" aria-hidden="true">
                        {sparkles.map((s, k) => (
                          <svg
                            key={k}
                            className={`gal-sparkle ${s.gold ? 'gold' : 'rose'}`}
                            viewBox="-1 -1 2 2"
                            style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s * 2, height: s.s * 2, ['--dx' as string]: `${s.dx}px`, ['--dy' as string]: `${s.dy}px`, animationDelay: `${s.delay}ms` }}
                          >
                            <path d={STAR} />
                          </svg>
                        ))}
                      </span>
                    )}
                  </div>
                  <figcaption className="gal-plaque">
                    <span className="gal-plaque-title">{item.title}</span>
                    <span className="gal-plaque-meta">{item.style}</span>
                    {item.isNew && byline && <span className="gal-plaque-by">{byline}</span>}
                  </figcaption>
                  <img className="gal-reflection" src={item.imageUrl} alt="" aria-hidden="true" draggable={false} />
                </figure>
              );
            })}
        </div>
      </div>

      <header className="gal-head">
        <div className="gal-title">
          <p className="eyebrow">Atlas</p>
          <h1>Our gallery</h1>
          <p className="lede">Drag to look around. Tap a painting to see it up close.</p>
        </div>
        <div className="gal-actions">
          <button type="button" className="btn secondary" disabled={!items[0]?.isNew} onClick={() => items[0] && void savePainting(items[0], byline)}>
            Save
          </button>
          <button type="button" className="btn secondary" onClick={onPlayAgain}>
            Play again
          </button>
        </div>
      </header>

      <p className="gal-sr" aria-live="polite">
        {phase === 'settled' && current ? `${current.title}, ${current.style}. Painting ${front + 1} of ${items.length}.` : ''}
      </p>

      {/* The two painters: user 1's from the left, user 2's from the right. */}
      {duo && (
        <div className="gal-duo" aria-hidden="true">
          <div className="gal-char one">
            <div className="gal-hop">
              <PainterSprite character={duo[0]} />
            </div>
          </div>
          <div className="gal-char two">
            <div className="gal-hop">
              <PainterSprite character={duo[1]} />
            </div>
          </div>
          <div className="gal-clap">
            <span className="gal-flash" />
            {Array.from({ length: 8 }, (_, k) => (
              <svg key={k} className="gal-clap-star" viewBox="-1 -1 2 2" style={{ ['--a' as string]: `${k * 45}deg` }}>
                <path d={STAR} />
              </svg>
            ))}
            {confetti.map((c, k) => (
              <span
                key={k}
                className={`gal-confetti${c.wide ? ' wide' : ''}`}
                style={{ background: c.color, ['--dx' as string]: `${c.dx}px`, ['--dy' as string]: `${c.dy}px`, ['--spin' as string]: `${c.spin}deg`, animationDelay: `${c.delay}ms` }}
              />
            ))}
          </div>
        </div>
      )}
      {duo && cloud && (
        <div className="gal-say">
          <SpeechCloud name={`${duo[0].name} & ${duo[1].name}`} line={line} roomFor={line} />
        </div>
      )}

      {/* The painting on its way to the frame (no view transition: FLIP, or from the distance). */}
      {items[0]?.isNew && (phase === 'loading' || phase === 'fly') && !shared && !calm && (
        <img ref={flyerRef} className={`gal-flyer${phase === 'loading' ? ' waiting' : ''}`} src={items[0].imageUrl} alt="" aria-hidden="true" />
      )}

      {shown && (
        <div className="gal-focus" role="dialog" aria-modal="true" aria-label={shown.title} onClick={() => setFocus(null)}>
          <figure className="gal-focus-card" style={{ ['--ar' as string]: aspects[shown.key] ?? 0.8 }} onClick={(ev) => ev.stopPropagation()}>
            <div className="gal-frame">
              <img className="gal-art" src={shown.imageUrl} alt={shown.title} draggable={false} />
            </div>
            <figcaption className="gal-plaque">
              <span className="gal-plaque-title">{shown.title}</span>
              <span className="gal-plaque-meta">
                {shown.style}
                {shown.createdAt ? ` · ${new Date(shown.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}` : ''}
              </span>
              {shown.isNew ? byline && <span className="gal-plaque-by">{byline}</span> : shown.credit && <span className="gal-plaque-credit">{shown.credit}</span>}
            </figcaption>
            <div className="gal-focus-actions">
              {shown.isNew && (
                <button type="button" className="btn secondary" onClick={() => void savePainting(shown, byline)}>
                  Save
                </button>
              )}
              <button type="button" className="btn secondary" autoFocus onClick={() => setFocus(null)}>
                Back to the room
              </button>
            </div>
          </figure>
        </div>
      )}
    </main>
  );
}
