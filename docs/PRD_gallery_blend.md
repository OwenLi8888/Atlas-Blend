# Gallery Blend — PRD (HackPrinceton F26)

Submission: Sun Nov 15, 8:30am. Track: Media & Entertainment (+ LangChain Deep Agents).

## One line
Spotify Blend for art. You heart a few artworks, the app learns your visual taste across 42 museum/gallery collections, and when you blend with a friend it finds the one artwork that sits between you two and paints it in front of you.

## Problem
Art discovery apps are feeds (Artsy, Google Arts & Culture, DailyArt). Museums are single collections. Nobody does personal taste across world collections, and nobody makes art discovery social the way Blend made music social.

## Users
- Primary: 18–30, likes art casually, follows aesthetic accounts, goes to museums with friends.
- Demo user: a judge with 30 seconds.

## Core flows

### 1. Onboarding (taste seed)
- Grid of ~20 artworks, one per visual family (cluster centroids from the atlas, so tiles cover old masters, ukiyo-e, minimal, neon, etc.).
- Pick ≥3. Done in under 15 seconds.
- Output: initial taste profile.

### 2. Your gallery (recs)
- Feed of ~12 recommended works laid out like a wall, not infinite scroll.
- Heart = positive signal. Skip/"not for me" = negative.
- Each rec shows a one-line reason ("close to the Hokusai you picked: flat color, strong diagonals").
- Tap a work: image, artist, date, museum, short caption/story, link to museum page.

### 3. Blend (headline)
- Generate a code / QR / link. Friend enters it.
- Output screen:
  - Blend score (taste overlap %).
  - **The artwork that brings you together**, revealed with the stroke-by-stroke painting animation (oil/watercolor works preferred, they animate best).
  - Why: "you hearted X, they hearted Y, this sits between both" with the 2 source pieces shown.
  - A shared wall of ~8 works: some from overlap, some from each side.
- Shareable card (image export).

### 4. Profile
- Your taste map: your hearts plotted on the atlas, top visual families, "your era/region spread".
- Past blends.

## Recommendation engine

### Data (built)
- 6,674 curated works from 42 sources (Met, MoMA, NGA, Cleveland, SMK, ColBase, Smithsonian, contemporary galleries, etc.), plus additions packets (installations, neon/glass/light, narrative, MoMA addback).
- Image vectors: SigLIP 2 so400m, 1152-d, L2-normalized.
- Caption vectors: Haiku image+text captions → text-embedding-3-small, 1536-d.
- Clusters: HDBSCAN/k-means on 80% image / 20% caption combined vectors; each work has a family label.
- Dedup: perceptual hash; aesthetic bottom-tail pruned; artist/family caps.

### Taste profile
- Not one average vector (blurs multi-taste users into mush).
- Multi-interest: cluster the user's hearts into k ≤ 4 taste centroids (PinnerSage-style). Each centroid has a weight = share of hearts.
- Negatives: skipped works pushed into a small penalty set.

### Ranking
1. For each taste centroid, cosine kNN top ~100 from the image index.
2. Score = sim − λ·max_sim_to_negatives + small aesthetic prior.
3. Allocate slots per centroid by weight.
4. MMR rerank (diversity vs relevance) so the wall isn't 12 versions of the same print; cap 2 per artist per wall.
5. ~15% exploration slots from adjacent clusters the user hasn't seen.

### Blend
- Inputs: user A centroids, user B centroids.
- Candidate pool: kNN around each A–B centroid midpoint (normalized), for every centroid pair.
- Score a work w = min(sim(w, A), sim(w, B)) — rewards works both people would like, not ones one person loves.
- Top shared artwork = best score among animation-ready works (oil/watercolor).
- Blend score = mean of best pairwise centroid similarities, rescaled to 0–100.
- Explanation: the nearest hearted work from each side to the chosen piece.

### Serving
- Typesense (self-hosted, Hetzner 8GB) with image vector field (HNSW, cosine) + facet fields (era, region, medium, museum, family).
- FastAPI for profile + blend logic; image embed server (SigLIP 2) only needed if users upload their own image.
- Images served from R2 (1024px) + small WebP thumbs.

## API (draft)
- GET /onboarding → 20 tiles
- POST /profile/{id}/hearts {artwork_id, value: +1/-1}
- GET /profile/{id}/recs?n=12
- POST /blend {a, b} → {score, top_artwork, reasons, wall[]}
- GET /artwork/{id} → metadata, caption, neighbors

## Demo script (~2 min)
1. Judge picks 3 tiles → lands on their wall instantly.
2. Hearts one more, wall updates.
3. Blend with pre-seeded team profile (rich history).
4. Painting animation reveals the shared artwork + why.
5. Cut to atlas (Fieldwork) showing both users' hearts on the map and the blend point between them.

## Scope
**Must (by 8:30am):** onboarding grid, recs wall, blend with seeded profile, reveal animation on 1–3 pre-rendered works, atlas cutaway.
**Nice:** share card export, QR pairing, profile taste map.
**Cut:** auth, real multi-user backend, creature/tamagotchi, curated multi-room shows, link import.

## Risks
- Animation only looks good on painterly works → restrict top-artwork pick to animation-ready set, pre-render for demo.
- Typesense box not up yet → fallback: numpy cosine in FastAPI (6.7k × 1152 is trivial in memory).
- Cold start with 3 picks → onboarding tiles are cluster centroids, so 3 picks already land in distinct families.

## Success (for judges)
- Blend result feels uncanny-right for two different people.
- Recs visibly span eras/cultures instead of clustering on one style.
