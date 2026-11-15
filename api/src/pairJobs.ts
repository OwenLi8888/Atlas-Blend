/**
 * Two-image blend job: paint image A with painting B's technique. The warm painter
 * (worker/src/serve.ts) analyses B (medium, palette, mark length, stroke direction, ground), maps
 * A onto B's palette and paints it stroke by stroke with B's medium, as a video. A few seconds end
 * to end. The finished painting is saved as a tile on the person's globe.
 *
 * Same Blend record and event stream as the gallery blend, so /blends/:id/events works.
 * Events: stage {detail} · technique {summary, swatches, medium} · painting {pct, detail}
 *         · video {video_url, thumb_url, strokes, ...} · done {status, timings}
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { bus } from "./jobs.js";
import { paintWithTechnique } from "./painter.js";
import { RUNTIME } from "./paths.js";
import type { Blend, BlendEvent, Store } from "./store.js";

export interface PairInput { ref: string; path: string; label: string; thumb: string; medium: "oil" | "watercolor" | null }

async function push(store: Store, blend: Blend, type: string, data: unknown, persist = true) {
  const ev: BlendEvent = { seq: blend.events.length + 1, at: Date.now(), type, data };
  blend.events.push(ev);
  bus.emit(`blend:${blend.id}`, ev);
  if (persist) await store.saveBlend(blend);
}

export async function startPairBlend(
  store: Store, userId: string, a: PairInput, b: PairInput & { medium: "oil" | "watercolor" },
  ensureGallery: () => Promise<void>,
): Promise<Blend> {
  const blend: Blend = {
    id: randomUUID().slice(0, 12), session_code: null, user_a: userId, user_b: userId,
    status: "painting", score: null, per_variable: null, pairs: null, groups: null, targets: null,
    references: [{ role: "subject", ...a }, { role: "technique", ...b }], medium: b.medium, prompt: null,
    still_source: "technique-transfer", painting_variables: null, gallery_a: null, gallery_b: null,
    names: { a: a.label, b: b.label }, still_url: null, thumb_url: null, video_url: null, panel: null,
    panel_status: "ready", video_status: "pending", cache_key: `pair:${randomUUID()}`, timings: {},
    error: null, events: [], created_at: new Date().toISOString(),
  };
  await store.saveBlend(blend);
  run(store, blend, a, b, ensureGallery).catch(async (e) => {
    console.error(`[pair ${blend.id}]`, e);
    blend.status = "error";
    blend.error = String(e?.message ?? e);
    await push(store, blend, "error", { message: blend.error });
  });
  return blend;
}

async function run(store: Store, blend: Blend, a: PairInput, b: PairInput & { medium: "oil" | "watercolor" }, ensureGallery: () => Promise<void>) {
  const t0 = Date.now();
  const outDir = join(RUNTIME, "blends", blend.id);
  mkdirSync(outDir, { recursive: true });
  const gallery = ensureGallery(); // in parallel: a first-time user's gallery (Python) is off the critical path
  gallery.catch(() => {});
  await push(store, blend, "stage", { detail: `Reading the technique of ${b.label}` }, false);

  const r = await paintWithTechnique({ a: a.path, b: b.path, medium: b.medium, out: outDir }, (e) => {
    if (e.stage === "analysing" && e.pct === 1) void push(store, blend, "stage", { detail: "Painting with that technique" }, false);
    else if (e.stage === "planning" || e.stage === "painting" || e.stage === "encoding") void push(store, blend, "painting", e, false);
  });
  await push(store, blend, "technique", { summary: r.technique.summary, swatches: r.technique.swatches, medium: b.medium, brokenness: r.technique.brokenness }, false);
  blend.video_url = await store.putFile(r.video, `blends/${blend.id}/painting.mp4`, "video/mp4");
  blend.thumb_url = await store.putFile(r.final, `blends/${blend.id}/painting.png`, "image/png");
  blend.video_status = "ready";
  blend.timings.paint = r.seconds;
  await push(store, blend, "video", { video_url: blend.video_url, thumb_url: blend.thumb_url, strokes: r.strokes, layers: r.layers, duration: r.duration });

  // the painting lands on this person's globe
  await gallery;
  const g = await store.getGallery(blend.user_a);
  if (g && !g.blend_tiles.some((t) => t.blend_id === blend.id)) {
    g.blend_tiles = [{ blend_id: blend.id, thumb_url: blend.thumb_url, video_url: blend.video_url, partner: `${a.label} + ${b.label}`, score: 0 }, ...g.blend_tiles];
    await store.saveGallery(g);
  }
  blend.status = "ready";
  blend.timings.total = (Date.now() - t0) / 1000;
  await push(store, blend, "done", { status: blend.status, timings: blend.timings });
}
