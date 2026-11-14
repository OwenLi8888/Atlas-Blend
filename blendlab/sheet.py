"""One image per version: A | B | merge for every pair, with the automatic checks in green/red."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .common import RUNS, artworks, load

BG, TEXT, MUTED, GOOD, BAD = (24, 24, 27), (232, 230, 225), (154, 151, 143), (127, 191, 127), (217, 119, 107)


def _font(names: list[str], size: int):
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make_sheet(version: str, method: str = "rules_local", out: Path | None = None, tile: int = 300) -> Path:
    meta = json.loads((RUNS / version / "meta.json").read_text(encoding="utf-8"))
    arts = artworks()
    pairs = meta["pairs"]
    f = _font(["segoeui.ttf", "DejaVuSans.ttf", "Arial.ttf"], 15)
    fb = _font(["segoeuib.ttf", "DejaVuSans-Bold.ttf", "Arial Bold.ttf"], 13)
    fh = _font(["segoeuib.ttf", "DejaVuSans-Bold.ttf", "Arial Bold.ttf"], 18)
    T, H = tile, 64
    sheet = Image.new("RGB", (3 * T + 20, len(pairs) * (T + H) + 50), BG)
    d = ImageDraw.Draw(sheet)
    d.text((10, 12), f"{version} {method}: A (subject)  +  B (style)  =  merge     green = check passed, red = failed",
           fill=TEXT, font=fh)
    for r, p in enumerate(pairs):
        y = 50 + r * (T + H)
        res = meta["results"].get(f"{method}/{p['id']}", {})
        out_path = RUNS / version / method / f"{p['id']}.jpg"
        ims = [load(p["a"]), load(p["b"])] + ([Image.open(out_path)] if out_path.exists() else [])
        for c, im in enumerate(ims):
            im = im.copy()
            im.thumbnail((T - 10, T - 10))
            sheet.paste(im, (10 + c * T + (T - 10 - im.width) // 2, y + (T - 10 - im.height) // 2))
        a, b = arts.get(p["a"], {}), arts.get(p["b"], {})
        kind = f" ({p['kind']})" if p.get("kind") else ""
        d.text((10, y + T - 4), f"{p['id']}{kind}: {a.get('title', p['a'])[:34]} ({a.get('brush', '?')})  +  "
                                f"{b.get('title', p['b'])[:34]} ({b.get('brush', '?')})", fill=TEXT, font=f)
        x = 10
        if res.get("checks"):
            d.text((x, y + T + 18), f"{res['passed']}/{len(res['checks'])}", fill=TEXT, font=fb)
            x += 40
            for k, c in res["checks"].items():
                t = k.replace("_", " ").replace(" proxy", "")
                d.text((x, y + T + 18), t, fill=GOOD if c["pass"] else BAD, font=fb)
                x += d.textlength(t, font=fb) + 12
        elif not res.get("ok", True) or not res:
            d.text((x, y + T + 18), res.get("error", "not run")[:110], fill=BAD, font=fb)
    out = out or RUNS / version / f"sheet_{method}.png"
    sheet.save(out)
    return out
