import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import './PhotoPicks.css';
import { studioCast, type Character } from '../characters';
import { columnsFor, layoutWall, type Box } from '../picks/masonry';
import { loadDraft, saveDraft, savePicks, type PicksRecord } from '../picks/picksStore';
import { loadPool, photoUrl, PICKS, shownIds, type PoolPhoto } from '../picks/pool';
import type { Session } from '../picks/session';
import { SpeechCloud } from './SpeechCloud';

interface Props {
  character: Character;
  session: Session;
  onBack: () => void;
  /** Called a moment after the picks are saved, once the character has said so. */
  onDone: (record: PicksRecord) => void;
}

type Phase = 'picking' | 'saving' | 'saved';

/** How long "Nice picks!" stays up before moving on. */
const CONFIRM_MS = 1600;

/**
 * What the painter says. *Stars* mark the phrase to highlight; {n} is the number to pick.
 * A painter's own opening line is `pickLine` in src/characters.tsx.
 */
const DEFAULT_LINE = 'Ooh, a quest! Pick the *{n} pictures* that make your heart go sparkle!';
const FULL_LINE = '*Perfect picks!* Ready to continue?';
const SAVED_LINE = '*Nice picks!*';

/**
 * Screen 2: the chosen painter asks for the 5 pictures that speak to you, out of 25 hung like a
 * gallery wall (src/picks/masonry.ts). Which 25 comes from the session id (src/picks/pool.ts), so
 * the other user's device shows a different 25.
 */
export function PhotoPicks({ character, session, onBack, onDone }: Props) {
  const [photos, setPhotos] = useState<PoolPhoto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('picking');
  const [hint, setHint] = useState('');
  const [shaking, setShaking] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    loadPool()
      .then((pool) => {
        if (cancelled) return;
        const byId = new Map(pool.map((p) => [p.id, p]));
        const shown = shownIds([...byId.keys()], session).map((id) => byId.get(id)!);
        setPhotos(shown);
        setPicks(loadDraft(session, shown.map((p) => p.id)).slice(0, PICKS));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session, attempt]);

  useEffect(() => {
    if (!shaking) return;
    const t = window.setTimeout(() => setShaking(null), 420);
    return () => window.clearTimeout(t);
  }, [shaking]);

  // ---- The painter's trips: on each pick it hops to the picture and paints a check on it ----
  const mainRef = useRef<HTMLElement>(null);
  const flyerRef = useRef<HTMLDivElement>(null);
  const tiles = useRef(new Map<string, HTMLButtonElement>());
  /** Pictures that already carry a painted check. */
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  /** The check being painted right now: it draws itself in step with the brush. */
  const [painting, setPainting] = useState<string | null>(null);
  const queue = useRef<string[]>([]);
  const busy = useRef(false);
  const alive = useRef(true);
  const picksRef = useRef(picks);
  picksRef.current = picks;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // A restored draft arrives already checked.
  useEffect(() => {
    setChecked((c) => (c.size || !picks.length ? c : new Set(picks)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);

  const tripTo = async (id: string) => {
    const flyer = flyerRef.current;
    const sprite = mainRef.current?.querySelector<HTMLElement>('.picks-sprite');
    const tile = tiles.current.get(id);
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!flyer || !sprite || !tile || calm) {
      setChecked((c) => new Set(c).add(id));
      return;
    }
    const home = sprite.getBoundingClientRect();
    const box = tile.getBoundingClientRect();
    const size = home.width;
    // Lands on the picture's lower right corner, brush reaching over to the check.
    const land = { x: box.right - size * 0.7, y: box.bottom - size * 0.95 };
    const arc = (from: { x: number; y: number }, to: { x: number; y: number }, lift: number) =>
      Array.from({ length: 9 }, (_, i) => {
        const k = i / 8;
        const x = from.x + (to.x - from.x) * k;
        const y = from.y + (to.y - from.y) * k - Math.sin(Math.PI * k) * lift;
        const squash = i === 0 || i === 8 ? 'scale(1.08, 0.9)' : 'scale(0.96, 1.05)';
        return { transform: `translate(${x}px, ${y}px) ${squash}` };
      });
    const start = { x: home.left, y: home.top };
    Object.assign(flyer.style, { width: `${size}px`, height: `${size}px`, opacity: '1' });
    sprite.style.visibility = 'hidden';
    const lift = Math.max(70, Math.abs(land.y - start.y) * 0.35);
    await flyer.animate(arc(start, land, lift), { duration: 560, easing: 'ease-in-out', fill: 'forwards' }).finished;
    if (!alive.current) return;
    if (picksRef.current.includes(id)) {
      setPainting(id);
      setChecked((c) => new Set(c).add(id));
      // brushing: a little sway while the check draws itself
      await flyer.animate(
        [0, -10, 6, -8, 4, 0].map((r) => ({ transform: `translate(${land.x}px, ${land.y}px) rotate(${r}deg)` })),
        { duration: 620, easing: 'ease-in-out', fill: 'forwards' },
      ).finished;
      if (!alive.current) return;
      setPainting(null);
    }
    const back = sprite.getBoundingClientRect();
    await flyer.animate(arc(land, { x: back.left, y: back.top }, lift * 0.8), { duration: 480, easing: 'ease-in-out', fill: 'forwards' }).finished;
    if (!alive.current) return;
    sprite.style.visibility = '';
    flyer.style.opacity = '0';
  };
  const runTrips = async () => {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length && alive.current) {
      const id = queue.current.shift()!;
      if (picksRef.current.includes(id)) await tripTo(id);
    }
    busy.current = false;
  };

  const toggle = (id: string) => {
    if (phase !== 'picking') return;
    let next = picks;
    if (picks.includes(id)) {
      next = picks.filter((p) => p !== id);
      queue.current = queue.current.filter((q) => q !== id);
      setChecked((c) => {
        const n = new Set(c);
        n.delete(id);
        return n;
      });
      setHint('');
    } else if (picks.length >= PICKS) {
      setShaking(id);
      setHint(`That’s ${PICKS} already. Tap a pick to swap it.`);
      return;
    } else {
      next = [...picks, id];
      setHint('');
      queue.current.push(id);
      picksRef.current = next;
      void runTrips();
    }
    setPicks(next);
    saveDraft(session, next);
  };

  const submit = async () => {
    if (!photos || picks.length !== PICKS || phase !== 'picking') return;
    setPhase('saving');
    const record: PicksRecord = {
      sessionId: session.sessionId,
      user: session.user,
      characterId: character.id,
      shown: photos.map((p) => p.id),
      picks,
      pickedAt: new Date().toISOString(),
    };
    const where = await savePicks(record);
    setHint(where === 'device' ? 'Saved on this device only: the picks server did not answer.' : '');
    setPhase('saved');
    window.setTimeout(() => doneRef.current(record), CONFIRM_MS);
  };

  // The wall's width, column count and gap. Measured before the first paint, then again whenever
  // the wall is resized: at once for the first change (a scrollbar appearing must not show as a
  // jump), then debounced while a resize keeps going.
  const wallRef = useRef<HTMLUListElement>(null);
  const [frame, setFrame] = useState<{ width: number; columns: number; gap: number } | null>(null);
  useLayoutEffect(() => {
    const el = wallRef.current;
    if (!el) return;
    const measure = () => {
      const next = {
        width: el.clientWidth,
        columns: columnsFor(window.innerWidth),
        gap: Math.round(parseFloat(getComputedStyle(el).columnGap) || 16),
      };
      setFrame((f) => (f && f.width === next.width && f.columns === next.columns && f.gap === next.gap ? f : next));
    };
    measure();
    let timer = 0;
    let quietSince = 0;
    const ro = new ResizeObserver(() => {
      const now = performance.now();
      window.clearTimeout(timer);
      if (now - quietSince > 300) queueMicrotask(() => flushSync(measure));
      else timer = window.setTimeout(measure, 120);
      quietSince = now;
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.clearTimeout(timer);
    };
  }, [failed]);

  const wall = useMemo(
    () => (photos && frame ? layoutWall(photos.map((p) => p.height / p.width), frame.width, frame.columns, frame.gap) : null),
    [photos, frame],
  );

  const order = useMemo(() => new Map(picks.map((id, i) => [id, i + 1])), [picks]);
  const full = picks.length === PICKS;
  const askLine = (character.pickLine ?? DEFAULT_LINE).replace('{n}', String(PICKS));
  const saved = phase === 'saved';

  return (
    <main className="picks" ref={mainRef}>
      <header className="picks-head">
        <div className="picks-top">
          <button type="button" className="btn ghost back" onClick={onBack} disabled={phase !== 'picking'}>
            <span aria-hidden="true">←</span> Back
          </button>
          <p className="eyebrow">Player {session.user} of 2</p>
        </div>

        <div className="picks-guide">
          <Guide character={character} cheer={saved} bounce={picks.length} />
          <SpeechCloud name={character.name} line={saved ? SAVED_LINE : full ? FULL_LINE : askLine} roomFor={askLine} />
        </div>
      </header>

      {failed ? (
        <div className="picks-empty">
          <p className="lede">The pictures did not load.</p>
          <button type="button" className="btn secondary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <ul ref={wallRef} className="picks-wall" style={{ height: wall?.height }} aria-label={`Pictures to choose from. Pick ${PICKS}.`} aria-busy={!photos}>
          {photos &&
            wall &&
            photos.map((photo, i) => {
              const n = order.get(photo.id);
              const box = wall.boxes[i];
              return (
                <li key={photo.id} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) tiles.current.set(photo.id, el);
                      else tiles.current.delete(photo.id);
                    }}
                    className={`pick-tile${n ? ' selected' : ''}${shaking === photo.id ? ' shake' : ''}`}
                    aria-pressed={!!n}
                    disabled={phase !== 'picking'}
                    onClick={() => toggle(photo.id)}
                  >
                    <WallImage photo={photo} box={box} />
                    {n && checked.has(photo.id) && <PaintedCheck color={character.color} drawing={painting === photo.id} />}
                    {n && (
                      <span className="pick-badge">
                        <span className="sr-only">Pick </span>
                        {n}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
        </ul>
      )}

      {/* The painter on its trips to the wall, with a brush in its colour. In <body> for the same
          reason as the bar below. */}
      {createPortal(
        <div ref={flyerRef} className="picks-flyer" style={{ ['--tint' as string]: character.color }} aria-hidden="true">
          <img className="picks-flyer-brush" src="./studio/brush.webp" alt="" draggable={false} />
          <character.Sprite />
        </div>,
        document.body,
      )}

      {/* In <body>, not in the screen: the screen wrapper is animated with a transform, and a
          transformed ancestor would stop position: fixed from pinning the bar to the viewport. */}
      {createPortal(
        <footer className="picks-bar">
          <p className="picks-hint" role="status">
            {hint}
          </p>
          <p className="picks-count" aria-live="polite">
            <strong>{picks.length}</strong> of {PICKS}
            <span className="picks-pips" aria-hidden="true">
              {Array.from({ length: PICKS }, (_, i) => (
                <span key={i} className={i < picks.length ? 'on' : ''} />
              ))}
            </span>
          </p>
          <button type="button" className="btn primary" disabled={!full || phase !== 'picking'} onClick={submit}>
            {phase === 'picking' ? 'Continue' : phase === 'saving' ? 'Saving…' : 'Saved'}
          </button>
        </footer>,
        document.body,
      )}
    </main>
  );
}

/**
 * A check painted with a loaded brush in the painter's colour: a white underlay so it reads on any
 * picture, the colour stroke with a ragged paint edge, and a lighter ridge on top. `drawing` makes
 * it paint itself in.
 */
function PaintedCheck({ color, drawing }: { color: string; drawing: boolean }) {
  const d = 'M20 55 C 28 62, 34 70, 41 77 C 52 60, 66 42, 83 24';
  return (
    <span className={`pick-check${drawing ? ' drawing' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <defs>
          <filter id="paint-edge" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
            <feDisplacementMap in="SourceGraphic" scale="5" />
          </filter>
        </defs>
        <path className="under" d={d} pathLength={1} />
        <path className="paint" d={d} pathLength={1} style={{ stroke: color }} filter="url(#paint-edge)" />
        <path className="ridge" d={d} pathLength={1} />
      </svg>
    </span>
  );
}

/** Long side of the thumbnails written by scripts/build-pool.mjs. */
const THUMB_SIDE = 600;

/**
 * One picture on the wall. Its box is already sized from pool.json, so the image only has to fade
 * in. The thumbnail is used unless the column is wide enough (or the screen dense enough) to want
 * the full photo.
 */
function WallImage({ photo, box }: { photo: PoolPhoto; box: Box }) {
  const [loaded, setLoaded] = useState(false);
  const thumbWidth = Math.round(photo.width * Math.min(1, THUMB_SIDE / Math.max(photo.width, photo.height)));
  return (
    <img
      ref={(img) => {
        if (img?.complete && img.naturalWidth) setLoaded(true);
      }}
      className={loaded ? 'loaded' : ''}
      src={photoUrl(photo.thumb)}
      srcSet={`${photoUrl(photo.thumb)} ${thumbWidth}w, ${photoUrl(photo.file)} ${photo.width}w`}
      sizes={`${box.w}px`}
      width={box.w}
      height={box.h}
      alt={`Photo ${photo.id}`}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(true)}
    />
  );
}

/** The painter beside the bubble: the page 1 sprite on its paint puddle, blinking as it does in the studio. */
function Guide({ character, cheer, bounce }: { character: Character; cheer: boolean; bounce: number }) {
  const [blink, setBlink] = useState(false);
  const spriteRef = useRef<HTMLSpanElement>(null);
  const lastBounce = useRef(bounce);

  // A quick happy bounce each time a picture is picked (not when one is put back).
  useEffect(() => {
    const picked = bounce > lastBounce.current;
    lastBounce.current = bounce;
    if (!picked || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    spriteRef.current?.animate(
      [
        { transform: 'translateY(0) scale(1)' },
        { transform: 'translateY(2px) scale(1.06, 0.92)', offset: 0.18 },
        { transform: 'translateY(-14px) scale(0.96, 1.06)', offset: 0.5 },
        { transform: 'translateY(0) scale(1.04, 0.96)', offset: 0.82 },
        { transform: 'translateY(0) scale(1)' },
      ],
      { duration: 440, easing: 'ease-out' },
    );
  }, [bounce]);
  const blinkSrc = studioCast.find((c) => c.id === character.id)?.blink;

  useEffect(() => {
    if (!blinkSrc || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let open = 0;
    let close = 0;
    const schedule = () => {
      open = window.setTimeout(() => {
        setBlink(true);
        close = window.setTimeout(() => {
          setBlink(false);
          schedule();
        }, 130);
      }, 2200 + Math.random() * 3200);
    };
    schedule();
    return () => {
      window.clearTimeout(open);
      window.clearTimeout(close);
    };
  }, [blinkSrc]);

  return (
    <div className={`picks-painter${cheer ? ' cheer' : ''}`} style={{ ['--tint' as string]: character.color }} aria-hidden="true">
      <span className="picks-puddle" />
      <span ref={spriteRef} className="picks-sprite">
        <character.Sprite />
        {blinkSrc && <img className="picks-blink" src={`./studio/${blinkSrc}`} alt="" draggable={false} style={{ opacity: blink ? 1 : 0 }} />}
      </span>
    </div>
  );
}
