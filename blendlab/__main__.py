"""Blend lab: test two-photo blending on its own, compare versions, rate, improve.

  python -m blendlab run v1                    run every method on the fixed test pairs
  python -m blendlab run v2 --methods hybrid   run only some methods
  python -m blendlab pair aic-11 aic-138       blend any two images (ids or file paths)
  python -m blendlab review                    open the rating page (http://localhost:8790)
  python -m blendlab ratings                   print the average rating per version and method
  python -m blendlab sheet v3 --open           one image: A | B | merge for every pair, with checks
"""
from __future__ import annotations

import argparse
import json
import random
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path

from .common import IMAGES, ROOT, RUNS, artworks, load

PAIRS_FILE = ROOT / "pairs.json"


def make_pairs(n: int = 8, seed: int = 7) -> list[dict]:
    """Fixed, varied test pairs: A and B always differ in medium."""
    arts = [a for a in artworks().values() if (IMAGES / f"{a['id']}.jpg").exists()]
    rng = random.Random(seed)
    rng.shuffle(arts)
    used, pairs = set(), []
    for a in arts:
        if a["id"] in used:
            continue
        for b in arts:
            if b["id"] in used or b["id"] == a["id"]:
                continue
            if a["medium"].split()[0].lower() != b["medium"].split()[0].lower():
                pairs.append({"id": f"p{len(pairs) + 1}", "a": a["id"], "b": b["id"]})
                used |= {a["id"], b["id"]}
                break
        if len(pairs) == n:
            break
    return pairs


def load_pairs() -> list[dict]:
    if not PAIRS_FILE.exists():
        PAIRS_FILE.write_text(json.dumps(make_pairs(), indent=2) + "\n", encoding="utf-8")
    return json.loads(PAIRS_FILE.read_text(encoding="utf-8"))


def run_methods(pairs, names, out: Path, note: str = "") -> dict:
    from .methods import METHODS, available
    out.mkdir(parents=True, exist_ok=True)
    meta_path = out / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {"methods": {}, "results": {}}
    meta.update(created=datetime.now().isoformat(timespec="seconds"), note=note or meta.get("note", ""),
                pairs=pairs)
    shutil.copy(ROOT / "methods.py", out / "methods.py")  # snapshot: this version's exact code
    for name in names:
        ok, why = available(name)
        if not ok:
            print(f"  skip {name}: {why}")
            continue
        m = METHODS[name]
        meta["methods"][name] = {"params": m["params"], "doc": m["doc"]}
        (out / name).mkdir(exist_ok=True)
        for pr in pairs:
            t0 = time.time()
            try:
                got = m["fn"](load(pr["a"]), load(pr["b"]), dict(m["params"], _a=pr["a"], _b=pr["b"]))
                img, extra, cands = got if isinstance(got, tuple) else (got, {}, [])
                img.save(out / name / f"{pr['id']}.jpg", quality=92)
                for i, (_, c) in enumerate(cands):
                    c.save(out / name / f"{pr['id']}_c{i + 1}.jpg", quality=88)
                res = {"ok": True, "seconds": round(time.time() - t0, 2), **extra}
            except Exception as e:  # keep going; one failure shouldn't sink the run
                res = {"ok": False, "error": f"{type(e).__name__}: {e}"}
            meta["results"][f"{name}/{pr['id']}"] = res
            info = f"{res['seconds']:.1f}s" if res["ok"] else res["error"]
            if res.get("checks"):
                info += f"  picked {res['picked']}, {res['passed']}/{len(res['checks'])} checks: " + " ".join(
                    ("+" if c["pass"] else "-") + k for k, c in res["checks"].items())
            print(f"  {name:15s} {pr['id']:4s} {info}", flush=True)
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def main(argv=None):
    ap = argparse.ArgumentParser(prog="blendlab", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="run methods on the fixed test pairs")
    r.add_argument("version")
    r.add_argument("--methods", help="comma list (default: all)")
    r.add_argument("--pairs", help="comma list of pair ids (default: all)")
    r.add_argument("--note", default="", help="what changed in this version")
    p = sub.add_parser("pair", help="blend two specific images")
    p.add_argument("a")
    p.add_argument("b")
    p.add_argument("--methods")
    v = sub.add_parser("review", help="serve the rating page")
    v.add_argument("--port", type=int, default=8790)
    sub.add_parser("ratings", help="summarize ratings")
    sh = sub.add_parser("sheet", help="one image of A | B | merge for every pair in a version")
    sh.add_argument("version")
    sh.add_argument("--method", default="rules_local")
    sh.add_argument("--open", action="store_true", help="open it in the image viewer")
    args = ap.parse_args(argv)

    from .methods import METHODS
    names = args.methods.split(",") if getattr(args, "methods", None) else [n for n, m in METHODS.items() if not m["legacy"]]
    unknown = [n for n in names if n not in METHODS]
    if unknown:
        sys.exit(f"unknown method(s): {unknown}; have {list(METHODS)}")

    if args.cmd == "run":
        pairs = load_pairs()
        if args.pairs:
            pairs = [x for x in pairs if x["id"] in args.pairs.split(",")]
        print(f"{args.version}: {len(names)} methods x {len(pairs)} pairs")
        run_methods(pairs, names, RUNS / args.version, args.note)
        print(f"done -> {RUNS / args.version}\nrate it: python -m blendlab review")
    elif args.cmd == "pair":
        tag = f"{Path(args.a).stem}__{Path(args.b).stem}"
        out = RUNS / "_scratch" / tag
        run_methods([{"id": "out", "a": args.a, "b": args.b}], names, out)
        print(f"done -> {out}")
    elif args.cmd == "review":
        from .review import serve
        serve(args.port)
    elif args.cmd == "sheet":
        from .sheet import make_sheet
        path = make_sheet(args.version, args.method)
        print(path)
        if args.open:
            import os
            os.startfile(path) if hasattr(os, "startfile") else print("open it from the path above")
    elif args.cmd == "ratings":
        from .review import summary
        for ver, rows in summary().items():
            print(ver)
            for name, (avg, n) in rows.items():
                print(f"  {name:15s} {avg:.2f}  ({n} rated)")


if __name__ == "__main__":
    main()
