"""Painting-process video for blend outputs: the impasto stroke planner (from magic-brush) plans
knife and brush strokes for the finished blend, and the worker plays them back stroke by stroke,
underpainting first, accents last, into an MP4 (plus a sheet of the canvas after each layer).

The Node side lives in worker/src/impasto/ (python only finds the images and calls it).
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from .common import REPO, RUNS

WORKER = REPO / "worker"


def paint_one(still: Path, out: Path, style: str = "oil", area: int | None = None,
              size: int | None = None, seconds: float | None = None) -> dict:
    cmd = ["npx", "tsx", "src/cli.ts", "--engine", "impasto", "--still", str(still.resolve()),
           "--out", str(out.resolve()), "--brush", style]
    for flag, val in (("--area", area), ("--size", size), ("--seconds", seconds)):
        if val:
            cmd += [flag, str(val)]
    proc = subprocess.Popen(cmd, cwd=WORKER, stdout=subprocess.PIPE, text=True, shell=(Path.cwd().drive != ""))
    result = None
    for line in proc.stdout:
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("event") == "progress" and ev.get("stage") == "planning" and ev.get("detail"):
            print(f"    {ev['detail']}", flush=True)
        elif ev.get("event") == "result":
            result = ev["data"]
        elif ev.get("event") == "error":
            raise RuntimeError(ev["message"])
    if proc.wait() != 0 or result is None:
        raise RuntimeError(f"worker exited {proc.returncode}")
    return result


def targets(ref: str, method: str, pairs: list[str] | None) -> list[tuple[str, Path]]:
    """A version name (runs/<v>/<method>/<pair>.jpg) or a path to any image."""
    p = Path(ref)
    if p.is_file():
        return [(p.stem, p)]
    d = RUNS / ref / method
    if not d.is_dir():
        raise FileNotFoundError(f"no {d} (give a version that has {method} outputs, or an image path)")
    files = sorted(f for f in d.glob("*.jpg") if "_c" not in f.stem)  # finals only, not candidates
    return [(f.stem, f) for f in files if not pairs or f.stem in pairs]


def run(ref: str, method: str = "rules_local", pairs: list[str] | None = None, style: str = "oil",
        area: int | None = None, size: int | None = None, seconds: float | None = None) -> list[dict]:
    is_file = Path(ref).is_file()
    base = (RUNS / "_scratch" / "painting") if is_file else (RUNS / ref / "painting" / method)
    out = []
    for name, still in targets(ref, method, pairs):
        print(f"  {name}: planning strokes for {still.name}", flush=True)
        r = paint_one(still, base / name, style, area, size, seconds)
        sizes = " ".join(f"{l['name']} {l['strokes']}" for l in r["layers"])
        print(f"  {name}: {r['strokes']} strokes ({sizes}), {r['duration']} s video, made in {r['seconds']} s\n"
              f"      {r['video']}", flush=True)
        out.append(r)
    return out
