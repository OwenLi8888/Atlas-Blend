import { useCallback, useState } from 'react';
import { characters } from './characters';
import type { PicksRecord } from './picks/picksStore';
import { loadPool, photoUrl } from './picks/pool';
import { getSession, recallCharacter, rememberCharacter, setPicking, wasPicking } from './picks/session';
import { Home } from './screens/Home';
import { PaintRoom, type Picture } from './screens/PaintRoom';
import { PhotoPicks } from './screens/PhotoPicks';

/**
 * The flow: 1 choose a painter in the studio, 2 pick 5 of 25 pictures, 3 the painter paints three
 * of those picks in the studio. (The paintings screen and Museum setup are not in this flow; their
 * components are still in src/screens/.)
 */
type Screen = 'home' | 'picks' | 'studio';
const ORDER: Screen[] = ['home', 'picks', 'studio'];

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
  const [screen, setScreen] = useState<Screen>(() => (wasPicking(session) && recallCharacter(session) ? 'picks' : 'home'));
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [pictures, setPictures] = useState<Picture[]>([]);

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

  const character = characters.find((c) => c.id === characterId) ?? characters[0];

  return (
    <div key={screen} className={`screen screen-${screen} ${direction}`}>
      {screen === 'home' && (
        <Home characters={characters} selectedId={characterId} onSelect={selectCharacter} onContinue={() => go('picks')} />
      )}
      {screen === 'picks' && (
        <PhotoPicks
          character={character}
          session={session}
          onBack={() => go('home')}
          onDone={(record) => {
            // ---- HANDOFF: the recommendation step can read both users' records here ----
            //   import { getSessionPicks } from './picks/picksStore';
            //   const records = await getSessionPicks(session.sessionId);
            picturesFor(record).then(
              (list) => {
                if (!list.length) return;
                setPictures(list);
                go('studio');
              },
              () => {},
            );
          }}
        />
      )}
      {screen === 'studio' && pictures.length > 0 && (
        <PaintRoom pictures={pictures} character={character} onBack={() => go('picks')} />
      )}
    </div>
  );
}
