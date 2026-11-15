import express from 'express';
import { randomBytes } from 'node:crypto';
import { ApiError, check, type Services } from './services';
import { taste, recommend, blendScore, diversify, overlap, bridge, publicWork, normalize } from '../src/rec/scoring';

function text(v: unknown, label: string, max = 200): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new ApiError(400, 'Invalid ' + label);
  return v.trim();
}
function uuid(v: unknown): string {
  const s = text(v, 'user_id', 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) throw new ApiError(400, 'Invalid user_id');
  return s;
}
export function createApp(s: Services) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));
  // Same-origin only. No permissive CORS; use Vite's /api proxy.
  app.use((req, _res, next) => {
    if (req.get('sec-fetch-site') === 'cross-site') return next(new ApiError(403, 'Cross-site request blocked'));
    next();
  });
  async function profile(id: string) {
    const p = check(await s.db.from('profiles').select('id,name,blend_code').eq('id', id).maybeSingle());
    if (!p) throw new ApiError(404, 'Profile not found');
    return p;
  }
  async function hearts(id: string) {
    await profile(id);
    const rows = check(await s.db.from('hearts').select('art_id').eq('user_id', id).order('created_at').limit(300));
    return s.documents((rows ?? []).map(r => r.art_id));
  }
  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  app.post('/api/profile', async (req, res) => {
    const name = text(req.body?.name, 'name', 80);
    for (let i = 0; i < 4; i++) {
      const result = await s.db.from('profiles').insert({ name, blend_code: randomBytes(4).toString('hex').toUpperCase() }).select('id,name,blend_code,created_at').single();
      if (result.error?.code === '23505') continue;
      res.status(201).json(check(result)); return;
    }
    throw new ApiError(503, 'Please retry profile creation');
  });
  app.get('/api/onboarding', async (_req, res) => { res.json({ works: (await s.onboarding()).map(publicWork) }); });
  app.post('/api/heart', async (req, res) => {
    const user_id = uuid(req.body?.user_id), art_id = text(req.body?.art_id, 'art_id');
    const why = req.body?.why == null ? null : text(req.body.why, 'why', 500);
    await profile(user_id);
    if (!(await s.documents([art_id])).length) throw new ApiError(404, 'Artwork not found');
    const heart = check(await s.db.from('hearts').upsert({ user_id, art_id, why }, { onConflict: 'user_id,art_id' }).select().single());
    res.json({ heart });
  });
  app.get('/api/recs/:user_id', async (req, res) => {
    const liked = await hearts(uuid(req.params.user_id)), centers = taste(liked.map(w => w.image_vec));
    if (!centers.length) { res.json({ works: (await s.onboarding()).slice(0, 12).map(publicWork), taste_count: 0 }); return; }
    const pools = await s.knn(centers.map(c => c.vector));
    res.json({ works: recommend(pools, centers, new Set(liked.map(w => w.id))).map(publicWork), taste_count: centers.length });
  });
  app.post('/api/blend', async (req, res) => {
    const user_id = uuid(req.body?.user_id), code = text(req.body?.code, 'code', 12).toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(code)) throw new ApiError(400, 'Invalid blend code');
    const friend = check(await s.db.from('profiles').select('id,name').eq('blend_code', code).maybeSingle());
    if (!friend) throw new ApiError(404, 'Blend code not found');
    if (friend.id === user_id) throw new ApiError(400, 'Choose a friend’s code');
    const [ha, hb] = await Promise.all([hearts(user_id), hearts(friend.id)]);
    if (!ha.length || !hb.length) throw new ApiError(409, 'Both people need at least one heart');
    const a = taste(ha.map(w => w.image_vec)), b = taste(hb.map(w => w.image_vec));
    const midpoints: number[][] = [];
    for (const x of a) for (const y of b) {
      const sum = x.vector.map((v, i) => v + y.vector[i]);
      if (Math.hypot(...sum) > 1e-10) midpoints.push(normalize(sum));
    }
    const pools = await s.knn([...a.map(c => c.vector), ...b.map(c => c.vector), ...midpoints]);
    const exclude = new Set([...ha, ...hb].map(w => w.id));
    const candidates = [...new Map(pools.flat().filter(w => !exclude.has(w.id)).map(w => [w.id, w])).values()];
    const score = (w: typeof candidates[number]) => blendScore(w.image_vec, a, b);
    const ranked = candidates.sort((x, y) => score(y) - score(x));
    // Prefer an animation-ready painterly work among the best shared matches, not an unrelated painting.
    const top = ranked.slice(0, 20).find(w => /oil|watercolou?r/i.test(w.medium ?? '')) ?? ranked[0];
    if (!top) throw new ApiError(404, 'No shared candidates found');
    const picks = diversify(candidates, score, 8, [top]);
    const ba = bridge(top, ha)!, bb = bridge(top, hb)!;
    const story = 'You hearted “' + ba.title + '”; they hearted “' + bb.title + '”. “' + top.title + '” is visually close to both.';
    const saved = check(await s.db.from('blends').insert({ user_a: user_id, user_b: friend.id, top_art_id: top.id, picks: picks.map(w => w.id), story }).select('id,created_at').single());
    res.json({ ...saved, score: overlap(a, b), top_artwork: publicWork(top), picks: picks.map(publicWork), bridge: { a: publicWork(ba), b: publicWork(bb) }, story });
  });
  app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err instanceof ApiError ? err.status : err instanceof SyntaxError ? 400 : 500;
    if (status >= 500) console.error(err instanceof Error ? err.message : 'Unexpected error');
    res.status(status).json({ error: err instanceof ApiError ? err.message : status === 400 ? 'Invalid JSON' : 'Server error' });
  });
  return app;
}
