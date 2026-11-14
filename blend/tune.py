"""Tune / verify matching on 10 simulated test pairs (PRD step 3.3).

Each simulated person has a taste vector over the variables + subjects and plays the real quiz:
in every round they tap each artwork they like (at least one). Checks:
  * determinism: same galleries -> identical result
  * spread: Blend scores across the 10 pairs span >= 40 points
  * dominance: nobody leads more than 4 of 6 merge variables

    python blend/tune.py            # report
    python blend/tune.py --sweep    # sweep RANGE_SCALE
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from blend import catalog, matching  # noqa: E402
from blend.gallery import summarize  # noqa: E402
from blend.merge import variable_targets  # noqa: E402

KEYS = ["warmth", "brightness", "saturation", "detail", "era"]

PERSONAS = {  # z-score preferences (+ subject likes)
    "sunny":     ({"warmth": 1, "brightness": 1, "saturation": 1}, ["landscape", "flowers"]),
    "sunny2":    ({"warmth": 1, "brightness": 0.8, "saturation": 0.6}, ["landscape", "water"]),
    "noir":      ({"warmth": -0.3, "brightness": -1.2, "saturation": -0.8}, ["portrait", "night", "religious"]),
    "noir2":     ({"brightness": -1, "era": -1}, ["religious", "portrait"]),
    "linework":  ({"detail": 1.2, "saturation": -1}, ["architecture", "animals"]),
    "seaside":   ({"warmth": -0.8, "brightness": 0.5}, ["water", "landscape"]),
    "modern":    ({"era": 1.2, "saturation": 0.8}, ["figures", "landscape"]),
    "oldmaster": ({"era": -1.5, "brightness": -0.5}, ["religious", "portrait", "still life"]),
    "botanist":  ({"saturation": 0.6, "detail": 0.4}, ["flowers", "still life", "animals"]),
    "minimal":   ({"detail": -1.2, "saturation": -0.5}, ["water", "landscape"]),
}
PAIRS = [("sunny", "sunny2"), ("noir", "noir2"), ("sunny", "noir"),  # opposite
         ("linework", "modern"), ("seaside", "minimal"), ("oldmaster", "modern"),  # opposite
         ("botanist", "sunny"), ("seaside", "linework"), ("oldmaster", "noir2"), ("minimal", "botanist")]


def play_quiz(persona: str) -> list[str]:
    prefs, subj = PERSONAS[persona]
    st = catalog.stats()
    picks = []
    for r in catalog.quiz_rounds():
        scored = []
        for aid in r["artwork_ids"]:
            a = catalog.get(aid)
            z = {k: (a["variables"][k] - st[k]["mean"]) / st[k]["std"] for k in KEYS}
            s = sum(w * z[k] for k, w in prefs.items()) + 0.8 * len(set(subj) & set(a["subjects"]))
            scored.append((s, aid))
        scored.sort(reverse=True)
        chosen = [aid for s, aid in scored if s > 0.6] or [scored[0][1]]
        picks += chosen[:3]
    return picks


def run(verbose=True):
    gal = {p: summarize(play_quiz(p)) for p in PERSONAS}
    scores = []
    for a, b in PAIRS:
        m1 = matching.match(gal[a], gal[b])
        m2 = matching.match(gal[a], gal[b])
        assert json.dumps(m1, sort_keys=True) == json.dumps(m2, sort_keys=True), "non-deterministic"
        t, w = variable_targets(gal[a], gal[b], m1["per_variable"])
        lead_a = sum(v == "a" for v in w["dominance"].values())
        lead_b = sum(v == "b" for v in w["dominance"].values())
        assert lead_a <= 4 and lead_b <= 4
        scores.append(m1["score"])
        if verbose:
            sims = " ".join(f"{k[:4]}={v:.2f}" for k, v in m1["per_variable"].items())
            print(f"{a:>9} x {b:<9} score {m1['score']:3d}  pairs {len(m1['pairs'])} "
                  f"(top {m1['pairs'][0]['similarity']:.2f})  lead a/b {lead_a}/{lead_b}  {sims}")
    spread = max(scores) - min(scores)
    if verbose:
        print(f"\nscores {sorted(scores)}  spread {spread}  (target >= 40)")
        print("gallery sizes:", {p: len(g['artwork_ids']) for p, g in gal.items()})
        print("titles:", {p: g["title"] for p, g in gal.items()})
    return spread


if __name__ == "__main__":
    if "--sweep" in sys.argv:
        for rs in (1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0):
            matching.RANGE_SCALE = rs
            print(f"RANGE_SCALE {rs}: spread {run(verbose=False)}")
    else:
        run()
