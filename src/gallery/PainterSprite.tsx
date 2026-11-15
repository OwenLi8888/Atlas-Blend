import { useEffect, useState } from 'react';
import './PainterSprite.css';
import { studioCast, type Character } from '../characters';

interface Props {
  character: Character;
  /** Draw only the outline, in navy: someone who is not here yet. */
  silhouette?: boolean;
  className?: string;
}

/**
 * A painter as page 2 drew it beside the speech cloud: the page 1 sprite on a puddle of its own
 * paint, blinking as it does in the studio. (That component, `Guide`, was removed from
 * PhotoPicks.tsx in 5fec6fd; this is the same markup and timing, without the pick bounce.)
 */
export function PainterSprite({ character, silhouette = false, className = '' }: Props) {
  const [blink, setBlink] = useState(false);
  const blinkSrc = studioCast.find((c) => c.id === character.id)?.blink;

  useEffect(() => {
    if (!blinkSrc || silhouette || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
  }, [blinkSrc, silhouette]);

  return (
    <div className={`painter${silhouette ? ' silhouette' : ''} ${className}`} style={{ ['--tint' as string]: character.color }} aria-hidden="true">
      <span className="painter-puddle" />
      <span className="painter-body">
        <character.Sprite />
        {blinkSrc && <img className="painter-blink" src={`./studio/${blinkSrc}`} alt="" draggable={false} style={{ opacity: blink ? 1 : 0 }} />}
      </span>
    </div>
  );
}
