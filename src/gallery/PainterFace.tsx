import type { ReactNode } from 'react';
import type { PainterId } from '../rec/api';
import type { Painter } from './painter';

const INK = '#1c1b18';

interface Face {
  /** The colour of the eyes and smile: whichever reads on the painter's own colour. */
  ink: string;
  /** Centres of the two eyes. */
  eyes: { left: number; right: number; y: number; radius: number };
  /** The smile: where it sits and how far it reaches either side of the middle. */
  smile: { y: number; reach: number };
  /** A line around a body too pale to stand out from the wall. */
  outline?: string;
  /** What the painter wears on its head, drawn behind the body, in place of the curl when `curl` is false. */
  crown?: ReactNode;
  curl: boolean;
  /** What it wears on its face or body, drawn last. */
  wears?: ReactNode;
}

const EYES = { left: 18, right: 30, y: 30, radius: 1.8 };
const SMILE = { y: 35, reach: 4.5 };

/** Each painter keeps its colour and the one thing it is known by; everything else is the same drop. */
const FACES: Record<PainterId, Face> = {
  ember: {
    ink: INK,
    eyes: EYES,
    smile: SMILE,
    curl: false,
    crown: <path d="M24 1c5 4 6 8 3 12h-7c-3-4-1-6 1-9 .5 2 1.5 2 3-3z" fill="#FFA63D" />,
  },
  sunny: {
    ink: INK,
    eyes: EYES,
    smile: SMILE,
    curl: true,
    crown: <ellipse cx="24" cy="6" rx="9" ry="2.6" fill="none" stroke="#D99A00" strokeWidth="1.6" />,
  },
  pop: {
    ink: INK,
    eyes: EYES,
    smile: SMILE,
    curl: true,
    crown: <path d="M35 3l1.3 3.2L39.5 7.5l-3.2 1.3L35 12l-1.3-3.2L30.5 7.5l3.2-1.3z" fill="#E2337F" />,
  },
  // The glasses sit high and the smile short and low, so the two never meet.
  dot: {
    ink: '#ffffff',
    eyes: { left: 18.5, right: 29.5, y: 27.5, radius: 1.5 },
    smile: { y: 36.5, reach: 3 },
    curl: true,
    wears: (
      <g fill="none" stroke="#ffffff" strokeWidth="1.2">
        <circle cx="18.5" cy="27.5" r="3.6" />
        <circle cx="29.5" cy="27.5" r="3.6" />
        <path d="M22.1 27.5h3.8" />
      </g>
    ),
  },
  hue: {
    ink: INK,
    eyes: EYES,
    smile: { y: 33.5, reach: 4.5 },
    curl: true,
    wears: (
      <g fill="none" strokeWidth="3.2" strokeLinecap="round">
        <path d="M9.5 38.5q14.5 6 29 0" stroke="#FFC62E" />
        <path d="M33 40v5" stroke="#E2337F" />
      </g>
    ),
  },
  ivory: {
    ink: INK,
    eyes: { ...EYES, y: 28.5 },
    smile: { y: 36, reach: 4.5 },
    outline: 'rgba(28, 27, 24, 0.3)',
    curl: true,
    wears: <circle cx="30" cy="28.5" r="3.8" fill="none" stroke="#C99A2E" strokeWidth="1.2" />,
  },
};

interface Props {
  painter: Painter;
  /** Width and height in CSS pixels. */
  size: number;
}

/** A painter as a flat picture: its drop of colour, two eyes and a line for a smile. Decorative; label what holds it. */
export function PainterFace({ painter, size }: Props) {
  const face = FACES[painter.id];
  const { eyes, smile } = face;
  return (
    <svg className="painter-face" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {face.crown}
      {face.curl && (
        <path
          d="M24.5 9c-.5-5.5-8.5-5-7-.5"
          fill="none"
          stroke={face.outline ? '#D9D0BD' : painter.color}
          strokeWidth="3"
          strokeLinecap="round"
        />
      )}
      <path
        d="M24 7C20 15 8 22 8 32c0 9 7 12 16 12s16-3 16-12C40 22 28 15 24 7z"
        fill={painter.color}
        stroke={face.outline}
        strokeWidth={face.outline ? 1 : undefined}
      />
      <circle cx={eyes.left} cy={eyes.y} r={eyes.radius} fill={face.ink} />
      <circle cx={eyes.right} cy={eyes.y} r={eyes.radius} fill={face.ink} />
      <path
        d={`M${24 - smile.reach} ${smile.y}q${smile.reach} ${smile.reach * 0.8} ${smile.reach * 2} 0`}
        fill="none"
        stroke={face.ink}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {face.wears}
    </svg>
  );
}
