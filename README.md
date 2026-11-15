# Atlas Blend

Spotify Blend for art. Heart the works you like, get a wall hung for you, then blend with a friend:
a match score, a shared wall, and one new artwork made for the two of you, painted stroke by stroke.

HackPrinceton F26. Spec: [`docs/PRD_gallery_blend.md`](docs/PRD_gallery_blend.md).

## Run it

Needs Node 22 or newer. Two processes: the API and the screens.

```
cd server
npm ci
cp .env.example .env     # fill in TYPESENSE_KEY (and SUPABASE_SECRET_KEY, unless using dev:local)
npm run dev:local        # the API on 127.0.0.1:43871, with a local file in place of Supabase
```

```
npm install
npm run dev              # the screens on http://localhost:5173, with /api passed to the API
```

`npm run build` type-checks and writes the screens to `dist/`. They call the API at `/api` on their
own origin, so a deployment needs both behind one address.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/gallery/` | The screens: onboarding, the gallery and its rooms, Explore, blends, the painted reveal, the studio and the round room |
| `src/rec/` | Request and response types shared with the server, and the taste, recommendation and blend maths |
| `src/engine/`, `src/plan/` | The painting animation: stroke plans made in a Web Worker and the renderers that draw them |
| `src/scene/` | The 3D studio the painters work in |
| `server/` | The API: profiles, hearts, recommendations, blends, the curator and the commissioned piece. See [`server/README.md`](server/README.md) |
| `supabase/` | The database schema and migrations |

## Check it

```
npm run typecheck
cd server && npm test
```
