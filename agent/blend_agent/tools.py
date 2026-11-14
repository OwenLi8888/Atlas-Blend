"""The five research-agent tools. Every fact the panel states must come back from one of these."""
from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
CATALOG_DIR = Path(os.environ.get("CATALOG_DIR", ROOT / "catalog" / "data"))
CACHE = CATALOG_DIR / "cache" / "museum"
VARS = ["warmth", "brightness", "saturation", "detail", "era"]

_catalog: dict[str, dict] | None = None
_blends: dict[str, dict] = {}       # blend_id -> blend result (from the blend service)
_panels: dict[str, dict] = {}       # blend_id -> validated panel
_lock = threading.Lock()


def catalog() -> dict[str, dict]:
    global _catalog
    if _catalog is None:
        arts = json.loads((CATALOG_DIR / "artworks.json").read_text(encoding="utf-8"))
        _catalog = {a["id"]: a for a in arts}
    return _catalog


def register_blend(blend: dict) -> None:
    _blends[blend["blend_id"]] = blend


def saved_panel(blend_id: str) -> dict | None:
    return _panels.get(blend_id)


def source_artwork_ids(blend: dict) -> list[str]:
    return list(dict.fromkeys(r["id"] for r in blend["references"]))


def owner_of(blend: dict, aid: str) -> str:
    a = aid in blend["gallery_a"]["artwork_ids"]
    b = aid in blend["gallery_b"]["artwork_ids"]
    na, nb = blend["users"]["a"]["name"], blend["users"]["b"]["name"]
    return "both" if a and b else na if a else nb if b else "neither (bridge)"


# ------------------------------------------------------------------- the tools
def get_blend_packet(blend_id: str) -> dict:
    """Matched pairs, groups, per-variable similarity, variable stats for person A, person B and
    the painting, and the source artwork IDs for one blend."""
    b = _blends.get(blend_id)
    if not b:
        return {"error": f"unknown blend {blend_id}"}
    na, nb = b["users"]["a"]["name"], b["users"]["b"]["name"]
    cat = catalog()
    return {
        "blend_id": blend_id,
        "people": {"a": na, "b": nb},
        "score": b["score"],
        "per_variable_similarity": b["per_variable"],
        "matched_pairs": [
            {**p, "a_title": cat[p["a"]]["title"], "b_title": cat[p["b"]]["title"],
             "a_owner": na, "b_owner": nb} for p in b["pairs"]],
        "groups": [{"id": g["id"], "kind": g["kind"], "label": g["label"], "year_span": g["year_span"],
                    "artwork_ids": g["artwork_ids"], "count_a": len(g["owners"]["a"]),
                    "count_b": len(g["owners"]["b"])} for g in b["groups"]],
        "bridge_artwork_id": b["bridge_id"],
        "source_artwork_ids": source_artwork_ids(b),
        "painting_medium": b["medium"],
        "stats": {"a": _scalar(b["gallery_a"]["means"]), "b": _scalar(b["gallery_b"]["means"]),
                  "painting": _scalar(b["painting_variables"])},
        "top_subjects": {"a": b["gallery_a"]["top_subjects"], "b": b["gallery_b"]["top_subjects"]},
        "top_hues": {"a": b["gallery_a"]["top_hues"], "b": b["gallery_b"]["top_hues"]},
    }


def get_artwork(artwork_id: str) -> dict:
    """Catalog record for one artwork: title, artist, year, medium, subjects, variables, source URL."""
    a = catalog().get(artwork_id)
    if not a:
        return {"error": f"unknown artwork {artwork_id}"}
    keys = ("id", "title", "artist", "year", "date_display", "medium", "brush", "style", "place",
            "subjects", "source_url", "license")
    return {**{k: a.get(k) for k in keys}, "variables": _scalar(a["variables"])}


def museum_record(artwork_id: str) -> dict:
    """The museum's public API record (Art Institute of Chicago): date, medium, place, a short
    history line and the public URL. Cached on disk."""
    a = catalog().get(artwork_id)
    if not a:
        return {"error": f"unknown artwork {artwork_id}"}
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{artwork_id}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    url = (f"https://api.artic.edu/api/v1/artworks/{a['museum_id']}?fields=id,title,artist_display,"
           "date_display,medium_display,place_of_origin,short_description,description,credit_line,"
           "style_title,dimensions,provenance_text,exhibition_history")
    try:
        r = httpx.get(url, headers={"AIC-User-Agent": "BlendHackathonAgent/0.1"}, timeout=12)
        r.raise_for_status()
        d = r.json()["data"]
    except Exception as e:
        return {"artwork_id": artwork_id, "error": f"museum API unavailable: {e}",
                "link": a["source_url"]}
    text = _strip_html(d.get("short_description") or d.get("description") or "")
    rec = {
        "artwork_id": artwork_id,
        "title": d.get("title"),
        "artist_display": d.get("artist_display"),
        "date_display": d.get("date_display"),
        "medium": d.get("medium_display"),
        "place_of_origin": d.get("place_of_origin"),
        "style": d.get("style_title"),
        "credit_line": d.get("credit_line"),
        "history_text": text[:700],
        "provenance_text": _strip_html(d.get("provenance_text") or "")[:600],
        "exhibition_history": _strip_html((d.get("exhibition_history") or "").split("\n")[0])[:300],
        "link": a["source_url"],
        "source": "Art Institute of Chicago API",
    }
    path.write_text(json.dumps(rec, indent=1, ensure_ascii=False), encoding="utf-8")
    return rec


def history_line(rec: dict, limit: int = 30) -> str:
    """One grounded line from a museum record: description, else first exhibition, else
    the latest provenance step, else the credit line."""
    def first(t: str) -> str:
        sent = re.split(r"(?<=[.!?])\s+", t.strip())[0]
        w = sent.split()
        return " ".join(w[:limit]) + ("..." if len(w) > limit else "")
    if rec.get("history_text"):
        return first(rec["history_text"])
    if rec.get("exhibition_history"):
        return "Exhibited: " + first(rec["exhibition_history"])
    if rec.get("provenance_text"):
        steps = [x.strip() for x in re.split(r"[;.]\s+", rec["provenance_text"]) if x.strip()]
        return "Provenance: " + first(steps[-1]) if steps else ""
    if rec.get("credit_line"):
        return rec["credit_line"]
    return ""


def compare_stats(blend_id: str) -> dict:
    """Per-variable gaps between person A, person B and the painting (painting minus each)."""
    b = _blends.get(blend_id)
    if not b:
        return {"error": f"unknown blend {blend_id}"}
    A, B, P = _scalar(b["gallery_a"]["means"]), _scalar(b["gallery_b"]["means"]), _scalar(b["painting_variables"])
    T = _scalar(b["targets"])
    return {k: {"a": A[k], "b": B[k], "painting": P[k], "target": T[k],
                "a_minus_b": round(A[k] - B[k], 3), "painting_minus_target": round(P[k] - T[k], 3),
                "similarity": b["per_variable"][k], "leaning": b["weights"]["dominance"][k]}
            for k in VARS}


def write_panel(blend_id: str, panel_json: str) -> dict:
    """Validate and save the side panel. Fields: combined_from, notable_qualities (3 short
    bullets), why_matched (2-3 sentences citing the matched pairs), source_history (one entry per
    source artwork: artwork_id, title, artist, year, medium, history, link). Anything whose year
    or medium does not match the catalog is dropped; the response says what was dropped."""
    from .validator import validate
    b = _blends.get(blend_id)
    if not b:
        return {"error": f"unknown blend {blend_id}"}
    try:
        raw = json.loads(panel_json) if isinstance(panel_json, str) else panel_json
    except json.JSONDecodeError as e:
        return {"error": f"panel_json is not valid JSON: {e}"}
    panel, dropped = validate(raw, b, catalog())
    with _lock:
        _panels[blend_id] = panel
    return {"saved": True, "dropped": dropped}


# ------------------------------------------------------------------- helpers
def _scalar(v: dict) -> dict:
    out = {}
    for k in VARS:
        x = v.get(k)
        out[k] = round(float(x), 3) if x is not None else None
    return out


def _strip_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()
