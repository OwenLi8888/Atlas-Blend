import { useEffect, useId, useRef, useState } from 'react';
import { PainterFace } from './PainterFace';
import type { Painter } from './painter';

interface Props {
  /** The person's name, shown at the top of the menu. */
  name: string;
  /** Their painter: its face is their picture. */
  painter: Painter;
  /** Whether the Settings page is the one open. */
  onSettings: boolean;
}

/** The person's picture at the end of the bar; pressing it opens what belongs to them. */
export function ProfileMenu({ name, painter, onSettings }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLAnchorElement>(null);
  const menuId = useId();

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
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('hashchange', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('hashchange', close);
    };
  }, [open]);

  // Opened from the keyboard or not, focus moves into the menu so arrow keys and Tab start there.
  useEffect(() => {
    if (open) firstItem.current?.focus();
  }, [open]);

  return (
    <div
      className="profile-menu"
      ref={root}
      onBlur={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="profile-avatar"
        aria-label={'Your profile, ' + name}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-current={onSettings ? 'page' : undefined}
        onClick={() => setOpen(was => !was)}
      >
        <PainterFace painter={painter} size={38} />
      </button>
      {open && (
        <div className="profile-dropdown" id={menuId} role="menu" aria-label="Your profile">
          <p className="profile-name">{name}</p>
          <a
            ref={firstItem}
            role="menuitem"
            href="#/settings"
            aria-current={onSettings ? 'page' : undefined}
            onClick={() => setOpen(false)}
          >
            Settings
          </a>
        </div>
      )}
    </div>
  );
}
