import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Artwork, BlendResponse, Commission, Profile, Trend, WallItem, WallSource } from '../rec/api';
import { Player } from '../engine/player';
import { getPlan } from '../plan/planStore';
import type { StrokePlan } from '../types';
import { api } from './api';
import { Detail, useOverlay } from './Detail';
import { possessive } from './format';
import { revealUrl, thumbnailUrl } from './images';
import { AtlasRoom, type RoomArrival, type RoomItem, type RoomPainter } from './AtlasRoom';
import { friendPainter, painterOf } from './painter';
import { PIECE_KEY, PaintStudio, canOpenStudio, studioPair } from './PaintStudio';

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
/** Frames in the room, as in the gallery room on main: twelve keeps each work large. A full room goes all the way round. */
const ROOM_FRAMES = 12;
/** How often to ask whether the piece being made is ready. */
const COMMISSION_POLL_MS = 1000;

/** What gets painted in the frame straight ahead. */
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
 * A blend, as one round room. The piece made for the two people hangs straight
 * ahead, the works they share hang around it, and their two painters stand on
 * the floor. A new blend is painted in its frame, stroke by stroke: first the
 * collection work the two already meet at, then the new piece when it arrives.
 * A saved blend opens with everything already hung.
 */
export function Reveal({ me, blend, revisit }: Props) {
  const commission = useCommission(blend);
  const [open, setOpen] = useState<Artwork | null>(null);
  const [pieceOpen, setPieceOpen] = useState(false);
  /** Which canvas has had its last stroke: the plan ID of the work in front once it is painted. */
  const [paintedId, setPaintedId] = useState<string | null>(null);
  const friend = blend.friend.name.trim() || 'your friend';
  const meeting = blend.top_artwork;
  /**
   * A new blend opens in the studio, where the three paintings are painted, and the room follows
   * with them hung. `none`: there is no studio (a saved blend, or a browser that cannot draw it),
   * and a new blend is painted in the room's own frame instead.
   */
  const [studio, setStudio] = useState<'open' | 'closed' | 'none'>(() => (!revisit && canOpenStudio() ? 'open' : 'none'));
  /** The canvases painted in the studio and where each stood on screen, for their flight into the room. */
  const [arrivals, setArrivals] = useState<readonly RoomArrival[]>([]);
  const leaveStudio = useCallback((painted: readonly RoomArrival[]) => {
    setArrivals(painted);
    setStudio('closed');
  }, []);
  /** Everything is already painted when the room opens. */
  const hung = revisit || studio !== 'none';

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  const closeDetail = useCallback(() => setOpen(null), []);
  const closePiece = useCallback(() => setPieceOpen(false), []);

  const made = commission.status === 'ready' && commission.image_url !== null;
  const making = commission.status === 'pending';
  /** No piece is coming: the work the two already meet at stays in front, and says what the piece would have. */
  const noPiece = !made && !making;
  const subject = subjectOf(blend, commission);
  const subjectId = subject.planId;
  const finishPainting = useCallback(() => setPaintedId(subjectId), [subjectId]);
  // The room keeps facing the front until the last canvas there is painted: nothing more is coming.
  const still = !hung && (making || paintedId !== subjectId);
  const { plan } = usePlan(hung ? null : subject);
  // The canvas being painted, in place of a picture, once its strokes are worked out.
  const canvas = plan ? (
    <Painting key={subject.planId} plan={plan} settled={subject.settled} label={subject.label} onDone={finishPainting} />
  ) : undefined;
  const canvasAspect = plan ? plan.widthMm / plan.heightMm : undefined;

  const tagFor: Record<WallSource, string> = {
    you: 'Yours',
    friend: possessive(friend),
    both: 'Both of you',
    new: 'New to you both',
  };
  // The piece's own story once it is written; the plain summary if it could not be; nothing while it is being written.
  const story = commission.label?.story ?? (commission.label_status === 'pending' ? null : blend.story);
  const pieceTitle = commission.title ?? 'Your piece';

  // Each person's painter is the one on their profile.
  const mine = painterOf(me);
  const friendPainterInRoom: RoomPainter = friendPainter(blend.friend, mine.painter);

  // The two works that hang either side of the front frame: one from each person's side. A new
  // blend paints these two in the studio, on the easels either side of the piece.
  const pair = useMemo(() => studioPair(blend.wall), [blend.wall]);
  const works = new Map<string, Artwork>([[meeting.id, meeting], ...blend.wall.map(({ work }): [string, Artwork] => [work.id, work])]);
  const wallItem = ({ work, from }: WallItem): RoomItem => ({
    key: work.id,
    imageUrl: thumbnailUrl(work.id),
    title: work.title,
    style: tagFor[from],
    credit: work.artist,
    isNew: false,
  });
  const meetingItem: RoomItem = {
    key: meeting.id,
    imageUrl: thumbnailUrl(meeting.id),
    title: meeting.title,
    style: 'Where you already meet',
    credit: meeting.artist,
    // Until the new piece arrives, this is the work the room is lit for.
    isNew: !made,
    content: made ? undefined : canvas,
    aspect: made ? undefined : canvasAspect,
  };
  // In front: the piece made for the two of them, or the work they already meet at until it arrives.
  // Whichever is in front is the one being painted, when the room does its own painting. The piece
  // is signed by the two painters; a collection work keeps its artist, wherever it hangs.
  const lead: RoomItem =
    made && commission.image_url
      ? {
          key: PIECE_KEY,
          imageUrl: commission.image_url,
          title: pieceTitle,
          style: 'Made for you both',
          credit: 'by ' + mine.name + ' & ' + friendPainterInRoom.name,
          isNew: true,
          content: canvas,
          aspect: canvasAspect,
        }
      : meetingItem;
  const others = [...(lead === meetingItem ? [] : [meetingItem]), ...blend.wall.filter(item => item !== pair.mine && item !== pair.theirs).map(wallItem)];
  const items = hangRoom(lead, pair.mine && wallItem(pair.mine), pair.theirs && wallItem(pair.theirs), others).map(item => {
    // A canvas flying in from the studio lands as the same picture, in a frame already its shape.
    const arrival = arrivals.find(({ key }) => key === item.key);
    return arrival ? { ...item, imageUrl: arrival.src, aspect: item.aspect ?? arrival.from.width / arrival.from.height } : item;
  });

  if (studio === 'open') {
    return <PaintStudio blend={blend} commission={commission} pair={pair} painter={mine} friendPainter={friendPainterInRoom} friend={friend} onDone={leaveStudio} />;
  }

  return (
    <main>
      <AtlasRoom
        items={items}
        painters={[mine, friendPainterInRoom]}
        eyebrow={(me.name || 'You') + ' & ' + friend + ' · ' + blend.score + '% taste match'}
        lede={making ? 'A new piece is being made for you both…' : 'Drag to look around. Tap a painting to see it up close.'}
        paused={open !== null || pieceOpen}
        still={still}
        arrivals={arrivals}
        onOpen={item => {
          if (item.key === PIECE_KEY) setPieceOpen(true);
          else setOpen(works.get(item.key) ?? null);
        }}
      />

      {open && (
        <Detail work={open} onClose={closeDetail}>
          {noPiece && open.id === meeting.id && (
            <div className="blend-account">
              <p className="eyebrow">Where you already meet · {blend.score}% taste match</p>
              <p className="piece-story">{blend.story}</p>
              <BlendLeanings trends={blend.trends} friend={friend} onOpen={setOpen} />
            </div>
          )}
        </Detail>
      )}
      {pieceOpen && made && commission.image_url && (
        <PieceDetail
          imageUrl={commission.image_url}
          title={pieceTitle}
          story={story}
          score={blend.score}
          trends={blend.trends}
          friend={friend}
          onClose={closePiece}
          onOpenWork={work => {
            setPieceOpen(false);
            setOpen(work);
          }}
        />
      )}
    </main>
  );
}

/**
 * The order the room is hung in. Frames go round to the right from the one in front, so in a full
 * room the last frame is the one just left of it: `left` and `right` then hang either side of
 * `lead`, as on the easels. A room with frames to spare has nothing on the left, and both follow `lead`.
 */
function hangRoom(lead: RoomItem, left: RoomItem | undefined, right: RoomItem | undefined, others: readonly RoomItem[]): RoomItem[] {
  const flanks = [right, left].filter((item): item is RoomItem => item !== undefined);
  const middle = others.slice(0, ROOM_FRAMES - 1 - flanks.length);
  const full = 1 + flanks.length + middle.length === ROOM_FRAMES;
  if (!left || !full) return [lead, ...flanks, ...middle];
  return [lead, ...(right ? [right] : []), ...middle, left];
}

interface PieceDetailProps {
  imageUrl: string;
  title: string;
  /** Null while the story is still being written. */
  story: string | null;
  score: number;
  trends: BlendResponse['trends'];
  friend: string;
  onClose: () => void;
  onOpenWork: (work: Artwork) => void;
}

/** A closer look at the piece made for the two people: its story, and what each of them leans toward. */
function PieceDetail({ imageUrl, title, story, score, trends, friend, onClose, onOpenWork }: PieceDetailProps) {
  const closeRef = useOverlay(onClose);
  return (
    <div className="detail" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="detail-inner" onClick={event => event.stopPropagation()}>
        <img className="detail-image" src={imageUrl} alt={title} />
        <div className="detail-text">
          <button ref={closeRef} type="button" className="text-link detail-close" onClick={onClose}>
            Close
          </button>
          <h2 className="detail-title">{title}</h2>
          <p className="detail-byline">Made for you both · {score}% taste match</p>
          <p className="piece-story">{story ?? 'Its story is still being written…'}</p>
          <BlendLeanings trends={trends} friend={friend} onOpen={onOpenWork} />
        </div>
      </div>
    </div>
  );
}

/** What each of the two people leans toward, side by side. */
function BlendLeanings({ trends, friend, onOpen }: { trends: BlendResponse['trends']; friend: string; onOpen: (work: Artwork) => void }) {
  return (
    <div className="piece-leanings">
      <Leanings label="You lean toward" trends={trends.you} onOpen={onOpen} />
      <Leanings label={friend + ' leans toward'} trends={trends.friend} onOpen={onOpen} />
    </div>
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
