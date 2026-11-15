import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { joinGallery, type GalleryPlayer } from './blend/gallery';
import { characters } from './characters';
import { HANGING_CLASS, reducedMotion } from './gallery/flight';
import { rememberFinalPainting, setInGallery, wasInGallery, type FinalPainting } from './gallery/galleryData';
import { HangItUp } from './gallery/HangItUp';
import { savePicks, type PicksRecord } from './picks/picksStore';
import { deviceStore, getSession, joinRoom, newRoom, recallCharacter, rememberCharacter, setPicking, wasPicking } from './picks/session';
import { Gallery, type Arrival } from './screens/Gallery';
import { GalleryWall, type GalleryItem } from './screens/GalleryWall';
import { Home } from './screens/Home';
import { PaintRoom } from './screens/PaintRoom';
import { PhotoPicks } from './screens/PhotoPicks';

/**
 * The flow, for two players on two devices in one room (player 2 types player 1's room code):
 * 1 name yourself and choose a painter, 2 pick 5 of 25 pictures, 3 the painter paints a new work for
 * you, one for your friend and the piece between you both, 4 that piece is hung in the gallery room.
 * Apart from that room, the wall of everything this device has painted (GalleryWall) opens over
 * page 1 or page 3 and closes back to it.
 * (The paintings screen and Museum setup are not in this flow; their components are in src/screens/.)
 */
type Screen = 'home' | 'picks' | 'studio' | 'gallery';
const ORDER: Screen[] = ['home', 'picks', 'studio', 'gallery'];

export function App() {
  // The character, the name and the picks screen are remembered per session and user, so a refresh
  // on the picks screen comes back to it as the same player.
  const [session] = useState(getSession);
  const [characterId, setCharacterId] = useState<string | null>(() => recallCharacter(session));
  const [name, setName] = useState(() => deviceStore.get(session, 'name') ?? '');
  const [screen, setScreen] = useState<Screen>(() =>
    // A refresh in the gallery room, or a link to it (?view=gallery), opens the gallery room.
    wasInGallery(session) ? 'gallery' : wasPicking(session) && recallCharacter(session) ? 'picks' : 'home',
  );
  /** How the gallery room was reached: it plays the painting's arrival differently for each. */
  const [arrival, setArrival] = useState<Arrival>({ kind: 'direct' });
  /** Resolves the hand-off's view transition once the gallery room has the painting in its frame. */
  const frontReady = useRef<(() => void) | null>(null);
  const onFrontReady = useCallback(() => frontReady.current?.(), []);
  /** What the studio reported as finished (onPaintingComplete), until it is hung. */
  const [finished, setFinished] = useState<FinalPainting | null>(null);
  /** A finished canvas is being read about in the studio: the hand-off waits. */
  const [reading, setReading] = useState(false);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [record, setRecord] = useState<PicksRecord | null>(null);
  /** The gallery, while it is open: the canvases still being painted, to hang beside the saved ones. Null when closed. */
  const [wall, setWall] = useState<GalleryItem[] | null>(null);
  /** This player's profile in the Gallery API (server/); null while it is unknown or the API is not running. */
  const [player, setPlayer] = useState<GalleryPlayer | null>(null);

  const go = useCallback(
    (next: Screen) => {
      setDirection(ORDER.indexOf(next) >= ORDER.indexOf(screen) ? 'forward' : 'back');
      setScreen(next);
      setPicking(session, next === 'picks');
      setInGallery(session, next === 'gallery');
    },
    [screen, session],
  );

  const onPaintingComplete = useCallback(
    (painting: FinalPainting | null) => {
      setFinished(painting);
      if (!painting) return;
      // The gallery room keeps one copy per room, and every Play again is a new room: the copies
      // of earlier rooms go first, or a device that plays all day runs out of storage.
      try {
        const mine = `atlas:final:${session.sessionId}`;
        for (const key of Object.keys(window.localStorage)) {
          if (key.startsWith('atlas:final:') && key !== mine) window.localStorage.removeItem(key);
        }
      } catch {
        // Storage is blocked: there is nothing to clear.
      }
      rememberFinalPainting(session.sessionId, painting);
    },
    [session],
  );

  /**
   * The painting goes to the gallery room. With the View Transitions API the browser flies it from
   * where it lifted off (`from`) into the room's frame while the room fades in; without it the
   * room does the same flight itself (FLIP). Reduced motion: a plain crossfade.
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
          // The new picture is taken once the gallery room has the painting in its frame.
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

  const selectCharacter = useCallback(
    (id: string) => {
      setCharacterId(id);
      rememberCharacter(session, id);
    },
    [session],
  );

  const rename = useCallback(
    (value: string) => {
      setName(value);
      deviceStore.set(session, 'name', value.trim() || null);
    },
    [session],
  );

  // Once the player is past page 1, give them a Gallery API profile (if that server is running).
  // It usually arrives while they are still picking, and is saved with their picks.
  const named = name.trim();
  const past = screen !== 'home';
  useEffect(() => {
    if (!past || !named || player) return;
    let cancelled = false;
    joinGallery(named).then((p) => !cancelled && p && setPlayer(p));
    return () => {
      cancelled = true;
    };
  }, [past, named, player]);

  // The profile can arrive after the picks were saved (slow Wi-Fi). Then the saved record is topped
  // up with it, so the other device can still blend through the Gallery API.
  useEffect(() => {
    // (the record in state is left as it is: replacing it would restart the studio mid-painting)
    if (!record || !player || record.blendCode) return;
    void savePicks({ ...record, profileId: player.profileId, blendCode: player.blendCode });
  }, [record, player]);

  const character = characters.find((c) => c.id === characterId) ?? characters[0];

  return (
    <>
    <div key={screen} className={`screen screen-${screen} ${direction}`}>
      {screen === 'home' && (
        <Home
          paused={wall !== null}
          onGallery={() => setWall([])}
          characters={characters}
          selectedId={characterId}
          onSelect={selectCharacter}
          name={name}
          onName={rename}
          player={session.user}
          room={session.sessionId}
          onJoin={(code) => joinRoom(session, code)}
          onLeave={newRoom}
          onContinue={() => go('picks')}
        />
      )}
      {screen === 'picks' && (
        <PhotoPicks
          character={character}
          session={session}
          identity={{ name: named || undefined, profileId: player?.profileId, blendCode: player?.blendCode }}
          onBack={() => go('home')}
          onDone={(saved) => {
            setRecord(saved);
            go('studio');
          }}
        />
      )}
      {screen === 'studio' && record && (
        <PaintRoom
          character={character}
          session={session}
          record={record}
          player={player}
          paused={wall !== null}
          onBack={() => go('picks')}
          onGallery={setWall}
          onPaintingComplete={onPaintingComplete}
          onReading={setReading}
        />
      )}
      {/* the hand-off to the gallery room waits while a canvas is read about or the wall is open: its 10 s ring would otherwise leave mid-sentence */}
      {screen === 'studio' && finished && !reading && wall === null && <HangItUp character={character} painting={finished} onHang={hang} />}
      {screen === 'gallery' && (
        <Gallery
          session={session}
          characterId={characterId}
          arrival={arrival}
          onFrontReady={onFrontReady}
          // A new room: the address without ?session, which page 1 then fills in.
          onPlayAgain={() => {
            setInGallery(session, false);
            window.location.assign(window.location.pathname);
          }}
        />
      )}
    </div>
    {/* outside .screen: its entrance animation would otherwise hold the gallery's fixed box */}
    {wall && <GalleryWall live={wall} onBack={() => setWall(null)} />}
    </>
  );
}
