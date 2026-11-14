"""Catalog access + catalog-wide statistics used for scaling."""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import numpy as np

from .variables import SCALAR_VARS

ROOT = Path(__file__).resolve().parents[2]
CATALOG_DIR = Path(os.environ.get("CATALOG_DIR", ROOT / "catalog" / "data"))


@lru_cache(maxsize=1)
def artworks() -> dict[str, dict]:
    arts = json.loads((CATALOG_DIR / "artworks.json").read_text(encoding="utf-8"))
    return {a["id"]: a for a in arts}


@lru_cache(maxsize=1)
def quiz_rounds() -> list[dict]:
    return json.loads((CATALOG_DIR / "quiz_rounds.json").read_text(encoding="utf-8"))


def get(aid: str) -> dict:
    try:
        return artworks()[aid]
    except KeyError:
        raise KeyError(f"unknown artwork id {aid!r}") from None


def image_path(aid: str) -> Path:
    return CATALOG_DIR / get(aid)["image_path"]


def embedding(aid: str) -> np.ndarray:
    return np.asarray(get(aid)["clip_embedding"], dtype=float)


@lru_cache(maxsize=1)
def stats() -> dict:
    """Per-variable catalog mean, std and range (R_k in the PRD)."""
    arts = list(artworks().values())
    out = {}
    for k in SCALAR_VARS:
        v = np.array([a["variables"][k] for a in arts], dtype=float)
        out[k] = {"mean": float(v.mean()), "std": float(v.std()), "min": float(v.min()),
                  "max": float(v.max()), "range": float(np.ptp(v))}
    return out


def embedding_model() -> str:
    return next(iter(artworks().values())).get("embedding_model", "unknown")
