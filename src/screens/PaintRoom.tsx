import './PaintRoom.css';
import { useEffect, useRef, useState } from 'react';
import { studioCast, type Character } from '../characters';
import { Player } from '../engine/player';
import { getPlan } from '../plan/planStore';
import type { StudioScene } from '../scene/studioScene';
import { STYLE_MENU, type Painting, type StrokePlan } from '../types';
import { Studio } from './Studio';

interface Props {
  painting: Painting;
  character: Character;
  onBack: () => void;
}

/** One canvas per style, painted left to right. */
const STYLES = STYLE_MENU.slice(0, 3);
/** CSS width of the hidden canvases the stroke players draw on; the 3D room shows them as textures. */
const SHEET = 420;
const SECONDS_EACH = 9;

const hasWebGL = () => !!document.createElement('canvas').getContext('webgl2');

/**
 * Screen 3, in the painted studio. The chosen painter hops off the palette, takes a brush from the
 * jar and repaints the chosen painting on the three easels, one style per canvas, moving its
 * stepladder along as it goes. Without WebGL it falls back to the flat Studio screen.
 */
export function PaintRoom(props: Props) {
  const [webgl] = useState(hasWebGL);
  return webgl ? <Room {...props} /> : <Studio {...props} />;
}

function Room({ painting, character, onBack }: Props) {
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [plan, setPlan] = useState<StrokePlan | null>(null);
  const [failed, setFailed] = useState(false);
  /** -1 while the painter fetches its brush, then the canvas being painted. */
  const [index, setIndex] = useState(-1);
  const [done, setDone] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getPlan(painting).then(
      (p) => !cancelled && setPlan(p),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [painting]);

  useEffect(() => {
    const canvas = sceneRef.current;
    const host = hostRef.current;
    const panel = panelRef.current;
    if (!plan || !canvas || !host) return;
    let cancelled = false;
    let scene: StudioScene | null = null;
    let ro: ResizeObserver | null = null;
    let current = -1;
    const players: Player[] = [];
    const aspect = plan.widthMm / plan.heightMm;
    const sheets = STYLES.map(() => {
      const sheet = document.createElement('canvas');
      sheet.style.width = `${SHEET}px`;
      sheet.style.height = `${Math.round(SHEET / aspect)}px`;
      host.append(sheet);
      return sheet;
    });
    setIndex(-1);
    setDone(false);
    const bar = (progress: number) => {
      if (barRef.current) barRef.current.style.transform = `scaleX(${progress})`;
    };
    bar(0);

    import('../scene/studioScene').then(({ createStudioScene }) => {
      if (cancelled) return;
      scene = createStudioScene(canvas, {
        base: './studio/',
        cast: studioCast,
        mode: 'paint',
        painterId: character.id,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        works: sheets.map((sheet) => ({ canvas: sheet, aspect })),
        onReady: (i) => {
          current = i;
          setIndex(i);
          const sheet = sheets[i];
          const player = new Player(sheet, plan, {
            style: STYLES[i].id,
            durationMs: SECONDS_EACH * 1000,
            onFrame: (f) => {
              if (i !== current) return;
              scene?.setBrush(f.x / sheet.clientWidth, f.y / sheet.clientHeight);
              bar((i + f.progress) / STYLES.length);
            },
            onDone: () => {
              player.destroy(); // the finished picture stays on its canvas
              if (i === current) scene?.workDone();
            },
          });
          players.push(player);
        },
        onAllDone: () => setDone(true),
      });
      ro = new ResizeObserver(() => {
        const wide = window.matchMedia('(min-width: 900px) and (min-aspect-ratio: 1/1)').matches;
        scene?.setPanel(wide && panel ? panel.getBoundingClientRect().right : 0);
      });
      if (panel) ro.observe(panel);
      ro.observe(canvas);
    });
    return () => {
      cancelled = true;
      ro?.disconnect();
      for (const p of players) p.destroy();
      scene?.dispose();
      for (const sheet of sheets) sheet.remove();
    };
  }, [plan, character.id, run]);

  const style = index >= 0 ? STYLES[index] : null;
  const status = failed
    ? 'This painting could not be prepared. Go back and pick another.'
    : !plan
      ? `${character.name} is studying the painting…`
      : done
        ? `${character.name} painted it three ways.`
        : style
          ? `${character.name} is painting in ${style.label}…`
          : `${character.name} is fetching a brush…`;

  return (
    <main className="paint-room">
      <canvas ref={sceneRef} className="paint-scene" aria-hidden="true" />
      <div ref={hostRef} className="paint-sheets" aria-hidden="true" />
      <div ref={panelRef} className="paint-panel">
        <header className="paint-head">
          <button type="button" className="btn ghost back" onClick={onBack}>
            <span aria-hidden="true">←</span> Back
          </button>
          <div className="paint-title">
            <h1>{painting.title}</h1>
            <p>{[painting.artist, painting.year].filter(Boolean).join(', ')}</p>
          </div>
        </header>

        <section className="paint-foot" aria-label="Painting progress">
          <ol className="paint-steps">
            {STYLES.map((s, i) => (
              <li key={s.id} className={done || i < index ? 'done' : i === index ? 'now' : undefined}>
                {s.label}
              </li>
            ))}
          </ol>
          <div className="progress" aria-hidden="true">
            <div className="progress-fill" ref={barRef} />
          </div>
          <p className="status" role="status">
            {status}
          </p>
          {done && (
            <button type="button" className="btn secondary" onClick={() => setRun((n) => n + 1)}>
              Paint again
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
