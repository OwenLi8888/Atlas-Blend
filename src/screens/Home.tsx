import { useEffect, useRef, useState } from 'react';
import './Home.css';
import { studioCast, type Character } from '../characters';
import { ROOM_CODE } from '../picks/session';
import type { StudioScene } from '../scene/studioScene';

interface Props {
  characters: Character[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The player's name, shown to the other player later. */
  name: string;
  onName: (name: string) => void;
  /** Which of the two players this device is. */
  player: 1 | 2;
  /** This room's code: the friend types it on their device to play together. */
  room: string;
  /** Player 1 typed a friend's code: move into that room. */
  onJoin: (code: string) => void;
  /** Player 2 leaves the friend's room. */
  onLeave: () => void;
  /** Open the gallery of everything this device has painted. */
  onGallery: () => void;
  /** The gallery is open over this screen: stop drawing the studio. */
  paused?: boolean;
  onContinue: () => void;
}

/**
 * Screen 1: choose your painter, inside a painted 3D studio. The painters sit on a palette; tap one
 * in the scene or on its name. On a phone the text sits above and the choice below the picture; on
 * a wide screen it is a column on the left and the picture moves right to make room.
 */
export function Home({ characters, selectedId, onSelect, name, onName, player, room, onJoin, onLeave, onGallery, paused = false, onContinue }: Props) {
  const [friendCode, setFriendCode] = useState('');
  const canJoin = ROOM_CODE.test(friendCode) && friendCode !== room;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<StudioScene | null>(null);
  const pickRef = useRef(onSelect);
  pickRef.current = onSelect;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const shown = characters.slice(0, 6);
  const selected = shown.find((c) => c.id === selectedId);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const panel = panelRef.current;
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    // three.js loads as its own chunk, so the rest of the app does not wait for it
    // Without WebGL the studio stays a plain backdrop; the picker below still works.
    import('../scene/studioScene').then(({ createStudioScene }) => {
      if (cancelled || !document.createElement('canvas').getContext('webgl2')) return;
      const scene = createStudioScene(canvas, {
        base: './studio/',
        cast: studioCast,
        onPick: (id) => pickRef.current(id),
        reducedMotion,
      });
      sceneRef.current = scene;
      scene.select(selectedRef.current);
      scene.pause(pausedRef.current);
      // On a wide screen the UI is a column over the left of the picture: tell the scene its width.
      ro = new ResizeObserver(() => {
        const wide = window.matchMedia('(min-width: 900px) and (min-aspect-ratio: 1/1)').matches;
        scene.setPanel(wide && panel ? panel.getBoundingClientRect().right : 0);
      });
      if (panel) ro.observe(panel);
      ro.observe(canvas);
    });
    return () => {
      cancelled = true;
      ro?.disconnect();
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.select(selectedId);
  }, [selectedId]);

  useEffect(() => {
    sceneRef.current?.pause(paused);
  }, [paused]);

  return (
    <main className="home">
      <canvas ref={canvasRef} className="home-scene" aria-hidden="true" />
      <div ref={panelRef} className="home-panel">
        <header className="home-head">
          <p className="eyebrow">Atlas · Player {player} of 2</p>
          <h1>Choose your painter</h1>
          <p className="lede">Tap a painter in the studio. It will paint what you and your friend love.</p>
          <label className="player-name">
            <span className="eyebrow">Your name</span>
            <input
              type="text"
              value={name}
              maxLength={24}
              placeholder="Type your name"
              autoComplete="given-name"
              enterKeyHint="done"
              onChange={(e) => onName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
          <div className="room">
            <p className="room-code">
              <span className="eyebrow">{player === 1 ? 'Room code' : 'Friend’s room'}</span>
              <strong>{room}</strong>
            </p>
            {player === 1 ? (
              <form
                className="room-join"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canJoin) onJoin(friendCode);
                }}
              >
                <label>
                  <span className="eyebrow">Join a friend</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={4}
                    placeholder="Their code"
                    value={friendCode}
                    onChange={(e) => setFriendCode(e.target.value.replace(/\D/g, ''))}
                  />
                </label>
                <button type="submit" className="btn primary" disabled={!canJoin}>
                  Join
                </button>
              </form>
            ) : (
              <button type="button" className="btn ghost room-leave" onClick={onLeave}>
                Leave room
              </button>
            )}
          </div>
        </header>

        <div className="home-choice">
          <div className="painter-chips" role="radiogroup" aria-label="Painters">
            {shown.map((c) => {
              const on = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`painter-chip${on ? ' selected' : ''}`}
                  style={{ ['--tint' as string]: c.color }}
                  onClick={() => onSelect(c.id)}
                >
                  <span className="dot" aria-hidden="true" />
                  {c.name}
                </button>
              );
            })}
          </div>
          <p className="painter-note" aria-live="polite">
            {selected ? (
              <>
                <strong>{selected.name}</strong> · {selected.blurb}
              </>
            ) : (
              'Nobody picked yet'
            )}
          </p>
          <button type="button" className="btn primary" disabled={!selectedId || !name.trim()} onClick={onContinue}>
            Continue
          </button>
          <button type="button" className="text-btn home-gallery" onClick={onGallery}>
            Your gallery
          </button>
        </div>
      </div>
    </main>
  );
}
