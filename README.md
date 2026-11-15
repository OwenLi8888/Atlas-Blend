# Atlas

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

## Photo picks (two people, two devices)

After choosing a painter, each person picks the 5 pictures that speak to them out of 25. Both
devices open the same link with a different `user`:

```
http://<your-laptop-ip>:5173/?session=abc123&user=1
http://<your-laptop-ip>:5173/?session=abc123&user=2
```

Opening the app without `session` makes a new one and puts it in the address bar. The session id
seeds a shuffle of the 100 pool photos: user 1 gets the first 25 and user 2 the next 25, so the two
never see the same picture, and a refresh shows the same 25 with the picks made so far.

- Photos: `public/pool/photos/p001.jpg` to `p100.jpg`, thumbnails in `public/pool/thumbs/`, the index
  in `public/pool/pool.json`, original file names in `public/pool/pool-map.json`. After changing the
  photos run `npm run build-pool`.
- Saved picks: `data/runtime/picks.json`, written by the `/api/picks` endpoint that `npm run dev` and
  `npm run preview` serve (`server/picksApi.mjs`). A plain static host has no endpoint, so there the
  picks stay on each device.
- In code, everything goes through `src/picks/picksStore.ts`: `savePicks`, `getPicks(sessionId, user)`
  and `getSessionPicks(sessionId)`, which returns both records:

```json
{ "sessionId": "abc123", "user": 1, "characterId": "ember", "shown": ["p017", "…25 ids"], "picks": ["p042", "p003", "p091", "p066", "p010"], "pickedAt": "2026-11-15T05:48:19.456Z" }
```

## The gallery room (last screen)

When the painter has finished, it offers to hang the painting ("Hang it up", or 10 s without a tap)
and the painting flies into a round gallery of 12 framed canvases. `?view=gallery` opens the room
directly: `http://localhost:5173/?session=abc123&user=1&view=gallery`.

- From the painting page: `PaintRoom` calls its `onPaintingComplete(painting | null)` prop. That is
  the whole interface; `src/gallery/HangItUp.tsx` and `src/App.tsx` do the rest.
- The painting the room hangs: `getFinalPainting(sessionId)` in `src/gallery/galleryData.ts`. Today
  it is what this device finished (kept in localStorage), else `public/gallery/placeholder.jpg`.
- The pictures around it: 11 of the 100 pool photos (`public/pool/`), chosen by the session id, so
  both devices see the same wall and each session a different one (`loadWall` in the same file).
  Only if the pool cannot be loaded do the stand-ins in `public/gallery/samples/` hang there.
- A painter's own line after the high five: `galleryLine` in `src/characters.tsx`.
- Check it: with `npm run dev -- --port 5199` running, `node scripts/gallery-shots.mjs` plays the
  whole flow at 1440 and 390 wide, checks the layout and saves `screenshots/gallery-*.png`.

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
npm run precompute -- hokusai   # just one id
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
