"""Gallery builder: means, spreads, hue palette, centroid and a short descriptive title."""
from __future__ import annotations

from collections import Counter

import numpy as np

from . import catalog
from .variables import SCALAR_VARS, HUE_NAMES

ADJ = {  # (variable, high?) -> adjective
    ("warmth", True): "Warm", ("warmth", False): "Cool",
    ("brightness", True): "Luminous", ("brightness", False): "Shadowed",
    ("saturation", True): "Vivid", ("saturation", False): "Muted",
    ("detail", True): "Intricate", ("detail", False): "Quiet",
    ("era", True): "Modern", ("era", False): "Old-World",
}
NOUN = {
    "landscape": "Wanderer", "water": "Tidewatcher", "figures": "People-Watcher",
    "portrait": "Portraitist", "architecture": "Flaneur", "animals": "Naturalist",
    "still life": "Collector", "flowers": "Gardener", "interior": "Homebody",
    "religious": "Pilgrim", "night": "Night Owl", "abstract": "Dreamer",
}


def summarize(artwork_ids: list[str]) -> dict:
    ids = list(dict.fromkeys(artwork_ids))  # dedupe, keep order
    if not ids:
        raise ValueError("a gallery needs at least one artwork")
    arts = [catalog.get(i) for i in ids]
    means, spreads = {}, {}
    for k in SCALAR_VARS:
        v = np.array([a["variables"][k] for a in arts], dtype=float)
        means[k] = round(float(v.mean()), 4)
        spreads[k] = round(float(v.std()), 4)
    H = np.array([a["variables"]["hue"] for a in arts])
    hue = H.mean(0)
    hue = hue / hue.sum()
    means["hue"] = [round(float(x), 4) for x in hue]
    spreads["hue"] = round(float(np.mean(0.5 * np.abs(H - hue).sum(1))), 4)
    E = np.array([a["clip_embedding"] for a in arts])
    c = E.mean(0)
    c = c / (np.linalg.norm(c) + 1e-9)
    subjects = Counter(s for a in arts for s in a["subjects"])
    brushes = Counter(a["brush"] for a in arts)
    return {
        "artwork_ids": ids,
        "means": means,
        "spreads": spreads,
        "centroid": [round(float(x), 5) for x in c],
        "title": title(means, subjects),
        "top_subjects": [s for s, _ in subjects.most_common(3)],
        "top_hues": top_hues(hue),
        "dominant_medium": brushes.most_common(1)[0][0],
        "bars": bars(means),
    }


def zscores(means: dict) -> dict:
    st = catalog.stats()
    return {k: (means[k] - st[k]["mean"]) / (st[k]["std"] + 1e-9) for k in SCALAR_VARS}


def title(means: dict, subjects: Counter) -> str:
    z = zscores(means)
    k = max(z, key=lambda key: abs(z[key]))
    adj = ADJ[(k, z[k] > 0)]
    subj = distinctive_subject(subjects)
    return f"{adj} {NOUN.get(subj, 'Wanderer')}"


def distinctive_subject(subjects: Counter) -> str:
    """Subject with the highest lift over its catalog frequency (needs 2+ hits when possible)."""
    if not subjects:
        return "landscape"
    cat = Counter(s for a in catalog.artworks().values() for s in a["subjects"])
    n_cat = len(catalog.artworks())
    total = sum(subjects.values())
    def lift(s):
        return (subjects[s] / total) / ((cat[s] + 1) / n_cat)
    pool = [s for s, c in subjects.items() if c >= 2] or list(subjects)
    return max(sorted(pool), key=lambda s: subjects[s] * lift(s) ** 0.5)


def top_hues(hist, n: int = 3) -> list[str]:
    hist = np.asarray(hist)
    return [HUE_NAMES[i] for i in np.argsort(-hist)[:n] if hist[i] > 0.04]


def bars(means: dict) -> dict:
    """0..1 bar values for the gallery card, scaled to the catalog range."""
    st = catalog.stats()
    out = {}
    for k in SCALAR_VARS:
        lo, hi = st[k]["min"], st[k]["max"]
        out[k] = round(float(np.clip((means[k] - lo) / (hi - lo + 1e-9), 0, 1)), 3)
    h = np.asarray(means["hue"])
    out["hue"] = round(float(1 - (-(h * np.log(h + 1e-9)).sum() / np.log(len(h)))), 3)  # palette focus
    return out
