# Gallery API

The backend for Gallery Blend: profiles, hearts, recommendations and blends.

## Run it

Node 22 or newer. From this directory:

```bash
npm ci
cp .env.example .env   # then fill in TYPESENSE_KEY and SUPABASE_SECRET_KEY
npm run dev
```

To run without Supabase (profiles and hearts kept in memory until the server stops), use `npm run dev:local` instead. It needs only the Typesense values in `.env`.

The API listens on `127.0.0.1:43871`. The screens are at `/gallery.html` on the Vite dev server. Run the normal Vite dev server from the repo root; its `/api` proxy forwards here. For deployment, put a same-origin `/api` reverse proxy in front of it (the Vite proxy only exists in development).

**Startup.** The server loads the whole art catalog into memory before it accepts requests. The first start reads it from Typesense (about 15 seconds) and saves a copy in `server/.cache/` (git-ignored, about 36 MB). Every later start reads that copy in under 2 seconds, and still works if Typesense is unreachable. The copy is rebuilt automatically when works are added or removed, or when works move between visual families (a recluster); delete `server/.cache/` to force a rebuild.

## How it works

| File | What it holds |
| --- | --- |
| `../src/rec/api.ts` | Request and response types, shared with the frontend |
| `../src/rec/scoring.ts` | Taste, recommendation and blend maths (pure functions, no I/O) |
| `catalog.ts` | Loads the catalog from Typesense or the local cache; trims and names it; picks the onboarding tiles |
| `families.ts` | Display names for the 30 visual families |
| `db.ts` | Profiles, hearts and blends in Supabase |
| `memory-db.ts` | The same contract in memory, for tests and `dev:local` |
| `commission.ts` | Makes the new piece for each blend in the background |
| `atelier.ts` | The deep agent that writes its brief and wall label |
| `gemini.ts` | The Gemini image model behind it |
| `demo.ts` | The ready-made demo profile |
| `app.ts` | The routes |

At 6,674 works the collection is about 30 MB of vectors, so every request is scored exactly against all of it in memory. A recommendation wall takes about 0.1 s and a blend about 0.2 s. Typesense is only used to fill the cache.

**Curation.** Monochrome works on paper (pencil, ink, etching and the like, about one work in six) are left out when the catalog loads, because they read as pale sketches on a wall of paintings. The cache keeps the full collection, so the rule in `catalog.ts` can change without refetching. Each visual family gets its display name from `families.ts`, where every name is tied to one typical artwork, not to a cluster number, so a recluster cannot attach a name to the wrong family.

**Taste.** A person's newest 300 hearts are grouped into at most three tastes. Each taste is represented by the heart at its centre (its medoid), not by an average: averaged vectors drift toward the middle of the whole collection, which made any two people look about 93% alike. Hearts with similarity of 0.77 or more count as the same taste.

**Recommendations.** The 12 slots are shared between tastes by the square root of their share of the hearts, so a small taste still gets room (each taste keeps at least one slot). Tastes take turns picking; each pick trades closeness to its taste against sameness with the wall so far, with at most two works per known artist. Closeness stops counting above 0.85, the level of a near copy, so the wall is not the next five prints from the same series. Every recommendation names the heart it is closest to.

**Blend.** The reveal comes from the whole of each person's taste, not from one heart each. Every pairing of one of A's tastes with one of B's scores a work as the lower of its closeness to each, and pairings count by how much of each person's hearts the two tastes hold. (Scoring only the closest pair finds a work in whatever the two already share, which is not a mix.) The reveal is the best-scoring work, or an oil or watercolour among the top 20 when there is one, because those suit the painting animation. The response also carries each person's leanings: the family, share of hearts, a few example hearts and a reason they gave. The story is a short fact-only sentence built from those.

**Shared wall.** Like a shared playlist, it is mostly the two people's own hearts: works both hearted, then three of each person's hearts that the other is closest to, and six new works close to both. Each is tagged `both`, `you`, `friend` or `new`, and they take turns down the wall.

**Commissioned piece.** With `GEMINI_API_KEY` set, every blend also gets a new artwork made for the two people: the centrepiece of the reveal. The blend answers at once with the piece marked `pending`, and the screen polls until the image and its wall label are ready, then paints it. Finished pieces are held in memory (the newest 40). Without a key, or if the image model fails, the reveal paints the collection work instead.

**The atelier (deep agent).** The piece is briefed and labelled by a LangChain `deepagents` agent running on Gemini (`atelier.ts`). Its virtual filesystem starts with each person's taste portrait (`/portraits/you.md`, `/portraits/friend.md`: leanings with shares, a few loved works with captions, and their own words). The lead delegates to three subagents:

- `art-director` writes the painting brief and hands it to the image model at once through a tool, then saves it to `/commission/brief.md`.
- `label-writer` reads the brief and writes `/commission/label.md`: a title and the story of the piece: what the painting shows and what it takes from each person (a medium, a way of making marks, a palette or a subject), woven together.
- `critic` checks it against the brief and the portraits (both people named, each credited only with what their own portrait supports, nothing invented); the writer revises once.

Measured on one run: brief after about 5 s, image ready at about 13 s, label at about 11 s. If the brief has not arrived within 10 s, or the agent fails, the image is painted from a fixed template brief so the piece is still made; a failed label falls back to a plain title. Models: `GEMINI_AGENT_MODEL` (default `gemini-flash-lite-latest`) and `GEMINI_IMAGE_MODEL` (default `gemini-3.1-flash-lite-image`; `gemini-nano-banana-2.1` is slower).

**Demo profile.** On startup the server makes sure a ready-made profile exists: "Juno", blend code `CANVAS`, with 22 hearts across three leanings (gold-ground screens, hard-edge abstraction, Indian miniatures). Enter `CANVAS` on the blend screen to show a blend without a second person. The name, code and leanings are at the top of `demo.ts`.

**Match score.** Each taste is matched to the other person's closest taste, weighted by share of hearts, in both directions. The raw similarity is rescaled between two anchors measured from the catalog at startup: two unrelated works (about 0.55) and a work next to its nearest neighbour (about 0.85). That 0 to 1 overlap is then lifted onto 50 to 100 and curved, so it reads like a familiar match score: most pairs land between 65 and 95, and a closer pair always scores higher.

**Onboarding.** One tile per visual family (`cluster_id`), shown by the family's most typical work. Families holding under 1.5% of the collection are skipped. Tiles are added most-different first, up to 24, and a family is left out when its tile would nearly duplicate one already shown.

## Endpoints

Types for every request and response are in `src/rec/api.ts`. Artworks never include their vector.

| Request | Returns |
| --- | --- |
| `GET /api/health` | `{ok, works}` |
| `POST /api/profile` `{name}` | The profile, with a six-letter `blend_code` (201) |
| `GET /api/profile/:user_id` | `{profile, hearts}`, hearts newest first with their artwork and reason |
| `GET /api/onboarding` | `{works, min_picks}` |
| `POST /api/heart` `{user_id, art_id, why?}` | `{heart}`. Hearting again without `why` keeps the saved reason |
| `DELETE /api/heart?user_id=&art_id=` | 204 |
| `GET /api/recs/:user_id` | `{works: [{work, because}], taste_count}`. `works` is empty until the person has a heart |
| `POST /api/blend` `{user_id, code}` | `{id, created_at, friend, score, commission, top_artwork, wall: [{work, from}], trends: {you, friend}, story}` |
| `GET /api/blend/:id/commission` | `{status, image_url, title, label_status, label}`; `label` is `{title, story}` once written |
| `GET /api/blend/:id/commission/image` | The finished piece |
| `GET /api/image?id=` | The artwork's image, served from this origin. The image host sends no CORS headers, and the painting animation has to read pixels |

Errors are `{error}` with a 4xx or 5xx status. Missing database tables answer 503 with a pointer to `supabase/schema.sql`.

## Checks

```bash
npm test
```

Unit tests for the scoring, plus every endpoint run against an in-memory database and a small hand-built catalog. No network needed.

```bash
npm run typecheck
```

```bash
npm run smoke
```

Runs the whole flow against live Typesense and the real Supabase project. It creates two temporary profiles and deletes them afterwards. Do not point it at a project holding real data.

## Security

This is a trusted hackathon demo with no authentication. A profile UUID is an identifier, not a credential: anyone who can reach the API and knows a UUID can change that profile's hearts. Keep it local or private. The server uses the Supabase secret key and bypasses RLS on purpose (the schema has no policies), so never put that key in a `VITE_*` variable or send it to the browser. Typesense is plain HTTP and is only ever called from this server.

## Hosting the pages without Vite

`serve.mjs` is the whole app as one Node process with no dependencies: the built pages (`dist/`) and the picks endpoint (`picksApi.mjs`). A host needs only Node 22 and three things copied to it: `dist/`, `server/serve.mjs` and `server/picksApi.mjs`.

```bash
npm run build
node server/serve.mjs
```

It listens on `127.0.0.1:4830`; put a reverse proxy or a tunnel in front of it. Set `GALLERY_API=http://127.0.0.1:43871` to pass the other `/api` paths on to the Gallery API; without it they answer 503 and the studio chooses pictures from the pool. `PORT`, `HOST`, `DIST` and `PICKS_FILE` are listed at the top of the file. The picks file keeps the newest 500 sessions.
