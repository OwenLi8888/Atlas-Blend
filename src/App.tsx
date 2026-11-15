import { useCallback, useEffect, useState } from 'react';
import { characters } from './characters';
import { loadPaintings } from './paintings';
import { getPlan } from './plan/planStore';
import { Home } from './screens/Home';
import { MuseumSetup } from './screens/MuseumSetup';
import { Paintings } from './screens/Paintings';
import { PaintRoom } from './screens/PaintRoom';
import type { Painting } from './types';

type Screen = 'home' | 'paintings' | 'studio';
const ORDER: Screen[] = ['home', 'paintings', 'studio'];

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [characterId, setCharacterId] = useState<string | null>(null);
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
    },
    [screen],
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
          <Home characters={characters} selectedId={characterId} onSelect={setCharacterId} onContinue={() => go('paintings')} />
        )}
        {screen === 'paintings' && (
          <Paintings
            paintings={paintings}
            onBack={() => go('home')}
            onPick={(index) => {
              setPaintingIndex(index);
              go('studio');
            }}
            onMissing={markMissing}
            onOpenSetup={() => setSetupOpen(true)}
          />
        )}
        {screen === 'studio' && painting && !painting.missing && (
          <PaintRoom key={painting.id} painting={painting} character={character} onBack={() => go('paintings')} />
        )}
      </div>
      {setupOpen && paintings && <MuseumSetup paintings={paintings} onReplace={replace} onClose={() => setSetupOpen(false)} />}
    </>
  );
}
