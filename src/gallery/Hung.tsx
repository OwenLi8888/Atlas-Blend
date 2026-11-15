import { useState, type ReactNode } from 'react';
import type { Artwork } from '../rec/api';
import { byline } from './format';

interface Props {
  work: Artwork;
  /** A quiet line under the artist, such as the heart a recommendation came from. */
  note?: ReactNode;
  /** A small label above the title, such as whose work this is on a shared wall. */
  tag?: string;
  kept?: boolean;
  onToggleKeep?: () => void;
  onOpen?: () => void;
  /** Shown under the label, such as the field for why a work was kept. */
  children?: ReactNode;
}

/** One artwork as it hangs on a wall: the image, then a label like a museum's. */
export function Hung({ work, note, tag, kept = false, onToggleKeep, onOpen, children }: Props) {
  const [loaded, setLoaded] = useState(false);
  const image = (
    <img
      className={loaded ? 'loaded' : ''}
      src={work.image_url}
      alt={work.title + ' by ' + (work.artist || 'an unknown artist')}
      loading="lazy"
      draggable={false}
      onLoad={() => setLoaded(true)}
    />
  );

  return (
    <figure className={'hung' + (kept ? ' kept' : '')}>
      {onOpen ? (
        <button type="button" className="hung-image" onClick={onOpen} aria-label={'Look closer at ' + work.title}>
          {image}
        </button>
      ) : (
        <div className="hung-image">{image}</div>
      )}
      <figcaption className="plate">
        <div className="plate-text">
          {tag && <span className="plate-tag">{tag}</span>}
          <span className="plate-title">{work.title}</span>
          <span className="plate-meta">{byline(work)}</span>
          {note && <span className="plate-note">{note}</span>}
        </div>
        {onToggleKeep ? <HeartButton kept={kept} title={work.title} onToggle={onToggleKeep} /> : kept && <HeartMark />}
      </figcaption>
      {children}
    </figure>
  );
}

const HEART_PATH =
  'M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z';

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d={HEART_PATH} />
    </svg>
  );
}

export function HeartButton({ kept, title, onToggle }: { kept: boolean; title: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={'heart' + (kept ? ' on' : '')}
      aria-pressed={kept}
      aria-label={(kept ? 'Remove the heart from ' : 'Heart ') + title}
      onClick={onToggle}
    >
      <HeartIcon />
    </button>
  );
}

/** A heart that only shows state, for places where the whole work is the control. */
export function HeartMark() {
  return (
    <span className="heart on">
      <HeartIcon />
    </span>
  );
}
