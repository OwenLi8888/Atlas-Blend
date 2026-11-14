/**
 * The blend job: blend service (match + merge + still) -> painting worker and research agent in
 * parallel -> save the painting as a tile on both spheres. Every step emits progress events that
 * the app reads over SSE (or polling).
 */
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_DIR, BLEND_DIR, PYTHON, ROOT, RUNTIME, WORKER_CLI } from "./paths.js";
import { runJsonLines, type JsonEvent } from "./proc.js";
import type { Blend, BlendEvent, Store } from "./store.js";

export const bus = new EventEmitter();
bus.setMaxListeners(200);

const cacheKey = (a: string[], b: string[]) =>
  createHash("sha1").update(JSON.stringify([a, b])).digest("hex").slice(0, 16);

async function push(store: Store, blend: Blend, type: string, data: unknown, persist = true) {
  const ev: BlendEvent = { seq: blend.events.length + 1, at: Date.now(), type, data };
  blend.events.push(ev);
  bus.emit(`blend:${blend.id}`, ev);
  if (persist) await store.saveBlend(blend);
}

export interface StartBlend { sessionCode: string | null; userA: string; userB: string }

export async function startBlend(store: Store, req: StartBlend): Promise<Blend> {
  const [ua, ub, ga, gb] = await Promise.all([
    store.getUser(req.userA), store.getUser(req.userB), store.getGallery(req.userA), store.getGallery(req.userB),
  ]);
  if (!ua || !ub || !ga || !gb) throw new Error("both people need a gallery before painting");
  const blend: Blend = {
    id: randomUUID().slice(0, 12), session_code: req.sessionCode, user_a: ua.id, user_b: ub.id,
    status: "matching", score: null, per_variable: null, pairs: null, groups: null, targets: null,
    references: null, medium: null, prompt: null, still_source: null, painting_variables: null,
    gallery_a: null, gallery_b: null, names: { a: ua.display_name, b: ub.display_name },
    still_url: null, thumb_url: null, video_url: null, panel: null,
    panel_status: "pending", video_status: "pending",
    cache_key: cacheKey(ga.artwork_ids, gb.artwork_ids), timings: {}, error: null,
    events: [], created_at: new Date().toISOString(),
  };
  await store.saveBlend(blend);
  run(store, blend, ga.artwork_ids, gb.artwork_ids).catch(async (e) => {
    console.error(`[blend ${blend.id}]`, e);
    blend.status = "error";
    blend.error = String(e?.message ?? e);
    await push(store, blend, "error", { message: blend.error });
  });
  return blend;
}

async function run(store: Store, blend: Blend, aIds: string[], bIds: string[]) {
  const t0 = Date.now();
  const cached = await store.findBlendByCacheKey(blend.cache_key);
  if (cached && process.env.BLEND_CACHE !== "off") return replayCached(store, blend, cached);

  const outDir = join(RUNTIME, "blends", blend.id);
  mkdirSync(outDir, { recursive: true });
  await push(store, blend, "stage", { stage: "matching" });

  // 1. blend service: variables, matching, merge, still
  const result = (await runJsonLines(PYTHON, ["-m", "blend", "blend"], {
    cwd: BLEND_DIR,
    input: JSON.stringify({
      blend_id: blend.id, out_dir: outDir,
      a: { user_id: blend.user_a, name: blend.names.a, artwork_ids: aIds },
      b: { user_id: blend.user_b, name: blend.names.b, artwork_ids: bIds },
    }),
    onEvent: (e) => void push(store, blend, "stage", { stage: "matched-early", ...e }, false),
    timeoutMs: 90_000,
  })) as Record<string, any>;
  writeFileSync(join(outDir, "blend.json"), JSON.stringify(result));
  Object.assign(blend, {
    score: result.score, per_variable: result.per_variable, pairs: result.pairs, groups: result.groups,
    targets: result.targets, references: result.references, medium: result.medium, prompt: result.prompt,
    still_source: result.still_source, painting_variables: result.painting_variables,
    gallery_a: slim(result.gallery_a), gallery_b: slim(result.gallery_b), status: "painting",
  });
  blend.still_url = await store.putFile(result.still_path, `blends/${blend.id}/still.png`, "image/png");
  blend.thumb_url = await store.putFile(result.thumb_path, `blends/${blend.id}/thumb.jpg`, "image/jpeg");
  blend.timings.match_and_still = (Date.now() - t0) / 1000;
  await push(store, blend, "matched", {
    score: blend.score, per_variable: blend.per_variable, pairs: blend.pairs, groups: blend.groups,
    medium: blend.medium, still_url: blend.still_url, gallery_a: blend.gallery_a, gallery_b: blend.gallery_b,
    painting_bars: (blend.painting_variables as any)?.bars,
  });

  // 2. painting worker and research agent, in parallel
  const painting = runJsonLines(process.execPath, ["--import", "tsx", WORKER_CLI,
    "--still", result.still_path, "--out", outDir, "--brush", result.medium], {
    cwd: join(ROOT, "worker"),
    onEvent: (e: JsonEvent) => void push(store, blend, "painting", e, false),
    timeoutMs: 120_000,
  }).then(async (r: any) => {
    blend.video_url = await store.putFile(r.video, `blends/${blend.id}/painting.mp4`, "video/mp4");
    blend.video_status = "ready";
    blend.timings.paint = r.seconds;
    await push(store, blend, "video", { video_url: blend.video_url, ...r, video: undefined, final: undefined });
  }).catch(async (e) => {
    blend.video_status = "error";
    await push(store, blend, "video_error", { message: String(e?.message ?? e) });
  });

  const research = runJsonLines(PYTHON, ["-m", "blend_agent", "--blend", join(outDir, "blend.json")], {
    cwd: AGENT_DIR,
    onEvent: (e: JsonEvent) => void push(store, blend, e.event === "todos" ? "todos" : "agent", e, false),
    timeoutMs: 150_000,
  }).then(async (panel) => {
    blend.panel = panel;
    blend.panel_status = "ready";
    await push(store, blend, "panel", panel);
  }).catch(async (e) => {
    blend.panel_status = "error";
    await push(store, blend, "panel_error", { message: String(e?.message ?? e) });
  });

  await Promise.all([painting, research]);
  blend.timings.total = (Date.now() - t0) / 1000;
  await finish(store, blend);
}

async function replayCached(store: Store, blend: Blend, src: Blend) {
  const keep = { id: blend.id, session_code: blend.session_code, events: blend.events, created_at: blend.created_at, names: blend.names };
  Object.assign(blend, { ...src, ...keep, timings: { ...src.timings, cached: 1 } });
  await push(store, blend, "stage", { stage: "cached" });
  await push(store, blend, "matched", {
    score: blend.score, per_variable: blend.per_variable, pairs: blend.pairs, groups: blend.groups,
    medium: blend.medium, still_url: blend.still_url, gallery_a: blend.gallery_a, gallery_b: blend.gallery_b,
    painting_bars: (blend.painting_variables as any)?.bars,
  });
  const todos = src.events.filter((e) => e.type === "todos").at(-1);
  if (todos) await push(store, blend, "todos", todos.data);
  await push(store, blend, "video", { video_url: blend.video_url, cached: true });
  await push(store, blend, "panel", blend.panel);
  await finish(store, blend);
}

async function finish(store: Store, blend: Blend) {
  blend.status = blend.video_status === "ready" ? "ready" : "error";
  if (blend.video_url && blend.thumb_url) {
    for (const [uid, partner] of [[blend.user_a, blend.names.b], [blend.user_b, blend.names.a]] as const) {
      const g = await store.getGallery(uid);
      if (g && !g.blend_tiles.some((t) => t.blend_id === blend.id)) {
        g.blend_tiles = [{ blend_id: blend.id, thumb_url: blend.thumb_url, video_url: blend.video_url, partner, score: blend.score ?? 0 }, ...g.blend_tiles];
        await store.saveGallery(g);
      }
    }
  }
  if (blend.session_code) {
    const s = await store.getSession(blend.session_code);
    if (s) await store.saveSession({ ...s, status: blend.status === "ready" ? "done" : "error" });
  }
  await push(store, blend, "done", { status: blend.status, timings: blend.timings });
}

function slim(g: Record<string, any>) {
  const { centroid, ...rest } = g;
  return rest;
}
