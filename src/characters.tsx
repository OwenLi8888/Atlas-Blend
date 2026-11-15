/**
 * The painters. This file is the only place characters are defined.
 *
 * TO DROP IN REAL ART: put the files in src/assets/characters/ (PNG or SVG, transparent
 * background, roughly square) and replace an entry below with
 *
 *   import pipUrl from './assets/characters/pip.png';
 *   imageCharacter({ id: 'pip', name: 'Pip', color: '#A6445D', src: pipUrl, brushTip: [0.07, 0.94] }),
 *
 * `brushTip` is where the tip of the brush is in the artwork, as fractions of its width and
 * height from the top-left corner. The studio pins that point to the stroke being painted. Draw
 * the character with the brush on its LEFT: the studio mirrors it when it paints rightwards.
 * Up to 6 characters fit the picker.
 */
import type { ComponentType } from 'react';

export interface Character {
  id: string;
  name: string;
  /** One short line under the name. */
  blurb: string;
  /** Accent used behind the character on its card. */
  color: string;
  /** Tip of the brush in the sprite, as [x, y] fractions from the top-left corner. */
  brushTip: [number, number];
  /** Renders the artwork at 100% of its container. */
  Sprite: ComponentType;
}

export function imageCharacter(c: Omit<Character, 'Sprite' | 'blurb'> & { src: string; blurb?: string }): Character {
  const { src, ...rest } = c;
  return {
    blurb: '',
    ...rest,
    Sprite: () => <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />,
  };
}

// ---- Placeholders: a blob with eyes, a beret and a brush, in palette colours. ----

const NAVY = '#142F40';
const ROSE = '#A6445D';
const TEAL = '#62929E';
const OLIVE = '#393A10';
const IVORY = '#E7DECD';

interface BlobLook {
  body: string;
  beret: string;
  paint: string;
  /** Body ellipse radii, in a 120-unit box. */
  rx: number;
  ry: number;
}

/** Brush tip of every placeholder, in the 120-unit viewBox: (9, 112). */
const PLACEHOLDER_TIP: [number, number] = [9 / 120, 112 / 120];

function BlobPainter({ body, beret, paint, rx, ry }: BlobLook) {
  const cx = 74;
  const cy = 108 - ry; // stands on a common floor line
  const top = cy - ry;
  const light = body === IVORY;
  const silhouette = (
    <>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />
      <ellipse cx={cx + 3} cy={top + 3} rx={rx * 0.72} ry={9} transform={`rotate(-10 ${cx + 3} ${top + 3})`} />
      <path d="M45 77 L21 101 L9 112" fill="none" />
      <path d={`M${cx - rx + 8} ${cy + 8} Q40 ${cy + 16} 39 84`} fill="none" />
    </>
  );
  return (
    <svg viewBox="0 0 120 120" width="100%" height="100%" aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      {/* White sticker edge, so the character reads over any painting. */}
      <g fill="#fff" stroke="#fff" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round">
        {silhouette}
      </g>
      {/* Feet */}
      <ellipse cx={cx - rx * 0.42} cy={108} rx={8} ry={4} fill={NAVY} />
      <ellipse cx={cx + rx * 0.42} cy={108} rx={8} ry={4} fill={NAVY} />
      {/* Body */}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={body} stroke={NAVY} strokeOpacity={light ? 0.35 : 0} strokeWidth={1.5} />
      {/* Eyes, looking at the brush */}
      <ellipse cx={cx - rx * 0.4} cy={cy - ry * 0.22} rx={6.5} ry={7.5} fill="#fff" />
      <ellipse cx={cx + rx * 0.22} cy={cy - ry * 0.22} rx={6.5} ry={7.5} fill="#fff" />
      <circle cx={cx - rx * 0.4 - 2} cy={cy - ry * 0.22 + 2} r={3.2} fill={NAVY} />
      <circle cx={cx + rx * 0.22 - 2} cy={cy - ry * 0.22 + 2} r={3.2} fill={NAVY} />
      <path
        d={`M${cx - rx * 0.26} ${cy + ry * 0.2} q7 6 14 0`}
        fill="none"
        stroke={light ? NAVY : '#fff'}
        strokeOpacity={0.85}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      {/* Beret */}
      <ellipse cx={cx + 3} cy={top + 3} rx={rx * 0.72} ry={9} fill={beret} transform={`rotate(-10 ${cx + 3} ${top + 3})`} />
      <path d={`M${cx + 4} ${top - 5} l3 -6`} stroke={beret} strokeWidth={3} strokeLinecap="round" />
      {/* Brush: handle, ferrule, loaded bristles ending at the tip (9, 112) */}
      <path d="M46 76 L24 98" stroke={OLIVE} strokeWidth={4.5} strokeLinecap="round" />
      <path d="M26 96 L20 102" stroke={IVORY} strokeWidth={6.5} strokeLinecap="butt" />
      <path d="M23.5 98.5 L18.5 103.5 L9 112 L16.5 101.5 Z" fill={paint} stroke={paint} strokeWidth={3} strokeLinejoin="round" />
      {/* Arm and hand, over the handle */}
      <path
        d={`M${cx - rx + 8} ${cy + 8} Q40 ${cy + 16} 39 84`}
        fill="none"
        stroke={body}
        strokeWidth={8}
        strokeLinecap="round"
      />
      <circle cx={39} cy={83} r={6.5} fill={body} stroke={NAVY} strokeOpacity={light ? 0.35 : 0} strokeWidth={1.5} />
    </svg>
  );
}

function placeholder(id: string, name: string, blurb: string, look: BlobLook): Character {
  return { id, name, blurb, color: look.body, brushTip: PLACEHOLDER_TIP, Sprite: () => <BlobPainter {...look} /> };
}

export const characters: Character[] = [
  placeholder('pip', 'Pip', 'Bold and quick', { body: ROSE, beret: NAVY, paint: TEAL, rx: 34, ry: 34 }),
  placeholder('mo', 'Mo', 'Calm and careful', { body: TEAL, beret: ROSE, paint: ROSE, rx: 30, ry: 39 }),
  placeholder('juno', 'Juno', 'Loves the dark bits', { body: NAVY, beret: ROSE, paint: IVORY, rx: 38, ry: 30 }),
  placeholder('fig', 'Fig', 'Never in a hurry', { body: OLIVE, beret: TEAL, paint: ROSE, rx: 33, ry: 37 }),
  placeholder('bea', 'Bea', 'Light on her feet', { body: IVORY, beret: ROSE, paint: NAVY, rx: 36, ry: 32 }),
];
