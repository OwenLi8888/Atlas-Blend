import './PaintRoom.css';
import { useEffect, useRef, useState } from 'react';
import { studioCast, type Character } from '../characters';
import { Player } from '../engine/player';
import type { FinalPainting } from '../gallery/galleryData';
import { getPlan } from '../plan/planStore';
import type { StudioScene } from '../scene/studioScene';
import { STYLE_MENU, type Painting } from '../types';
import { Studio } from './Studio';

/** One picture to paint, with its shape known up front so the easel can be sized before planning. */
export interface Picture {
  painting: Painting;
  /** Width / height. */
  aspect: number;
}

interface Props {
  /** Up to three pictures, one per easel, painted left to right. */
  pictures: Picture[];
  character: Character;
  onBack: () => void;
  /**
   * HAND-OFF TO THE GALLERY (src/gallery/HangItUp.tsx listens to this through App.tsx).
   * Called with the finished painting when the last canvas is done, and with null when painting
   * starts again. This is the only thing the gallery needs from this page.
   * TODO(painting page): three canvases are painted and the gallery hangs one; today that is the
   * last one that was painted. Pass whichever is "the" painting, or a combined one.
   * TODO(painting page): the no-WebGL fallback (<Studio>) does not report completion yet.
   */
  onPaintingComplete?: (painting: FinalPainting | null) => void;
}

/** One style per easel, so the three canvases also differ in look. */
const STYLES = STYLE_MENU.slice(0, 3);
/** CSS width of the hidden canvases the stroke players draw on; the 3D room shows them as textures. */
const SHEET = 420;
const SECONDS_EACH = 9;

const hasWebGL = () => !!document.createElement('canvas').getContext('webgl2');

/**
 * Screen 3, in the painted studio. The chosen painter hops off the palette, takes a brush from the
 * jar and paints the visitor's picks on the three easels, one after another, moving its stepladder
 * along as it goes. Without WebGL it falls back to the flat Studio screen with the first pick.
 */
export function PaintRoom(props: Props) {
  const [webgl] = useState(hasWebGL);
  const first = props.pictures[0];
  if (!first) return null;
  return webgl ? <Room {...props} /> : <Studio painting={first.painting} character={props.character} onBack={props.onBack} />;
}

function Room({ pictures, character, onBack, onPaintingComplete }: Props) {
  const completeRef = useRef(onPaintingComplete);
  completeRef.current = onPaintingComplete;
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  /** -1 while the painter fetches its brush, then the canvas being painted. */
  const [index, setIndex] = useState(-1);
  /** The canvas being painted is still being planned (first visit of a picture). */
  const [studying, setStudying] = useState(false);
  const [skipped, setSkipped] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  const [run, setRun] = useState(0);
  const works = pictures.slice(0, STYLES.length);

  // Plan every picture at once; the worker takes them in turn while the painter walks to the jar.
  useEffect(() => {
    for (const w of works) getPlan(w.painting).catch(() => {});
  }, [pictures]);

  useEffect(() => {
    const canvas = sceneRef.current;
    const host = hostRef.current;
    const panel = panelRef.current;
    if (!canvas || !host || !works.length) return;
    let cancelled = false;
    let scene: StudioScene | null = null;
    let ro: ResizeObserver | null = null;
    let current = -1;
    const players: Player[] = [];
    /** Canvases that could not be painted. */
    const blank = new Set<number>();
    // Pixel size set up front, the same the Player will measure (CSS size x DPR, at most 2): the 3D
    // room uploads each sheet as a texture before its plan may be ready, and a texture cannot
    // change size once uploaded.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sheets = works.map((w) => {
      const sheet = document.createElement('canvas');
      const h = Math.round(SHEET / w.aspect);
      sheet.style.width = `${SHEET}px`;
      sheet.style.height = `${h}px`;
      sheet.width = Math.max(1, Math.round(SHEET * dpr));
      sheet.height = Math.max(1, Math.round(h * dpr));
      const g = sheet.getContext('2d', { alpha: false });
      if (g) {
        g.fillStyle = '#f4efe6';
        g.fillRect(0, 0, sheet.width, sheet.height);
      }
      host.append(sheet);
      return sheet;
    });
    setIndex(-1);
    setDone(false);
    setSkipped([]);
    completeRef.current?.(null);
    const bar = (progress: number) => {
      if (barRef.current) barRef.current.style.transform = `scaleX(${progress})`;
    };
    bar(0);

    const paintAt = async (i: number) => {
      current = i;
      setIndex(i);
      setStudying(true);
      let plan;
      try {
        plan = await getPlan(works[i].painting);
      } catch {
        plan = null;
      }
      if (cancelled || i !== current) return;
      setStudying(false);
      if (!plan) {
        // This picture could not be planned: the painter moves on, the canvas stays blank.
        blank.add(i);
        setSkipped((s) => [...s, i]);
        scene?.workDone();
        return;
      }
      const sheet = sheets[i];
      const player = new Player(sheet, plan, {
        style: STYLES[i].id,
        durationMs: SECONDS_EACH * 1000,
        onFrame: (f) => {
          if (i !== current) return;
          scene?.setBrush(f.x / sheet.clientWidth, f.y / sheet.clientHeight);
          bar((i + f.progress) / works.length);
        },
        onDone: () => {
          player.destroy(); // the finished picture stays on its canvas
          players.splice(players.indexOf(player), 1);
          if (i === current) scene?.workDone();
        },
      });
      players.push(player);
    };

    import('../scene/studioScene').then(({ createStudioScene }) => {
      if (cancelled) return;
      scene = createStudioScene(canvas, {
        base: './studio/',
        cast: studioCast,
        mode: 'paint',
        painterId: character.id,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        works: sheets.map((sheet, i) => ({ canvas: sheet, aspect: works[i].aspect })),
        onReady: (i) => void paintAt(i),
        onAllDone: () => {
          bar(1);
          setDone(true);
          // Hand-off to the gallery: see onPaintingComplete in Props.
          const last = works.map((_, i) => i).filter((i) => !blank.has(i)).pop();
          if (last === undefined) return;
          try {
            completeRef.current?.({
              imageUrl: sheets[last].toDataURL('image/jpeg', 0.9),
              title: works[last].painting.title,
              style: STYLES[last].label,
              createdAt: new Date().toISOString(),
            });
          } catch {
            // The canvas could not be read: nothing to hang.
          }
        },
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
  }, [pictures, character.id, run]);

  const now = index >= 0 ? works[index] : null;
  const status = done
    ? skipped.length
      ? `${character.name} painted ${works.length - skipped.length} of your picks.`
      : `${character.name} painted your picks.`
    : !now
      ? `${character.name} is fetching a brush…`
      : studying
        ? `${character.name} is studying “${now.painting.title}”…`
        : `${character.name} is painting in ${STYLES[index].label}…`;

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
            <h1>{now ? now.painting.title : 'Your picks'}</h1>
            <p>{now ? [now.painting.artist, now.painting.year].filter(Boolean).join(', ') : `${character.name} paints them in the studio`}</p>
          </div>
        </header>

        <section className="paint-foot" aria-label="Painting progress">
          <ol className="paint-steps">
            {works.map((w, i) => (
              <li key={w.painting.id} className={done || i < index ? 'done' : i === index ? 'now' : undefined} title={w.painting.title}>
                {STYLES[i].label}
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
