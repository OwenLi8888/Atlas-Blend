import { useEffect, useRef } from 'react';
import './Home.css';
import { studioCast, type Character } from '../characters';
import type { StudioScene } from '../scene/studioScene';

interface Props {
  characters: Character[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onContinue: () => void;
}

/**
 * Screen 1: choose your painter, inside a painted 3D studio. The painters sit on a palette; tap one
 * in the scene or on its name. On a phone the text sits above and the choice below the picture; on
 * a wide screen it is a column on the left and the picture moves right to make room.
 */
export function Home({ characters, selectedId, onSelect, onContinue }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<StudioScene | null>(null);
  const pickRef = useRef(onSelect);
  pickRef.current = onSelect;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
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
    import('../scene/studioScene').then(({ createStudioScene }) => {
      if (cancelled) return;
      const scene = createStudioScene(canvas, {
        base: './studio/',
        cast: studioCast,
        onPick: (id) => pickRef.current(id),
        reducedMotion,
      });
      sceneRef.current = scene;
      scene.select(selectedRef.current);
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

  return (
    <main className="home">
      <canvas ref={canvasRef} className="home-scene" aria-hidden="true" />
      <div ref={panelRef} className="home-panel">
        <header className="home-head">
          <p className="eyebrow">Atlas</p>
          <h1>Choose your painter</h1>
          <p className="lede">Tap a painter in the studio. They will repaint a painting from this gallery while you watch.</p>
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
          <button type="button" className="btn primary" disabled={!selectedId} onClick={onContinue}>
            Continue
          </button>
        </div>
      </div>
    </main>
  );
}
