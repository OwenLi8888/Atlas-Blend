import './AtlasRoom.css';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Painter } from './painter';
import { PainterSprite } from './PainterSprite';

/**
 * The round gallery room of the painting flow (src/screens/Gallery.tsx and
 * Gallery.css on main), carried over as it is: the ring, the lamp, the floor
 * and its reflections, the spring and the slow turn when idle, the painters
 * hopping in for a high five. What differs here: the works come from a blend,
 * choosing a work hands it to the caller's own closer look, and there is no
 * Save, Play again or speech cloud.
 */

/** One canvas on the wall. */
export interface RoomItem {
  key: string;
  imageUrl: string;
  title: string;
  /** The small-capitals line on the plaque. */
  style: string;
  /** A quiet line under it, such as the artist. */
  credit?: string;
  /** The work this room was made for: it gets the spotlight, and the painters' names on its plaque. */
  isNew: boolean;
  /** Shown in the frame in place of the picture, such as a canvas being painted. */
  content?: ReactNode;
  /** Width over height, when it is known before the picture has loaded. */
  aspect?: number;
}

export interface RoomPainter {
  painter: Painter;
  /** What its person calls it. */
  name: string;
}

interface Props {
  items: readonly RoomItem[];
  /** The visitor's painter comes in from the left, the friend's from the right. */
  painters: readonly [RoomPainter, RoomPainter];
  eyebrow: string;
  lede: string;
  /** A canvas was tapped: the room turns to it and the caller shows it up close. */
  onOpen: (item: RoomItem) => void;
  /** True while something is open over the room: it stops turning and ignores the keys. */
  paused: boolean;
  /** True while the work in front is still being painted: the room does not turn away by itself. */
  still: boolean;
}

/**
 * The arrival, in order. `land`: the spotlight warms up. `enter`: the painters pop up in the
 * corners. `meet`: they hop together. `clap`: the high five. `settled`: the room is the visitor's.
 */
type Phase = 'loading' | 'land' | 'enter' | 'meet' | 'clap' | 'settled';
const STEPS: [Phase, number][] = [
  ['land', 0],
  ['enter', 600],
  ['meet', 1250],
  ['clap', 1950],
  ['settled', 3300],
];

const SLOTS = 12;
const STEP_DEG = 360 / SLOTS;
/** Idle time before the room starts to turn by itself, and how fast it turns. */
const IDLE_MS = 8000;
const AUTO_DEG_PER_S = 3.2;
/** Canvases further round than this are behind the visitor and not drawn. */
const HIDE_DEG = 72;

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
  /** Where the canvases start, from the top of the room. */
  top: number;
}

function measure(el: HTMLElement): Dims {
  const vw = el.clientWidth, vh = el.clientHeight;
  // Narrow screens stand closer to the wall, so the edges of the neighbouring canvases stay in view.
  const r = Math.min(900, Math.max(520, vw * 1.45));
  const p = r * 1.5;
  // 12 canvases share the circle: each gets 30 degrees of wall, and 84% of that is canvas.
  const slotW = Math.floor(2 * r * Math.tan(Math.PI / SLOTS) * 0.84);
  // A little smaller than in the painting flow, where the painters are the hosts.
  const char = Math.round(Math.min(104, Math.max(68, vw * 0.17)));
  const head = vw < 600 ? 104 : 96, plaque = 92, below = char + 30;
  const room = vh - head - plaque - below;
  const slotH = Math.floor(Math.max(160, Math.min(slotW * 1.2, room)));
  return { r, p, slotW, slotH, char, top: Math.round(head + Math.max(0, room - slotH) / 2) };
}

export function AtlasRoom({ items, painters, eyebrow, lede, onOpen, paused, still }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const [dims, setDims] = useState<Dims | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [skipped, setSkipped] = useState(false);
  const [front, setFront] = useState(0);
  const [calm] = useState(reducedMotion);

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
  canAuto.current = phase === 'settled' && !paused && !still && !calm;

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
  // The 8 s idle clock starts when the room becomes the visitor's, and again when a closer look is closed.
  useEffect(() => {
    if (phase === 'settled') touch();
  }, [phase, paused, still, touch]);

  // A new work hung in front (the piece arriving) turns the room back to face it.
  const firstKey = items[0]?.key;
  const facedKey = useRef(firstKey);
  useEffect(() => {
    if (facedKey.current === firstKey) return;
    facedKey.current = firstKey;
    touch();
    face(0);
  }, [firstKey, face, touch]);

  // ---- The arrival moment ----
  const timers = useRef<number[]>([]);
  const started = useRef(false);
  const ready = !!dims && items.length > 0;

  const play = useCallback(() => {
    for (const [p, at] of STEPS) timers.current.push(window.setTimeout(() => setPhase(p), at));
  }, []);

  const settle = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    setSkipped(true);
    setPhase('settled');
  }, []);

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    if (calm) {
      // No hops and no confetti: the painters are simply there.
      setPhase('settled');
      return;
    }
    play();
  }, [ready, calm, play]);

  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );

  const arriving = phase !== 'settled' && phase !== 'loading';
  const arrived = phase !== 'loading';
  const clapped = phase === 'clap' || phase === 'settled';

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
      const tapped = d.panel !== null ? items[d.panel] : undefined;
      if (ev.type === 'pointerup' && d.panel !== null && tapped) {
        face(d.panel);
        onOpen(tapped);
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
    if (phase !== 'settled' || paused) return;
    const delta = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    const now = performance.now();
    // One canvas per notch: a trackpad sends a stream of small events for one gesture.
    if (Math.abs(delta) < 4 || now - wheelAt.current < 320) return;
    wheelAt.current = now;
    step(delta > 0 ? 1 : -1);
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (paused) return;
      if (phase !== 'settled') {
        if (arriving && (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Escape')) settle();
        return;
      }
      if (ev.key === 'ArrowRight') step(1);
      else if (ev.key === 'ArrowLeft') step(-1);
      else return;
      ev.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, paused, arriving, settle, step]);

  // ---- Drawing ----
  const byline = `by ${painters[0].name} & ${painters[1].name}`;
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
    const colors = ['var(--rose)', 'var(--teal)', 'var(--navy)', 'var(--olive)', painters[0].painter.color, painters[1].painter.color];
    return Array.from({ length: 18 }, (_, i) => {
      const a = -Math.PI / 2 + ((i / 17) * 2 - 1) * 1.25;
      const reach = 70 + ((i * 37) % 60);
      return { dx: Math.cos(a) * reach, dy: Math.sin(a) * reach, spin: ((i * 73) % 360) - 180, color: colors[i % colors.length], delay: (i % 4) * 25, wide: i % 3 === 0 };
    });
  }, [painters]);
  const current = items[front];

  return (
    <div
      ref={rootRef}
      className={`gallery${arrived ? ' arrived' : ''}${clapped ? ' clapped' : ''}${skipped ? ' skipped' : ''}${paused ? ' focused' : ''}`}
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
            items.slice(0, SLOTS).map((item, i) => {
              const ar = item.aspect ?? aspects[item.key] ?? 0.8;
              const known = item.aspect !== undefined || aspects[item.key] !== undefined;
              return (
                <figure
                  key={item.key}
                  className={`gal-panel${item.isNew ? ' is-new' : ''}${known ? ' loaded' : ''}${i === front ? ' front' : ''}`}
                  data-index={i}
                  style={{ transform: `rotateY(${-i * STEP_DEG}deg) translateZ(${-dims.r}px)`, ['--ar' as string]: ar }}
                >
                  {item.isNew && <span className="gal-spot" aria-hidden="true" />}
                  <div className="gal-frame">
                    {item.content ?? (
                      <img
                        className="gal-art"
                        src={item.imageUrl}
                        alt={item.isNew ? `${item.title}, the piece made for the two of you` : `${item.title}, ${item.style}`}
                        draggable={false}
                        onLoad={(ev) => {
                          const img = ev.currentTarget;
                          const done = () => {
                            if (img.naturalWidth && img.naturalHeight) setAspects((a) => ({ ...a, [item.key]: img.naturalWidth / img.naturalHeight }));
                          };
                          img.decode().then(done, done);
                        }}
                      />
                    )}
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
                    {item.isNew ? <span className="gal-plaque-by">{byline}</span> : item.credit && <span className="gal-plaque-credit">{item.credit}</span>}
                    <span className="gal-plaque-meta">{item.style}</span>
                  </figcaption>
                  <img className="gal-reflection" src={item.imageUrl} alt="" aria-hidden="true" draggable={false} />
                </figure>
              );
            })}
        </div>
      </div>

      <header className="gal-head">
        <div className="gal-title">
          <p className="eyebrow">{eyebrow}</p>
          <h1>Our gallery</h1>
          <p className="lede">{lede}</p>
        </div>
      </header>

      <p className="gal-sr" aria-live="polite">
        {phase === 'settled' && current ? `${current.title}, ${current.style}. Painting ${front + 1} of ${Math.min(items.length, SLOTS)}.` : ''}
      </p>

      {/* The two painters: the visitor's from the left, the friend's from the right. */}
      <div className="gal-duo" aria-hidden="true">
        <div className="gal-char one">
          <div className="gal-hop">
            <PainterSprite painter={painters[0].painter} />
          </div>
        </div>
        <div className="gal-char two">
          <div className="gal-hop">
            <PainterSprite painter={painters[1].painter} />
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
    </div>
  );
}
