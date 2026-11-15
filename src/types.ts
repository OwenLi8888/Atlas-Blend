export type Rgb = [number, number, number];

/** One planned stroke, as written by strokesToJSON (trimmed to the fields the renderers use). */
export interface Stroke {
  layer: number;
  primitive: string;
  /** Path of the stroke centre, mm from the canvas's top-left corner. */
  points: [number, number][];
  widthMm: number;
  lengthMm: number;
  /** 11 width multipliers, start to end. */
  contact: number[];
  /** sRGB, 0 to 1. */
  color: Rgb;
  secondary: Rgb;
}

export interface StrokePlan {
  version: number;
  id: string;
  widthMm: number;
  heightMm: number;
  strokes: Stroke[];
}

/** An entry of public/paintings/paintings.json, plus what the app adds at run time. */
export interface Painting {
  id: string;
  file: string;
  title: string;
  artist: string;
  year: string;
  credit: string;
  widthMm: number;
  /** URL of the image: a file in public/paintings/ or an object URL for an upload. */
  src: string;
  /** Set for images uploaded in Museum setup: planned in the worker, never fetched. */
  uploaded?: boolean;
  /** No entry in paintings.json for this slot, or its image failed to load. */
  missing?: boolean;
}

export type StyleId = 'swirl' | 'shapes' | 'mosaic';

export const STYLES: { id: StyleId; label: string; hint: string }[] = [
  { id: 'swirl', label: 'Swirl', hint: 'Inspired by Van Gogh' },
  { id: 'shapes', label: 'Shapes', hint: "Inspired by Picasso's cubism" },
  { id: 'mosaic', label: 'Mosaic', hint: 'A hand-made broken-tile mosaic' },
];
