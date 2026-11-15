import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import './PhotoPicks.css';
import { studioCast, type Character } from '../characters';
import { columnsFor, layoutWall, type Box } from '../picks/masonry';
import { loadDraft, saveDraft, savePicks, type PicksRecord } from '../picks/picksStore';
import { loadPool, photoUrl, PICKS, shownIds, type PoolPhoto } from '../picks/pool';
import type { Session } from '../picks/session';

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

  const toggle = (id: string) => {
    if (phase !== 'picking') return;
    let next = picks;
    if (picks.includes(id)) {
      next = picks.filter((p) => p !== id);
      setHint('');
    } else if (picks.length >= PICKS) {
      setShaking(id);
      setHint(`That’s ${PICKS} already. Tap a pick to swap it.`);
      return;
    } else {
      next = [...picks, id];
      setHint('');
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
  const saved = phase === 'saved';

  return (
    <main className="picks">
      <header className="picks-head">
        <div className="picks-top">
          <button type="button" className="btn ghost back" onClick={onBack} disabled={phase !== 'picking'}>
            <span aria-hidden="true">←</span> Back
          </button>
          <p className="eyebrow">Player {session.user} of 2</p>
        </div>

        <div className="picks-guide">
          <Guide character={character} cheer={saved} />
          {/* key: the bubble pops in again when the line changes */}
          <div key={saved ? 'saved' : 'ask'} className="speech" role="status">
            <p className="eyebrow">{character.name}</p>
            <h1>{saved ? 'Nice picks!' : `Pick the ${PICKS} pictures that speak to you the most.`}</h1>
          </div>
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
                    className={`pick-tile${n ? ' selected' : ''}${shaking === photo.id ? ' shake' : ''}`}
                    aria-pressed={!!n}
                    disabled={phase !== 'picking'}
                    onClick={() => toggle(photo.id)}
                  >
                    <WallImage photo={photo} box={box} />
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
function Guide({ character, cheer }: { character: Character; cheer: boolean }) {
  const [blink, setBlink] = useState(false);
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
      <span className="picks-sprite">
        <character.Sprite />
        {blinkSrc && <img className="picks-blink" src={`./studio/${blinkSrc}`} alt="" draggable={false} style={{ opacity: blink ? 1 : 0 }} />}
      </span>
    </div>
  );
}
