import { useEffect, useState } from 'react';
import type { Artwork, Profile, ProfileResponse } from '../rec/api';
import { api, ApiFailure } from './api';
import { Hung } from './Hung';
import { defaultPainter, type Painter } from './painter';
import { PainterPicker } from './PainterPicker';
import { Salon } from './Salon';
import { newUserId } from './session';
import type { StudioChoice } from './StudioEntrance';

interface Props {
  /** Set when someone with a profile has no hearts left and is choosing again. */
  profile: Profile | null;
  /** Called with the profile and the hearts just saved for it. */
  onDone: (entered: ProfileResponse) => void;
  /** The painter and name chosen in the studio, when the visitor came through it. */
  chosen?: StudioChoice | null;
  /** Back to the studio, to choose another painter. */
  onBack?: () => void;
}

const MAX_NAME_LENGTH = 80;

/** The entrance: a spread of very different works. Choosing a few is the whole sign-up. */
export function Onboarding({ profile, onDone, chosen: fromStudio = null, onBack }: Props) {
  const [works, setWorks] = useState<Artwork[] | null>(null);
  /** Why the works could not be fetched; null while they are on their way and once they are here. */
  const [unreachable, setUnreachable] = useState<string | null>(null);
  /** How many times the works have been asked for again. */
  const [retries, setRetries] = useState(0);
  const [minPicks, setMinPicks] = useState(3);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [name, setName] = useState(fromStudio?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The ID this visit signs up with, kept across attempts so trying again never makes a second profile. */
  const [signUpId] = useState(newUserId);
  const [chosenPainter, setChosenPainter] = useState<Painter | null>(fromStudio?.painter ?? null);
  /** Until one is chosen, the painter this ID would be given anyway. Either way it is saved with the profile. */
  const painter = chosenPainter ?? defaultPainter(signUpId);

  useEffect(() => {
    let cancelled = false;
    api.onboarding().then(
      response => {
        if (cancelled) return;
        setWorks(response.works);
        setMinPicks(response.min_picks);
      },
      (failure: unknown) => !cancelled && setUnreachable(messageOf(failure)),
    );
    return () => {
      cancelled = true;
    };
  }, [retries]);

  const tryAgain = () => {
    setUnreachable(null);
    setRetries(count => count + 1);
  };

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
      const picks = [...chosen];
      if (profile) {
        onDone(await api.choosePicks(profile.id, picks));
      } else {
        onDone(await api.createProfile(signUpId, name.trim() || 'Guest', picks, painter.id));
      }
    } catch (failure) {
      setError(messageOf(failure));
      setBusy(false);
    }
  };

  return (
    <main className="page entrance">
      <header className="page-head">
        {onBack && (
          <button type="button" className="text-link entrance-back" onClick={onBack}>
            ← {painter.name}, back to the studio
          </button>
        )}
        <h1>Which of these would you stop for?</h1>
        <p>Choose {minPicks} or more. There are no right answers.</p>
      </header>

      {works === null && unreachable === null && <p className="quiet">Hanging the room…</p>}

      {works === null && unreachable !== null && (
        <div className="entrance-closed" role="alert">
          <p className="quiet">{unreachable}</p>
          <button type="button" className="button" onClick={tryAgain}>
            Try again
          </button>
        </div>
      )}

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

      {unreachable === null && (
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
            <PainterPicker painter={painter} onChoose={setChosenPainter} />
          )}
          {!profile && !fromStudio && (
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
      )}
    </main>
  );
}

function messageOf(failure: unknown): string {
  return failure instanceof ApiFailure ? failure.message : 'Something went wrong.';
}
