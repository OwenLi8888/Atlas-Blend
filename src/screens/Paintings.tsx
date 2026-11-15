import type { Painting } from '../types';

interface Props {
  /** null while paintings.json is loading. */
  paintings: Painting[] | null;
  onPick: (index: number) => void;
  onBack: () => void;
  /** An image failed to load: the slot becomes an "Add painting" card. */
  onMissing: (index: number) => void;
  onOpenSetup: () => void;
}

/** Screen 2: choose one of the four featured paintings. */
export function Paintings({ paintings, onPick, onBack, onMissing, onOpenSetup }: Props) {
  return (
    <main className="page paintings">
      <header className="page-head">
        <button type="button" className="btn ghost back" onClick={onBack}>
          <span aria-hidden="true">←</span> Back
        </button>
        <h1>Choose a painting</h1>
        <p className="lede">Four works from this gallery.</p>
      </header>

      <div className="painting-grid">
        {(paintings ?? []).map((p, i) =>
          p.missing ? (
            <button key={p.id} type="button" className="painting-card empty" onClick={onOpenSetup}>
              <span className="painting-image">
                <span className="plus" aria-hidden="true">+</span>
              </span>
              <span className="painting-text">
                <span className="painting-title">Add painting</span>
                <span className="painting-meta">This slot is empty. Open Museum setup to fill it.</span>
              </span>
            </button>
          ) : (
            <button key={p.id} type="button" className="painting-card" onClick={() => onPick(i)}>
              <span className="painting-image">
                <img src={p.src} alt="" draggable={false} onError={() => onMissing(i)} />
              </span>
              <span className="painting-text">
                <span className="painting-title">{p.title}</span>
                <span className="painting-meta">{[p.artist, p.year].filter(Boolean).join(', ')}</span>
                {p.credit && <span className="painting-credit">{p.credit}</span>}
              </span>
            </button>
          ),
        )}
      </div>

      <footer className="quiet-foot">
        <button type="button" className="link" onClick={onOpenSetup}>
          Museum setup
        </button>
      </footer>
    </main>
  );
}
