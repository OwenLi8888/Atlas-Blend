import { useEffect, useRef, type ReactNode } from 'react';
import type { Artwork } from '../rec/api';
import { byline, museumName } from './format';

interface Props {
  work: Artwork;
  onClose: () => void;
  /** Controls shown under the text, such as the heart and the reason field. */
  children?: ReactNode;
}

/** A closer look at one work: the image large, with everything the label has room for. */
export function Detail({ work, onClose, children }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);

  return (
    <div className="detail" role="dialog" aria-modal="true" aria-label={work.title} onClick={onClose}>
      <div className="detail-inner" onClick={event => event.stopPropagation()}>
        <img className="detail-image" src={work.image_url} alt={work.title} />
        <div className="detail-text">
          <button ref={closeRef} type="button" className="text-link detail-close" onClick={onClose}>
            Close
          </button>
          <h2 className="detail-title">{work.title}</h2>
          <p className="detail-byline">{byline(work)}</p>
          <dl className="detail-facts">
            {work.medium && (
              <>
                <dt>Medium</dt>
                <dd>{work.medium}</dd>
              </>
            )}
            <dt>Held by</dt>
            <dd>{museumName(work.source)}</dd>
            {work.cluster && (
              <>
                <dt>Among</dt>
                <dd>{work.cluster}</dd>
              </>
            )}
          </dl>
          {work.caption && <p className="detail-caption">{work.caption}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
