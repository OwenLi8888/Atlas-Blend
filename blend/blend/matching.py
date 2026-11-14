"""Gallery-against-gallery matching (M6).

Layer 1 (readable): per-variable similarity s_k = 1 - |mu_A,k - mu_B,k| / R_k, hue palette by
histogram intersection, Blend score = 100 (0.7 mean(s) + 0.3 min(s)).
Layer 2 (pairing): cross-gallery cosine matrix of image embeddings, greedy matched pairs, and
k-means (k=3) groups over the union of both galleries.

Everything is deterministic: same galleries in, same result out.
"""
from __future__ import annotations

from collections import Counter

import numpy as np

from . import catalog
from .variables import SCALAR_VARS

# R_k = RANGE_SCALE * catalog std. Gallery means are averages of 6-10 artworks, so the full
# catalog range would squash every score into the 80s. Tuned in blend/tune.py on 10 test pairs.
RANGE_SCALE = 2.0
SIMILAR = 0.7          # s_k threshold for "similar" (also the merge rule)
W_MEAN, W_MIN = 0.7, 0.3
MAX_PAIRS = 3
PAIR_THRESHOLD = {"clip": 0.80, "fallback": 0.70}


def scale(k: str) -> float:
    return RANGE_SCALE * catalog.stats()[k]["std"]


def variable_similarity(ga: dict, gb: dict) -> dict:
    s = {}
    for k in SCALAR_VARS:
        s[k] = float(np.clip(1 - abs(ga["means"][k] - gb["means"][k]) / scale(k), 0, 1))
    s["hue"] = float(np.minimum(ga["means"]["hue"], gb["means"]["hue"]).sum())
    return {k: round(v, 4) for k, v in s.items()}


def blend_score(sim: dict) -> int:
    v = np.array(list(sim.values()))
    return int(round(100 * (W_MEAN * v.mean() + W_MIN * v.min())))


def _threshold() -> float:
    return PAIR_THRESHOLD["clip" if "clip" in catalog.embedding_model() else "fallback"]


def matched_pairs(a_ids: list[str], b_ids: list[str]) -> tuple[list[dict], np.ndarray]:
    EA = np.array([catalog.embedding(i) for i in a_ids])
    EB = np.array([catalog.embedding(i) for i in b_ids])
    S = EA @ EB.T
    order = sorted(((S[i, j], i, j) for i in range(len(a_ids)) for j in range(len(b_ids))),
                   key=lambda t: (-t[0], a_ids[t[1]], b_ids[t[2]]))
    used_a, used_b, used_art, pairs = set(), set(), set(), []
    th = _threshold()
    for sim, i, j in order:
        if len(pairs) >= MAX_PAIRS:
            break
        a, b = a_ids[i], b_ids[j]
        if i in used_a or j in used_b or (a != b and (a in used_art or b in used_art)):
            continue
        if sim < th and pairs:  # always keep the single strongest pair as evidence
            break
        used_a.add(i); used_b.add(j); used_art.update({a, b})
        pairs.append(pair_evidence(a, b, float(sim), strong=sim >= th))
    return pairs, S


def pair_evidence(a: str, b: str, sim: float, strong: bool) -> dict:
    A, B = catalog.get(a), catalog.get(b)
    shared_subjects = sorted(set(A["subjects"]) & set(B["subjects"]))
    close = []
    for k in ("warmth", "brightness", "saturation", "detail"):
        if abs(A["variables"][k] - B["variables"][k]) < 0.5 * catalog.stats()[k]["std"]:
            close.append(k)
    return {
        "a": a, "b": b, "similarity": round(sim, 4), "strong": bool(strong),
        "same_artwork": a == b,
        "shared_subjects": shared_subjects,
        "close_variables": close,
        "same_medium": A["brush"] == B["brush"],
        "year_gap": abs(A["year"] - B["year"]),
    }


def _kmeans(X: np.ndarray, k: int, iters: int = 50) -> np.ndarray:
    k = min(k, len(X))
    # deterministic farthest-point init from the point nearest the mean
    c0 = int(np.argmin(np.linalg.norm(X - X.mean(0), axis=1)))
    centers = [X[c0]]
    d = np.linalg.norm(X - X[c0], axis=1)
    while len(centers) < k:
        i = int(np.argmax(d))
        centers.append(X[i])
        d = np.minimum(d, np.linalg.norm(X - X[i], axis=1))
    C = np.array(centers)
    lab = np.zeros(len(X), dtype=int)
    for _ in range(iters):
        new = np.argmin(((X[:, None, :] - C[None]) ** 2).sum(-1), axis=1)
        if (new == lab).all() and _ > 0:
            break
        lab = new
        for c in range(k):
            if (lab == c).any():
                C[c] = X[lab == c].mean(0)
    return lab


def groups(a_ids: list[str], b_ids: list[str], k: int = 3) -> list[dict]:
    union = sorted(set(a_ids) | set(b_ids))
    X = np.array([catalog.embedding(i) for i in union])
    lab = _kmeans(X, k)
    out = []
    for c in sorted(set(lab.tolist())):
        members = [union[i] for i in range(len(union)) if lab[i] == c]
        owners = {"a": [m for m in members if m in a_ids], "b": [m for m in members if m in b_ids]}
        kind = "shared" if owners["a"] and owners["b"] else ("signature_a" if owners["a"] else "signature_b")
        arts = [catalog.get(m) for m in members]
        subj = Counter(s for a in arts for s in a["subjects"]).most_common(1)
        brush = Counter(a["brush"] for a in arts).most_common(1)[0][0]
        label = f"{(subj[0][0] if subj else 'mixed subjects').capitalize()} in {brush}"
        out.append({
            "id": f"g{c}", "kind": kind, "label": label, "artwork_ids": members,
            "owners": owners, "year_span": [min(a["year"] for a in arts), max(a["year"] for a in arts)],
        })
    # shared groups first, then by size
    out.sort(key=lambda g: (g["kind"] != "shared", -len(g["artwork_ids"])))
    return out


def match(ga: dict, gb: dict) -> dict:
    sim = variable_similarity(ga, gb)
    pairs, S = matched_pairs(ga["artwork_ids"], gb["artwork_ids"])
    return {
        "per_variable": sim,
        "score": blend_score(sim),
        "pairs": pairs,
        "groups": groups(ga["artwork_ids"], gb["artwork_ids"]),
        "matrix_mean": round(float(S.mean()), 4),
        "embedding_model": catalog.embedding_model(),
    }
