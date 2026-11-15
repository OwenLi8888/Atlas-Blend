import { useEffect, useRef, useState } from 'react';
import { uploadedPainting } from '../paintings';
import type { Painting } from '../types';

interface Props {
  paintings: Painting[];
  onReplace: (index: number, painting: Painting) => void;
  onClose: () => void;
}

/** Staff panel: put an image into any of the four slots for a demo. Uploads last until reload. */
export function MuseumSetup({ paintings, onReplace, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <header className="sheet-head">
          <div>
            <p className="eyebrow">For museum staff</p>
            <h2 id="setup-title">Museum setup</h2>
          </div>
          <button ref={closeRef} type="button" className="btn ghost" onClick={onClose}>
            Done
          </button>
        </header>
        <p className="sheet-note">
          Upload a JPEG or PNG into a slot to try it now. Uploads last until this page is reloaded. To keep a painting,
          add its image to <code>public/paintings/</code>, edit <code>paintings.json</code> and run{' '}
          <code>npm run precompute</code>.
        </p>
        <div className="slot-list">
          {paintings.map((p, i) => (
            <Slot key={p.id} index={i} painting={p} onReplace={onReplace} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Slot({ index, painting, onReplace }: { index: number; painting: Painting; onReplace: Props['onReplace'] }) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [year, setYear] = useState('');
  const [portrait, setPortrait] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError('Use a JPEG, PNG or WebP image.');
      return;
    }
    setError('');
    onReplace(index, uploadedPainting(file, { title, artist, year, credit: 'Uploaded for this session.', portrait }));
    setTitle('');
    setArtist('');
    setYear('');
  };

  return (
    <div className="slot">
      <div className="slot-thumb">
        {painting.missing ? <span className="plus" aria-hidden="true">+</span> : <img src={painting.src} alt="" />}
      </div>
      <div className="slot-body">
        <p className="slot-current">
          <span className="eyebrow">Slot {index + 1}</span>
          {painting.missing ? 'Empty' : `${painting.title}${painting.artist ? `, ${painting.artist}` : ''}`}
        </p>
        <div className="slot-fields">
          <input aria-label={`Slot ${index + 1} title`} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input aria-label={`Slot ${index + 1} artist`} placeholder="Artist" value={artist} onChange={(e) => setArtist(e.target.value)} />
          <input aria-label={`Slot ${index + 1} year`} placeholder="Year" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className="slot-actions">
          <label className="check">
            <input type="checkbox" checked={portrait} onChange={(e) => setPortrait(e.target.checked)} />
            Portrait of a person (finer strokes)
          </label>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button type="button" className="btn secondary" onClick={() => inputRef.current?.click()}>
            Upload image
          </button>
        </div>
        {error && <p className="slot-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
