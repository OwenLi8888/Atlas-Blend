"""Blend service CLI. JSON in on stdin, JSON out on stdout (last line).

    python -m blend gallery   {"artwork_ids": [...]}
    python -m blend blend     {"blend_id": "...", "out_dir": "...",
                               "a": {"user_id","name","artwork_ids"}, "b": {...}}
    python -m blend quiz
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from . import catalog
from .gallery import summarize, bars
from .matching import match
from .merge import merge
from .still import make_still


def run_blend(req: dict) -> dict:
    t0 = time.time()
    ga = summarize(req["a"]["artwork_ids"])
    gb = summarize(req["b"]["artwork_ids"])
    m = match(ga, gb)
    t_match = time.time() - t0
    print(json.dumps({"event": "matched", "score": m["score"], "seconds": round(t_match, 2)}), flush=True)
    mg = merge(ga, gb, m)
    still = make_still(mg, Path(req["out_dir"]))
    still["painting_variables"]["bars"] = bars(still["painting_variables"])
    return {
        "blend_id": req.get("blend_id"),
        "users": {"a": {k: req["a"].get(k) for k in ("user_id", "name")},
                  "b": {k: req["b"].get(k) for k in ("user_id", "name")}},
        "gallery_a": ga, "gallery_b": gb,
        **m, **mg, **still,
        "timings": {"match": round(t_match, 2), "total": round(time.time() - t0, 2)},
    }


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    if cmd == "quiz":
        rounds = catalog.quiz_rounds()
        out = [{**r, "artworks": [public(catalog.get(i)) for i in r["artwork_ids"]]} for r in rounds]
    elif cmd == "catalog":
        out = [public(a) for a in catalog.artworks().values()]
    elif cmd == "gallery":
        out = summarize(json.loads(sys.stdin.read())["artwork_ids"])
    elif cmd == "blend":
        out = run_blend(json.loads(sys.stdin.read()))
    else:
        print(__doc__)
        return
    sys.stdout.write(json.dumps({"event": "result", "data": out}) + "\n")


def public(a: dict) -> dict:
    keys = ("id", "title", "artist", "year", "date_display", "medium", "brush", "subjects",
            "image_path", "image_url", "source_url", "license", "variables")
    return {k: a.get(k) for k in keys}


if __name__ == "__main__":
    main()
