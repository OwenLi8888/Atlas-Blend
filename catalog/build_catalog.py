"""Build the Blend catalog (M1) and quiz rounds (M2 design).

Pulls public-domain artworks from the Art Institute of Chicago open-access API, downloads a
400px image of each, measures the six variables, computes an embedding per artwork (CLIP when
torch/transformers are installed, otherwise a deterministic fallback), and designs 5 balanced
quiz rounds of 4.

    python catalog/build_catalog.py            # full build (network)
    python catalog/build_catalog.py --reembed  # recompute variables/embeddings from cached images
    python catalog/build_catalog.py --quiz     # redesign quiz rounds only
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import httpx
import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "blend"))

from blend.variables import measure, SCALAR_VARS  # noqa: E402
from blend import embed  # noqa: E402

DATA = ROOT / "data"
IMAGES = DATA / "images"
CATALOG = DATA / "artworks.json"
QUIZ = DATA / "quiz_rounds.json"
UA = {"User-Agent": "BlendHackathonCatalog/0.1", "AIC-User-Agent": "BlendHackathonCatalog/0.1"}
API = "https://api.artic.edu/api/v1/artworks/search"
IIIF = "https://www.artic.edu/iiif/2/{}/full/400,/0/default.jpg"
FIELDS = ("id,title,artist_title,date_start,date_end,date_display,medium_display,image_id,"
          "classification_title,term_titles,style_title,is_public_domain,place_of_origin,"
          "artwork_type_title,thumbnail")

# (search terms, how many to keep). Chosen to cover dark/light, warm/cool, sparse/detailed,
# several centuries and the five brush mediums.
QUERIES = [
    ("landscape oil painting impressionism", 10), ("seascape", 7), ("river landscape", 5),
    ("watercolor landscape", 9), ("watercolor", 6), ("japanese woodblock print", 7),
    ("ink drawing", 6), ("chinese ink painting", 4), ("pastel", 8), ("gouache", 6),
    ("portrait oil", 7), ("figures dancers", 4), ("still life", 7), ("flowers", 6),
    ("architecture city", 6), ("night", 5), ("animals horse", 4), ("birds", 4),
    ("religious renaissance", 6), ("dutch golden age", 4), ("winter snow", 4),
    ("garden", 4), ("abstract", 4), ("interior", 4),
]
OK_ARTWORK_TYPES = {"Painting", "Drawing and Watercolor", "Print"}

MEDIUM_RULES = [  # first match wins -> brush set
    ("watercolor", "watercolor"), ("water color", "watercolor"), ("wash", "watercolor"),
    ("pastel", "pastel"), ("chalk", "pastel"), ("crayon", "pastel"), ("charcoal", "pastel"),
    ("gouache", "gouache"), ("tempera", "gouache"), ("distemper", "gouache"),
    ("ink", "ink"), ("woodblock", "ink"), ("woodcut", "ink"), ("etching", "ink"),
    ("engraving", "ink"), ("lithograph", "ink"), ("pen", "ink"), ("graphite", "ink"),
    ("oil", "oil"),
]
SUBJECT_KEYWORDS = {
    "landscape": ["landscape", "landscapes", "fields", "mountains", "trees", "countryside", "hills"],
    "water": ["water", "sea", "seascape", "river", "rivers", "ocean", "boats", "harbor", "lake", "waves", "marine"],
    "figures": ["figures", "women", "men", "people", "dancers", "children", "genre"],
    "portrait": ["portrait", "portraits", "self-portrait"],
    "architecture": ["architecture", "buildings", "cityscapes", "city", "cathedral", "church", "bridge", "streets"],
    "animals": ["animals", "horse", "horses", "birds", "dogs", "cats", "cattle", "animal"],
    "still life": ["still life", "still lifes", "fruit"],
    "flowers": ["flowers", "flower", "botanical"],
    "interior": ["interiors", "interior", "domestic scenes"],
    "religious": ["religious", "christianity", "saints", "madonna", "virgin", "buddhism", "biblical"],
    "night": ["night", "moon", "nocturne"],
    "abstract": ["abstraction", "abstract", "modernism"],
}


def brush_for(medium: str) -> str:
    m = (medium or "").lower()
    for key, brush in MEDIUM_RULES:
        if key in m:
            return brush
    return "oil"


def subjects_for(terms: list[str], title: str) -> list[str]:
    blob = " ".join([t.lower() for t in terms or []] + [title.lower()])
    return [s for s, kws in SUBJECT_KEYWORDS.items() if any(k in blob for k in kws)]


def fetch_candidates(client: httpx.Client) -> list[dict]:
    seen, keep = set(), []
    for q, n in QUERIES:
        params = {"q": q, "limit": 60, "fields": FIELDS,
                  "query[term][is_public_domain]": "true"}
        try:
            r = client.get(API, params=params, timeout=30)
            r.raise_for_status()
        except Exception as e:  # keep going; one bad query shouldn't sink the build
            print(f"  ! query {q!r} failed: {e}")
            continue
        got = 0
        for a in r.json()["data"]:
            if got >= n:
                break
            if a["id"] in seen or not a.get("image_id") or not a.get("is_public_domain"):
                continue
            if a.get("artwork_type_title") not in OK_ARTWORK_TYPES:
                continue
            year = a.get("date_end") or a.get("date_start")
            if not year or not a.get("medium_display") or not a.get("title"):
                continue
            seen.add(a["id"])
            keep.append(a)
            got += 1
        print(f"  {q!r}: +{got}")
        time.sleep(0.3)
    return keep


def download(client: httpx.Client, a: dict) -> Path | None:
    path = IMAGES / f"aic-{a['id']}.jpg"
    if path.exists() and path.stat().st_size > 2000:
        return path
    try:
        r = client.get(IIIF.format(a["image_id"]), timeout=40)
        r.raise_for_status()
        path.write_bytes(r.content)
        return path
    except Exception as e:
        print(f"  ! image {a['id']} failed: {e}")
        return None


def record(a: dict) -> dict:
    medium = a["medium_display"]
    return {
        "id": f"aic-{a['id']}",
        "museum": "aic",
        "museum_id": a["id"],
        "title": a["title"],
        "artist": a.get("artist_title") or "Unknown artist",
        "year": int(a.get("date_end") or a.get("date_start")),
        "date_display": a.get("date_display"),
        "medium": medium,
        "brush": brush_for(medium),
        "style": a.get("style_title"),
        "place": a.get("place_of_origin"),
        "subjects": subjects_for(a.get("term_titles") or [], a["title"]),
        "image_url": IIIF.format(a["image_id"]),
        "image_path": f"images/aic-{a['id']}.jpg",
        "source_url": f"https://www.artic.edu/artworks/{a['id']}",
        "license": "CC0 (Art Institute of Chicago public domain)",
        "alt_text": (a.get("thumbnail") or {}).get("alt_text"),
    }


def compute_features(arts: list[dict]) -> None:
    paths = [str(DATA / a["image_path"]) for a in arts]
    for a, p in zip(arts, paths):
        a["variables"] = measure(p, a["year"])
    use_clip = embed.clip_available()
    print(f"  embeddings: {'CLIP ' + embed.CLIP_MODEL if use_clip else 'fallback layout embedding'}")
    if use_clip:
        E = embed.clip_image_embeddings(paths)
        S = embed.clip_subject_scores(E)
        for a, e, s in zip(arts, E, S):
            a["clip_embedding"] = [round(float(x), 5) for x in e]
            a["embedding_model"] = embed.CLIP_MODEL
            # Merge zero-shot CLIP subjects with museum tags
            top = [embed.SUBJECTS[i] for i in np.argsort(-s)[:2] if s[i] > 0.2]
            a["subjects"] = sorted(set(a["subjects"]) | set(top))
    else:
        for a, p in zip(arts, paths):
            a["clip_embedding"] = [round(float(x), 5) for x in embed.fallback_embedding(p, a["subjects"])]
            a["embedding_model"] = "fallback-layout-v1"


def trim(arts: list[dict], cap: int = 120) -> list[dict]:
    """Drop the most redundant artworks (nearest embedding neighbour within the most common
    brush) until the catalog fits the 80-120 range."""
    from collections import Counter
    arts = list(arts)
    while len(arts) > cap:
        common = Counter(a["brush"] for a in arts).most_common(1)[0][0]
        idx = [i for i, a in enumerate(arts) if a["brush"] == common]
        E = np.array([arts[i]["clip_embedding"] for i in idx])
        sim = E @ E.T
        np.fill_diagonal(sim, -1)
        i, _ = np.unravel_index(np.argmax(sim), sim.shape)
        arts.pop(idx[i])
    return arts


# ------------------------------------------------------------------ quiz design
def design_quiz(arts: list[dict], rounds: int = 5, per: int = 4) -> list[dict]:
    """Pick 20 artworks by farthest-point sampling over normalized variables + medium + subject,
    then deal them into rounds so each round mixes mediums and varies >= 2 variables."""
    keys = ["warmth", "brightness", "saturation", "detail", "era"]
    X = np.array([[a["variables"][k] for k in keys] for a in arts], dtype=float)
    X = (X - X.min(0)) / (np.ptp(X, 0) + 1e-9)
    brushes = sorted({a["brush"] for a in arts})
    B = np.array([[1.0 if a["brush"] == b else 0.0 for b in brushes] for a in arts]) * 0.5
    subj = embed.SUBJECTS
    S = np.array([[1.0 if s in a["subjects"] else 0.0 for s in subj] for a in arts]) * 0.3
    F = np.hstack([X, B, S])
    n = rounds * per
    # deterministic start: the artwork closest to the catalog median
    chosen = [int(np.argmin(np.linalg.norm(F - np.median(F, 0), axis=1)))]
    d = np.linalg.norm(F - F[chosen[0]], axis=1)
    while len(chosen) < n:
        i = int(np.argmax(d))
        chosen.append(i)
        d = np.minimum(d, np.linalg.norm(F - F[i], axis=1))
    pool = list(chosen)
    out = []
    for r in range(rounds):
        group = [pool.pop(0)]
        while len(group) < per:
            def score(j):
                med_bonus = 0.6 if arts[j]["brush"] not in {arts[g]["brush"] for g in group} else 0
                return min(np.linalg.norm(F[j] - F[g]) for g in group) + med_bonus
            j = max(pool, key=score)
            pool.remove(j)
            group.append(j)
        sub = X[group]
        varied = [keys[k] for k in range(len(keys)) if np.ptp(sub[:, k]) > 0.35]
        mediums = sorted({arts[g]["brush"] for g in group})
        out.append({
            "round": r + 1,
            "artwork_ids": [arts[g]["id"] for g in group],
            "design_note": f"varies {', '.join(varied) or 'subject'}; mediums: {', '.join(mediums)}",
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reembed", action="store_true")
    ap.add_argument("--quiz", action="store_true")
    args = ap.parse_args()
    IMAGES.mkdir(parents=True, exist_ok=True)

    if args.quiz:
        arts = json.loads(CATALOG.read_text(encoding="utf-8"))
    elif args.reembed:
        arts = json.loads(CATALOG.read_text(encoding="utf-8"))
        compute_features(arts)
    else:
        with httpx.Client(headers=UA, follow_redirects=True) as client:
            print("searching AIC ...")
            cands = fetch_candidates(client)
            print(f"downloading {len(cands)} images ...")
            arts = []
            for a in cands:
                if download(client, a):
                    arts.append(record(a))
        print(f"measuring {len(arts)} artworks ...")
        compute_features(arts)

    arts = trim(arts)
    CATALOG.write_text(json.dumps(arts, indent=1, ensure_ascii=False), encoding="utf-8")
    quiz = design_quiz(arts)
    QUIZ.write_text(json.dumps(quiz, indent=1), encoding="utf-8")
    from collections import Counter
    print(f"catalog: {len(arts)} artworks -> {CATALOG}")
    print("brushes:", dict(Counter(a["brush"] for a in arts)))
    for k in SCALAR_VARS:
        v = [a["variables"][k] for a in arts]
        print(f"  {k:<11} min {min(v):8.2f}  max {max(v):8.2f}")
    for q in quiz:
        print(f"  round {q['round']}: {q['design_note']}")


if __name__ == "__main__":
    main()
