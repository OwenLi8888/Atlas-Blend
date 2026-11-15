import { useCallback, useEffect, useState } from 'react';
import { characters } from './characters';
import { loadPaintings } from './paintings';
import { getSession, recallCharacter, rememberCharacter, setPicking, wasPicking } from './picks/session';
import { getPlan } from './plan/planStore';
import { Home } from './screens/Home';
import { MuseumSetup } from './screens/MuseumSetup';
import { Paintings } from './screens/Paintings';
import { PhotoPicks } from './screens/PhotoPicks';
import { Studio } from './screens/Studio';
import type { Painting } from './types';

type Screen = 'home' | 'picks' | 'paintings' | 'studio';
const ORDER: Screen[] = ['home', 'picks', 'paintings', 'studio'];

export function App() {
  // The two-device session (?session=…&user=1|2). The character and the picks screen are remembered
  // per session, so a refresh on the picks screen comes back to it with the same painter.
  const [session] = useState(getSession);
  const [characterId, setCharacterId] = useState<string | null>(() => recallCharacter(session));
  const [screen, setScreen] = useState<Screen>(() => (wasPicking(session) && recallCharacter(session) ? 'picks' : 'home'));
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [paintings, setPaintings] = useState<Painting[] | null>(null);
  const [paintingIndex, setPaintingIndex] = useState(0);
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadPaintings().then((list) => {
      if (cancelled) return;
      setPaintings(list);
      // Warm the plans while the visitor is still choosing, so the studio starts at once.
      for (const p of list) if (!p.missing) getPlan(p).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const go = useCallback(
    (next: Screen) => {
      setDirection(ORDER.indexOf(next) >= ORDER.indexOf(screen) ? 'forward' : 'back');
      setScreen(next);
      setPicking(session, next === 'picks');
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

  const markMissing = useCallback((index: number) => {
    setPaintings((list) => list && list.map((p, i) => (i === index ? { ...p, missing: true } : p)));
  }, []);

  const replace = useCallback((index: number, painting: Painting) => {
    setPaintings((list) => list && list.map((p, i) => (i === index ? painting : p)));
    getPlan(painting).catch(() => {});
  }, []);

  const character = characters.find((c) => c.id === characterId) ?? characters[0];
  const painting = paintings?.[paintingIndex];

  return (
    <>
      <div key={screen} className={`screen screen-${screen} ${direction}`}>
        {screen === 'home' && (
          <Home characters={characters} selectedId={characterId} onSelect={selectCharacter} onContinue={() => go('picks')} />
        )}
        {screen === 'picks' && (
          <PhotoPicks
            character={character}
            session={session}
            onBack={() => go('home')}
            onDone={() => {
              // ---- HANDOFF: the recommendation step goes here ----
              // This user's picks are saved by now. To read both users' records (same shape as the
              // argument of onDone):
              //   import { getSessionPicks } from './picks/picksStore';
              //   const records = await getSessionPicks(session.sessionId);
              // Add your screen to Screen/ORDER above and go to it here. Until it exists, the app
              // carries on to the paintings screen.
              go('paintings');
            }}
          />
        )}
        {screen === 'paintings' && (
          <Paintings
            paintings={paintings}
            onBack={() => go('picks')}
            onPick={(index) => {
              setPaintingIndex(index);
              go('studio');
            }}
            onMissing={markMissing}
            onOpenSetup={() => setSetupOpen(true)}
          />
        )}
        {screen === 'studio' && painting && !painting.missing && (
          <Studio key={painting.id} painting={painting} character={character} onBack={() => go('paintings')} />
        )}
      </div>
      {setupOpen && paintings && <MuseumSetup paintings={paintings} onReplace={replace} onClose={() => setSetupOpen(false)} />}
    </>
  );
}
