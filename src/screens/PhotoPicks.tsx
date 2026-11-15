import { useEffect, useMemo, useRef, useState } from 'react';
import './PhotoPicks.css';
import { studioCast, type Character } from '../characters';
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
 * Screen 2: the chosen painter asks for the 5 pictures that speak to you, out of 25. Which 25 comes
 * from the session id (src/picks/pool.ts), so the other user's device shows a different 25.
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

  const order = useMemo(() => new Map(picks.map((id, i) => [id, i + 1])), [picks]);
  const full = picks.length === PICKS;
  const saved = phase === 'saved';

  return (
    <main className={`picks${saved ? ' is-saved' : ''}`}>
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
        <ul className="picks-grid" aria-label={`Pictures to choose from. Pick ${PICKS}.`} aria-busy={!photos}>
          {(photos ?? PLACEHOLDERS).map((photo, i) => {
            if (!photo) return <li key={i} className="pick-tile placeholder" aria-hidden="true" />;
            const n = order.get(photo.id);
            return (
              <li key={photo.id}>
                <button
                  type="button"
                  className={`pick-tile${n ? ' selected' : ''}${shaking === photo.id ? ' shake' : ''}`}
                  aria-pressed={!!n}
                  disabled={phase !== 'picking'}
                  onClick={() => toggle(photo.id)}
                >
                  <img src={photoUrl(photo.thumb)} alt={`Photo ${photo.id}`} loading="lazy" decoding="async" width={300} height={300} draggable={false} />
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
      </footer>
    </main>
  );
}

const PLACEHOLDERS: null[] = Array.from({ length: 25 }, () => null);

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
