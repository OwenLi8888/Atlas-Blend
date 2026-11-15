import './PainterFace.css';
import type { CSSProperties } from 'react';
import { painterBlinkImage, painterImage, type Painter } from './painter';

interface Props {
  painter: Painter;
  /** Width and height in CSS pixels. */
  size: number;
}

/**
 * A painter, small: its own painted artwork (public/studio/, the same files the 3D studio uses),
 * on a round of its paint colour, blinking now and then. The one way the app shows a painter
 * outside the studio, so every place shows the same character. Decorative; label what holds it.
 */
export function PainterFace({ painter, size }: Props) {
  // each painter blinks on its own beat, so two side by side do not blink together
  const beat = 4.2 + (painter.id.charCodeAt(0) % 5) * 0.55;
  const style = { width: size, height: size, ['--paint' as string]: painter.color, ['--beat' as string]: `${beat}s` } as CSSProperties;
  return (
    <span className="painter-face" style={style} aria-hidden="true">
      <img className="painter-face-open" src={painterImage(painter)} alt="" draggable={false} />
      <img className="painter-face-blink" src={painterBlinkImage(painter)} alt="" draggable={false} />
    </span>
  );
}
