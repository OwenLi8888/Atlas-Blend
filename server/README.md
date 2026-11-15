# Gallery API

Node 22+. From this directory run `npm ci`, copy `.env.example` to `.env`, fill the two keys, then `npm run dev`. API binds to 127.0.0.1:43871. From the repo root run the normal Vite dev server; its /api proxy forwards here. For deployment configure a same-origin /api reverse proxy; the Vite proxy only runs in development. Never put the Supabase secret in VITE_* variables or ship it to the browser.

This is a trusted hackathon demo, NOT authenticated user management. Profile UUIDs are identifiers, not credentials. Anyone who can reach the API and knows a UUID can change its hearts or read recommendations. Keep it private/local; add authenticated sessions, ownership authorization, rate limiting, and HTTPS before public deployment. No production data or real personal data belongs here. The backend bypasses RLS using its secret key, deliberately, because the demo schema has no auth policies.

## Requests and responses

- POST /api/profile with {name} returns {id,name,blend_code,created_at}.
- GET /api/onboarding returns {works}, 20 distinct image clusters. art_v1 has no aesthetic field, so no aesthetic ordering is claimed.
- POST /api/heart with {user_id,art_id,why?} returns {heart}. Repeated hearts upsert.
- GET /api/recs/:user_id returns {works,taste_count}, at most 12 works. An empty profile gets onboarding tiles.
- POST /api/blend with {user_id,code} returns {id,created_at,score,top_artwork,picks,bridge:{a,b},story}. picks contains up to eight additional works, not the top artwork again.
- GET /api/health returns {ok:true}.

Work objects preserve Typesense metadata, including image_url, title, artist, date, medium, source, cluster, cluster_id and caption, but omit image_vec.

Taste is deterministic farthest-first seeded spherical k-means, up to three interests. Recs query each centroid, round-robin across interests, and use an MMR-like novelty penalty with a two-per-artist cap. Blend queries both sides and all valid pairwise midpoint vectors, then scores min(best similarity to A, best similarity to B). A painterly work within the top 20 shared candidates is preferred for the reveal. Overlap score is the symmetric weighted best-centroid cosine, clamped to 0–100, not a calibrated compatibility probability. The bridge uses the nearest actual heart from each side. Saved blends contain pick IDs and story; responses include full artwork metadata.

Only the latest API-supported first 300 chronological hearts are considered. No negative signals or exploration model yet. Typesense is contacted over the existing private-demo HTTP endpoint from Node, never from the browser. ID lookups use exact filtered searches so colon IDs work under the search-only key.

## Checks

`npm test` runs synthetic-vector unit tests.
`npm run typecheck` checks server plus scoring.
`npm run smoke` tests all core endpoints against live Typesense/Supabase, creates two labeled temporary profiles, verifies saved blend, and deletes those profiles plus cascading hearts/blends in finally. Do not run against an unrelated production project. Missing tables return 503 with instructions to run supabase/schema.sql.

Environment keys must be set before starting. .env is git-ignored.
