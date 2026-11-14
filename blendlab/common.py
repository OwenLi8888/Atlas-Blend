"""Shared helpers: image loading, resizing, LAB color conversion, fast blur."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
CATALOG = REPO / "catalog" / "data"
IMAGES = CATALOG / "images"
RUNS = ROOT / "runs"


def _load_dotenv(path: Path = REPO / ".env") -> None:
    """Read KEY=value lines from the repo's .env (gitignored). Real env vars win; blanks are skipped."""
    import os
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.split(" #")[0].strip().strip('"').strip("'")
        if v and not os.environ.get(k):
            os.environ[k] = v


_load_dotenv()


def artworks() -> dict[str, dict]:
    data = json.loads((CATALOG / "artworks.json").read_text(encoding="utf-8"))
    return {a["id"]: a for a in data}


def resolve(ref: str) -> Path:
    """Accept a catalog id (aic-11), a filename, or a path to any image."""
    p = Path(ref)
    if p.exists():
        return p
    for cand in (IMAGES / ref, IMAGES / f"{ref}.jpg", IMAGES / f"aic-{ref}.jpg"):
        if cand.exists():
            return cand
    raise FileNotFoundError(f"no image for {ref!r} (looked in {IMAGES})")


def load(ref: str) -> Image.Image:
    return Image.open(resolve(ref)).convert("RGB")


def fit(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Center-crop to the target aspect, then resize."""
    tw, th = size
    w, h = img.size
    s = max(tw / w, th / h)
    img = img.resize((max(tw, round(w * s)), max(th, round(h * s))), Image.LANCZOS)
    w, h = img.size
    l, t = (w - tw) // 2, (h - th) // 2
    return img.crop((l, t, l + tw, t + th))


def canvas(a: Image.Image, long_side: int = 512) -> tuple[int, int]:
    """Output size: A's aspect (clamped), long side fixed."""
    w, h = a.size
    ar = float(np.clip(w / h, 0.6, 1.67))
    return (long_side, round(long_side / ar)) if ar >= 1 else (round(long_side * ar), long_side)


def to_f(img: Image.Image) -> np.ndarray:
    return np.asarray(img, dtype=np.float64) / 255.0


def to_img(arr: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))


# ---- sRGB <-> CIELAB (D65) ----
_M = np.array([[0.4124564, 0.3575761, 0.1804375],
               [0.2126729, 0.7151522, 0.0721750],
               [0.0193339, 0.1191920, 0.9503041]])
_Minv = np.linalg.inv(_M)
_WHITE = np.array([0.95047, 1.0, 1.08883])


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    c = np.where(rgb > 0.04045, ((rgb + 0.055) / 1.055) ** 2.4, rgb / 12.92)
    xyz = c @ _M.T / _WHITE
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    fy = (lab[..., 0] + 16) / 116
    f = np.stack([fy + lab[..., 1] / 500, fy, fy - lab[..., 2] / 200], -1)
    xyz = np.where(f ** 3 > 216 / 24389, f ** 3, (116 * f - 16) / (24389 / 27)) * _WHITE
    c = xyz @ _Minv.T
    c = np.clip(c, 0, None)
    return np.clip(np.where(c > 0.0031308, 1.055 * c ** (1 / 2.4) - 0.055, 12.92 * c), 0, 1)


# ---- fast gaussian-ish blur (3 box passes), works on HxW or HxWxC float arrays ----
def _box1d(a: np.ndarray, r: int, axis: int) -> np.ndarray:
    if r < 1:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    p = np.pad(a, pad, mode="reflect")
    c = np.cumsum(p, axis=axis)
    hi = np.take(c, range(2 * r + 1, c.shape[axis]), axis=axis)
    lo = np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis=axis)
    return (hi - lo) / (2 * r + 1)


def blur(a: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0.3:
        return a
    r = max(1, int(round(np.sqrt(12 * sigma * sigma / 3 + 1) / 2)))
    for _ in range(3):
        a = _box1d(_box1d(a, r, 0), r, 1)
    return a


def match_stats(src_lab: np.ndarray, ref_lab: np.ndarray, amount: float = 1.0) -> np.ndarray:
    """Reinhard transfer: move src's per-channel mean/std toward ref's."""
    out = src_lab.copy()
    for c in range(3):
        sm, ss = src_lab[..., c].mean(), src_lab[..., c].std() + 1e-6
        rm, rs = ref_lab[..., c].mean(), ref_lab[..., c].std() + 1e-6
        moved = (src_lab[..., c] - sm) * (rs / ss) + rm
        out[..., c] = src_lab[..., c] * (1 - amount) + moved * amount
    return out


def hist_match(src: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """Match src values' distribution to ref's (one channel)."""
    s_idx = np.argsort(src, axis=None)
    ref_sorted = np.sort(ref, axis=None)
    q = np.linspace(0, len(ref_sorted) - 1, src.size).astype(int)
    out = np.empty(src.size)
    out[s_idx] = ref_sorted[q]
    return out.reshape(src.shape)
