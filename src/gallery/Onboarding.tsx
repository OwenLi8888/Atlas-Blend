import { useEffect, useState } from 'react';
import type { Artwork, Profile } from '../rec/api';
import { api, ApiFailure } from './api';
import { Hung } from './Hung';
import { Salon } from './Salon';

interface Props {
  /** Set when someone with a profile has no hearts left and is choosing again. */
  profile: Profile | null;
  onDone: (profile: Profile) => void;
}

const MAX_NAME_LENGTH = 80;

/** The entrance: a spread of very different works. Choosing a few is the whole sign-up. */
export function Onboarding({ profile, onDone }: Props) {
  const [works, setWorks] = useState<Artwork[] | null>(null);
  const [minPicks, setMinPicks] = useState(3);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.onboarding().then(
      response => {
        if (cancelled) return;
        setWorks(response.works);
        setMinPicks(response.min_picks);
      },
      (failure: unknown) => !cancelled && setError(messageOf(failure)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: string) =>
    setChosen(current => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const missing = Math.max(0, minPicks - chosen.size);

  const enter = async () => {
    if (missing > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const owner = profile ?? (await api.createProfile(name.trim() || 'Guest'));
      await Promise.all([...chosen].map(id => api.heart(owner.id, id)));
      onDone(owner);
    } catch (failure) {
      setError(messageOf(failure));
      setBusy(false);
    }
  };

  return (
    <main className="page entrance">
      <header className="page-head">
        <h1>Which of these would you stop for?</h1>
        <p>Choose {minPicks} or more. There are no right answers.</p>
      </header>

      {works === null && !error && <p className="quiet">Hanging the room…</p>}

      {works && (
        <Salon className="salon-entrance" minColumnWidth={180} maxColumns={5}>
          {works.map(work => (
            <div
              key={work.id}
              className={'choice' + (chosen.has(work.id) ? ' chosen' : '')}
              role="checkbox"
              aria-checked={chosen.has(work.id)}
              aria-label={work.title}
              tabIndex={0}
              onClick={() => toggle(work.id)}
              onKeyDown={event => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  toggle(work.id);
                }
              }}
            >
              <Hung work={work} kept={chosen.has(work.id)} />
            </div>
          ))}
        </Salon>
      )}

      <form
        className="entry-bar"
        onSubmit={event => {
          event.preventDefault();
          void enter();
        }}
      >
        <p className="entry-count" role="status">
          {error ?? (missing > 0 ? (chosen.size === 0 ? 'Nothing chosen yet' : 'Choose ' + missing + ' more') : chosen.size + ' chosen')}
        </p>
        {!profile && (
          <label className="entry-name">
            <span className="visually-hidden">Your name</span>
            <input
              type="text"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Your name"
              autoComplete="given-name"
              onChange={event => setName(event.target.value)}
            />
          </label>
        )}
        <button type="submit" className="button" disabled={missing > 0 || busy}>
          {busy ? 'Opening…' : 'Open my gallery'}
        </button>
      </form>
    </main>
  );
}

function messageOf(failure: unknown): string {
  return failure instanceof ApiFailure ? failure.message : 'Something went wrong.';
}
