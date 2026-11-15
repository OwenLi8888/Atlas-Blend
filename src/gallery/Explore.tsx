import { useCallback, useEffect, useRef, useState } from 'react';
import type { Artwork, HeartedWork, Profile } from '../rec/api';
import { api, ApiFailure } from './api';
import { HeartableDetail } from './Detail';
import { Hung } from './Hung';
import { useHearts } from './useHearts';

interface Props {
  profile: Profile;
  hearts: readonly HeartedWork[];
  onHearts: (hearts: HeartedWork[]) => void;
}

/** How close to the end of the page, in pixels, the next works start loading. */
const LOAD_AHEAD_PX = 1200;

/**
 * A stroll through the whole collection: an endless wall where neighbours
 * differ, so every scroll shows something unlike the last. Opening a work shows
 * others like it, which is how you wander off in one direction.
 */
export function Explore({ profile, hearts, onHearts }: Props) {
  const actions = useHearts(profile, hearts, onHearts);
  // A fresh order on every visit; the seed keeps paging consistent within it.
  const [seed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [works, setWorks] = useState<Artwork[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [open, setOpen] = useState<Artwork | null>(null);
  const loading = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loading.current || nextOffset === null) return;
    loading.current = true;
    try {
      const page = await api.discover(seed, nextOffset, profile.id);
      setWorks(current => [...current, ...page.works]);
      setNextOffset(page.next_offset);
      setFailure(null);
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error.message : 'Something went wrong.');
    } finally {
      loading.current = false;
    }
  }, [seed, nextOffset, profile.id]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target) return;
    const observer = new IntersectionObserver(entries => entries.some(entry => entry.isIntersecting) && void loadMore(), {
      rootMargin: LOAD_AHEAD_PX + 'px',
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore]);

  const closeDetail = useCallback(() => setOpen(null), []);
  const error = failure ?? actions.error;

  return (
    <main className="page">
      <header className="page-head">
        <h1>Explore</h1>
        <p>The whole collection, in no particular order, with a few we think you will love along the way. Open a work to see others like it.</p>
      </header>

      <div className="salon">
        {works.map(work => (
          <Hung
            key={work.id}
            work={work}
            kept={actions.of(work) !== undefined}
            onToggleKeep={() => void actions.toggle(work)}
            onOpen={() => setOpen(work)}
          />
        ))}
      </div>

      {error && (
        <p className="quiet" role="alert">
          {error}{' '}
          <button type="button" className="text-link" onClick={() => void loadMore()}>
            Try again
          </button>
        </p>
      )}
      {nextOffset !== null ? <div ref={sentinel} className="more" aria-hidden="true" /> : <p className="quiet">That is the whole collection.</p>}

      {open && <HeartableDetail work={open} hearts={actions} onClose={closeDetail} onNavigate={setOpen} />}
    </main>
  );
}
