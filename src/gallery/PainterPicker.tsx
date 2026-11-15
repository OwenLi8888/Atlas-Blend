import './PainterPicker.css';
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { PainterFace } from './PainterFace';
import { PAINTERS, type Painter } from './painter';

interface Props {
  /** The painter shown as chosen. */
  painter: Painter;
  onChoose: (painter: Painter) => void;
}

/** The person's painter as a small picture; pressing it opens the six to choose from, just above it. */
export function PainterPicker({ painter, onChoose }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<Map<string, HTMLButtonElement>>(new Map());
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Focus goes to the chosen painter as the choices open, so the arrow keys start from it.
  useEffect(() => {
    if (open) options.current.get(painter.id)?.focus();
    // Only on opening, so `painter` is left out: choosing with the arrow keys moves focus itself.
  }, [open]);

  const step = (event: ReactKeyboardEvent, from: number) => {
    const by =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (by === 0) return;
    event.preventDefault();
    const next = PAINTERS[(from + by + PAINTERS.length) % PAINTERS.length];
    onChoose(next);
    options.current.get(next.id)?.focus();
  };

  return (
    <div
      className="painter-picker"
      ref={root}
      onBlur={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="painter-picker-trigger"
        aria-label={'Your painter, ' + painter.name + '. Choose another'}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen(was => !was)}
      >
        <PainterFace painter={painter} size={36} />
        <svg className="painter-picker-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="painter-popover" id={popoverId}>
          <div className="painter-options" role="radiogroup" aria-label="Your painter">
            {PAINTERS.map((option, index) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                ref={node => {
                  if (node) options.current.set(option.id, node);
                  else options.current.delete(option.id);
                }}
                className="painter-option"
                aria-checked={option.id === painter.id}
                aria-label={option.name}
                tabIndex={option.id === painter.id ? 0 : -1}
                onClick={() => onChoose(option)}
                onKeyDown={event => step(event, index)}
              >
                <PainterFace painter={option} size={36} />
              </button>
            ))}
          </div>
          <p className="painter-popover-name" aria-hidden="true">
            {painter.name}
          </p>
        </div>
      )}
    </div>
  );
}
