# Atlas: product spec

Working name. HackPrinceton, Entertainment track. Source: `docs/Restyle PRD and BRD.pdf` plus the
build brief of Nov 14, 2026.

## Problem

Museums are losing visitors, especially repeat visitors, because a permanent collection looks the
same every visit. AAM's 2025 National Snapshot found 55% of US museums had fewer visitors than in
2019, at a median of 81% of pre-pandemic traffic. The share of adults who visit at all has
recovered; how often they come back has not. Small museums are hit hardest.

Atlas gives a museum's same paintings a new experience every visit. A visitor picks a character,
picks one of four featured paintings and watches the character repaint it stroke by stroke in one
of three modern-art styles. Each replay takes about 10 seconds.

## Users

| Who | What they get |
|---|---|
| Museum (buyer), small and mid-sized | A new experience on the same collection, refreshed by swapping the four featured paintings. No acquisitions, no hardware beyond a tablet. |
| Visitor | A fun 10-second reason to stop at a painting and look at it again. |
| Families and kids | A character that paints, which keeps kids at the painting longer. |

It runs in the gallery: on a kiosk tablet, or on a visitor's phone through a QR code beside the
real painting. It is a web app with no install.

## Screens (3 screens, 3 taps)

1. **Choose your painter (home).** Character cards on a clean ivory background. Tap one to select
   it (it bounces once), then Continue. Characters load from `src/characters.tsx`, so final art can
   be dropped in as PNG or SVG. Until the teammate's art lands the app ships 5 placeholder SVG
   characters (blob body, eyes, beret, paintbrush) in palette colors.
2. **Choose a painting.** Four static banner cards, each with the painting image, title, artist,
   year and credit line, read from `public/paintings/paintings.json` and the image files beside it.
   A missing image shows an "Add painting" placeholder card instead of crashing. A small footer
   link opens a hidden **Museum setup** panel where staff can upload an image into any of the four
   slots for demos.
3. **The studio.** A canvas card showing the chosen painting. Nothing is painted until the visitor
   picks a style; then the character paints it stroke by stroke over about 10 seconds. Under the
   canvas is a style menu (a dropdown) of three styles, each with the artist who made it famous:
   **Swirl** (Van Gogh), **Shapes** (Picasso) and **Mosaic** (Antoni Gaudí). Picking a style
   clears the canvas and the character repaints the same painting in that style. Also: Back, a thin progress bar, a status line such as "Pip is painting in Swirl…", and
   three text-only actions: Replay, a press-and-hold Compare that shows the original, and Save
   (the finished painting as a PNG).

## The four paintings

| id | file | Title | Artist | Year | widthMm |
|---|---|---|---|---|---|
| vermeer | `vermeer.jpg` | Girl with a Pearl Earring | Johannes Vermeer | c. 1665 | 240 (portrait) |
| hokusai | `hokusai.jpg` | The Great Wave off Kanagawa | Katsushika Hokusai | c. 1831 | 200 |
| michelangelo | `michelangelo.jpg` | The Creation of Adam | Michelangelo | c. 1512 | 240 (figures) |
| friedrich | `friedrich.jpg` | Wanderer above the Sea of Fog | Caspar David Friedrich | c. 1818 | 200 |

The brief listed Cézanne's *The Basket of Apples* in the second slot; the team supplied Hokusai's
*Great Wave* instead, so that is what ships. Each entry has `id`, `file`, `title`, `artist`,
`year`, `credit` (an editable string) and `widthMm`.

## Features

| ID | Feature | Done when |
|---|---|---|
| M1 | Character picker | Shows up to 6 characters from a config file; selection carries to the studio |
| M2 | Painting picker | Shows the 4 paintings from a config file with title, artist, year, credit |
| M3 | Stroke plan | Each painting's plan is computed once (about 3 s) and cached; bundled paintings ship precomputed |
| M4 | Style player | Any style replays all strokes in 10 s, coarse to fine, at 60 fps on a recent phone |
| M5 | Swirl renderer | Short thick dashes following a swirling flow field, color jitter, dark edges |
| M6 | Shapes renderer | Each stroke becomes a flat angular facet in a reduced palette with a thin navy outline |
| M7 | Mosaic renderer | Irregular broken-tile shards in thick grout, small along contours and large in flat areas, about 24 tile colors, glass gems |
| M8 | Character follows the brush | The character's brush tip sits on the current stroke's point every frame |
| M9 | Compare | Press and hold to see the original painting |
| M10 | Museum setup | Staff add a painting with an image plus a JSON entry; a hidden upload panel works for demos |

Out of scope: accounts, AI image generation, new painting content, app-store builds, the side
features (scrub bar, share image, about card, attract mode).

## Design system

Simple and modern: generous ivory space, one accent, the painting always the largest thing on
screen.

| Token | Hex | Use |
|---|---|---|
| Ivory | `#E7DECD` | Page background, paper |
| Navy | `#142F40` | Text, frames |
| Rose | `#A6445D` | The single accent: selected state, primary button, progress bar |
| Teal | `#62929E` | Secondary chips, hover |
| Olive | `#393A10` | Small labels only |
| White | `#FFFFFF` | Cards and the canvas |

- **Type:** Instrument Serif for titles (falls back to Georgia); Inter or the system sans for the rest.
- **Shape:** 20px card corners, pill chips, 1px navy hairlines at 12% opacity.
- **Motion:** screen transitions slide 24px and fade over 300ms; the selected character bounces once; `prefers-reduced-motion` is respected.
- **Touch:** every target at least 44px.
- **Responsive:** phone portrait first; also works on a landscape tablet kiosk.

## Technical design

**Plan once, replay in any style.** The expensive step (deciding where every stroke goes) runs once
per painting. Each style is a different way of drawing the same stroke list, so switching styles is
instant and the character's path is identical in every style.

- **Plan.** `planImpasto(image, { widthMm })` from the npm package `tryimpasto` (MIT), then
  `strokesToJSON(result.plan)`. Each stroke has `points` ([x, y] in mm from the top-left),
  `widthMm`, `lengthMm`, `contact` (11 width multipliers along the stroke), `color` and `secondary`
  (sRGB 0 to 1), `layer` and `primitive`. Planning takes about 3 s for roughly 1,300 strokes.
  `scripts/precompute-plans.mjs` writes `public/paintings/<id>.plan.json` for every entry in
  paintings.json. The app uses the precomputed plan when it exists and otherwise plans in a Web
  Worker, caching the result per painting. The package's paint simulation (`renderImpasto`) is not
  used: it is too slow.
- **Player.** All strokes are spread over 10 s. Each stroke's duration is weighted by
  sqrt(lengthMm × widthMm), so big early layers take longer and detail is fast: a coarse-to-fine
  reveal. Finished strokes are drawn once onto an offscreen "committed" canvas. Each frame copies
  that canvas and draws the active strokes partially, up to their progress. It uses
  requestAnimationFrame and devicePixelRatio. All randomness is seeded by stroke index, so replays
  are identical.
- **Character.** Each frame the target is the current point of the most recently started stroke,
  mapped to screen pixels. The sprite eases toward it (lerp about 0.25 per frame) with the brush
  tip on the point, flips horizontally with the direction of travel and bobs slightly.
- **Swirl (inspired by Van Gogh).** Along each stroke, short thick dashes (length about 0.8 ×
  width, thickness about 0.25 × width, round caps) in rows across the stroke width. Each dash is
  rotated by a swirl flow field (a few seeded vortex centers per painting plus smooth noise)
  blended with the stroke's own direction. The swirl fades to near zero for the last two detail
  layers so faces keep their own stroke direction. Colors jitter slightly in HSL, some dashes get a
  thin darker edge, the ground is ivory.
- **Shapes (inspired by Picasso's cubism).** Each stroke becomes a straight-edged facet (a skewed
  quadrilateral or triangle spanning the stroke's start, end and width) at an angle snapped to 15°
  steps, filled flat with the stroke color snapped to about 10 colors posterized from the painting,
  with a thin navy outline (`#142F40` at 70%). Larger facets occasionally get hatch lines.
- **Mosaic (a hand-made broken-tile mosaic).** No grid: the canvas is cut once per painting into
  irregular, angular shards, and the layout is kept with the plan's renderer.
  - *Tessellation.* A Voronoi diagram (`d3-delaunay`) over two kinds of seed. Contour seeds run
    along the strokes of the last three (detail) layers, about one tile apart, in one row on the
    path or two rows astride it, so tiles line up along edges and flow around shapes
    ("andamento"). Background seeds are random darts kept only if nothing is closer than the local
    spacing, which runs from about long side / 36 in flat areas down to about long side / 108
    where detail strokes are thickest. About 35% of cells are split in two along a diagonal, every
    corner is nudged by up to 15% of the local tile size, and about 15% of tiles have a corner
    knocked off.
  - *Grout.* The ground is `#A89C86`. Each shard is drawn in from its outline toward its centre
    by about 9% of its size, at least 1.5 device px, so the grout width varies.
  - *Painting.* As each stroke is drawn, strokes in progress included, every shard whose centre
    it covers takes its color; the latest stroke wins, as paint would. Only shards that changed
    are redrawn.
  - *Color and glaze.* Colors snap to about 24 posterized from the painting (saturation lifted
    slightly), then each shard shifts ±5% in lightness and ±4° in hue, seeded by tile index. Each
    has a faint highlight along one edge, and about 20% carry a few sparkle specks.
  - *Glass gems.* Six to ten round gems (radial gradient, white specular dot, soft shadow, tinted
    from the tile they replace) are set only where the canvas is flat all round, and come out one
    by one through the final layer. A painting with no flat areas gets none.
  - *Finish.* When the replay ends a darker line is drawn round every shard for depth.

**Stack.** Vite, React, TypeScript, Canvas 2D, `tryimpasto` for planning only. No backend: static
files, `base: './'`. Everything runs on Windows with only Node installed (no bash, no Python). The
precompute script decodes images in Node with `jpeg-js` and `pngjs` and builds paths with
`node:path`.

## Acceptance criteria

1. Three taps from home to the studio; one pick from the style menu then starts the painting.
2. A style replay starts within 1 s of the tap and finishes in about 10 s.
3. Switching styles mid-paint restarts cleanly with no leftover strokes.
4. The character stays on the brush and never jumps off the canvas.
5. 60 fps on a recent iPhone (checked in a phone-sized viewport at minimum).
6. Vermeer's face is still readable in Swirl. In Mosaic, at phone size it reads as a broken-tile
   mosaic (irregular shards of varied size, visible grout, no grid); tiles get smaller and line up
   along edges so Vermeer's face and the Wanderer's silhouette are recognizable; big flat areas use
   larger random shards.
7. Swapping a painting means editing paintings.json plus one image file, then rerunning the precompute script.
8. `npm run build` passes with no TypeScript errors.
9. Every screen, and every style at 50% and 100% for all four paintings, is screenshotted in a headless browser and reviewed.
