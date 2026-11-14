# Backend / data plan (status as of Sat Nov 14, ~2pm)

Owner: Alissa. This covers the data pipeline, search, and the curator agent. Frontend folks: the "Interfaces" section is what you'll call.

## TL;DR
- **Dataset:** ~27.7k artworks after pruning (paintings, drawings, prints, sculpture), pulled from 11+ museum sources + MoMA + WikiArt + AP Art History 250. MoMA images still downloading (~4h).
- **Prototype working end to end on 1,000 works:** image + text embeddings, Typesense hybrid search, LangChain Deep Agents curator that produces full exhibitions (theme, rooms, wall text, critic pass).
- **Next:** embed the full set, dedup, build the similarity graph, taste/recs, then the API the frontend calls.

## Data
Sources: The Met, National Gallery, Cleveland Museum, Smithsonian, SMK, MoMA, ColBase (Japan), Palace Museum Taipei, Rijksmuseum, Europeana, WikiArt (post-1950), AP Art History 250 (with Smarthistory essays as anchor pieces). Art Institute of Chicago is excluded (their image server blocks us).

Everything is normalized to one schema: id (`source:objectid`), title, artist, date, era, region, classification, medium, museum, image_path, plus description/essay text where available.

UI shows short museum names ("National Gallery", "The Met", "Cleveland Museum", "MoMA"...). Full names go in the detail view only.

**Pruning (automatic, reruns as new images land):** cuts text pages/colophons, title pages, bookplates, maps, botanical/scientific plates, ornament/architecture drawings, sketches/studies, repeated print states, reproduction engravings, stiff formal/official portraits, and tiny images (<600px). Minimal/pale works are kept on purpose.

**Dedup (after embedding):** near-identical works collapse to one (very close image vectors, or a looser threshold when it's the same series + artist + museum, e.g. the Met's "Indian Trades and Castes" set). AP250 always wins, then bigger image, then richer metadata.

## Embeddings
Two vectors per artwork:
1. **Visual:** SigLIP 2 on the image (base model now; may upgrade to so400m for the full set on a GPU). Captures color, composition, brushwork.
2. **Meaning:** a VLM (gpt-4.1-mini) looks at the image + metadata and writes a short card (what's depicted, story, themes, emotions, mood). That card is embedded with OpenAI text-embedding-3-small. Captures themes like grief or labor across works that look nothing alike.

Facets (era, region, medium, classification, museum) are plain filters, not stratifiers.

## Search: Typesense
Both vectors + facets live in Typesense. Hybrid search (keyword + vector), image-neighbor search, and facet filters all work on the prototype. Example: "grief, prints, pre-1900" = meaning vector + filters.

## Similarity graph (add-on, after full embed)
- Each work gets its top ~10 visual and top ~10 meaning neighbors as edges.
- **Clusters:** Leiden community detection, and an LLM names each cluster. On the 1k sample the combined graph gave 9 groups: abstract/surreal, intimate figures/portraits, East Asian spiritual scenes, earthy realism, medieval/devotional, figurative sculpture, South Asian/Islamic miniatures, mortality/social-commentary prints (plus a bookplate cluster, which we now prune). Page: https://differently-nervously-durable-python.kitten.space/clusters.html
- **Bridges:** shortest paths between two works (e.g. Monet to Rothko through in-between pieces). Good for room sequencing and the Blend.
- **Wander mode:** click a work, walk to its neighbors.

## Taste + recommendations
- **Onboarding:** ~30 tiles spread across visual clusters (not quotas by region/era). Narrow based on hearts. No agent here, it needs to be instant.
- **Taste profile:** a few visual centroids from hearts (people like more than one style) + a meaning centroid from cards and "why" answers.
- **Recs:** personalized PageRank on the graph, with random walks starting from hearted works. It updates instantly on every heart, no retraining. Skips count as soft negatives.
- **Mix:** ~75% "safe" picks we're confident they'll like, ~25% stretch picks (similar meaning, different look), shown in marked slots. If they skip stretch picks, we back off that direction.
- **Diversity:** MMR with a gentle penalty (lambda ~0.8) so picks aren't near-copies of each other without drifting off-taste.

## Curator agent (LangChain Deep Agents)
Built for the LangChain track criteria (complex use case, real use of subagents + filesystem, demo).
1. Curator writes a plan (theme + arc) to the virtual filesystem.
2. Two researcher subagents query Typesense (visual and meaning tools) and write candidate notes to files.
3. Curator reads the notes, sequences rooms, and drafts wall text.
4. Critic subagent reviews the draft (theme fit, repetition, label quality) and writes a critique file.
5. Curator revises and outputs the final exhibit JSON. Every run saves its artifacts + a timed activity log (useful for the demo, "watch the curator work").

Example output on the sample: "Quiet Rooms" (shelter to isolation to connection) and "Blooming Resilience" (flowers bridged with labor/resistance). Showcase: https://differently-nervously-durable-python.kitten.space

Known issues being fixed: wall text reads like generic AI museum copy, and the critic doesn't catch theme mismatches yet (one show promised "muted blues" and picked greens/purples). Shows are ~12 works now because of the 1k sample; with the full set, 20-40.

## Interfaces (draft, for frontend)
Exhibit JSON:
```
{ title, thesis, rooms: [ { title, wall_text, works: [ { artwork_id, label, reason } ] } ] }
```
Planned endpoints (not built yet): `GET /artwork/:id`, `GET /search?q=&filters=`, `GET /neighbors/:id`, `POST /heart`, `GET /recs`, `POST /exhibit` (streams room by room), `POST /blend`.

## Open questions
- so400m vs base for visual embeddings (so400m needs a GPU: ~1h rented or Alissa's Mac).
- Where the API runs (Hetzner box w/ Typesense?).
- Blend generated artwork: yes/no.
