import { useCallback, useEffect, useRef, useState } from 'react';
import type { Artwork, BlendResponse, BridgeHeart, Profile, WallSource } from '../rec/api';
import { Player } from '../engine/player';
import { getPlan } from '../plan/planStore';
import type { StrokePlan } from '../types';
import { api } from './api';
import { Detail } from './Detail';
import { byline, museumName, possessive } from './format';
import { Hung } from './Hung';

interface Props {
  me: Profile;
  blend: BlendResponse;
  onAgain: () => void;
}

/** Physical width the stroke planner works at. Wider means finer strokes and a slower plan. */
const PAINTING_WIDTH_MM = 220;

/**
 * The blend, revealed in a darkened room: the two hearts it grew from on either
 * side, and between them the shared work, painted stroke by stroke.
 */
export function Reveal({ me, blend, onAgain }: Props) {
  const [painted, setPainted] = useState(false);
  const [open, setOpen] = useState<Artwork | null>(null);
  const friend = blend.friend.name.trim() || 'your friend';

  useEffect(() => {
    document.body.classList.add('room');
    window.scrollTo({ top: 0 });
    return () => document.body.classList.remove('room');
  }, []);

  const finish = useCallback(() => setPainted(true), []);
  const closeDetail = useCallback(() => setOpen(null), []);

  const tagFor: Record<WallSource, string> = {
    you: 'Yours',
    friend: possessive(friend),
    both: 'Both of you',
    new: 'New to you both',
  };

  return (
    <main className={'page reveal' + (painted ? ' painted' : '')}>
      <p className="eyebrow reveal-names">
        {me.name || 'You'} <span aria-hidden="true">&amp;</span> {friend}
      </p>

      <div className="reveal-stage">
        <Bridge heart={blend.bridge.a} label="Yours" onOpen={setOpen} />
        <div className="reveal-centre">
          <Painting work={blend.top_artwork} onDone={finish} />
          <div className="reveal-plate" aria-live="polite">
            {painted ? (
              <>
                <h1>{blend.top_artwork.title}</h1>
                <p>
                  {byline(blend.top_artwork)}
                  <br />
                  {museumName(blend.top_artwork.source)}
                </p>
              </>
            ) : (
              <p>Painting where you meet…</p>
            )}
          </div>
        </div>
        <Bridge heart={blend.bridge.b} label={possessive(friend)} onOpen={setOpen} />
      </div>

      <div className="reveal-after">
        <section className="reveal-story">
          <p className="score">
            <strong>{blend.score}</strong>
            <span>percent in common</span>
          </p>
          <p className="story">{blend.story}</p>
        </section>

        <section>
          <h2 className="section-title">The wall you share</h2>
          <div className="salon">
            {blend.wall.map(({ work, from }) => (
              <Hung key={work.id} work={work} tag={tagFor[from]} onOpen={() => setOpen(work)} />
            ))}
          </div>
        </section>

        <button type="button" className="text-link" onClick={onAgain}>
          Blend with someone else
        </button>
      </div>

      {open && <Detail work={open} onClose={closeDetail} />}
    </main>
  );
}

function Bridge({ heart, label, onOpen }: { heart: BridgeHeart; label: string; onOpen: (work: Artwork) => void }) {
  return (
    <div className="bridge">
      <Hung work={heart.work} tag={label} onOpen={() => onOpen(heart.work)} />
      {heart.why && <p className="bridge-why">“{heart.why}”</p>}
    </div>
  );
}

/** Paints one work onto a canvas. Falls back to the plain image if it cannot be planned. */
function Painting({ work, onDone }: { work: Artwork; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [plan, setPlan] = useState<StrokePlan | null>(null);
  const [failed, setFailed] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPlan({
      id: 'blend:' + work.id,
      file: '',
      title: work.title,
      artist: work.artist,
      year: work.date ?? '',
      credit: museumName(work.source),
      widthMm: PAINTING_WIDTH_MM,
      src: api.imageUrl(work.id),
      // Planned in the browser from the image; there is no precomputed plan to fetch.
      uploaded: true,
    }).then(
      result => !cancelled && setPlan(result),
      () => {
        if (cancelled) return;
        setFailed(true);
        onDone();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [work, onDone]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!plan || !canvas) return;
    const player = new Player(canvas, plan, {
      style: 'swirl',
      onDone: () => {
        setFinished(true);
        onDone();
      },
    });
    return () => player.destroy();
  }, [plan, onDone]);

  if (failed) {
    return (
      <div className="painting">
        <img src={work.image_url} alt={work.title} />
      </div>
    );
  }
  return (
    <div className="painting" style={plan ? paintingBox(plan.widthMm / plan.heightMm) : undefined}>
      <canvas ref={canvasRef} role="img" aria-label={work.title + ', being painted'} />
      {/* Once the last stroke is down, the painted version settles into the work itself. */}
      <img className={'painting-original' + (finished ? ' shown' : '')} src={work.image_url} alt="" draggable={false} />
    </div>
  );
}

/** Sizes the painting to its own proportions; `--ratio` lets the stylesheet cap its height. */
function paintingBox(ratio: number): React.CSSProperties {
  return { aspectRatio: String(ratio), ['--ratio' as string]: ratio };
}
