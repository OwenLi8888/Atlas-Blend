# Gallery API

The backend for Gallery Blend: profiles, hearts, recommendations and blends.

## Run it

Node 22 or newer. From this directory:

```bash
npm ci
cp .env.example .env   # then fill in TYPESENSE_KEY and SUPABASE_SECRET_KEY
npm run dev
```

To run without Supabase, use `npm run dev:local` instead. Profiles, hearts and blends are then kept in one local file (`server/.data/local-db.json`, git-ignored), so they survive restarts. It needs only the Typesense values in `.env`.

With Supabase, run `supabase/migrations/001_blend_result.sql` once in the SQL editor. It adds the column that lets a saved blend be reopened; without it blends still work but are not listed afterwards.

The API listens on `127.0.0.1:43871`. The screens are at `/gallery.html` on the Vite dev server. Run the normal Vite dev server from the repo root; its `/api` proxy forwards here. For deployment, put a same-origin `/api` reverse proxy in front of it (the Vite proxy only exists in development).

**Startup.** The server loads the whole art catalog into memory before it accepts requests. The first start reads it from Typesense (about 15 seconds) and saves a copy in `server/.cache/` (git-ignored, about 36 MB). Every later start reads that copy in under 2 seconds, and still works if Typesense is unreachable. The copy is rebuilt automatically when works are added or removed, or when the families stored in Typesense change; delete `server/.cache/` to force a rebuild.

## How it works

| File | What it holds |
| --- | --- |
| `../src/rec/api.ts` | Request and response types, shared with the frontend |
| `../src/rec/scoring.ts` | Taste, recommendation and blend maths (pure functions, no I/O) |
| `catalog.ts` | Loads the catalog from Typesense or the local cache; trims and names it; picks the onboarding tiles |
| `families.ts` | The visual families: assigning works to them and their display names |
| `families.json` | Which works make up each family (written by `npm run recluster`) |
| `recluster.ts` | Regroups the works into families |
| `db.ts` | Profiles, hearts and blends in Supabase |
| `memory-db.ts` | The same contract in memory, for tests and `dev:local` |
| `commission.ts` | Makes the new piece for each blend in the background |
| `atelier.ts` | The deep agent that writes its brief and wall label |
| `curator.ts` | The deep agent that keeps notes on each person and hangs their rooms |
| `collection.ts` | How the curator searches the catalog: by words and by likeness |
| `gemini.ts` | The Gemini image model behind it |
| `demo.ts` | The ready-made demo profile |
| `app.ts` | The routes |

At 6,757 works the collection is about 30 MB of vectors, so every request is scored exactly against all of it in memory. A recommendation wall takes about 0.1 s and a blend about 0.2 s. Typesense is only used to fill the cache.

**Curation.** Monochrome works on paper (pencil, ink, etching and the like, about one work in six) are left out when the catalog loads, because they read as pale sketches on a wall of paintings. So are all but two of the 45 carriage design drawings: alike as they are, together they formed a family of their own and took an onboarding tile. The cache keeps the full collection, so the rule in `catalog.ts` can change without refetching.

**Visual families.** The works on the walls are grouped into 31 families. They drive the onboarding tiles (one typical work per family), the order of Explore (families take turns) and the family names in leanings and the closer look; recommendations, blends and the curator do not use them. The groups are made by `npm run recluster` and saved in `families.json`, so they are reviewed and committed like code. The script runs k-means on the image vectors after subtracting the collection average (without that, every family average looks about 95% alike, and large groups swallow small ones). It then merges families whose averages are at least 0.78 alike, unless the merged family would hold more than 7% of the collection. Works added since the last recluster join the family they are most like when the server starts. Each name in `families.ts` is tied to one typical artwork, not to a family number, so a recluster cannot attach a name to the wrong family; the script lists any family left without a name. A work that hardly resembles its family (under 0.25 likeness to the family's average, about 1% of works, such as a Belle Époque poster among prints) stays in the family but is shown without its name.

**Taste.** A person's newest 300 hearts are grouped into at most twelve tastes, so a heart is not folded into a taste it does not resemble. A blend names each person's three largest as their leanings; scoring uses all of them. Each taste is represented by the heart at its centre (its medoid), not by an average: averaged vectors drift toward the middle of the whole collection, which made any two people look about 93% alike. Hearts with similarity of 0.77 or more count as the same taste.

**Recommendations.** The 12 slots are shared between tastes by the square root of their share of the hearts, so a small taste still gets room (each taste keeps at least one slot). Tastes take turns picking; each pick trades closeness to its taste against sameness with the wall so far, with at most two works per known artist. Closeness stops counting above 0.85, the level of a near copy, so the wall is not the next five prints from the same series. Every recommendation names the heart it is closest to.

**Blend.** The reveal comes from the whole of each person's taste, not from one heart each. Every pairing of one of A's tastes with one of B's scores a work as the lower of its closeness to each, and pairings count by how much of each person's hearts the two tastes hold. (Scoring only the closest pair finds a work in whatever the two already share, which is not a mix.) The reveal is the best-scoring work, or an oil or watercolour among the top 20 when there is one, because those suit the painting animation. The response also carries each person's leanings: the family, share of hearts, a few example hearts and a reason they gave. The story is a short fact-only sentence built from those.

**Shared wall.** Like a shared playlist, it is mostly the two people's own hearts: works both hearted, then three of each person's hearts that the other is closest to, and six new works close to both. Each is tagged `both`, `you`, `friend` or `new`, and they take turns down the wall.

**Commissioned piece.** With `GEMINI_API_KEY` set, every blend also gets a new artwork made for the two people: the centrepiece of the reveal. The blend answers at once with the piece marked `pending`, and the screen polls until the image and its wall label are ready, then paints it. Finished pieces are written to `server/.data/commissions/` (git-ignored), so a saved blend still has its piece after a restart. That folder is on the machine running the server: a piece made on one machine is not there on another. Without a key, or if the image model fails, the reveal paints the collection work instead.

**The atelier (deep agent).** The piece is briefed and labelled by a LangChain `deepagents` agent running on Gemini (`atelier.ts`). Its virtual filesystem starts with each person's taste portrait (`/portraits/you.md`, `/portraits/friend.md`: leanings with shares, a few loved works with captions, and their own words). The lead delegates to three subagents:

- `art-director` writes the painting brief and hands it to the image model at once through a tool, then saves it to `/commission/brief.md`.
- `label-writer` reads the brief and writes `/commission/label.md`: a title and the story of the piece: what the painting shows and what it takes from each person (a medium, a way of making marks, a palette or a subject), woven together.
- `critic` checks it against the brief and the portraits (both people named, each credited only with what their own portrait supports, nothing invented); the writer revises once.

Measured on one run: brief after about 5 s, image ready at about 13 s, label at about 11 s. If the brief has not arrived within 10 s, or the agent fails, the image is painted from a fixed template brief so the piece is still made; a failed label falls back to a plain title. Models: `GEMINI_AGENT_MODEL` (default `gemini-flash-lite-latest`) and `GEMINI_IMAGE_MODEL` (default `gemini-3.1-flash-lite-image`; `gemini-nano-banana-2.1` is slower).

**The curator (deep agent with memory).** Each person has a curator (`curator.ts`), a `deepagents` agent whose filesystem is that person's own folder on disk (`server/.data/curator/<id>/`), so it remembers between runs. It keeps `/memories/taste.md` (its notes on the person, loaded into its prompt every run and rewritten by it) and `/memories/notes.md` (what the person told it, word for word).

- Saving works or leaving a note makes it rehang in the background. It always writes a short portrait. Once eight works are saved it also plans two rooms (`/rooms/plan.md`) and gives each to a `room-maker` subagent at the same time; a room-maker searches the collection by words and by likeness, adds works the person has not saved, orders them and writes the wall text.
- Leaving a note (`POST /api/curator/:id/note`) gets an answer in a few seconds and goes into its notes, which changes the next hanging.
- The atelier reads the curator's notes on both people when it makes a blend's piece.

Measured in one session: a note answered in 3 to 4 s; rooms hung in 10 to 16 s. Nobody waits on a rehang: `GET /api/curator/:id` answers at once with what it has and `status: working`. Search is by words in titles, captions and labels (`collection.ts`), not by meaning.

**Demo profile.** On startup the server makes sure a ready-made profile exists: "Juno", blend code `CANVAS`, with 22 hearts across three leanings (gold-ground screens, hard-edge abstraction, Indian miniatures). Enter `CANVAS` on the blend screen to show a blend without a second person. The name, code and leanings are at the top of `demo.ts`.

**Match score.** Each taste is matched to the other person's closest taste, weighted by share of hearts, in both directions. The raw similarity is rescaled between two anchors measured from the catalog at startup: two unrelated works (about 0.55) and a work next to its nearest neighbour (about 0.85). That 0 to 1 overlap is then lifted onto 50 to 100 and curved, so it reads like a familiar match score: most pairs land between 65 and 95, and a closer pair always scores higher.

**Onboarding.** One tile per visual family (`cluster_id`), and no two tiles alike enough to count as one taste (similarity under 0.77, the same rule that groups hearts), so every pick starts a taste of its own. Families holding under 1.5% of the collection are skipped. Families are added most-different first, up to 30. Each is shown by its most typical work, measured as the families are made (after subtracting the collection average); when that work repeats a tile already shown, the next most typical is tried, ten deep, and a family with none is left out. Today that gives 29 tiles covering 95% of the collection.

**Signing up.** `POST /api/profile` takes the name and the picks together and makes the profile with its first hearts in one step; with fewer than three different known artworks it makes nothing. With Supabase the hearts go in as one insert and the profile is removed again if that insert fails (PostgREST has no transaction across two tables).

## Endpoints

Types for every request and response are in `src/rec/api.ts`. Artworks never include their vector.

| Request | Returns |
| --- | --- |
| `GET /api/health` | `{ok, works}` |
| `POST /api/profile` `{name, picks}` | Signs up: `{profile, hearts}` with a six-letter `blend_code` and the picks hearted (201). 400 with fewer than `min_picks` different works |
| `POST /api/profile/:user_id/picks` `{picks}` | `{profile, hearts}`: someone left with no hearts choosing again, under the same minimum |
| `GET /api/profile/:user_id` | `{profile, hearts}`, hearts newest first with their artwork and reason |
| `GET /api/onboarding` | `{works, min_picks}` |
| `POST /api/heart` `{user_id, art_id, why?}` | `{heart}`. Hearting again without `why` keeps the saved reason |
| `DELETE /api/heart?user_id=&art_id=` | 204 |
| `GET /api/recs/:user_id?count=` | `{works: [{work, because}], taste_count}`. 24 works by default, up to 48. `works` is empty until the person has a heart |
| `GET /api/discover?seed=&offset=&limit=&user_id=` | `{works, next_offset}`: the whole collection as one varied stroll. With `user_id`, every sixth work is one that person is likely to love. Each family is shuffled and the families take turns, so neighbours differ. The seed fixes the order, so paging is stable |
| `GET /api/similar?id=&limit=` | `{work, similar}`: a varied handful of the works nearest to one work |
| `POST /api/blend` `{user_id, code}` | `{id, created_at, friend, score, commission, top_artwork, wall: [{work, from}], trends: {you, friend}, story}` |
| `GET /api/curator/:user_id` | `{status, portrait, rooms: [{title, text, works}], saves_until_rooms}`. Starts a rehang when what the person saved or said has changed |
| `POST /api/curator/:user_id/note` `{text}` | `{reply}`: the curator's answer in a sentence or two |
| `GET /api/blends/:user_id` | `{blends}`: every blend the person made or was blended into, newest first, each with the friend's name, score, title and image |
| `GET /api/blend/:id?user_id=` | A saved blend again, in the same shape as when it was made, from the point of view of whichever of the two people asks |
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

## Performance audit (15 November 2026)

Measured results and limits are in `../docs/performance-audit.json`. The audit uses the real cached catalog and isolated in-memory profiles; it does not change Supabase data. To repeat endpoint measurements, run `npx tsx performance.ts` from this directory. Add `--serve` to keep the isolated API on port 43872, then run `node scripts/audit-ui.mjs` and `node scripts/audit-failures.mjs` from the repo root, one at a time. They use headless Chrome and their own Vite server on port 5178. The UI measurements are development-server measurements, not production Lighthouse scores.

Grid images now use `/api/image?id=…&width=480`; reveal images use `width=1280`. These WebP variants retain the original proportions and are cached in `.cache/images/`. Install server dependencies on the demo host (`npm ci`) for the Sharp image decoder. Conversion concurrency is limited to four, duplicate work is shared, and image downloads have size and time limits. Visiting the onboarding grid before the demo warms its variants. Metadata currently has no image dimensions, so first-visit image layout shifts remain a limitation.

The collection match now starts painting while the commissioned piece is pending. The image and story arrive independently through non-overlapping polls. A coarse 60 mm preview reduces planning latency; the finished painting still settles into the larger image after decoding. Existing deep-agent subagents, filesystem, model choices and timeouts are retained. Reopening a saved blend skips animation.

Reads share in-flight requests. Onboarding is cached for five minutes and recommendations for thirty seconds; mutations invalidate reads before and after saving. Hearts update optimistically and roll back on failure. The explicit “Rehang the wall” action is retained. Saved blend names use one batched database read.

Use `npm run dev:local` deliberately if Supabase is unavailable. There is no automatic switch between databases: switching silently would split profiles and saved blends. Keep the catalog and image cache on the demo host. A failed catalog refresh now retains the previous valid cache.
