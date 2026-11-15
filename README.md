# Restyle

A museum's same paintings, a new experience every visit. A visitor picks a character, picks one of
four featured paintings and watches the character repaint it stroke by stroke in one of three
styles: **Swirl** (inspired by Van Gogh), **Shapes** (inspired by Picasso's cubism) or **Mosaic**
(a hand-made broken-tile mosaic). It is a static web app for a gallery kiosk tablet or a visitor's phone (QR code beside
the real painting). No install, no backend.

HackPrinceton, Entertainment track. Spec: [`docs/PRD.md`](docs/PRD.md).

## Run it

Needs only Node 22 or newer. Works on Windows, macOS and Linux.

```
npm install
npm run dev        # http://localhost:5173, and on your phone at the Network URL it prints
```

```
npm run build      # type-checks, then writes static files to dist/
npm run preview    # serves dist/
```

`dist/` can be hosted from any folder on any static host (`base` is `./`).

## Swap a painting

1. Put the image in `public/paintings/`. To shrink a large file to a web-sized JPEG:
   `npm run add-painting -- "C:\path\to\image.png" my-id` writes `public/paintings/my-id.jpg`.
2. Edit its entry in `public/paintings/paintings.json`: `id`, `file`, `title`, `artist`, `year`,
   `credit`, `widthMm` (240 for a portrait of a person, 200 otherwise). The first four entries are
   the four slots.
3. Run `npm run precompute`.

For a quick demo without touching files, open **Museum setup** (small link under the painting
list) and upload an image into a slot. Uploads are planned in the browser and last until the page
is reloaded.

## Precompute stroke plans

```
npm run precompute             # every painting in paintings.json
npm run precompute -- monet    # just one id
```

This writes `public/paintings/<id>.plan.json` (the ordered stroke list from `tryimpasto`'s
`planImpasto`). The app loads that file when it exists, so the first paint starts at once. Without
it the app plans the painting in a Web Worker, which takes a few seconds, then caches the result.
Rerun it whenever an image or its `widthMm` changes: a stale plan would paint the old picture.

## Swap the characters

Characters live in one file, [`src/characters.tsx`](src/characters.tsx). The five there now are
placeholder SVGs. To use real art, put PNG or SVG files in `src/assets/characters/` and replace an
entry:

```tsx
import pipUrl from './assets/characters/pip.png';

imageCharacter({ id: 'pip', name: 'Pip', blurb: 'Bold and quick', color: '#A6445D', src: pipUrl, brushTip: [0.07, 0.94] }),
```

`brushTip` is where the tip of the brush is in the artwork, as fractions of its width and height
from the top-left corner; the studio pins that point to the stroke being painted. Draw the
character roughly square, on a transparent background, with the brush on its left (the studio
mirrors it when it paints rightwards). Up to six characters are shown.

## How it works

- `src/plan/`: loads the precomputed plan or plans in a worker (`tryimpasto`, planning only; its
  paint simulation is not used).
- `src/engine/player.ts`: spreads the strokes over 10 s, weighting each by sqrt(length x width) so
  the picture arrives coarse to fine. Finished strokes are drawn once to an offscreen canvas; each
  frame copies it and draws the strokes in progress.
- `src/engine/styles/`: the three renderers (Swirl, Shapes, Mosaic). Mosaic cuts the canvas
  into shards once per painting (`tessellate.ts`, a Voronoi diagram from `d3-delaunay`) and redraws
  only the shards a stroke changes. Each draws the same stroke list its own way, and all
  randomness is seeded by stroke index, so replays are identical.
- `src/screens/`: the three screens and the Museum setup panel.

## Check it

```
npm run build
npm run screenshots            # needs Microsoft Edge or Google Chrome installed
node scripts/contact-sheet.mjs # optional: tiles the screenshots into sheets
```

`npm run screenshots` drives the built app in a headless browser at phone and kiosk sizes, saves
every screen and every style at 50% and 100% for each painting to `screenshots/`, and checks the
acceptance criteria it can measure (three taps, start latency, 10 s duration, frame rate, the
character staying on the brush, clean style switches, the missing-image and missing-plan
fallbacks).
