# Atlas Blend

**Tagline (Devpost "elevator pitch" field, 200 chars max):**
Spotify Blend for art. Heart what you like from 42 museums, blend with a friend, and watch AI agents commission and paint the one piece that could only belong to the two of you.

---

## Inspiration

Everyone knows their friends' music taste. Spotify Blend and Wrapped turned listening into something you compare, screenshot and argue about. Nobody knows their friends' taste in art, including, usually, their own.

That's not because people don't care. It's because the art is scattered across museums all over the world, and the one near you wasn't hung with you in mind: you walk past hundreds of works with no context, hoping something lands. We wanted the BuzzFeed-quiz feeling of *"wait, that's so you"* and the Spotify Blend feeling of *"I can't believe we both like this"*, but for paintings, across the world's collections at once.

So Atlas Blend is a new way to experience art. Instead of standing in front of whatever a museum happened to hang, you start from what you're drawn to and find out what that says about you. And instead of looking alone, you look with someone: their taste next to yours, and the art that sits between you.

## What it does

Atlas Blend learns your taste in art, then lets you blend it with a friend's.

1. **Pick what you like.** Onboarding shows one work from each of 31 visual families (ukiyo-e prints, Indian miniatures, Fauve landscapes, geometric abstraction...). Tap a few. That takes about fifteen seconds.
2. **Get a wall made for you.** Your gallery is 12 works chosen from 6,757 pieces across 42 museums and galleries (the Met, MoMA, the National Gallery of Art, Cleveland, SMK Copenhagen, Japan's ColBase and more). Every recommendation says which of your hearts it came from. Heart more and the wall rehangs.
3. **Meet your curator.** An AI curator keeps notes on you, writes a portrait of your taste, engages you with easy tap-to-answer questions about your preferences, and curates entire rooms for you, where each piece is chosen with intention. It has its own long-term memory of you. Tell it something ("I hate anything gloomy") and that goes into its notes and changes what comes next: how it describes your taste, the rooms it hangs, and the piece made for you when you blend.
4. **Blend with a friend.** You get a match score, each person's top leanings, and a shared wall: works you both hearted, works of theirs you'd love, and new works that sit between you.
5. **Create a piece that's uniquely yours.** Every blend makes a brand-new artwork out of the two of you: your palettes, subjects and ways of making marks, combined into one painting that didn't exist before. A team of agents writes the brief from both your tastes, an image model makes it, and your painter character paints it on screen stroke by stroke while a wall label explains what it took from each of you. Then you hang it in your 3D round room and keep it.

The result is a thing you actually send to the group chat: *our* painting, with a score and a story.

## Who it's for

Anyone who likes art casually. Also museums themselves: every work links back to its home institution, so a blend is a doorway into collections people would not have searched for.

## How we built it

```
 React + TypeScript + Vite + three.js (gallery, reveal, 3D round room)
        |                                   stroke-by-stroke painting engine
        |  /api                             (tryimpasto plans, Web Worker, canvas)
        v
 Node + Express API
   |-- taste, recs and blend scoring     in memory, exact, over 6,757 SigLIP 2 vectors
   |-- curator   (deepagents + Gemini)   per-person filesystem memory, room-maker subagents
   |-- atelier   (deepagents + Gemini)   art-director -> label-writer -> critic
   |-- Gemini image model                paints the commissioned piece
   v
 Supabase Postgres (profiles, hearts, blends)   Typesense (catalog + vectors)
```

**Taste engine.** Every work is embedded with SigLIP 2 (1,152 dimensions). The whole collection is about 30 MB of vectors, so we skip approximate search and score every request exactly, in memory: a recommendation wall takes about 0.1 s and a blend about 0.2 s. A person is not one average vector. Their hearts are grouped into up to twelve separate tastes, each represented by a real artwork at its centre, so liking both Japanese gold screens and Cubism gives you both, not beige. Wall slots are split between tastes, with a diversity trade-off and a cap of two works per artist.

**Blend.** Every pairing of one of your tastes with one of your friend's scores each work by the *lower* of its closeness to the two of you, weighted by how much of each person's hearts those tastes hold. That rewards work you'd both like over work one of you loves.

**The atelier (deep agent).** Each blend is handed to a LangChain `deepagents` agent on Gemini. Its virtual filesystem starts with a taste portrait of each person. An `art-director` subagent writes a painting brief and fires it at the image model through a tool the moment it exists; a `label-writer` writes the title and story; a `critic` checks that both people are named and each is credited only with what their own portrait supports, and sends it back for one revision.

**The curator (deep agent with memory).** Each person gets their own agent whose filesystem is a folder on disk, so it persists between runs: `/memories/taste.md` (its own notes, which it rewrites), `/memories/notes.md` (what you told it, word for word), and `/rooms/`. Saving works wakes it up in the background. It plans two rooms and hands each to a `room-maker` subagent in parallel, which searches the collection by words and by visual likeness, orders the works and writes the wall text.

**Painting engine.** We wrote a renderer that plays a stroke plan back over ten seconds, coarse to fine, with an animated painter following the brush. Plans are computed in a Web Worker so the interface never stalls.

## Challenges we ran into

- **Everyone was a 93% match.** Our first taste profile was the average of your hearts. Averaged embeddings drift toward the middle of the collection, so any two people looked nearly identical. We switched to multiple tastes per person, each anchored on a real artwork, and re-calibrated the score against measured similarities (two unrelated works sit around 0.55, a near neighbour around 0.85).
- **A blend that only found the overlap.** Scoring just the closest pair of tastes returns something you already both like, which is not a mix. Scoring across all pairings, weighted by share, is what made results feel like a meeting point.
- **Agents are slow and a reveal can't be.** A full agent run takes about 15 seconds. We restructured it so the brief is handed to the image model the moment it is written (about 5 s in) and the label is written in parallel; the blend itself answers instantly and the screen paints a preview while the piece is made. If the agent stalls, a template brief takes over so there is always a painting.
- **Clusters that swallowed each other.** Grouping works into families gave us one giant blob until we subtracted the collection average before clustering and capped family size.
- **Scope.** We started the weekend as a different project (repainting a museum's paintings in new styles) and pivoted to taste and blending on day one. The painting engine survived the pivot and became the reveal.

## Accomplishments that we're proud of

- A blend result that feels spot-on for two real people, on real museum works, in a fifth of a second.
- Two deep agents doing jobs that need them: one with long-term memory per person, one with a director, writer and critic that produces a painting and a label that are specific to both people and fact-checked against their tastes.
- The reveal. Watching a piece made for you and a friend get painted in front of you lands every time we show it.
- 6,757 works from 42 institutions in one taste space, with every piece linked back to its museum.

## What we learned

- Embeddings need calibrating before they mean anything to a person. Raw cosine similarity is not a match score.
- Taste is plural. The single biggest quality jump came from refusing to average.
- Deep agents earn their cost when you give them a filesystem and a division of labour, and when you design the product around their latency instead of hiding it.

## What's next for Atlas Blend

- **Group blends**: a whole friend group, a couple's anniversary wall, a class.
- **Share cards** made for stories, the way Wrapped is.
- **Museum mode**: scan a QR code at the entrance and get a route through the building for you and whoever you came with.
- **More of the world**: more non-Western collections, textiles, photography and living artists.
- **A feed of blends** from people whose taste is near yours.
- **Your own work on the walls**: upload art you've made and it joins the collection, so it can turn up on the wall of someone whose taste it fits, next to the museum pieces.

## Built With

react, typescript, vite, three.js, node.js, express, langchain, deepagents, langgraph, gemini, supabase, postgresql, typesense, siglip, embeddings, web-workers, d3-delaunay, tryimpasto

---

## Prize notes (paste the relevant paragraph where Devpost asks, or keep as a section)

**Entertainment track.** Atlas Blend turns art, the least social medium on your phone, into something you play with a friend: a taste quiz, a match score, a curator that tells your story back to you, and a live painted reveal you keep and share.

**Best use of deepagents (LangChain).** Two deep agents built with `deepagents` and LangGraph. The curator uses a per-person `FilesystemBackend` as long-term memory and fans out to parallel `room-maker` subagents with collection-search tools. The atelier runs an `art-director`, `label-writer` and `critic` over a shared virtual filesystem, with a tool call that starts image generation mid-run and structured output for the label.

**Best Practical AI Innovation (Amazon).** Agentic: plans rooms, delegates, searches, critiques and revises. Adaptive: it learns from every heart and every note, and remembers them. Useful: a real way to find art you'd like among thousands of works, alone or with someone. Simple: three taps to a personal wall.

**Best Use of Gemini API (MLH / Google).** Gemini is the model behind everything generative in the app. It runs the curator: reading each person's memory files, rewriting its notes on them, planning rooms, and driving the room-maker subagents that search the collection and write the wall text. It runs the atelier's art-director, label-writer and critic. And a Gemini image model paints every commissioned piece from the written brief plus reference artworks from both people's hearts.
