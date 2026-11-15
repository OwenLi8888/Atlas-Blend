import './Gallery.css';
import { useEffect, useRef, useState } from 'react';
import type { GalleryScene } from '../scene/galleryScene';

/** One picture hung in the gallery, with its caption. */
export interface GalleryItem {
  src: string;
  /** Width / height, if known. */
  aspect?: number;
  title: string;
  /** Second line: who made it, or who painted it and how. */
  sub: string;
  /** Whose it is: "Yours", "Sam's", "Blend". */
  tag: string;
}

interface Props {
  items: GalleryItem[];
  onBack: () => void;
}

/**
 * Screen 4: the gallery. One long painted wall, in the same look as the studio; swipe (or use the
 * arrows) to walk along it. A first version: one row, a caption for the picture in front.
 */
export function Gallery({ items, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<GalleryScene | null>(null);
  const [index, setIndex] = useState(0);
  const [webgl] = useState(() => !!document.createElement('canvas').getContext('webgl2'));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !webgl || !items.length) return;
    let cancelled = false;
    import('../scene/galleryScene').then(({ createGalleryScene }) => {
      if (cancelled) return;
      sceneRef.current = createGalleryScene(canvas, {
        base: './studio/',
        items: items.map(({ src, aspect }) => ({ src, aspect })),
        onIndex: setIndex,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
    });
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [items, webgl]);

  const item = items[index];

  return (
    <main className="gallery-room">
      {webgl ? (
        <canvas ref={canvasRef} className="gallery-scene" aria-label="The gallery wall. Swipe to walk along it." />
      ) : (
        // Without WebGL: the same pictures as a plain strip that scrolls sideways.
        <ul className="gallery-strip">
          {items.map((it, i) => (
            <li key={i}>
              <img src={it.src} alt={it.title} />
              <span>{it.title}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="gallery-panel">
        <header className="gallery-head">
          <button type="button" className="btn ghost back" onClick={onBack}>
            <span aria-hidden="true">←</span> Back
          </button>
          <div className="gallery-title">
            <h1>Your gallery</h1>
            <p>Swipe to walk along the wall</p>
          </div>
        </header>

        {webgl && item && (
          <footer className="gallery-foot">
            <button type="button" className="gallery-arrow" aria-label="Previous picture" disabled={index === 0} onClick={() => sceneRef.current?.step(-1)}>
              ←
            </button>
            <div className="gallery-caption" aria-live="polite">
              <span className="paint-tag">{item.tag}</span>
              <strong>{item.title}</strong>
              <span className="gallery-sub">{item.sub}</span>
              <span className="gallery-count">
                {index + 1} of {items.length}
              </span>
            </div>
            <button type="button" className="gallery-arrow" aria-label="Next picture" disabled={index === items.length - 1} onClick={() => sceneRef.current?.step(1)}>
              →
            </button>
          </footer>
        )}
      </div>
    </main>
  );
}
