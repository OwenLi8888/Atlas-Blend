import { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { characters } from './characters';
import { HANGING_CLASS, reducedMotion } from './gallery/flight';
import { rememberFinalPainting, setInGallery, wasInGallery, type FinalPainting } from './gallery/galleryData';
import { HangItUp } from './gallery/HangItUp';
import type { PicksRecord } from './picks/picksStore';
import { loadPool, photoUrl } from './picks/pool';
import { getSession, recallCharacter, rememberCharacter, setPicking, wasPicking } from './picks/session';
import { Gallery, type Arrival } from './screens/Gallery';
import { Home } from './screens/Home';
import { PaintRoom, type Picture } from './screens/PaintRoom';
import { PhotoPicks } from './screens/PhotoPicks';

/**
 * The flow: 1 choose a painter in the studio, 2 pick 5 of 25 pictures, 3 the painter paints three
 * of those picks in the studio, 4 the finished painting is hung in the gallery room. (The paintings screen and Museum setup are not in this flow; their
 * components are still in src/screens/.)
 */
type Screen = 'home' | 'picks' | 'studio' | 'gallery';
const ORDER: Screen[] = ['home', 'picks', 'studio', 'gallery'];

/** How many of the picks the painter paints: one per easel. */
const EASELS = 3;

/** Turns picked photo ids into pictures the studio can plan and paint, first pick first. */
async function picturesFor(record: PicksRecord): Promise<Picture[]> {
  const pool = await loadPool();
  const byId = new Map(pool.map((p) => [p.id, p]));
  return record.picks
    .map((id) => byId.get(id))
    .filter((p) => !!p)
    .slice(0, EASELS)
    .map((p) => ({
      aspect: p.width / p.height,
      painting: {
        id: `pick-${p.id}`,
        file: p.file,
        title: p.title || 'Untitled',
        artist: p.artist ?? '',
        year: p.year ?? '',
        credit: '',
        widthMm: 200,
        src: photoUrl(p.file),
        // planned in the browser: there is no precomputed plan beside a pool photo
        uploaded: true,
      },
    }));
}

export function App() {
  // The two-device session (?session=…&user=1|2). The character and the picks screen are remembered
  // per session, so a refresh on the picks screen comes back to it with the same painter.
  const [session] = useState(getSession);
  const [characterId, setCharacterId] = useState<string | null>(() => recallCharacter(session));
  const [screen, setScreen] = useState<Screen>(() =>
    // A refresh in the gallery, or a link to it (?view=gallery), opens the gallery.
    wasInGallery(session) ? 'gallery' : wasPicking(session) && recallCharacter(session) ? 'picks' : 'home',
  );
  /** How the gallery was reached: it plays the painting's arrival differently for each. */
  const [arrival, setArrival] = useState<Arrival>({ kind: 'direct' });
  /** Resolves the hand-off's view transition once the gallery has the painting in its frame. */
  const frontReady = useRef<(() => void) | null>(null);
  const onFrontReady = useCallback(() => frontReady.current?.(), []);
  /** What the painting page reported as finished (onPaintingComplete), until it is hung. */
  const [finished, setFinished] = useState<FinalPainting | null>(null);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [pictures, setPictures] = useState<Picture[]>([]);
  /** Bumped to remount the picks screen (its draft is kept) when the studio could not be set up. */
  const [picksRun, setPicksRun] = useState(0);

  const go = useCallback(
    (next: Screen) => {
      setDirection(ORDER.indexOf(next) >= ORDER.indexOf(screen) ? 'forward' : 'back');
      setScreen(next);
      setPicking(session, next === 'picks');
      setInGallery(session, next === 'gallery');
    },
    [screen, session],
  );

  const selectCharacter = useCallback(
    (id: string) => {
      setCharacterId(id);
      rememberCharacter(session, id);
    },
    [session],
  );

  const onPaintingComplete = useCallback(
    (painting: FinalPainting | null) => {
      setFinished(painting);
      if (painting) rememberFinalPainting(session.sessionId, painting);
    },
    [session],
  );

  /**
   * The painting goes to the gallery. With the View Transitions API the browser flies it from
   * where it lifted off (`from`) into the gallery's frame while the room fades in; without it the
   * gallery does the same flight itself (FLIP). Reduced motion: a plain crossfade.
   */
  const hang = (from: DOMRect | null) => {
    const calm = reducedMotion();
    const enter = (next: Arrival) => {
      setArrival(next);
      setFinished(null);
      go('gallery');
    };
    if (typeof document.startViewTransition !== 'function') return enter({ kind: 'handoff', from: calm ? null : from, shared: false });
    const root = document.documentElement;
    root.classList.add(HANGING_CLASS);
    const transition = document.startViewTransition(
      () =>
        new Promise<void>((resolve) => {
          // The new picture is taken once the gallery has the painting in its frame.
          frontReady.current = resolve;
          window.setTimeout(resolve, 1500);
          flushSync(() => enter({ kind: 'handoff', from: null, shared: !calm && !!from }));
        }),
    );
    const done = () => {
      frontReady.current = null;
      root.classList.remove(HANGING_CLASS);
    };
    transition.finished.then(done, done);
  };

  const character = characters.find((c) => c.id === characterId) ?? characters[0];

  return (
    <div key={screen} className={`screen screen-${screen} ${direction}`}>
      {screen === 'home' && (
        <Home characters={characters} selectedId={characterId} onSelect={selectCharacter} onContinue={() => go('picks')} />
      )}
      {screen === 'picks' && (
        <PhotoPicks
          key={picksRun}
          character={character}
          session={session}
          onBack={() => go('home')}
          onDone={(record) => {
            // ---- HANDOFF: the recommendation step can read both users' records here ----
            //   import { getSessionPicks } from './picks/picksStore';
            //   const records = await getSessionPicks(session.sessionId);
            // If the pictures cannot be fetched, the picks screen comes back with the same picks.
            picturesFor(record).then(
              (list) => {
                if (!list.length) return setPicksRun((n) => n + 1);
                setPictures(list);
                go('studio');
              },
              () => setPicksRun((n) => n + 1),
            );
          }}
        />
      )}
      {screen === 'studio' && pictures.length > 0 && (
        <PaintRoom pictures={pictures} character={character} onBack={() => go('picks')} onPaintingComplete={onPaintingComplete} />
      )}
      {screen === 'studio' && finished && <HangItUp character={character} painting={finished} onHang={hang} />}
      {screen === 'gallery' && (
        <Gallery
          session={session}
          characterId={characterId}
          arrival={arrival}
          onFrontReady={onFrontReady}
          // A new session: the address without ?session, which page 1 then fills in.
          onPlayAgain={() => {
            setInGallery(session, false);
            window.location.assign(window.location.pathname);
          }}
        />
      )}
    </div>
  );
}
