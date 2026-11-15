"""One blend for the app: photo A (subject) + photo B (style) -> one still, as JSON lines.

  python -m blendlab still <a> <b> --out <dir>        a/b: catalog id (aic-11) or image path

Prints {"event":"progress",...} lines, then {"event":"result","data":{...}}. Default method is
rules_local (~45 s, offline). --method rules_hosted uses Gemini/OpenAI (slow or stuck at times).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

# paint style for the worker's impasto renderers, from the medium of B (rule 12: B owns the medium)
STYLE_FOR_MEDIUM = {"oil": "oil", "gouache": "oil", "pastel": "oil", "watercolor": "watercolor", "ink": "watercolor"}


def emit(event: str, **data):
    sys.stdout.write(json.dumps({"event": event, **data}) + "\n")
    sys.stdout.flush()


def make_still(a_ref: str, b_ref: str, out: Path, method: str | None = None) -> dict:
    from .common import load
    from .methods import METHODS, available
    out.mkdir(parents=True, exist_ok=True)
    method = method or "rules_local"
    ok, why = available(method)
    if not ok:
        raise RuntimeError(f"{method} unavailable: {why}")
    emit("progress", stage="blending", detail=f"{method}: subject from A, style from B")
    t0 = time.time()
    m = METHODS[method]
    img, extra, _ = m["fn"](load(a_ref), load(b_ref), dict(m["params"], _a=a_ref, _b=b_ref))
    still = out / "still.png"
    img.save(still)
    thumb = out / "thumb.jpg"
    t = img.copy()
    t.thumbnail((512, 512))
    t.convert("RGB").save(thumb, quality=88)
    medium = (extra.get("recipe") or {}).get("medium", "oil")
    return {"still_path": str(still), "thumb_path": str(thumb), "method": method, "medium": medium,
            "style": STYLE_FOR_MEDIUM.get(medium, "oil"), "seconds": round(time.time() - t0, 1),
            "passed": extra.get("passed"), "checks": len(extra.get("checks") or {}),
            "recipe": extra.get("recipe")}


def main(a: str, b: str, out: str, method: str | None = None):
    try:
        emit("result", data=make_still(a, b, Path(out), method))
    except Exception as e:  # the API shows this message to the user
        emit("error", message=f"{type(e).__name__}: {e}")
        sys.exit(1)
