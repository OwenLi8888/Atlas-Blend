"""Still generation + Reinhard-style color correction (M7, second half).

Image model: OpenAI image edits with the reference images (if OPENAI_API_KEY is set).
Fallback: the bridge artwork as the base composition with low-frequency color and layout from
the top matched pair mixed in. Either way the result is color-corrected toward the merged
warmth / brightness / saturation targets, then re-measured.
"""
from __future__ import annotations

import base64
import io
import os
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from . import catalog
from .variables import rgb_to_lab, lab_to_rgb, measure, chroma_of

STILL_SIZE = 768


def _fit(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Center-crop to aspect, then resize."""
    tw, th = size
    w, h = img.size
    scale = max(tw / w, th / h)
    img = img.resize((max(tw, int(w * scale + 0.5)), max(th, int(h * scale + 0.5))), Image.LANCZOS)
    w, h = img.size
    l, t = (w - tw) // 2, (h - th) // 2
    return img.crop((l, t, l + tw, t + th))


def _canvas_size(bridge: Image.Image) -> tuple[int, int]:
    w, h = bridge.size
    ar = np.clip(w / h, 0.75, 1.5)
    return (STILL_SIZE, int(STILL_SIZE / ar)) if ar >= 1 else (int(STILL_SIZE * ar), STILL_SIZE)


def image_model_still(prompt: str, ref_paths: list[Path], timeout: float = 60) -> Image.Image | None:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return None
    import httpx
    files = [("image[]", (p.name, p.read_bytes(), "image/jpeg")) for p in ref_paths]
    data = {"model": os.environ.get("IMAGE_MODEL", "gpt-image-1"), "prompt": prompt,
            "size": "1024x1024", "n": "1"}
    try:
        r = httpx.post("https://api.openai.com/v1/images/edits", headers={"Authorization": f"Bearer {key}"},
                       data=data, files=files, timeout=timeout)
        r.raise_for_status()
        b64 = r.json()["data"][0]["b64_json"]
        return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
    except Exception as e:  # never let the image model sink a blend
        print(f"[still] image model failed, using fallback: {e}", flush=True)
        return None


def fallback_still(refs: list[dict]) -> Image.Image:
    bridge_id = next(r["id"] for r in refs if r["role"] == "bridge")
    base = Image.open(catalog.image_path(bridge_id)).convert("RGB")
    size = _canvas_size(base)
    base_arr = np.asarray(_fit(base, size), dtype=float) / 255
    pair_imgs = [r for r in refs if r["role"].startswith("pair")][:2]
    if not pair_imgs:
        return Image.fromarray((base_arr * 255).astype(np.uint8))
    out = base_arr * 0.62
    for r in pair_imgs:
        im = _fit(Image.open(catalog.image_path(r["id"])).convert("RGB"), size)
        im = im.filter(ImageFilter.GaussianBlur(radius=size[0] / 40))  # composition + color only
        out += np.asarray(im, dtype=float) / 255 * (0.38 / len(pair_imgs))
    # restore bridge detail lost to the soft mix
    hi = base_arr - np.asarray(_fit(base, size).filter(ImageFilter.GaussianBlur(3)), dtype=float) / 255
    out = np.clip(out + 0.5 * hi, 0, 1)
    return Image.fromarray((out * 255).astype(np.uint8))


def color_correct(img: Image.Image, targets: dict, l_std_target: float | None = None) -> Image.Image:
    """Reinhard transfer in LAB: match mean/spread of L to the brightness target, move the a/b
    mean so warmth hits its target, then scale chroma until mean chroma hits saturation."""
    lab = rgb_to_lab(np.asarray(img))
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    Lm, Ls = L.mean(), L.std() + 1e-6
    Lt_std = l_std_target if l_std_target else Ls
    L2 = (L - Lm) * (Lt_std / Ls) + targets["brightness"]

    am, bm = a.mean(), b.mean()
    w = float(np.clip(targets["warmth"], -0.95, 0.95))
    ta = float(np.clip(am, -12, 12))
    tb = 25 * np.arctanh(w) - 0.3 * ta
    da, db = a - am, b - bm

    def chroma_for(s):
        return float(np.hypot(da * s + ta, db * s + tb).mean())

    lo, hi = 0.0, 4.0
    for _ in range(30):
        mid = (lo + hi) / 2
        if chroma_for(mid) < targets["saturation"]:
            lo = mid
        else:
            hi = mid
    s = (lo + hi) / 2
    out = np.stack([np.clip(L2, 0, 100), da * s + ta, db * s + tb], -1)
    return Image.fromarray((lab_to_rgb(out) * 255 + 0.5).astype(np.uint8))


def reference_l_std(refs: list[dict]) -> float:
    vals = []
    for r in refs:
        lab = rgb_to_lab(np.asarray(Image.open(catalog.image_path(r["id"])).convert("RGB").resize((128, 128))))
        vals.append(lab[..., 0].std())
    return float(np.mean(vals))


def make_still(merged: dict, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    refs = merged["references"]
    raw = image_model_still(merged["prompt"], [catalog.image_path(r["id"]) for r in refs])
    source = "image-model" if raw is not None else "fallback-bridge-composite"
    if raw is None:
        raw = fallback_still(refs)
    raw.save(out_dir / "still_raw.png")
    corrected = color_correct(raw, merged["targets"], reference_l_std(refs))
    corrected.save(out_dir / "still.png")
    thumb = corrected.copy()
    thumb.thumbnail((256, 256))
    thumb.save(out_dir / "thumb.jpg", quality=85)
    measured = measure(corrected, merged["targets"]["era"])
    return {
        "still_path": str(out_dir / "still.png"),
        "thumb_path": str(out_dir / "thumb.jpg"),
        "still_source": source,
        "painting_variables": measured,
        "still_seconds": round(time.time() - t0, 2),
        "size": list(corrected.size),
    }
