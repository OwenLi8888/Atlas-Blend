import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import '@fontsource/fredoka/latin-600.css';

interface Props {
  /** Who is speaking: shown on the tag pinned to the cloud. */
  name: string;
  /** What they say now. Wrap the key phrase in *stars* to highlight it. */
  line: string;
  /** The longest line this cloud will hold: it is sized for this one, so swapping lines moves nothing. */
  roomFor: string;
}

/** ms per letter, like an RPG dialogue box. */
const LETTER_MS = 30;
/** The first line waits for the cloud to pop in. */
const FIRST_DELAY_MS = 560;

interface Segment {
  text: string;
  hot: boolean;
}

/** "Pick the *5 pictures* now" -> plain and highlighted pieces. */
function parse(line: string): Segment[] {
  return line
    .split('*')
    .map((text, i) => ({ text, hot: i % 2 === 1 }))
    .filter((s) => s.text);
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The painter's speech bubble as a storybook cloud: a scalloped outline drawn to fit the text, a
 * thought-bubble tail towards the painter, a name tag, a few twinkling stars, and the line typed
 * out letter by letter. Tap it while it types to finish the line at once.
 */
export function SpeechCloud({ name, line, roomFor }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number; puff: number } | null>(null);
  const segments = useMemo(() => parse(line), [line]);
  const plain = segments.map((s) => s.text).join('');
  const total = plain.length;

  // ---- The cloud is drawn to the bubble's measured size ----
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // offsetWidth/Height ignore the pop-in transform, so the cloud is drawn at its settled size.
      const next = { w: el.offsetWidth, h: el.offsetHeight, puff: parseFloat(getComputedStyle(el).getPropertyValue('--puff')) || 18 };
      setSize((s) => (s && s.w === next.w && s.h === next.h && s.puff === next.puff ? s : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- Typing ----
  const [typed, setTyped] = useState(() => (reducedMotion() ? total : 0));
  const typedRef = useRef(typed);
  typedRef.current = typed;
  const first = useRef(true);
  useEffect(() => {
    if (reducedMotion()) {
      setTyped(total);
      return;
    }
    setTyped(0);
    typedRef.current = 0;
    let timer = 0;
    const tick = () => {
      if (typedRef.current >= total) return;
      typedRef.current += 1;
      setTyped(typedRef.current);
      timer = window.setTimeout(tick, LETTER_MS);
    };
    timer = window.setTimeout(tick, first.current ? FIRST_DELAY_MS : 80);
    // A new line gives the cloud a little squish (the first one has its pop-in instead).
    if (!first.current) {
      ref.current?.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.05, 0.94)' }, { transform: 'scale(0.98, 1.03)' }, { transform: 'scale(1)' }],
        { duration: 320, easing: 'ease-out' },
      );
    }
    first.current = false;
    return () => window.clearTimeout(timer);
  }, [line, total]);

  const typing = typed < total;
  const finish = () => {
    typedRef.current = total;
    setTyped(total);
  };

  // The visible letters, with the rest of the line kept invisible in place so it wraps the same.
  let budget = typed;
  const letters = segments.map((seg, i) => {
    const shown = seg.text.slice(0, Math.max(0, budget));
    const rest = seg.text.slice(shown.length);
    budget -= seg.text.length;
    const body = (
      <>
        {shown}
        {rest && <span className="untyped">{rest}</span>}
      </>
    );
    return seg.hot ? (
      <span key={i} className={`hot${rest ? '' : ' done'}`}>
        {body}
      </span>
    ) : (
      <span key={i}>{body}</span>
    );
  });

  return (
    <div ref={ref} className={`speech${typing ? ' typing' : ''}`} role="status" onClick={typing ? finish : undefined}>
      {size && <CloudArt {...size} />}
      <span className="speech-tag" aria-hidden="true">
        {name}
      </span>
      <h1>
        <span className="sr-only">
          {name} says: {plain}
        </span>
        <span className="speech-line" aria-hidden="true">
          {letters}
        </span>
        {/* Invisible, in the same cell: holds the cloud open for the longest line. */}
        <span className="speech-room" aria-hidden="true">
          {parse(roomFor).map((s) => s.text).join('')}
        </span>
      </h1>
      {!typing && (
        <span className="speech-next" aria-hidden="true">
          ▼
        </span>
      )}
    </div>
  );
}

// ---- The drawing ----

const circle = (cx: number, cy: number, r: number) => `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;

/**
 * A cloud outline: circles strung along the edges of a rectangle, plus the rectangle itself, all
 * wound the same way so they fill as one shape. Every circle is centred on the rectangle's edge,
 * so the rectangle (where the text goes, see --puff in the CSS) is always inside the cloud.
 */
function cloudPath(w: number, h: number, puff: number): string {
  const inset = puff + 3;
  const x0 = inset;
  const y0 = inset;
  const x1 = Math.max(x0 + 1, w - inset);
  const y1 = Math.max(y0 + 1, h - inset);
  const parts = [`M${x0},${y0}L${x0},${y1}L${x1},${y1}L${x1},${y0}Z`];
  const nx = Math.max(1, Math.ceil((x1 - x0) / (puff * 1.45)));
  const ny = Math.max(1, Math.ceil((y1 - y0) / (puff * 1.45)));
  // Alternate big and small puffs; corners are always big.
  const size = (i: number, n: number, phase: number) => (i === 0 || i === n ? puff : puff * ((i + phase) % 2 ? 0.84 : 1));
  for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx;
    parts.push(circle(x, y0, size(i, nx, 0)), circle(x, y1, size(i, nx, 1)));
  }
  for (let j = 1; j < ny; j++) {
    const y = y0 + ((y1 - y0) * j) / ny;
    parts.push(circle(x0, y, size(j, ny, 1)), circle(x1, y, size(j, ny, 0)));
  }
  return parts.join('');
}

const STAR = 'M0,-1C0.12,-0.3 0.3,-0.12 1,0C0.3,0.12 0.12,0.3 0,1C-0.12,0.3 -0.3,0.12 -1,0C-0.3,-0.12 -0.12,-0.3 0,-1Z';

function CloudArt({ w, h, puff }: { w: number; h: number; puff: number }) {
  const id = useId();
  const d = useMemo(() => cloudPath(w, h, puff), [w, h, puff]);
  const k = puff / 18; // the tail and stars scale with the puffs
  const tailY = Math.min(h - puff, Math.max(puff + 8, h * 0.6));
  const stars = [
    { x: w - 8, y: -5, s: 9, c: 'rose', delay: 0 },
    { x: w + 11 * k, y: h * 0.42, s: 6, c: 'teal', delay: 1.1 },
    { x: w * 0.6, y: -9 * k, s: 5.5, c: 'teal', delay: 2.0 },
    { x: w - 34, y: h + 7 * k, s: 6.5, c: 'rose', delay: 0.6 },
  ];
  return (
    <svg className="speech-cloud" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs>
        <clipPath id={`${id}clip`}>
          <path d={d} />
        </clipPath>
        {/* Top gloss: a band a few px inside the top edge. */}
        <mask id={`${id}gloss`} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
          <path d={d} transform="translate(0 4)" fill="#fff" />
          <path d={d} transform="translate(0 9)" fill="#000" />
        </mask>
        {/* Bottom shade: what the cloud does not cover when it is lifted a few px. */}
        <mask id={`${id}shade`} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
          <rect width={w} height={h} fill="#fff" />
          <path d={d} transform="translate(0 -6)" fill="#000" />
        </mask>
      </defs>

      {/* The tail: three bubbles shrinking towards the painter. */}
      <g className="speech-tail">
        <circle cx={-34 * k} cy={tailY + 17 * k} r={3.6 * k} />
        <circle cx={-22 * k} cy={tailY + 10 * k} r={5.6 * k} />
        <circle cx={-6 * k} cy={tailY} r={8.5 * k} />
      </g>

      <g className="speech-body">
        <path className="outline" d={d} />
        <path className="fill" d={d} />
        <g clipPath={`url(#${id}clip)`}>
          <rect className="shade" width={w} height={h} mask={`url(#${id}shade)`} />
          <rect className="gloss" width={w} height={h} mask={`url(#${id}gloss)`} />
        </g>
      </g>

      {stars.map((s, i) => (
        <g key={i} transform={`translate(${s.x} ${s.y}) scale(${s.s * Math.max(0.85, k)})`}>
          <path className={`speech-star ${s.c}`} d={STAR} style={{ animationDelay: `${s.delay}s` }} />
        </g>
      ))}
    </svg>
  );
}
