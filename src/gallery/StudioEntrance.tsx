import './StudioEntrance.css';
import { useEffect, useRef, useState } from 'react';
import type { StudioScene } from '../scene/studioScene';
import { PainterFace } from './PainterFace';
import { PAINTERS, type Painter } from './painter';

/** What the visitor brings from the studio into the entrance: their painter and their own name. */
export interface StudioChoice {
  painter: Painter;
  name: string;
}

interface Props {
  /** Chosen before, so the studio opens with it selected. */
  initial: StudioChoice | null;
  /** Signs the visitor up with this painter and name (and the works they chose before). */
  onEnter: (choice: StudioChoice) => void;
  /** Back to the works, to change what was chosen. Keeps the painter and name chosen so far. */
  onBack: (sofar: StudioChoice | null) => void;
  /** The sign-up is under way. */
  busy: boolean;
  /** Why the last sign-up failed, if it did. */
  error: string | null;
}

/** How much each painter waves its little hands, and a line about it. */
const CHARACTER: Record<string, { arms: number; blurb: string }> = {
  ember: { arms: 1, blurb: 'Warm and fiery' },
  sunny: { arms: 0.6, blurb: 'Loves the light' },
  pop: { arms: 1, blurb: 'Bold, bright colour' },
  dot: { arms: 0.45, blurb: 'Every last detail' },
  hue: { arms: 1, blurb: 'A bit of everything' },
  ivory: { arms: 0.7, blurb: 'An old master' },
};

const MAX_NAME_LENGTH = 80;

const cast = PAINTERS.map(({ id, color, art = id }) => ({
  id,
  color,
  arms: CHARACTER[id]?.arms ?? 0.7,
  src: art + '.webp',
  blink: art + '-blink.webp',
}));

/** The wide layout: a column on the left of the studio. Kept in step with the media query in StudioEntrance.css. */
const WIDE = '(min-width: 900px) and (min-aspect-ratio: 1/1)';

/**
 * The second step of a first visit, after the works: the painted studio builds itself around the
 * visitor, the six painters sit on the palette, and the visitor picks one (in the scene or by
 * name) and says who they are. That painter is theirs from then on: it paints their blends.
 */
export function StudioEntrance({ initial, onEnter, onBack, busy, error }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<StudioScene | null>(null);
  const [painterId, setPainterId] = useState<string | null>(initial?.painter.id ?? null);
  const [name, setName] = useState(initial?.name ?? '');
  const chosenRef = useRef(painterId);
  chosenRef.current = painterId;
  const painter = PAINTERS.find(p => p.id === painterId) ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const panel = panelRef.current;
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    // three.js comes as its own chunk, so the words on the page do not wait for it
    import('../scene/studioScene').then(({ createStudioScene }) => {
      if (cancelled) return;
      const scene = createStudioScene(canvas, {
        base: './studio/',
        cast,
        onPick: id => setPainterId(id),
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
      sceneRef.current = scene;
      scene.select(chosenRef.current);
      // on a wide screen the words are a column over the left of the picture: the scene moves right of it
      ro = new ResizeObserver(() => {
        scene.setPanel(window.matchMedia(WIDE).matches && panel ? panel.getBoundingClientRect().right : 0);
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
    sceneRef.current?.select(painterId);
  }, [painterId]);

  const enter = () => {
    if (painter && !busy) onEnter({ painter, name: name.trim() });
  };

  return (
    <main className="studio-entrance">
      <canvas ref={canvasRef} className="studio-entrance-scene" aria-hidden="true" />
      <div ref={panelRef} className="studio-entrance-panel">
        <header className="studio-entrance-head">
          <button type="button" className="text-link studio-entrance-back" onClick={() => onBack(painter && { painter, name: name.trim() })}>
            ← Back to the works
          </button>
          <h1>Choose your painter</h1>
          <p className="studio-entrance-lede">Tap one on the palette. It will paint what you and a friend love.</p>
        </header>

        <form
          className="studio-entrance-choice"
          onSubmit={event => {
            event.preventDefault();
            enter();
          }}
        >
          <div className="studio-entrance-painters" role="radiogroup" aria-label="Painters">
            {PAINTERS.map(p => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={p.id === painterId}
                className={'studio-entrance-painter' + (p.id === painterId ? ' chosen' : '')}
                style={{ ['--paint' as string]: p.color }}
                onClick={() => setPainterId(p.id)}
              >
                <PainterFace painter={p} size={34} />
                {p.name}
              </button>
            ))}
          </div>
          <p className="studio-entrance-note" aria-live="polite">
            {error ? (
              <span className="studio-entrance-error">{error}</span>
            ) : painter ? (
              <>
                <em>{painter.name}</em> · {CHARACTER[painter.id]?.blurb}
              </>
            ) : (
              'Nobody chosen yet'
            )}
          </p>
          <div className="studio-entrance-go">
            <label className="studio-entrance-name">
              <span className="visually-hidden">Your name</span>
              <input
                type="text"
                value={name}
                maxLength={MAX_NAME_LENGTH}
                placeholder="Your name"
                autoComplete="given-name"
                enterKeyHint="go"
                onChange={event => setName(event.target.value)}
              />
            </label>
            <button type="submit" className="button" disabled={!painter || busy}>
              {busy ? 'Opening…' : 'Open my gallery'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
