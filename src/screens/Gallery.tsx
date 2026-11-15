import './Gallery.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadWorks } from '../blend/works';
import type { GalleryScene } from '../scene/galleryScene';

/** One picture hung in the gallery, with its caption. */
export interface GalleryItem {
  src: string;
  /** Width / height, if known. */
  aspect?: number;
  title: string;
  /** Second line: who painted it and how. */
  sub: string;
  /** Who it is for: "For you", "For Sam", "Blend". */
  tag: string;
  /** Why this picture was chosen; shown when the picture is tapped. */
  why?: string;
  section: SectionId;
}

/** The parts of the hang, in wall order: the canvas on the easel now, then what this device made alone and with friends. */
const SECTIONS = [
  { id: 'now', title: 'Painting now' },
  { id: 'yours', title: 'Made by you' },
  { id: 'together', title: 'Made with friends' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

interface Props {
  /** Canvases still being painted, as they look at this moment. Finished ones come from the device's saved works. */
  live: GalleryItem[];
  onBack: () => void;
}

/**
 * The gallery: everything this device has painted, on one long white wall. Black and white on
 * purpose, so the paintings carry all the colour. Swipe (or use the arrows) to walk along it, tap
 * the picture in front to read why it was chosen. It opens over the screen it was called from.
 */
export function Gallery({ live, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<GalleryScene | null>(null);
  const [items] = useState<GalleryItem[]>(() => {
    const saved = loadWorks().map((w): GalleryItem => ({ src: w.src, aspect: w.aspect, title: w.title, sub: w.sub, tag: w.tag, why: w.why, section: w.group }));
    const all = [...live, ...saved];
    return SECTIONS.flatMap((s) => all.filter((item) => item.section === s.id));
  });
  const sections = useMemo(
    () => SECTIONS.map((s) => ({ ...s, at: items.findIndex((item) => item.section === s.id) })).filter((s) => s.at >= 0),
    [items],
  );
  const [index, setIndex] = useState(0);
  const [reading, setReading] = useState(false);
  const [webgl] = useState(() => !!document.createElement('canvas').getContext('webgl2'));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !webgl || !items.length) return;
    let cancelled = false;
    import('../scene/galleryScene').then(({ createGalleryScene }) => {
      if (cancelled) return;
      sceneRef.current = createGalleryScene(canvas, {
        items: items.map(({ src, aspect }) => ({ src, aspect })),
        sections: sections.map(({ title, at }) => ({ title, at })),
        onIndex: setIndex,
        onTap: () => setReading((on) => !on),
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
    });
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [items, sections, webgl]);

  useEffect(() => {
    sceneRef.current?.focus(reading);
  }, [reading]);

  const item = items[index];
  const here = item?.section;

  return (
    <main className={`gallery-room${reading ? ' reading' : ''}`}>
      {!items.length ? (
        <div className="gallery-empty">
          <h2>Nothing on the wall yet</h2>
          <p>Every canvas your painter finishes is hung here.</p>
        </div>
      ) : webgl ? (
        <canvas ref={canvasRef} className="gallery-scene" aria-label="The gallery wall. Swipe to walk along it, tap a picture to read about it." />
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
          <div className="gallery-top">
            <button type="button" className="gallery-btn" onClick={onBack}>
              <span aria-hidden="true">←</span> Back
            </button>
            <div className="gallery-title">
              <h1>Your gallery</h1>
              {items.length > 0 && (
                <p>
                  {items.length} {items.length === 1 ? 'painting' : 'paintings'}
                </p>
              )}
            </div>
          </div>
          {webgl && sections.length > 1 && (
            <nav className="gallery-tabs" aria-label="Parts of the gallery">
              {sections.map((s) => (
                <button key={s.id} type="button" className={s.id === here ? 'on' : undefined} aria-current={s.id === here} onClick={() => sceneRef.current?.go(s.at)}>
                  {s.title}
                </button>
              ))}
            </nav>
          )}
        </header>

        {webgl && item && (
          <footer className="gallery-foot">
            <div className="gallery-row">
              <button type="button" className="gallery-arrow" aria-label="Previous painting" disabled={index === 0} onClick={() => sceneRef.current?.step(-1)}>
                ←
              </button>
              <div className="gallery-caption" aria-live="polite">
                <span className="gallery-tag">{item.tag}</span>
                <strong>{item.title}</strong>
                <span className="gallery-sub">{item.sub}</span>
              </div>
              <button type="button" className="gallery-arrow" aria-label="Next painting" disabled={index === items.length - 1} onClick={() => sceneRef.current?.step(1)}>
                →
              </button>
            </div>
            {reading && item.why ? (
              <p className="gallery-why">{item.why}</p>
            ) : (
              <span className="gallery-count">
                {index + 1} of {items.length}
              </span>
            )}
            {item.why && (
              <button type="button" className="gallery-btn" aria-expanded={reading} onClick={() => setReading((on) => !on)}>
                {reading ? 'Close' : 'Why this one?'}
              </button>
            )}
          </footer>
        )}
      </div>
    </main>
  );
}
