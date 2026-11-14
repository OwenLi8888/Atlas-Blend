/**
 * Demo prep (PRD step 7): pre-build the demo teammate's gallery and three persona galleries, then
 * render three blends end to end so their videos and agent panels are cached as fallbacks.
 * Re-running a blend between the same two galleries replays the cached result instantly.
 *
 *   npm run prerender -w api
 */
import "./env.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startBlend } from "./jobs.js";
import { BLEND_DIR, CATALOG_DIR, PYTHON } from "./paths.js";
import { runJsonLines } from "./proc.js";
import { makeStore } from "./store.js";

const store = makeStore();
const rounds: { artwork_ids: string[] }[] = JSON.parse(readFileSync(join(CATALOG_DIR, "quiz_rounds.json"), "utf8"));

// Deterministic "taps" per persona: which slot(s) of each round of 4 they pick.
const PERSONAS: Record<string, { name: string; slots: number[][] }> = {
  "demo-teammate": { name: "Teammate (demo)", slots: rounds.map(() => [1, 3]) },
  "demo-ana": { name: "Ana (demo)", slots: [[0], [0, 2], [1], [0], [2, 3]] },
  "demo-ben": { name: "Ben (demo)", slots: [[3], [1], [3, 0], [2], [1]] },
  "demo-cy": { name: "Cy (demo)", slots: [[2], [3], [2], [1, 3], [0]] },
};

async function ensure(id: string) {
  const p = PERSONAS[id];
  await store.upsertUser({ id, display_name: p.name, created_at: new Date().toISOString() });
  const ids = rounds.flatMap((r, i) => (p.slots[i] ?? [0]).map((s) => r.artwork_ids[s]));
  const s = (await runJsonLines(PYTHON, ["-m", "blend", "gallery"], { cwd: BLEND_DIR, input: JSON.stringify({ artwork_ids: ids }) })) as any;
  const prev = await store.getGallery(id);
  await store.saveGallery({
    user_id: id, artwork_ids: s.artwork_ids, means: s.means, spreads: s.spreads, centroid: s.centroid, title: s.title,
    summary: { bars: s.bars, top_subjects: s.top_subjects, top_hues: s.top_hues, dominant_medium: s.dominant_medium },
    blend_tiles: prev?.blend_tiles ?? [], updated_at: new Date().toISOString(),
  });
  console.log(`gallery ${id.padEnd(14)} ${s.title} (${s.artwork_ids.length} artworks)`);
}

async function waitFor(id: string) {
  for (;;) {
    const b = await store.getBlend(id);
    if (b && b.events.some((e) => e.type === "done" || e.type === "error")) return b;
    await new Promise((r) => setTimeout(r, 300));
  }
}

for (const id of Object.keys(PERSONAS)) await ensure(id);
for (const [a, b] of [["demo-ana", "demo-teammate"], ["demo-ben", "demo-teammate"], ["demo-ana", "demo-cy"]]) {
  const t0 = Date.now();
  const started = await startBlend(store, { sessionCode: null, userA: a, userB: b });
  const done = await waitFor(started.id);
  console.log(`blend ${a} x ${b}: ${done.status} score ${done.score} in ${((Date.now() - t0) / 1000).toFixed(1)}s` +
    ` video ${done.video_url} panel ${done.panel_status}`);
}
// let the file store flush
setTimeout(() => process.exit(0), 400);
