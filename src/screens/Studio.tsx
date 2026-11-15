import { useEffect, useRef, useState } from 'react';
import type { Character } from '../characters';
import { Player, type PlayerFrame } from '../engine/player';
import { getPlan } from '../plan/planStore';
import { STYLES, type Painting, type StrokePlan, type StyleId } from '../types';

interface Props {
  painting: Painting;
  character: Character;
  onBack: () => void;
}

type Phase = 'planning' | 'painting' | 'done' | 'error';

declare global {
  interface Window {
    /** The live player, for the screenshot script and for poking at in the console. */
    __restyle?: Player;
  }
}

/** How far the sprite moves toward the brush each frame. */
const FOLLOW = 0.25;

/** Screen 3: the character paints the chosen painting, in any of three styles. */
export function Studio({ painting, character, onBack }: Props) {
  const [style, setStyle] = useState<StyleId>('swirl');
  const [phase, setPhase] = useState<Phase>('planning');
  const [plan, setPlan] = useState<StrokePlan | null>(null);
  const [aspect, setAspect] = useState(0.8);
  const [comparing, setComparing] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spriteRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const frameRef = useRef<PlayerFrame | null>(null);
  const styleRef = useRef<StyleId>(style);

  // The stroke plan: precomputed, or planned in the worker (a few seconds, once).
  useEffect(() => {
    let cancelled = false;
    getPlan(painting).then(
      (p) => {
        if (cancelled) return;
        setAspect(p.widthMm / p.heightMm);
        setPlan(p);
        setPhase('painting');
      },
      () => !cancelled && setPhase('error'),
    );
    return () => {
      cancelled = true;
    };
  }, [painting]);

  // The player lives as long as the plan does; styles and replays restart it in place.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!plan || !canvas) return;
    const player = new Player(canvas, plan, {
      style: styleRef.current,
      onFrame: (frame) => {
        frameRef.current = frame;
        if (barRef.current) barRef.current.style.transform = `scaleX(${frame.progress})`;
      },
      onDone: () => setPhase('done'),
    });
    playerRef.current = player;
    window.__restyle = player;
    return () => {
      player.destroy();
      playerRef.current = null;
      frameRef.current = null;
      if (window.__restyle === player) delete window.__restyle;
    };
  }, [plan]);

  // The character: brush tip eased toward the stroke being painted, or standing by when idle.
  useEffect(() => {
    const [tipX, tipY] = character.brushTip;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let x = NaN;
    let y = NaN;
    let facing = 1; // 1: as drawn (brush on the left, moving left). -1: mirrored.
    let flip = 1;
    let drift = 0;
    let lastTurn = 0;
    let size = 0;

    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const canvas = canvasRef.current;
      const sprite = spriteRef.current;
      const stage = stageRef.current;
      if (!canvas || !sprite || !stage) return;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (cw < 2) return;

      const wanted = Math.round(Math.min(Math.max(cw * 0.26, 72), 168));
      if (wanted !== size) {
        size = wanted;
        sprite.style.width = sprite.style.height = `${size}px`;
      }

      const frame = frameRef.current;
      const painting = !!frame?.painting;
      let targetX: number;
      let targetY: number;
      if (frame && painting) {
        targetX = frame.x;
        targetY = frame.y;
      } else {
        // Standing by: beside the canvas when there is room, else tucked over its bottom corner.
        // It only steps past an edge as far as there is screen to stand on.
        const box = canvas.getBoundingClientRect();
        const roomRight = Math.min((stage.clientWidth - cw) / 2, window.innerWidth - box.right) - 12;
        const roomBelow = window.innerHeight - box.bottom - 12;
        const left = cw - size + Math.min(Math.max(roomRight, size * 0.32), size + 16);
        const top = roomRight >= size ? ch - size : ch - size + Math.min(Math.max(roomBelow, 0), size * 0.4);
        targetX = left + tipX * size;
        targetY = top + tipY * size;
      }

      if (Number.isNaN(x)) {
        x = targetX;
        y = targetY;
      }
      const dx = (targetX - x) * FOLLOW;
      x += dx;
      y += (targetY - y) * FOLLOW;

      // Face the way it is travelling, without flickering, and never hang far off a side edge.
      drift = drift * 0.85 + dx * 0.15;
      if (!painting) facing = 1;
      else if (now - lastTurn > 320) {
        const want = drift > 0.8 ? -1 : drift < -0.8 ? 1 : facing;
        if (want !== facing) {
          facing = want;
          lastTurn = now;
        }
      }
      const body = (1 - tipX) * size;
      const overhang = size * 0.3;
      let face = facing;
      if (painting) {
        if (x + body > cw + overhang) face = -1;
        else if (x - body < -overhang) face = 1;
      }
      flip += (face - flip) * 0.3;

      const bob = calm ? 0 : painting ? Math.sin(now / 85) * 2.4 : Math.sin(now / 700) * 1.5;
      sprite.style.transformOrigin = `${tipX * 100}% ${tipY * 100}%`;
      sprite.style.transform = `translate3d(${(x - tipX * size).toFixed(2)}px, ${(y - tipY * size + bob).toFixed(2)}px, 0) scaleX(${flip.toFixed(3)})`;
      sprite.style.opacity = '1';
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [character]);

  const paint = (next: StyleId) => {
    styleRef.current = next;
    setStyle(next);
    if (!playerRef.current) return;
    playerRef.current.restart(next);
    setPhase('painting');
  };

  const styleLabel = STYLES.find((s) => s.id === style)!.label;
  const status =
    phase === 'planning'
      ? `${character.name} is studying the painting…`
      : phase === 'painting'
        ? `${character.name} is painting in ${styleLabel}…`
        : phase === 'done'
          ? `${character.name} painted it in ${styleLabel}.`
          : 'This painting could not be prepared. Go back and pick another.';

  const hold = {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setComparing(true);
    },
    onPointerUp: () => setComparing(false),
    onPointerCancel: () => setComparing(false),
    onLostPointerCapture: () => setComparing(false),
    onKeyDown: (e: React.KeyboardEvent) => (e.key === ' ' || e.key === 'Enter') && setComparing(true),
    onKeyUp: () => setComparing(false),
    onBlur: () => setComparing(false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };

  return (
    <main className="studio">
      <header className="studio-head">
        <button type="button" className="btn ghost back" onClick={onBack}>
          <span aria-hidden="true">←</span> Back
        </button>
        <div className="studio-title">
          <h1>{painting.title}</h1>
          <p>{[painting.artist, painting.year].filter(Boolean).join(', ')}</p>
        </div>
      </header>

      <div className="studio-stage" ref={stageRef}>
        <div className="easel" style={{ ['--ar' as string]: aspect }}>
          <div className="canvas-card">
            <canvas ref={canvasRef} aria-label={`${painting.title}, repainted in ${styleLabel}`} role="img" />
            <img
              className={`original${comparing ? ' on' : ''}`}
              src={painting.src}
              alt=""
              draggable={false}
              onLoad={(e) => !plan && setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
            />
            <span className={`original-tag${comparing ? ' on' : ''}`}>Original</span>
          </div>
          <div className="sprite" ref={spriteRef} aria-hidden="true">
            <character.Sprite />
          </div>
        </div>
      </div>

      <section className="studio-controls" aria-label="Painting controls">
        <div className={`progress${phase === 'planning' ? ' busy' : ''}`} aria-hidden="true">
          <div className="progress-fill" ref={barRef} />
        </div>
        <p className="status" role="status">
          {status}
        </p>
        <div className="chips" role="group" aria-label="Style">
          {STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`chip${s.id === style ? ' selected' : ''}`}
              aria-pressed={s.id === style}
              title={s.hint}
              disabled={phase === 'error'}
              onClick={() => paint(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="actions">
          <button type="button" className="btn secondary" disabled={!plan} onClick={() => paint(style)}>
            Replay
          </button>
          <button type="button" className={`btn secondary hold${comparing ? ' held' : ''}`} {...hold}>
            Hold to compare
          </button>
        </div>
      </section>
    </main>
  );
}
