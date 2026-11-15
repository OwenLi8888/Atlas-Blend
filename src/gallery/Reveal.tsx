import { useCallback, useEffect, useRef, useState } from 'react';
import type { Artwork, BlendResponse, Commission, Profile, Trend, WallSource } from '../rec/api';
import { Player } from '../engine/player';
import { getPlan } from '../plan/planStore';
import type { StrokePlan } from '../types';
import { api } from './api';
import { revealUrl, thumbnailUrl } from './images';
import { Detail } from './Detail';
import { byline, museumName, possessive } from './format';
import { Hung } from './Hung';

interface Props {
  me: Profile;
  blend: BlendResponse;
  /** True when reopening a saved blend: the finished piece is shown at once, without painting it again. */
  revisit: boolean;
}

/**
 * Physical width the stroke planner works at. Wider means finer strokes and a
 * slower plan. Use a coarse 60 mm plan for prompt playback. The painted
 * version settles into the real image at the end, so fine strokes are not needed.
 */
const PAINTING_WIDTH_MM = 60;
/** How often to ask whether the piece being made is ready. */
const COMMISSION_POLL_MS = 1000;

/** What gets painted in the middle of the room. */
interface Subject {
  /** Names the stroke plan, so one image is only planned once. */
  planId: string;
  /** Same-origin address of the image to paint; the planner has to read its pixels. */
  source: string;
  /** The image the finished painting settles into. */
  settled: string;
  label: string;
}

/**
 * The blend, revealed in a darkened room: what each person leans toward on
 * either side, and between them a new piece made for the two of them, painted
 * stroke by stroke. While it is being made, the room shows the work in the
 * collection they would both stop for. Without an image model, that work is
 * painted as the centrepiece instead.
 */
export function Reveal({ me, blend, revisit }: Props) {
  const commission = useCommission(blend);
  const [painted, setPainted] = useState(revisit);
  const [open, setOpen] = useState<Artwork | null>(null);
  const friend = blend.friend.name.trim() || 'your friend';
  const meeting = blend.top_artwork;

  useEffect(() => {
    document.body.classList.add('room');
    window.scrollTo({ top: 0 });
    return () => document.body.classList.remove('room');
  }, []);

  const finish = useCallback(() => setPainted(true), []);
  const closeDetail = useCallback(() => setOpen(null), []);

  const made = commission.status === 'ready' && commission.image_url !== null;
  const making = commission.status === 'pending';
  const subject = subjectOf(blend, commission);
  useEffect(() => setPainted(revisit), [subject.planId, revisit]);
  const { plan, unplannable } = usePlan(revisit ? null : subject);
  const ready = subject !== null && (revisit || plan !== null || unplannable);

  const tagFor: Record<WallSource, string> = {
    you: 'Yours',
    friend: possessive(friend),
    both: 'Both of you',
    new: 'New to you both',
  };
  // The piece's own story once it is written; the plain summary if it could not be; nothing while it is being written.
  const story = commission.label?.story ?? (commission.label_status === 'pending' ? null : blend.story);

  return (
    <main className={'page reveal' + (painted ? ' painted' : '')}>
      <header className="reveal-head">
        <p className="eyebrow">
          {me.name || 'You'} <span aria-hidden="true">&amp;</span> {friend}
        </p>
        <p className="reveal-match">
          <strong>{blend.score}%</strong> taste match
        </p>
      </header>

      <div className="reveal-stage">
        <Leanings label="You lean toward" trends={blend.trends.you} onOpen={setOpen} />
        <div className="reveal-centre">
          {!ready && (
            <button type="button" className="interlude" onClick={() => setOpen(meeting)} aria-label={'Look closer at ' + meeting.title}>
              <img src={revealUrl(meeting.id)} alt={meeting.title} fetchPriority="high" draggable={false} />
            </button>
          )}
          {ready && subject && !revisit && (
            <Painting key={subject.planId} plan={plan} settled={subject.settled} label={subject.label} onDone={finish} />
          )}
          {ready && subject && revisit && (
            <div className="painting still">
              <img src={subject.settled} alt={subject.label} draggable={false} />
            </div>
          )}

          <div className="reveal-plate" aria-live="polite">
            {making && ready && <p className="making">Your commissioned piece is being made; its story will appear here.</p>}
            {!ready && (making || made) && (
              <>
                <p className="making">{making ? 'A piece is being made for the two of you…' : 'Mixing the paints…'}</p>
                <p>
                  Meanwhile, <em>{meeting.title}</em>: a work you would both stop for.
                </p>
              </>
            )}
            {!ready && !making && !made && <p className="making">Mixing the paints…</p>}
            {ready && !painted && <p>{made ? 'Painting your piece…' : 'Painting where you meet…'}</p>}
            {ready && painted && made && (
              <>
                <h1>{commission.title}</h1>
                <p className="reveal-story">{story ?? <span className="making">Writing its story…</span>}</p>
              </>
            )}
            {ready && painted && !made && (
              <>
                <h1>{meeting.title}</h1>
                <p>
                  {byline(meeting)}
                  <br />
                  {museumName(meeting.source)}
                </p>
                <p className="reveal-story">{blend.story}</p>
              </>
            )}
          </div>
        </div>
        <Leanings label={friend + ' leans toward'} trends={blend.trends.friend} onOpen={setOpen} />
      </div>

      <div className="reveal-after">
        <section>
          <h2 className="section-title">The wall you share</h2>
          <div className="salon">
            {made && <Hung work={meeting} tag="Where you already meet" onOpen={() => setOpen(meeting)} />}
            {blend.wall.map(({ work, from }) => (
              <Hung key={work.id} work={work} tag={tagFor[from]} onOpen={() => setOpen(work)} />
            ))}
          </div>
        </section>

        <a className="text-link" href="#/blends">
          All your blends
        </a>
      </div>

      {open && <Detail work={open} onClose={closeDetail} />}
    </main>
  );
}

/** Paint the collection match immediately while the commissioned piece is being made. */
function subjectOf(blend: BlendResponse, commission: Commission): Subject {
  if (commission.status === 'ready' && commission.image_url) {
    return {
      planId: 'commission:' + blend.id,
      source: commission.image_url,
      settled: commission.image_url,
      label: commission.title ?? 'A piece made for the two of you',
    };
  }
  const work = blend.top_artwork;
  return { planId: 'blend:' + work.id, source: revealUrl(work.id), settled: revealUrl(work.id), label: work.title };
}

/** Follows the piece being made for a blend until both the image and its label have settled. */
function useCommission(blend: BlendResponse): Commission {
  const [commission, setCommission] = useState(blend.commission);
  const settled = commission.status !== 'pending' && commission.label_status !== 'pending';

  useEffect(() => {
    if (settled) return;
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      try {
        const latest = await api.commission(blend.id);
        if (!cancelled) setCommission(latest);
      } catch {
        // The server no longer knows this piece (for example it restarted): reveal the collection work.
        if (!cancelled) setCommission({ status: 'failed', image_url: null, title: null, label_status: 'failed', label: null });
      }
      if (!cancelled) timer = window.setTimeout(poll, COMMISSION_POLL_MS);
    };
    timer = window.setTimeout(poll, COMMISSION_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [settled, blend.id]);

  return commission;
}

/**
 * Works out the strokes for an image, off the main thread. It runs before the
 * canvas is shown, so the room never sits on an empty canvas while it thinks.
 */
function usePlan(subject: Subject | null): { plan: StrokePlan | null; unplannable: boolean } {
  const [state, setState] = useState<{ planId: string; plan: StrokePlan | null; unplannable: boolean } | null>(null);
  const planId = subject?.planId;
  const source = subject?.source;
  const label = subject?.label;

  useEffect(() => {
    if (planId === undefined || source === undefined) return;
    let cancelled = false;
    getPlan({
      id: planId,
      file: '',
      title: label ?? '',
      artist: '',
      year: '',
      credit: '',
      widthMm: PAINTING_WIDTH_MM,
      src: source,
      // Planned in the browser from the image; there is no precomputed plan to fetch.
      uploaded: true,
    }).then(
      plan => !cancelled && setState({ planId, plan, unplannable: false }),
      () => !cancelled && setState({ planId, plan: null, unplannable: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [planId, source, label]);

  if (!state || state.planId !== planId) return { plan: null, unplannable: false };
  return { plan: state.plan, unplannable: state.unplannable };
}

/** One person's taste at a glance: each leaning as its most central heart and the family it belongs to. */
function Leanings({ label, trends, onOpen }: { label: string; trends: readonly Trend[]; onOpen: (work: Artwork) => void }) {
  return (
    <div className="leanings">
      <p className="eyebrow">{label}</p>
      <ul>
        {trends.map(trend => {
          const work = trend.works[0];
          return (
            <li key={work.id}>
              <button type="button" className="leaning" onClick={() => onOpen(work)} aria-label={'Look closer at ' + work.title}>
                <img src={thumbnailUrl(work.id)} alt="" loading="lazy" decoding="async" draggable={false} />
                <span>{trend.family}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface PaintingProps {
  /** The strokes to paint, or null when the image could not be planned and is shown as it is. */
  plan: StrokePlan | null;
  /** The image the finished painting settles into. */
  settled: string;
  label: string;
  onDone: () => void;
}

/** Paints a planned image onto a canvas, stroke by stroke, then lets it settle into the image itself. */
function Painting({ plan, settled, label, onDone }: PaintingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [finished, setFinished] = useState(false);
  const [decoded, setDecoded] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!plan) {
      onDone();
      return;
    }
    if (!canvas) return;
    const player = new Player(canvas, plan, {
      style: 'swirl',
      onDone: () => {
        setFinished(true);
        onDone();
      },
    });
    return () => player.destroy();
  }, [plan, onDone]);

  if (!plan) {
    return (
      <div className="painting">
        <img src={settled} alt={label} />
      </div>
    );
  }
  return (
    <div className="painting" style={paintingBox(plan.widthMm / plan.heightMm)}>
      <canvas ref={canvasRef} role="img" aria-label={label + ', being painted'} />
      <img className={'painting-original' + (finished && decoded ? ' shown' : '')} src={settled} alt="" draggable={false} onLoad={event => { void event.currentTarget.decode().then(() => setDecoded(true), () => {}); }} />
    </div>
  );
}

/** Sizes the painting to its own proportions; `--ratio` lets the stylesheet cap its height. */
function paintingBox(ratio: number): React.CSSProperties {
  return { aspectRatio: String(ratio), ['--ratio' as string]: ratio };
}
