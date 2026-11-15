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
  /**
   * What this painter says on the photo-picks screen. Wrap the key phrase in *stars* to highlight
   * it; {n} becomes the number of pictures to pick. Leave it out to use the default line.
   */
  pickLine?: string;
  /**
   * What this painter says in the gallery room after the high five (*stars* highlight). Leave it
   * out to use the default line, "We made this together!".
   */
  galleryLine?: string;
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

// ---- The six painters: oil-paint characters painted for the studio on the first screen. ----
// Art: public/studio/<id>.webp, plus <id>-blink.webp (eyes closed) used by the studio scene.

interface Painter {
  id: string;
  name: string;
  blurb: string;
  /** Paint colour: card accent, the puddle it sits on, its wet edge while it is painted on. */
  color: string;
  /** How much the little hands wave in the studio, 0..1. */
  arms: number;
  /** Its own line on the photo-picks screen (see Character.pickLine). */
  pickLine?: string;
}

const PSST = 'Psst... which *{n} pictures* call to you? Choose wisely, adventurer!';
const TREASURE = "Let's fill your treasure chest! Tap the *{n} pictures* you love most.";

const PAINTERS: Painter[] = [
  { id: 'ember', name: 'Ember', blurb: 'Warm and fiery', color: '#EF5A26', arms: 1 },
  { id: 'sunny', name: 'Sunny', blurb: 'Loves the light', color: '#FFC62E', arms: 0.6, pickLine: TREASURE },
  { id: 'pop', name: 'Pop', blurb: 'Bold, bright colour', color: '#E2337F', arms: 1 },
  { id: 'dot', name: 'Dot', blurb: 'Every last detail', color: '#2F55D8', arms: 0.45, pickLine: PSST },
  { id: 'hue', name: 'Hue', blurb: 'A bit of everything', color: '#1F9E6E', arms: 1, pickLine: TREASURE },
  { id: 'ivory', name: 'Ivory', blurb: 'An old master', color: '#EFE8DA', arms: 0.7, pickLine: PSST },
];

const art = (id: string) => `./studio/${id}.webp`;

export const characters: Character[] = PAINTERS.map((p) =>
  // No brush in this art yet: the studio pins the left hand to the stroke being painted.
  imageCharacter({ id: p.id, name: p.name, blurb: p.blurb, color: p.color, src: art(p.id), brushTip: [0.12, 0.62], pickLine: p.pickLine }),
);

/** The same painters as the first-screen studio scene draws them (paths relative to ./studio/). */
export const studioCast = PAINTERS.map((p) => ({ id: p.id, color: p.color, arms: p.arms, src: `${p.id}.webp`, blink: `${p.id}-blink.webp` }));
