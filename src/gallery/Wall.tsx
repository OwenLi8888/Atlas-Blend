import { useCallback, useEffect, useState } from 'react';
import type { Artwork, HeartedWork, Profile, Recommendation } from '../rec/api';
import { api, ApiFailure } from './api';
import { Detail } from './Detail';
import { possessive } from './format';
import { HeartButton, Hung } from './Hung';
import { WhyField } from './WhyField';

interface Props {
  profile: Profile;
  hearts: readonly HeartedWork[];
  onHearts: (hearts: HeartedWork[]) => void;
  /** Called when the server no longer knows this profile, so the visitor can start again. */
  onSessionLost: () => void;
}

/**
 * Your gallery: one wall of works hung from what you have hearted. Hearting a
 * work does not reshuffle anything; the wall only changes when you ask it to.
 */
export function Wall({ profile, hearts, onHearts, onSessionLost }: Props) {
  const [wall, setWall] = useState<Recommendation[] | null>(null);
  const [changes, setChanges] = useState(0);
  const [hanging, setHanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Artwork | null>(null);

  const hang = useCallback(async () => {
    setHanging(true);
    setError(null);
    try {
      const response = await api.recs(profile.id);
      setWall(response.works);
      setChanges(0);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setHanging(false);
    }
  }, [profile.id]);

  useEffect(() => {
    void hang();
  }, [hang]);

  const heartOf = (work: Artwork) => hearts.find(heart => heart.work.id === work.id);

  const toggle = async (work: Artwork) => {
    setError(null);
    try {
      if (heartOf(work)) {
        await api.unheart(profile.id, work.id);
        onHearts(hearts.filter(heart => heart.work.id !== work.id));
      } else {
        const { heart } = await api.heart(profile.id, work.id);
        onHearts([{ work, why: heart.why, hearted_at: heart.created_at }, ...hearts]);
      }
      setChanges(count => count + 1);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 404 && failure.message === 'Profile not found') {
        onSessionLost();
        return;
      }
      setError(messageOf(failure));
    }
  };

  const saveWhy = async (work: Artwork, why: string) => {
    const { heart } = await api.heart(profile.id, work.id, why);
    onHearts(hearts.map(existing => (existing.work.id === work.id ? { ...existing, why: heart.why } : existing)));
  };

  const closeDetail = useCallback(() => setOpen(null), []);
  const openHeart = open ? heartOf(open) : undefined;

  return (
    <main className="page">
      <header className="page-head">
        <h1>{possessive(profile.name)} gallery</h1>
        <p>A wall hung from what you have hearted. Heart a work and the next hanging will lean toward it.</p>
      </header>

      {error && (
        <p className="quiet" role="alert">
          {error}
        </p>
      )}
      {wall === null && !error && <p className="quiet">Hanging your wall…</p>}

      {wall && (
        <div className="salon">
          {wall.map(({ work, because }) => {
            const heart = heartOf(work);
            return (
              <Hung
                key={work.id}
                work={work}
                note={'near ' + because.title}
                kept={heart !== undefined}
                onToggleKeep={() => void toggle(work)}
                onOpen={() => setOpen(work)}
              >
                {heart && <WhyField saved={heart.why} onSave={why => saveWhy(work, why)} />}
              </Hung>
            );
          })}
        </div>
      )}

      {hearts.length > 0 && (
        <section className="hearted" aria-label="Works you have hearted">
          <h2>Hearted</h2>
          <div className="hearted-row">
            {hearts.map(({ work }) => (
              <button key={work.id} type="button" className="hearted-work" onClick={() => setOpen(work)} aria-label={work.title}>
                <img src={work.image_url} alt="" loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
        </section>
      )}

      {changes > 0 && (
        <div className="rehang">
          <button type="button" className="button" disabled={hanging} onClick={() => void hang()}>
            {hanging ? 'Hanging…' : 'Rehang the wall'}
          </button>
        </div>
      )}

      {open && (
        <Detail work={open} onClose={closeDetail}>
          <div className="detail-actions">
            <HeartButton kept={openHeart !== undefined} title={open.title} onToggle={() => void toggle(open)} />
            <span>{openHeart ? 'Hearted' : 'Heart this work'}</span>
          </div>
          {openHeart && <WhyField key={open.id} saved={openHeart.why} onSave={why => saveWhy(open, why)} />}
          {error && (
            <p className="quiet" role="alert">
              {error}
            </p>
          )}
        </Detail>
      )}
    </main>
  );
}

function messageOf(failure: unknown): string {
  return failure instanceof ApiFailure ? failure.message : 'Something went wrong.';
}
