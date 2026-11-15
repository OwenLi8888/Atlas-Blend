import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Artwork } from '../rec/api';
import { api } from './api';
import { byline, museumName } from './format';
import { HeartButton } from './Hung';
import type { Hearts } from './useHearts';
import { WhyField } from './WhyField';

interface Props {
  work: Artwork;
  onClose: () => void;
  /** Called when a similar work is chosen; without it the similar works are not shown. */
  onNavigate?: (work: Artwork) => void;
  /** Controls shown under the text, such as the heart and the reason field. */
  children?: ReactNode;
}

/** A closer look at one work: the image large, everything the label has room for, and works like it. */
export function Detail({ work, onClose, onNavigate, children }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const similar = useSimilar(onNavigate ? work.id : null);

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

  // Moving to a similar work starts again from the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [work.id]);

  return (
    <div ref={scrollRef} className="detail" role="dialog" aria-modal="true" aria-label={work.title} onClick={onClose}>
      <div className="detail-inner" onClick={event => event.stopPropagation()}>
        <img key={work.id} className="detail-image" src={work.image_url} alt={work.title} />
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

        {onNavigate && similar.length > 0 && (
          <section className="detail-similar" aria-label="Works like this one">
            <h3 className="eyebrow">More like this</h3>
            <div className="similar-row">
              {similar.map(other => (
                <button key={other.id} type="button" className="similar-work" onClick={() => onNavigate(other)} aria-label={other.title}>
                  <img src={other.image_url} alt="" loading="lazy" draggable={false} />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** A closer look with the heart and its reason, for screens where works can be hearted. */
export function HeartableDetail({ work, hearts, onClose, onNavigate }: { work: Artwork; hearts: Hearts; onClose: () => void; onNavigate: (work: Artwork) => void }) {
  const heart = hearts.of(work);
  return (
    <Detail work={work} onClose={onClose} onNavigate={onNavigate}>
      <div className="detail-actions">
        <HeartButton kept={heart !== undefined} title={work.title} onToggle={() => void hearts.toggle(work)} />
        <span>{heart ? 'Hearted' : 'Heart this work'}</span>
      </div>
      {heart && <WhyField key={work.id} saved={heart.why} onSave={why => hearts.saveWhy(work, why)} />}
      {hearts.error && (
        <p className="quiet" role="alert">
          {hearts.error}
        </p>
      )}
    </Detail>
  );
}

/** Works near the given one; empty while loading, when there are none, or when not asked for. */
function useSimilar(artId: string | null): Artwork[] {
  const [found, setFound] = useState<{ artId: string; works: Artwork[] } | null>(null);

  useEffect(() => {
    if (artId === null) return;
    let cancelled = false;
    api.similar(artId).then(
      response => !cancelled && setFound({ artId, works: response.similar }),
      () => !cancelled && setFound({ artId, works: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [artId]);

  return found && found.artId === artId ? found.works : [];
}
