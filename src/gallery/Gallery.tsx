import { useCallback, useEffect, useState } from 'react';
import type { Artwork, CuratorResponse, HeartedWork, Profile, Recommendation } from '../rec/api';
import { api, ApiFailure } from './api';
import { CuratorNote } from './CuratorNote';
import { HeartableDetail } from './Detail';
import { possessive } from './format';
import { Hung } from './Hung';
import { useCurator } from './useCurator';
import { useHearts } from './useHearts';
import { WhyField } from './WhyField';

export type GalleryTab = 'for-you' | 'saved' | 'rooms';

interface Props {
  profile: Profile;
  hearts: readonly HeartedWork[];
  onHearts: (hearts: HeartedWork[]) => void;
  tab: GalleryTab;
}

/**
 * Your gallery, in three walls. "For you" is hung from what you have hearted
 * and only changes when you ask it to; "Saved" is everything you have hearted;
 * "Rooms" is the small show the curator hangs from what you saved and told it.
 */
export function Gallery({ profile, hearts, onHearts, tab }: Props) {
  const actions = useHearts(profile, hearts, onHearts);
  const { settle } = actions;
  const [wall, setWall] = useState<Recommendation[] | null>(null);
  const [hanging, setHanging] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [open, setOpen] = useState<Artwork | null>(null);
  const { curator, leaveNote } = useCurator(profile.id, hearts.map(heart => heart.work.id + (heart.why ?? '')).join('|'));
  const curatorIn = curator !== null && curator.status !== 'unavailable';

  const hang = useCallback(async () => {
    setHanging(true);
    setFailure(null);
    try {
      const response = await api.recs(profile.id);
      setWall(response.works);
      settle();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error.message : 'Something went wrong.');
    } finally {
      setHanging(false);
    }
  }, [profile.id, settle]);

  useEffect(() => {
    void hang();
  }, [hang]);

  const closeDetail = useCallback(() => setOpen(null), []);
  const error = failure ?? actions.error;

  return (
    <main className="page">
      <header className="page-head">
        <h1>{possessive(profile.name)} gallery</h1>
        {curator?.portrait && <p className="portrait">{curator.portrait}</p>}
        {curatorIn && <CuratorNote curator={curator} leaveNote={leaveNote} />}
        <nav className="tabs" aria-label="Walls">
          <a href="#/" aria-current={tab === 'for-you' ? 'page' : undefined}>
            For you
          </a>
          <a href="#/saved" aria-current={tab === 'saved' ? 'page' : undefined}>
            Saved <span className="tab-count">{hearts.length}</span>
          </a>
          {curatorIn && (
            <a href="#/rooms" aria-current={tab === 'rooms' ? 'page' : undefined}>
              Rooms {curator.rooms.length > 0 && <span className="tab-count">{curator.rooms.length}</span>}
            </a>
          )}
        </nav>
        <p>
          {tab === 'for-you' && 'Hung from what you have saved. Heart a work to keep it; the next hanging will lean toward it.'}
          {tab === 'saved' && 'Everything you have hearted, newest first.'}
          {tab === 'rooms' && roomsLine(curator)}
        </p>
      </header>

      {error && (
        <p className="quiet" role="alert">
          {error}
        </p>
      )}

      {tab === 'for-you' && wall === null && !error && <p className="quiet">Hanging your wall…</p>}
      {tab === 'for-you' && wall && (
        <div className="salon">
          {wall.map(({ work, because }) => {
            const heart = actions.of(work);
            return (
              <Hung
                key={work.id}
                work={work}
                note={'near ' + because.title}
                kept={heart !== undefined}
                onToggleKeep={() => void actions.toggle(work)}
                onOpen={() => setOpen(work)}
              >
                {heart && <WhyField saved={heart.why} onSave={why => actions.saveWhy(work, why)} />}
              </Hung>
            );
          })}
        </div>
      )}

      {tab === 'saved' && (
        <div className="salon">
          {hearts.map(({ work, why }) => (
            <Hung key={work.id} work={work} kept onToggleKeep={() => void actions.toggle(work)} onOpen={() => setOpen(work)}>
              <WhyField key={work.id} saved={why} onSave={reason => actions.saveWhy(work, reason)} />
            </Hung>
          ))}
        </div>
      )}

      {tab === 'rooms' &&
        curator?.rooms.map(room => (
          <section key={room.title} className="room">
            <header className="room-head">
              <h2>{room.title}</h2>
              <p>{room.text}</p>
            </header>
            <div className="salon">
              {room.works.map(work => (
                <Hung
                  key={work.id}
                  work={work}
                  kept={actions.of(work) !== undefined}
                  onToggleKeep={() => void actions.toggle(work)}
                  onOpen={() => setOpen(work)}
                />
              ))}
            </div>
          </section>
        ))}

      {tab === 'for-you' && actions.changes > 0 && (
        <div className="rehang">
          <button type="button" className="button" disabled={hanging} onClick={() => void hang()}>
            {hanging ? 'Hanging…' : 'Rehang the wall'}
          </button>
        </div>
      )}

      {open && <HeartableDetail work={open} hearts={actions} onClose={closeDetail} onNavigate={setOpen} />}
    </main>
  );
}

/** One line on where the rooms stand: how many more saves are needed, or that they are being hung. */
function roomsLine(curator: CuratorResponse | null): string {
  if (!curator || curator.status === 'unavailable') return 'The curator is away.';
  if (curator.saves_until_rooms > 0) {
    const more = curator.saves_until_rooms === 1 ? 'one more work' : curator.saves_until_rooms + ' more works';
    return 'Save ' + more + ' and the curator will hang your first rooms.';
  }
  if (curator.status === 'working') return curator.rooms.length > 0 ? 'The curator is rehanging your rooms…' : 'The curator is hanging your rooms…';
  return 'Hung by the curator from what you have saved and what you have said. Some of these you have not seen.';
}
