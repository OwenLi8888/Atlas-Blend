# Blend

Spotify Blend for art. Each person builds a gallery of artworks in a five-round taste quiz. Two
people connect with a join code, the app compares their **whole galleries**, and it paints a new
artwork from both, stroke by stroke, as a video. A side panel, researched by a LangChain
**deepagents** agent, explains what was combined and why the two matched.

HackPrinceton: Entertainment (main track) + LangChain "Best use of deepagents".

```
iPhone app (Expo) ──REST──▶ API server (Node+TS) ◀──▶ Supabase or local JSON store
                               │ job
                               ▼
                         Blend service (Python) ──prompt──▶ image model (optional)
                     variables · CLIP match · groups · merge
                        │ packet            │ still
                        ▼                   ▼
             Research agent (deepagents)   Painting worker (Node)
             subagent per source artwork   stroke plan · brushes · ffmpeg MP4
                        │
                 Art Institute of Chicago API
```

| Folder | What it is |
|---|---|
| `app/` | Expo SDK 58 iPhone app: quiz, globe gallery, gallery card, join code, reveal, side panel |
| `api/` | Node + TypeScript API: sessions, jobs, SSE/polling progress, storage, demo prerender |
| `blend/` | Python blend service: six variables, gallery matching, merge, still + color correction |
| `agent/` | Python research agent on deepagents, grounding validator, deterministic fallback |
| `worker/` | Node painting worker: layered stroke planner, 5 brush sets, MP4 encode |
| `catalog/` | 120 public-domain (CC0) Art Institute of Chicago artworks + 5 quiz rounds |
| `supabase/` | Schema (data model from the PRD) + catalog seed |

## Run it

Needs Node 22 and Python 3.11+. ffmpeg comes from `ffmpeg-static`.

```bash
pip install -r blend/requirements.txt -r agent/requirements.txt
npm install                      # api + worker workspaces
(cd app && npm install)
cp .env.example .env             # every key is optional, see below

npm run prerender -w api         # demo teammate gallery + 3 cached fallback blends
npm run api                      # API on :8787
cd app && npx expo start         # scan the QR with Expo Go on each iPhone (same Wi-Fi)
```

The app finds the API automatically on the laptop running Expo (`EXPO_PUBLIC_API_URL` overrides).
`http://<laptop>:8787/dev/globe` previews the globe gallery in a desktop browser.

**Optional keys** (everything runs without them, and the output says which path ran):

| Key | With it | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | deepagents agent on `claude-opus-5-5` plans, spawns one researcher subagent per source artwork, writes the panel | Deterministic run with the same plan, tools, per-artwork researchers and validator |
| `OPENAI_API_KEY` | Still from an image model given the matched-pair + bridge references | Bridge artwork composited with the matched pair's layout and color |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Postgres tables + public storage bucket (`supabase/schema.sql`) | `data/runtime/db.json` + files served by the API |
| `PAINT_ENGINE` | The team's existing stroke engine, loaded as a package dependency | Built-in layered stroke planner |

## How a blend works

1. **Variables** (`blend/blend/variables.py`): warmth (LAB b* + a*), brightness (L*), saturation
   (LCh chroma), detail (Canny edge density), 12-bin chroma-weighted hue palette, era.
2. **Matching** (`matching.py`): `s_k = 1 - |muA - muB| / R_k` per variable (hue by histogram
   intersection), `score = 100 (0.7 mean(s) + 0.3 min(s))`; CLIP cross-gallery cosine matrix;
   greedy matched pairs (up to 3); k-means (k=3) groups labelled shared or signature.
3. **Merge** (`merge.py`): `t_k = 0.5/0.5` when `s_k >= 0.7`, else weighted toward the tighter
   gallery; nobody leads more than 4 of 6 variables; slerp of the two centroids picks a
   "bridge" artwork from neither gallery; prompt built from the targets.
4. **Still** (`still.py`): image model or fallback, then Reinhard LAB color transfer to the
   targets and re-measure.
5. **In parallel**: the worker paints the still (brush set from the references' dominant
   medium) and the agent researches the source artworks. Both phones follow the same event
   stream; the painting is saved as a gold tile on both spheres.

## Measured against the PRD

| Target | Result |
|---|---|
| Score spread across 10 test pairs of 40+ (`python blend/tune.py`) | 65 points, deterministic, nobody dominates more than 4 variables |
| Still under 20 s, measured variables near targets | 0.8 s (fallback path); warmth/brightness/saturation land within 0.3 of target |
| Paint + encode under 40 s, 10 to 12 s video | 2 to 4 s at 640 px, 10.8 s video |
| Blend tap to video | 2.5 to 4 s on a laptop (cached repeat: instant) |
| Panel dates and mediums traceable | Validator rebuilds them from the catalog and drops any ungrounded year or medium |
| Catalog 80 to 120 public-domain works | 120, CC0, all fields + variables + CLIP embedding |

Not verified here: frame rate on a physical iPhone, the live LLM agent run and the image-model
path (no keys in this environment), and Supabase mode against a real project.

## Demo fallbacks

* "Blend with a demo teammate" in the lobby skips the second phone.
* `npm run prerender -w api` caches three blends; the same pair of galleries replays instantly.
* Set `BLEND_CACHE=off` to force fresh renders.
