"""Vector merging (M7, first half): variable targets, embedding target + bridge, references, prompt."""
from __future__ import annotations

from collections import Counter

import numpy as np

from . import catalog
from .gallery import top_hues
from .matching import SIMILAR
from .variables import SCALAR_VARS, ALL_VARS

MAX_DOMINANT = 4
MAX_REFS = 5


def variable_targets(ga: dict, gb: dict, sim: dict) -> tuple[dict, dict]:
    """t_k = w_A mu_A + w_B mu_B, w_A = 0.5 if s_k >= 0.7 else sigma_B / (sigma_A + sigma_B)."""
    wA = {}
    for k in ALL_VARS:
        if sim[k] >= SIMILAR:
            wA[k] = 0.5
        else:
            sa, sb = ga["spreads"][k], gb["spreads"][k]
            wA[k] = 0.5 if sa + sb < 1e-9 else sb / (sa + sb)
    # Neither person may dominate more than 4 of the 6 variables: soften the weakest leads.
    for side in ("a", "b"):
        lead = [k for k in ALL_VARS if (wA[k] > 0.5 if side == "a" else wA[k] < 0.5)]
        lead.sort(key=lambda k: abs(wA[k] - 0.5))
        while len(lead) > MAX_DOMINANT:
            wA[lead.pop(0)] = 0.5
    t = {}
    for k in SCALAR_VARS:
        t[k] = round(wA[k] * ga["means"][k] + (1 - wA[k]) * gb["means"][k], 4)
    h = wA["hue"] * np.asarray(ga["means"]["hue"]) + (1 - wA["hue"]) * np.asarray(gb["means"]["hue"])
    t["hue"] = [round(float(x), 4) for x in h / h.sum()]
    t["era"] = int(round(t["era"]))
    dominance = {k: ("a" if wA[k] > 0.5 else "b" if wA[k] < 0.5 else "even") for k in ALL_VARS}
    return t, {"weights_a": {k: round(v, 3) for k, v in wA.items()}, "dominance": dominance}


def slerp(a: np.ndarray, b: np.ndarray, t: float = 0.5) -> np.ndarray:
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    omega = np.arccos(np.clip(a @ b, -1, 1))
    if omega < 1e-6:
        return a
    return (np.sin((1 - t) * omega) * a + np.sin(t * omega) * b) / np.sin(omega)


def bridge(ga: dict, gb: dict) -> tuple[str, list[float]]:
    target = slerp(np.asarray(ga["centroid"]), np.asarray(gb["centroid"]))
    exclude = set(ga["artwork_ids"]) | set(gb["artwork_ids"])
    best, best_sim = None, -2.0
    for aid, a in sorted(catalog.artworks().items()):
        if aid in exclude:
            continue
        s = float(np.asarray(a["clip_embedding"]) @ target)
        if s > best_sim:
            best, best_sim = aid, s
    return best, [round(float(x), 5) for x in target]


def references(pairs: list[dict], bridge_id: str) -> list[dict]:
    refs = []
    for p in pairs[:2]:
        for side in ("a", "b"):
            if p[side] not in [r["id"] for r in refs]:
                refs.append({"id": p[side], "role": f"pair_{side}"})
    refs.append({"id": bridge_id, "role": "bridge"})
    return refs[:MAX_REFS]


def dominant_medium(refs: list[dict]) -> str:
    c = Counter(catalog.get(r["id"])["brush"] for r in refs)
    return sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


def _word(k: str, v: float) -> str:
    st = catalog.stats()[k]
    z = (v - st["mean"]) / (st["std"] + 1e-9)
    words = {
        "warmth": ("cool, blue-leaning", "balanced", "warm, golden"),
        "brightness": ("dark, low-key", "mid-toned", "bright, high-key"),
        "saturation": ("muted", "moderately saturated", "vivid"),
        "detail": ("sparse, broad", "moderately detailed", "intricately detailed"),
    }[k]
    return words[0] if z < -0.5 else words[2] if z > 0.5 else words[1]


def era_cue(year: int) -> str:
    if year < 1500: return "in the manner of a late-medieval or early Renaissance panel"
    if year < 1700: return "in the manner of a 17th-century old master"
    if year < 1800: return "in the manner of an 18th-century painting"
    if year < 1860: return "in the manner of an early 19th-century romantic painting"
    if year < 1900: return "in the manner of a late 19th-century impressionist work"
    return "in the manner of an early 20th-century modern painting"


def prompt(targets: dict, refs: list[dict], groups: list[dict], medium: str) -> str:
    subjects = Counter(s for r in refs for s in catalog.get(r["id"])["subjects"])
    subj = ", ".join(s for s, _ in subjects.most_common(2)) or "a landscape"
    hues = ", ".join(top_hues(targets["hue"])) or "harmonious"
    return (
        f"A single original {medium} painting of {subj}. "
        f"Combine the composition and mood of the reference artworks into one new scene. "
        f"Palette: {_word('warmth', targets['warmth'])}, {_word('brightness', targets['brightness'])}, "
        f"{_word('saturation', targets['saturation'])}, dominated by {hues}. "
        f"Brushwork: {_word('detail', targets['detail'])}. {era_cue(targets['era']).capitalize()}. "
        f"No text, no frame, no signature."
    )


def merge(ga: dict, gb: dict, m: dict) -> dict:
    targets, weights = variable_targets(ga, gb, m["per_variable"])
    bridge_id, emb_target = bridge(ga, gb)
    refs = references(m["pairs"], bridge_id)
    medium = dominant_medium(refs)
    return {
        "targets": targets,
        "weights": weights,
        "bridge_id": bridge_id,
        "embedding_target": emb_target,
        "references": refs,
        "medium": medium,
        "prompt": prompt(targets, refs, m["groups"], medium),
    }
