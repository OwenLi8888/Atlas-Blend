"""The six Blend variables, measured from pixels (plus era from catalog metadata).

warmth      mean b* (yellow-blue) plus a* weight, squashed to [-1, 1]
brightness  mean L* in [0, 100]
saturation  mean LCh chroma, roughly [0, 130]
detail      Canny edge pixels / total pixels, [0, 1]
hue         12-bin hue histogram weighted by chroma (sums to 1)
era         artwork year (catalog metadata)
"""
from __future__ import annotations

import numpy as np
from PIL import Image

SCALAR_VARS = ["warmth", "brightness", "saturation", "detail", "era"]
ALL_VARS = ["warmth", "brightness", "saturation", "detail", "hue", "era"]
HUE_BINS = 12
HUE_NAMES = [
    "red", "orange", "yellow", "chartreuse", "green", "spring green",
    "cyan", "azure", "blue", "violet", "magenta", "rose",
]
MEASURE_SIZE = 256


# ---------------------------------------------------------------- color space
def _srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


_M = np.array([[0.4124564, 0.3575761, 0.1804375],
               [0.2126729, 0.7151522, 0.0721750],
               [0.0193339, 0.1191920, 0.9503041]])
_M_INV = np.linalg.inv(_M)
_WHITE = np.array([0.95047, 1.0, 1.08883])


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """rgb uint8 or float [0,1] array (..., 3) -> LAB float array."""
    rgb = rgb.astype(np.float64)
    if rgb.max() > 1.0:
        rgb = rgb / 255.0
    xyz = _srgb_to_linear(rgb) @ _M.T / _WHITE
    eps = 216 / 24389
    kappa = 24389 / 27
    f = np.where(xyz > eps, np.cbrt(xyz), (kappa * xyz + 16) / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


def lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    """LAB -> float RGB in [0,1]."""
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    fy = (L + 16) / 116
    fx = fy + a / 500
    fz = fy - b / 200
    eps = 216 / 24389
    kappa = 24389 / 27
    def finv(f):
        f3 = f ** 3
        return np.where(f3 > eps, f3, (116 * f - 16) / kappa)
    xr = finv(fx)
    yr = np.where(L > kappa * eps, ((L + 16) / 116) ** 3, L / kappa)
    zr = finv(fz)
    xyz = np.stack([xr, yr, zr], axis=-1) * _WHITE
    return np.clip(_linear_to_srgb(xyz @ _M_INV.T), 0, 1)


# ------------------------------------------------------------------- measures
def warmth_of(lab: np.ndarray) -> float:
    a = lab[..., 1].mean()
    b = lab[..., 2].mean()
    return float(np.tanh((b + 0.3 * a) / 25.0))


def chroma_of(lab: np.ndarray) -> np.ndarray:
    return np.hypot(lab[..., 1], lab[..., 2])


def hue_histogram(lab: np.ndarray) -> np.ndarray:
    ch = chroma_of(lab).ravel()
    h = (np.degrees(np.arctan2(lab[..., 2], lab[..., 1])).ravel() + 360) % 360
    # LAB hue 0deg ~ magenta-red; rotate so bin 0 is red (~ 30deg in LAB hue)
    idx = (((h - 15) % 360) / 30).astype(int) % HUE_BINS
    hist = np.bincount(idx, weights=ch, minlength=HUE_BINS)
    s = hist.sum()
    return hist / s if s > 0 else np.full(HUE_BINS, 1 / HUE_BINS)


def _gaussian_blur(img: np.ndarray, sigma: float = 1.4) -> np.ndarray:
    r = int(3 * sigma)
    x = np.arange(-r, r + 1)
    k = np.exp(-x ** 2 / (2 * sigma ** 2))
    k /= k.sum()
    H, W = img.shape
    pad = np.pad(img, r, mode="reflect")
    rows = sum(k[i] * pad[:, i:i + W] for i in range(len(k)))      # (H+2r, W)
    return sum(k[i] * rows[i:i + H, :] for i in range(len(k)))     # (H, W)


def canny_density(gray: np.ndarray, low: float = 0.08, high: float = 0.2) -> float:
    """Compact Canny: blur, Sobel, non-maximum suppression, hysteresis. gray in [0,1]."""
    g = _gaussian_blur(gray)
    p = np.pad(g, 1, mode="edge")
    gx = (p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[1:-1, :-2] + p[2:, :-2])
    gy = (p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[:-2, 1:-1] + p[:-2, 2:])
    mag = np.hypot(gx, gy)
    mag = mag / (mag.max() + 1e-9)
    ang = (np.degrees(np.arctan2(gy, gx)) + 180) % 180
    q = np.round(ang / 45).astype(int) % 4  # 0:0deg 1:45 2:90 3:135
    mp = np.pad(mag, 1)
    H, W = mag.shape
    def sh(dy, dx):
        return mp[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
    n1 = np.select([q == 0, q == 1, q == 2, q == 3], [sh(0, 1), sh(-1, 1), sh(-1, 0), sh(-1, -1)])
    n2 = np.select([q == 0, q == 1, q == 2, q == 3], [sh(0, -1), sh(1, -1), sh(1, 0), sh(1, 1)])
    nms = np.where((mag >= n1) & (mag >= n2), mag, 0)
    strong = nms >= high
    weak = (nms >= low) & ~strong
    edges = strong.copy()
    for _ in range(8):  # bounded hysteresis growth
        e = np.pad(edges, 1)
        nb = np.zeros_like(edges)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                nb |= e[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
        grown = edges | (weak & nb)
        if (grown == edges).all():
            break
        edges = grown
    return float(edges.mean())


def load_rgb(path_or_img, size: int = MEASURE_SIZE) -> np.ndarray:
    img = path_or_img if isinstance(path_or_img, Image.Image) else Image.open(path_or_img)
    img = img.convert("RGB")
    img.thumbnail((size, size), Image.LANCZOS)
    return np.asarray(img)


def measure(path_or_img, year: int | None = None) -> dict:
    rgb = load_rgb(path_or_img)
    lab = rgb_to_lab(rgb)
    gray = lab[..., 0] / 100.0
    return {
        "warmth": round(warmth_of(lab), 4),
        "brightness": round(float(lab[..., 0].mean()), 3),
        "saturation": round(float(chroma_of(lab).mean()), 3),
        "detail": round(canny_density(gray), 4),
        "hue": [round(float(x), 4) for x in hue_histogram(lab)],
        "era": year,
    }
