import type { Character } from '../characters';

interface Props {
  characters: Character[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onContinue: () => void;
}

/** Screen 1: choose your painter. */
export function Home({ characters, selectedId, onSelect, onContinue }: Props) {
  const shown = characters.slice(0, 6);
  return (
    <main className="page home">
      <header className="page-head">
        <p className="eyebrow">Atlas</p>
        <h1>Choose your painter</h1>
        <p className="lede">They will repaint a painting from this gallery while you watch.</p>
      </header>

      <div className="character-grid" role="radiogroup" aria-label="Painters">
        {shown.map((c) => {
          const selected = c.id === selectedId;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`character-card${selected ? ' selected' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              <span className="character-art" style={{ ['--tint' as string]: c.color }}>
                {/* Remounts on selection, which replays the single bounce. */}
                <span key={selected ? 'on' : 'off'} className={selected ? 'bounce' : undefined}>
                  <c.Sprite />
                </span>
              </span>
              <span className="character-name">{c.name}</span>
              {c.blurb && <span className="character-blurb">{c.blurb}</span>}
            </button>
          );
        })}
      </div>

      <div className="page-foot">
        <button type="button" className="btn primary" disabled={!selectedId} onClick={onContinue}>
          Continue
        </button>
      </div>
    </main>
  );
}
