// The whole app as one small Node process, for a host without Vite: the built pages (dist/) and
// the picks endpoint (picksApi.mjs). No dependencies, so the host needs only Node and these files:
// dist/, server/serve.mjs and server/picksApi.mjs.
//
//   npm run build
//   node server/serve.mjs
//
// Settings, all optional, from the environment:
//   PORT         default 4830
//   HOST         default 127.0.0.1 (put a reverse proxy or a tunnel in front; do not bind a public address)
//   DIST         the built pages, default ../dist
//   PICKS_FILE   where picks are kept, default ../data/runtime/picks.json
//   GALLERY_API  address of the Gallery API (server/index.ts), e.g. http://127.0.0.1:43871.
//                Its /api paths are passed on to it. Without it they answer 503, and the pages
//                choose pictures from the pool instead.
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { picksMiddleware } from './picksApi.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 4830;
const host = process.env.HOST || '127.0.0.1';
const dist = path.resolve(process.env.DIST || path.join(here, '..', 'dist'));
const gallery = process.env.GALLERY_API ? new URL(process.env.GALLERY_API) : null;
const picks = picksMiddleware(process.env.PICKS_FILE ? { file: path.resolve(process.env.PICKS_FILE) } : {});

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};
/** Text files are sent gzipped; images and fonts are already compressed. */
const TEXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map']);
/** Gzipped copies, by file path, kept while the file does not change. */
const zipped = new Map();

function plain(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

async function page(req, res, pathname) {
  let file;
  try {
    file = path.join(dist, decodeURIComponent(pathname));
  } catch {
    return plain(res, 400, 'Bad request');
  }
  if (file !== dist && !file.startsWith(dist + path.sep)) return plain(res, 403, 'Forbidden');
  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = path.join(file, 'index.html');
    info = await stat(file).catch(() => null);
  }
  if (!info?.isFile()) return plain(res, 404, 'Not found');
  const ext = path.extname(file).toLowerCase();
  const headers = {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    // Vite names the files in assets/ after their contents, so they never change; the rest is checked again within the hour
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  };
  let body = await readFile(file);
  if (TEXT.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    const kept = zipped.get(file);
    if (kept?.mtimeMs === info.mtimeMs) body = kept.body;
    else zipped.set(file, { mtimeMs: info.mtimeMs, body: (body = gzipSync(body)) });
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** Passes a request on to the Gallery API and its answer back. */
function passOn(req, res) {
  const out = http.request(
    { hostname: gallery.hostname, port: gallery.port, path: req.url, method: req.method, headers: { ...req.headers, host: gallery.host } },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  out.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'The Gallery API is not answering' }));
  });
  req.pipe(out);
}

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    picks(req, res, () => {
      if (pathname.startsWith('/api/')) {
        if (gallery) return passOn(req, res);
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ error: 'The Gallery API is not set up on this host' }));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return plain(res, 405, 'Method not allowed');
      page(req, res, pathname).catch(() => {
        if (!res.headersSent) plain(res, 500, 'Server error');
        else res.end();
      });
    });
  })
  .listen(port, host, () => {
    console.log(`Atlas on http://${host}:${port} (pages from ${dist}${gallery ? `, Gallery API at ${gallery.origin}` : ''})`);
  });
