import './HangItUp.css';
import '../screens/SpeechCloud.css';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Character } from '../characters';
import { SpeechCloud } from '../screens/SpeechCloud';
import { HUNG_NAME, LIFT_MS, reducedMotion } from './flight';
import type { FinalPainting } from './galleryData';
import { PainterSprite } from './PainterSprite';

interface Props {
  character: Character;
  /** The painting that was just finished. */
  painting: FinalPainting;
  /**
   * Go to the gallery. `from` is where the painting is on screen after it has lifted off, or null
   * when it did not lift (reduced motion).
   */
  onHang: (from: DOMRect | null) => void;
}

/** The painting is finished: let it be looked at before the painter speaks up. */
const WAIT_MS = 1500;
/** With nobody tapping, the ring fills and the painting is hung. */
const AUTO_MS = 10_000;

const LINE = "It's *beautiful!* Let's hang it in our gallery!";

/**
 * The hand-off from the painting page to the gallery. It lies over the painting page and needs
 * nothing from it but the finished painting: the painter pops up with its speech cloud and a
 * "Hang it up" button with a ring that fills in 10 s. Anything the visitor does on the page starts
 * the ring again; "Stay here" switches the ring off.
 */
export function HangItUp({ character, painting, onHang }: Props) {
  const [shown, setShown] = useState(false);
  const [auto, setAuto] = useState(true);
  const [lifting, setLifting] = useState(false);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const ringRef = useRef<SVGRectElement>(null);
  const liftRef = useRef<HTMLImageElement>(null);
  const gone = useRef(false);
  const hangRef = useRef(onHang);
  hangRef.current = onHang;

  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), WAIT_MS);
    return () => window.clearTimeout(t);
  }, []);

  useLayoutEffect(() => {
    const b = buttonRef.current;
    if (shown && b) setBox({ w: b.offsetWidth, h: b.offsetHeight });
  }, [shown]);

  const advance = useCallback(() => {
    if (gone.current) return;
    gone.current = true;
    if (reducedMotion()) hangRef.current(null); // a plain crossfade: nothing lifts or flies
    else setLifting(true);
  }, []);

  // The painting lifts off its canvas, then the gallery takes it from where it hangs.
  useEffect(() => {
    if (!lifting) return;
    const t = window.setTimeout(() => hangRef.current(liftRef.current?.getBoundingClientRect() ?? null), LIFT_MS);
    return () => window.clearTimeout(t);
  }, [lifting]);

  // The ring: fills in 10 s, starts again on any interaction with the page.
  useEffect(() => {
    const rect = ringRef.current;
    if (!shown || !auto || !box || !rect) return;
    const anim = rect.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: AUTO_MS, fill: 'forwards' });
    anim.onfinish = advance;
    const reset = (ev: Event) => {
      if (gone.current) return anim.pause();
      // Its own buttons do not count: they act at once.
      if (ev.target instanceof Node && actionsRef.current?.contains(ev.target)) return;
      anim.currentTime = 0;
    };
    const events = ['pointerdown', 'wheel', 'scroll', 'keydown', 'change'] as const;
    for (const name of events) window.addEventListener(name, reset, { capture: true, passive: true });
    return () => {
      anim.onfinish = null;
      anim.cancel();
      for (const name of events) window.removeEventListener(name, reset, { capture: true });
    };
  }, [shown, auto, box, advance]);

  if (!shown) return null;
  const pad = 5; // the ring sits this far outside the button
  return (
    <div className={`hang${lifting ? ' lifting' : ''}`}>
      <div className="hang-guide">
        <PainterSprite character={character} className="hop-in" />
        <SpeechCloud name={character.name} line={LINE} roomFor={LINE} />
      </div>
      <div ref={actionsRef} className="hang-actions">
        <span className="hang-button">
          <button ref={buttonRef} type="button" className="btn primary" onClick={advance}>
            Hang it up
          </button>
          {box && auto && (
            <svg className="hang-ring" width={box.w + pad * 2} height={box.h + pad * 2} aria-hidden="true">
              {[false, true].map((fill) => (
                <rect
                  key={String(fill)}
                  ref={fill ? ringRef : undefined}
                  className={fill ? 'fill' : 'track'}
                  x={1.5}
                  y={1.5}
                  width={box.w + pad * 2 - 3}
                  height={box.h + pad * 2 - 3}
                  rx={(box.h + pad * 2 - 3) / 2}
                  pathLength={1}
                />
              ))}
            </svg>
          )}
        </span>
        {auto && (
          <button type="button" className="hang-stay" onClick={() => setAuto(false)}>
            Stay here
          </button>
        )}
      </div>
      {lifting && <img ref={liftRef} className="hang-lift" src={painting.imageUrl} alt="" style={{ viewTransitionName: HUNG_NAME }} />}
    </div>
  );
}
