/**
 * Blend API server. The app talks only to this server.
 *
 * GET  /quiz                      the 5 rounds
 * POST /users                     {id, display_name} (device id + name is the v1 identity)
 * POST /gallery                   {user_id, artwork_ids} -> variables, bars, title
 * GET  /gallery/:userId           gallery + saved blend tiles
 * POST /session                   {host_id} -> 6-character join code (reuses an open one)
 * GET  /session/:code             live readiness (polled by the app; Supabase realtime when configured)
 * POST /session/:code/join        {guest_id}
 * POST /session/:code/paint       {user_id} -> starts the blend job
 * GET  /blends/:id                score, pairs, groups, video, panel, status
 * GET  /blends/:id/progress       server-sent events: matching, painting, agent todos
 * GET  /blends/:id/events?after=n same events for polling clients
 * POST /demo/teammate             {user_id} pre-built teammate gallery + ready session (demo fallback)
 */
import "./env.js";
import cors from "cors";
import express, { type Request, type Response, type NextFunction } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bus, startBlend } from "./jobs.js";
import { BLEND_DIR, CATALOG_DIR, PYTHON, RUNTIME } from "./paths.js";
import { runJsonLines } from "./proc.js";
import { makeStore, type Blend, type BlendEvent, type Gallery, type Session } from "./store.js";

const store = makeStore();
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/catalog/images", express.static(join(CATALOG_DIR, "images"), { maxAge: "7d" }));
app.use("/files", express.static(join(RUNTIME, "files")));

const artworks: Record<string, any> = Object.fromEntries(
  JSON.parse(readFileSync(join(CATALOG_DIR, "artworks.json"), "utf8")).map((a: any) => [a.id, a]));
const rounds: any[] = JSON.parse(readFileSync(join(CATALOG_DIR, "quiz_rounds.json"), "utf8"));

const base = (req: Request) => process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
const abs = (req: Request, u: string | null | undefined) => (!u ? u : u.startsWith("http") ? u : base(req) + u);
const art = (req: Request, id: string) => {
  const a = artworks[id];
  return a && {
    id: a.id, title: a.title, artist: a.artist, year: a.year, medium: a.medium, brush: a.brush,
    subjects: a.subjects, source_url: a.source_url, license: a.license,
    image: `${base(req)}/catalog/${a.image_path}`,
    variables: { ...a.variables, hue: undefined },
  };
};
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const bad = (res: Response, code: number, msg: string) => res.status(code).json({ error: msg });

app.get("/health", (_req, res) => res.json({ ok: true, store: store.kind }));

app.get("/quiz", (req, res) => {
  res.json({ rounds: rounds.map((r) => ({ ...r, artworks: r.artwork_ids.map((id: string) => art(req, id)) })) });
});

app.get("/artworks/:id", (req, res) => {
  const a = art(req, String(req.params.id));
  return a ? res.json(a) : bad(res, 404, "unknown artwork");
});

app.post("/users", wrap(async (req, res) => {
  const { id, display_name } = req.body ?? {};
  if (!id || !display_name) return bad(res, 400, "id and display_name required");
  const prev = await store.getUser(id);
  const u = await store.upsertUser({ id, display_name: String(display_name).slice(0, 24), created_at: prev?.created_at ?? new Date().toISOString() });
  res.json(u);
}));

async function buildGallery(userId: string, ids: string[]): Promise<Gallery> {
  const clean = [...new Set(ids)].filter((i) => artworks[i]);
  if (clean.length < 1) throw Object.assign(new Error("pick at least one artwork"), { status: 400 });
  const s = (await runJsonLines(PYTHON, ["-m", "blend", "gallery"], {
    cwd: BLEND_DIR, input: JSON.stringify({ artwork_ids: clean }), timeoutMs: 30_000,
  })) as any;
  const prev = await store.getGallery(userId);
  return store.saveGallery({
    user_id: userId, artwork_ids: s.artwork_ids, means: s.means, spreads: s.spreads, centroid: s.centroid,
    title: s.title,
    summary: { bars: s.bars, top_subjects: s.top_subjects, top_hues: s.top_hues, dominant_medium: s.dominant_medium },
    blend_tiles: prev?.blend_tiles ?? [], updated_at: new Date().toISOString(),
  });
}

function galleryOut(req: Request, g: Gallery) {
  return {
    user_id: g.user_id, title: g.title, artwork_ids: g.artwork_ids, means: { ...g.means, hue: undefined },
    hue: (g.means as any).hue, ...g.summary,
    artworks: g.artwork_ids.map((id) => art(req, id)),
    blend_tiles: g.blend_tiles.map((t) => ({ ...t, thumb_url: abs(req, t.thumb_url), video_url: abs(req, t.video_url) })),
  };
}

app.post("/gallery", wrap(async (req, res) => {
  const { user_id, artwork_ids } = req.body ?? {};
  if (!user_id || !Array.isArray(artwork_ids)) return bad(res, 400, "user_id and artwork_ids required");
  if (!(await store.getUser(user_id))) return bad(res, 404, "unknown user");
  res.json(galleryOut(req, await buildGallery(user_id, artwork_ids)));
}));

app.get("/gallery/:userId", wrap(async (req, res) => {
  const g = await store.getGallery(String(req.params.userId));
  return g ? res.json(galleryOut(req, g)) : bad(res, 404, "no gallery yet");
}));

// ------------------------------------------------------------------ sessions
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const hostSessions = new Map<string, string>(); // host id -> open code (reconnect-safe create)

async function sessionOut(req: Request, s: Session) {
  const side = async (id: string | null) => {
    if (!id) return null;
    const [u, g] = await Promise.all([store.getUser(id), store.getGallery(id)]);
    return { id, name: u?.display_name ?? "?", has_gallery: !!g, title: g?.title ?? null, artwork_count: g?.artwork_ids.length ?? 0 };
  };
  const [host, guest] = await Promise.all([side(s.host_id), side(s.guest_id)]);
  const expired = Date.parse(s.expires_at) < Date.now() && s.status === "waiting";
  return { code: s.code, status: expired ? "expired" : s.status, host, guest,
    ready: !!(host?.has_gallery && guest?.has_gallery), blend_id: s.blend_id };
}

app.post("/session", wrap(async (req, res) => {
  const { host_id } = req.body ?? {};
  if (!host_id || !(await store.getUser(host_id))) return bad(res, 400, "unknown host");
  const open = hostSessions.get(host_id);
  if (open) {
    const s = await store.getSession(open);
    if (s && ["waiting", "ready"].includes(s.status) && Date.parse(s.expires_at) > Date.now()) return res.json(await sessionOut(req, s));
  }
  let code = newCode();
  while (await store.getSession(code)) code = newCode();
  const s = await store.saveSession({ code, host_id, guest_id: null, status: "waiting", blend_id: null,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), created_at: new Date().toISOString() });
  hostSessions.set(host_id, code);
  res.json(await sessionOut(req, s));
}));

app.get("/session/:code", wrap(async (req, res) => {
  const s = await store.getSession(String(req.params.code).toUpperCase());
  return s ? res.json(await sessionOut(req, s)) : bad(res, 404, "no session with that code");
}));

app.post("/session/:code/join", wrap(async (req, res) => {
  const code = String(req.params.code).toUpperCase().trim();
  const { guest_id } = req.body ?? {};
  const s = await store.getSession(code);
  if (!s) return bad(res, 404, "no session with that code");
  if (Date.parse(s.expires_at) < Date.now() && s.status === "waiting") return bad(res, 410, "that code expired");
  if (s.host_id === guest_id) return bad(res, 400, "that's your own code");
  if (s.guest_id && s.guest_id !== guest_id) return bad(res, 409, "this blend already has two people");
  const next = await store.saveSession({ ...s, guest_id, status: s.status === "waiting" ? "ready" : s.status });
  res.json(await sessionOut(req, next));
}));

app.post("/session/:code/paint", wrap(async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const s = await store.getSession(code);
  if (!s) return bad(res, 404, "no session with that code");
  if (s.blend_id) return res.json({ blend_id: s.blend_id }); // idempotent: both taps -> one job
  const host = await store.getUser(s.host_id);
  const isDemoGuest = s.guest_id?.startsWith("demo-");
  if (req.body?.user_id !== s.host_id && !isDemoGuest) return bad(res, 403, `only ${host?.display_name ?? "the host"} can start painting`);
  if (!s.guest_id) return bad(res, 400, "waiting for a friend to join");
  const blend = await startBlend(store, { sessionCode: code, userA: s.host_id, userB: s.guest_id });
  await store.saveSession({ ...s, status: "painting", blend_id: blend.id });
  res.json({ blend_id: blend.id });
}));

// ------------------------------------------------------------------ blends
function blendOut(req: Request, b: Blend) {
  const { events, cache_key, ...rest } = b;
  const panel = b.panel ? fixPanel(req, b.panel as any) : null;
  return { ...rest, still_url: abs(req, b.still_url), thumb_url: abs(req, b.thumb_url), video_url: abs(req, b.video_url),
    panel, last_seq: events.length, references: (b.references as any[] | null)?.map((r) => ({ ...r, artwork: art(req, r.id) })) };
}
function fixPanel(req: Request, p: any) {
  const img = (path: string) => `${base(req)}/catalog/${path}`;
  return {
    ...p,
    combined_from: p.combined_from?.map((g: any) => ({ ...g, artworks: g.artworks.map((a: any) => ({ ...a, image: img(a.image_path) })) })),
    source_history: p.source_history?.map((h: any) => ({ ...h, image: img(h.image_path) })),
  };
}
function eventOut(req: Request, e: BlendEvent) {
  const d: any = e.data;
  if (e.type === "panel" && d) return { ...e, data: fixPanel(req, d) };
  if (d && typeof d === "object") {
    const out = { ...d };
    for (const k of ["still_url", "video_url"]) if (out[k]) out[k] = abs(req, out[k]);
    return { ...e, data: out };
  }
  return e;
}

app.get("/blends/:id", wrap(async (req, res) => {
  const b = await store.getBlend(String(req.params.id));
  return b ? res.json(blendOut(req, b)) : bad(res, 404, "unknown blend");
}));

app.get("/blends/:id/events", wrap(async (req, res) => {
  const b = await store.getBlend(String(req.params.id));
  if (!b) return bad(res, 404, "unknown blend");
  const after = Number(req.query.after ?? 0);
  res.json({ status: b.status, events: b.events.filter((e) => e.seq > after).map((e) => eventOut(req, e)) });
}));

app.get("/blends/:id/progress", wrap(async (req, res) => {
  const id = String(req.params.id);
  const b = await store.getBlend(id);
  if (!b) return bad(res, 404, "unknown blend");
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (e: BlendEvent) => res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(eventOut(req, e).data)}\n\n`);
  b.events.forEach(send);
  const on = (e: BlendEvent) => { send(e); if (e.type === "done" || e.type === "error") res.end(); };
  bus.on(`blend:${id}`, on);
  req.on("close", () => bus.off(`blend:${id}`, on));
}));

// ------------------------------------------------------------------ demo fallback
const DEMO_PICKS = () => rounds.flatMap((r) => r.artwork_ids.filter((_: string, i: number) => i % 2 === 1));

app.post("/demo/teammate", wrap(async (req, res) => {
  const { user_id, name } = req.body ?? {};
  if (!user_id || !(await store.getGallery(user_id))) return bad(res, 400, "build your gallery first");
  const tid = "demo-teammate";
  await store.upsertUser({ id: tid, display_name: name || "Teammate (demo)", created_at: new Date().toISOString() });
  if (!(await store.getGallery(tid))) await buildGallery(tid, DEMO_PICKS());
  let code = newCode();
  while (await store.getSession(code)) code = newCode();
  const s = await store.saveSession({ code, host_id: user_id, guest_id: tid, status: "ready", blend_id: null,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), created_at: new Date().toISOString() });
  res.json(await sessionOut(req, s));
}));

// Desktop preview of the app's globe gallery (same HTML the WebView renders), for quick checks.
app.get("/dev/globe", wrap(async (req, res) => {
  const { GLOBE_HTML } = await import("../../app/src/components/globeHtml.js");
  const ids = rounds.flatMap((r) => r.artwork_ids);
  const tiles = ids.map((id: string, i: number) => ({ id, img: `${base(req)}/catalog/${artworks[id].image_path}`, tint: i % 2 ? "#FF7A59" : "#4CC9D8" }));
  const boot = `<script>setTimeout(function(){G.setTiles(${JSON.stringify(tiles)});
    setTimeout(function(){G.glowPairs([[${JSON.stringify(ids[0])},${JSON.stringify(ids[5])}]])},2500);},50)</script>`;
  res.type("html").send(GLOBE_HTML.replace("</body>", `<style>body{background:#0F0E0C}</style>${boot}</body>`));
}));

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: String(err.message ?? err) });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, "0.0.0.0", () => console.log(`Blend API on :${port} (store: ${store.kind})`));
