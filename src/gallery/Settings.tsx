import { useEffect, useRef, useState } from 'react';
import type { ChosenPainter, Profile } from '../rec/api';
import { api, ApiFailure } from './api';
import { PainterSprite } from './PainterSprite';
import { MAX_PAINTER_NAME_LENGTH, PAINTERS, painterImage, painterOf } from './painter';

interface Props {
  profile: Profile;
  /** Shows a new choice everywhere at once; this page saves it. */
  onPainter: (painter: ChosenPainter) => void;
}

/** A name is saved once the typing stops for this long. */
const NAME_SAVE_DELAY_MS = 500;

type SaveState = { state: 'idle' } | { state: 'saving' } | { state: 'saved' } | { state: 'failed'; message: string };

/**
 * Saves the person's painter to their profile. Only the latest choice is sent,
 * one request at a time, so an older one can never land on top of a newer one.
 */
function usePainterSaving(userId: string) {
  const [status, setStatus] = useState<SaveState>({ state: 'idle' });
  const unsent = useRef<ChosenPainter | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const sending = useRef<Promise<void>>(Promise.resolve());

  const send = () => {
    window.clearTimeout(timer.current);
    sending.current = sending.current.then(async () => {
      const painter = unsent.current;
      if (!painter) return;
      unsent.current = null;
      try {
        await api.savePainter(userId, painter);
        // Something newer may be waiting its turn: it is not saved yet.
        setStatus(unsent.current ? { state: 'saving' } : { state: 'saved' });
      } catch (failure) {
        setStatus({ state: 'failed', message: failure instanceof ApiFailure ? failure.message : 'Something went wrong.' });
      }
    });
  };

  // Leaving the page sends whatever is still waiting.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => () => sendRef.current(), []);

  const save = (painter: ChosenPainter, delayMs: number) => {
    unsent.current = painter;
    setStatus({ state: 'saving' });
    window.clearTimeout(timer.current);
    if (delayMs === 0) send();
    else timer.current = window.setTimeout(send, delayMs);
  };

  return { status, save };
}

/** Things a person sets once: for now, which painter is theirs and what it is called. */
export function Settings({ profile, onPainter }: Props) {
  const { painter } = painterOf(profile);
  const name = profile.painter?.name ?? '';
  const { status, save } = usePainterSaving(profile.id);

  const choose = (next: ChosenPainter, delayMs: number) => {
    onPainter(next);
    save(next, delayMs);
  };

  return (
    <main className="page">
      <header className="page-head">
        <h1>Settings</h1>
        <p>Your painter stands in the room whenever you blend with a friend.</p>
      </header>

      <section className="settings-painter">
        <div className="settings-preview" aria-hidden="true">
          <PainterSprite painter={painter} />
        </div>
        <div className="settings-fields">
          <h2 className="eyebrow">Your painter</h2>
          <div className="settings-options" role="radiogroup" aria-label="Your painter">
            {PAINTERS.map(option => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={option.id === painter.id}
                aria-label={option.name}
                className="settings-option"
                onClick={() => choose({ id: option.id, name }, 0)}
              >
                <img src={painterImage(option)} alt="" draggable={false} />
              </button>
            ))}
          </div>
          <label className="settings-name">
            <span className="eyebrow">Its name</span>
            <input
              type="text"
              value={name}
              maxLength={MAX_PAINTER_NAME_LENGTH}
              placeholder={painter.name}
              onChange={event => choose({ id: painter.id, name: event.target.value }, NAME_SAVE_DELAY_MS)}
            />
          </label>
          <p className="quiet" role="status">
            {status.state === 'idle' && 'Kept on your profile, so your friends see it too.'}
            {status.state === 'saving' && 'Saving…'}
            {status.state === 'saved' && 'Saved to your profile.'}
            {status.state === 'failed' && 'Not saved: ' + status.message}
          </p>
        </div>
      </section>
    </main>
  );
}
