import './LastHeartDialog.css';
import { useEffect, useRef } from 'react';
import type { LastHeart } from './useHearts';

interface Props {
  ask: LastHeart;
}

/**
 * Asked before someone removes the only work they have saved. Their wall and
 * their blends are made from what they saved, so with nothing left they are
 * taken back to choose again. Escape and a click outside both keep the work.
 */
export function LastHeartDialog({ ask }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    element.showModal();
    return () => element.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="last-heart"
      aria-labelledby="last-heart-title"
      onCancel={event => {
        event.preventDefault();
        ask.keep();
      }}
      onClick={event => {
        // The dialog element itself is only hit on its backdrop: its content fills it.
        if (event.target === dialog.current) ask.keep();
      }}
    >
      <div className="last-heart-body">
        <h2 id="last-heart-title">Remove your last saved work?</h2>
        <p>
          “{ask.work.title}” is the only work you have saved. Your wall and your blends are made from what you save, so
          without it there is nothing to make them from. You will be asked to choose a few works again.
        </p>
        <div className="last-heart-actions">
          <button type="button" className="button" autoFocus onClick={ask.keep}>
            Keep it
          </button>
          <button type="button" className="text-link" onClick={ask.remove}>
            Remove it
          </button>
        </div>
      </div>
    </dialog>
  );
}
