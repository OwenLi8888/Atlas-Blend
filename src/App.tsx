import { useCallback, useEffect, useState } from 'react';
import { joinGallery, type GalleryPlayer } from './blend/gallery';
import { characters } from './characters';
import type { PicksRecord } from './picks/picksStore';
import { deviceStore, getSession, recallCharacter, rememberCharacter, setPicking, wasPicking } from './picks/session';
import { Gallery, type GalleryItem } from './screens/Gallery';
import { Home } from './screens/Home';
import { PaintRoom } from './screens/PaintRoom';
import { PhotoPicks } from './screens/PhotoPicks';

/**
 * The flow, for two players on two devices in one session (?session=…&user=1|2):
 * 1 name yourself and choose a painter, 2 pick 5 of 25 pictures, 3 the painter paints one of your
 * picks, one of your friend's and the piece that blends you both, 4 the gallery wall.
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
  const [screen, setScreen] = useState<Screen>(() => (wasPicking(session) && recallCharacter(session) ? 'picks' : 'home'));
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [record, setRecord] = useState<PicksRecord | null>(null);
  const [wall, setWall] = useState<GalleryItem[]>([]);
  /** This player's profile in the Gallery API (server/); null while it is unknown or the API is not running. */
  const [player, setPlayer] = useState<GalleryPlayer | null>(null);

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

  const character = characters.find((c) => c.id === characterId) ?? characters[0];

  return (
    <div key={screen} className={`screen screen-${screen} ${direction}`}>
      {screen === 'home' && (
        <Home
          characters={characters}
          selectedId={characterId}
          onSelect={selectCharacter}
          name={name}
          onName={rename}
          player={session.user}
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
          onBack={() => go('picks')}
          onGallery={(items) => {
            setWall(items);
            go('gallery');
          }}
        />
      )}
      {screen === 'gallery' && <Gallery items={wall} onBack={() => go('studio')} />}
    </div>
  );
}
