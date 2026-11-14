"""Local rating page. Ratings are saved to blendlab/ratings.json so they can be read back and
used to decide what to change next."""
from __future__ import annotations

import json
import mimetypes
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from .common import IMAGES, ROOT, RUNS, artworks

RATINGS = ROOT / "ratings.json"
PAGE = ROOT / "review.html"


def read_ratings() -> dict:
    return json.loads(RATINGS.read_text(encoding="utf-8")) if RATINGS.exists() else {}


def versions() -> list[dict]:
    out = []
    for d in RUNS.iterdir() if RUNS.exists() else []:
        if d.is_dir() and not d.name.startswith("_") and (d / "meta.json").exists():
            meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
            out.append({"name": d.name, **meta})
    return sorted(out, key=lambda v: v.get("created", ""))


def summary() -> dict:
    rows: dict[str, dict[str, list[int]]] = {}
    for key, r in read_ratings().items():
        parts = key.split("/")
        if len(parts) == 3 and r.get("score"):
            rows.setdefault(parts[0], {}).setdefault(parts[1], []).append(r["score"])
    return {v: {m: (sum(s) / len(s), len(s)) for m, s in ms.items()} for v, ms in rows.items()}


def state() -> dict:
    vs = versions()
    arts = artworks()
    ids = {p[k] for v in vs for p in v.get("pairs", []) for k in ("a", "b")}
    info = {i: {k: arts[i].get(k) for k in ("title", "artist", "date_display", "medium")} for i in ids if i in arts}
    return {"versions": vs, "artworks": info, "ratings": read_ratings()}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, body: bytes, ctype: str, code: int = 200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _file(self, base: Path, rel: str):
        p = (base / rel).resolve()
        if base.resolve() not in p.parents or not p.is_file():
            return self._send(b"not found", "text/plain", 404)
        self._send(p.read_bytes(), mimetypes.guess_type(p.name)[0] or "application/octet-stream")

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/":
            return self._send(PAGE.read_bytes(), "text/html; charset=utf-8")
        if path == "/api/state":
            return self._send(json.dumps(state()).encode(), "application/json")
        if path.startswith("/runs/"):
            return self._file(RUNS, path[6:])
        if path.startswith("/img/"):
            return self._file(IMAGES, path[5:])
        self._send(b"not found", "text/plain", 404)

    def do_POST(self):
        if urlparse(self.path).path != "/api/rate":
            return self._send(b"not found", "text/plain", 404)
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        key = str(body.get("key", ""))
        if not key:
            return self._send(b'{"error":"key required"}', "application/json", 400)
        ratings = read_ratings()
        cur = ratings.get(key, {})
        for f in ("score", "note"):
            if f in body:
                cur[f] = body[f]
        cur["at"] = datetime.now().isoformat(timespec="seconds")
        if not cur.get("score") and not cur.get("note"):
            ratings.pop(key, None)
        else:
            ratings[key] = cur
        RATINGS.write_text(json.dumps(dict(sorted(ratings.items())), indent=2) + "\n", encoding="utf-8")
        self._send(b'{"ok":true}', "application/json")


def serve(port: int = 8790):
    url = f"http://localhost:{port}"
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"blend lab review on {url}  (Ctrl+C to stop)")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
