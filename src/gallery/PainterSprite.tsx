import './PainterSprite.css';
import { useEffect, useState, type CSSProperties } from 'react';
import { painterBlinkImage, painterImage, type Painter } from './painter';

interface Props {
  painter: Painter;
  className?: string;
}

/**
 * A painter on its puddle of paint, blinking as it does in the studio. The
 * markup, timing and stylesheet are those of the painting flow's PainterSprite
 * (src/gallery/PainterSprite.tsx on main); only where the painter comes from differs.
 */
export function PainterSprite({ painter, className = '' }: Props) {
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let open = 0;
    let close = 0;
    const schedule = () => {
      open = window.setTimeout(() => {
        setBlink(true);
        close = window.setTimeout(() => {
          setBlink(false);
          schedule();
        }, 130);
      }, 2200 + Math.random() * 3200);
    };
    schedule();
    return () => {
      window.clearTimeout(open);
      window.clearTimeout(close);
    };
  }, []);

  return (
    <div className={'painter ' + className} style={{ '--tint': painter.color } as CSSProperties} aria-hidden="true">
      <span className="painter-puddle" />
      <span className="painter-body">
        <img src={painterImage(painter)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        <img className="painter-blink" src={painterBlinkImage(painter)} alt="" draggable={false} style={{ opacity: blink ? 1 : 0 }} />
      </span>
    </div>
  );
}
