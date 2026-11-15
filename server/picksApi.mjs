// The smallest store for photo picks that works across two devices: one JSON file, one endpoint.
// No dependencies. Mounted into the Vite dev and preview servers by vite.config.ts, so `npm run dev`
// (or `npm run preview`) is the whole backend. The browser only talks to it through
// src/picks/picksStore.ts, so swapping this for Supabase or another API means changing that one file.
//
//   GET  /api/picks?session=abc123          -> [record, record]   (0 to 2 records, user 1 first)
//   GET  /api/picks?session=abc123&user=1   -> record | null
//   PUT  /api/picks   body: record          -> record             (one per user per session; saving again replaces it)
//
// record = { sessionId, user: 1 | 2, characterId, shown: [25 ids], picks: [5 ids, in pick order], pickedAt: ISO string }
//          plus optional name, profileId, blendCode: the player's name and their Gallery API profile
//
// Stored in data/runtime/picks.json (git-ignored) as { [sessionId]: { "1": record, "2": record } }.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'runtime', 'picks.json');
const SESSION = /^[A-Za-z0-9_-]{1,64}$/;
const PHOTO = /^p\d{3}$/;
const SHOWN = 25;
const PICKS = 5;
/** Sessions kept. Anyone who can reach the endpoint can write to it, so the file must not grow without end: past this, the oldest sessions go. */
const MAX_SESSIONS = 500;

/** When a session was last written to, by this server's clock (`savedAt`; records from before it existed count as oldest). */
const lastSaved = (session) => Math.max(0, ...Object.values(session).map((r) => Date.parse(r?.savedAt) || 0));

const distinctIds = (v, n) => Array.isArray(v) && v.length === n && new Set(v).size === n && v.every((id) => typeof id === 'string' && PHOTO.test(id));

/** Returns the cleaned record, or a string saying what is wrong with it. */
export function validateRecord(r) {
  if (!r || typeof r !== 'object') return 'Body must be a JSON object';
  if (typeof r.sessionId !== 'string' || !SESSION.test(r.sessionId)) return 'Invalid sessionId';
  if (r.user !== 1 && r.user !== 2) return 'user must be 1 or 2';
  if (typeof r.characterId !== 'string' || !r.characterId || r.characterId.length > 40) return 'Invalid characterId';
  if (!distinctIds(r.shown, SHOWN)) return `shown must be ${SHOWN} different photo ids`;
  if (!distinctIds(r.picks, PICKS)) return `picks must be ${PICKS} different photo ids`;
  if (!r.picks.every((id) => r.shown.includes(id))) return 'Every pick must be one of the shown photos';
  if (typeof r.pickedAt !== 'string' || Number.isNaN(Date.parse(r.pickedAt))) return 'pickedAt must be an ISO timestamp';
  // Optional: who this is, and their Gallery API profile, so the other device can blend with them.
  const text = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined);
  return {
    sessionId: r.sessionId,
    user: r.user,
    characterId: r.characterId,
    shown: r.shown,
    picks: r.picks,
    pickedAt: new Date(r.pickedAt).toISOString(),
    name: text(r.name, 40),
    profileId: text(r.profileId, 64),
    blendCode: text(r.blendCode, 12),
  };
}

export function picksMiddleware({ file = DEFAULT_FILE } = {}) {
  const read = () => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  };
  const write = (all) => {
    if (!existsSync(path.dirname(file))) mkdirSync(path.dirname(file), { recursive: true });
    // Write beside the file, then swap it in, so a crash never leaves half a file.
    writeFileSync(file + '.tmp', JSON.stringify(all, null, 2) + '\n');
    renameSync(file + '.tmp', file);
  };
  const send = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };

  return function picksApi(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.endsWith('/api/picks')) return next();

    if (req.method === 'GET') {
      const sessionId = url.searchParams.get('session') ?? '';
      if (!SESSION.test(sessionId)) return send(res, 400, { error: 'Invalid session' });
      const session = read()[sessionId] ?? {};
      const user = url.searchParams.get('user');
      if (user !== null) return send(res, 200, session[user] ?? null);
      return send(res, 200, ['1', '2'].map((u) => session[u]).filter(Boolean));
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 16_384) req.destroy();
      });
      req.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          return send(res, 400, { error: 'Invalid JSON' });
        }
        const record = validateRecord(parsed);
        if (typeof record === 'string') return send(res, 400, { error: record });
        const all = read();
        const session = all[record.sessionId] ?? {};
        const other = session[record.user === 1 ? '2' : '1'];
        if (other && other.shown.some((id) => record.shown.includes(id))) {
          return send(res, 409, { error: 'These photos overlap with the other user’s photos' });
        }
        // savedAt is this server's time, kept for the cap below: pickedAt comes from the device and cannot be trusted for it
        all[record.sessionId] = { ...session, [record.user]: { ...record, savedAt: new Date().toISOString() } };
        const ids = Object.keys(all);
        if (ids.length > MAX_SESSIONS) {
          const oldest = ids.filter((id) => id !== record.sessionId).sort((a, b) => lastSaved(all[a]) - lastSaved(all[b]));
          for (const id of oldest.slice(0, ids.length - MAX_SESSIONS)) delete all[id];
        }
        try {
          write(all);
        } catch {
          return send(res, 500, { error: 'Could not write picks' });
        }
        send(res, 200, record);
      });
      return;
    }

    send(res, 405, { error: 'Method not allowed' });
  };
}
