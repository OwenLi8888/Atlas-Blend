"""Deterministic research run used when no LLM key is configured (or the LLM run fails).

Same shape as the deepagents run: a todo plan, one researcher per source artwork (threads),
compare_stats, then write_panel through the same validator. Text is templated from tool results.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from . import tools as T

WORDS = {
    "warmth": ("cool", "warm"), "brightness": ("dark", "bright"),
    "saturation": ("muted", "vivid"), "detail": ("sparse", "detailed"),
}


def run_fallback(blend: dict, emit: Callable[[dict], None]) -> dict:
    T.register_blend(blend)
    bid = blend["blend_id"]
    packet = T.get_blend_packet(bid)
    cat = T.catalog()
    sources = packet["source_artwork_ids"]
    todos = [{"content": f"Research {cat[a]['title']} ({cat[a]['year']})", "status": "pending"} for a in sources]
    todos += [{"content": "Compare stats", "status": "pending"}, {"content": "Write the panel", "status": "pending"}]
    emit({"event": "todos", "todos": todos})

    def research(aid: str) -> dict:
        a = T.get_artwork(aid)
        who = a["artist"].split(",")[0].split()[-1] if a["artist"] else "artist"
        emit({"event": "step", "detail": f"Looking up the {a['year']} {who}...", "subagent": True})
        rec = T.museum_record(aid)
        return {"artwork_id": aid, "title": a["title"], "artist": a["artist"], "year": a["year"],
                "medium": a["medium"], "history": T.history_line(rec),
                "link": a["source_url"]}

    for t in todos[:len(sources)]:
        t["status"] = "in_progress"
    emit({"event": "todos", "todos": todos})
    with ThreadPoolExecutor(max_workers=5) as ex:
        history = list(ex.map(research, sources))
    for t in todos[:len(sources)]:
        t["status"] = "completed"
    todos[-2]["status"] = "in_progress"
    emit({"event": "todos", "todos": todos})

    stats = T.compare_stats(bid)
    na, nb = packet["people"]["a"], packet["people"]["b"]
    qualities = []
    close = sorted((k for k in WORDS if stats[k]["similarity"] >= 0.7),
                   key=lambda k: -abs(stats[k]["a"] + stats[k]["b"]))
    for k in close[:2]:
        lo, hi = WORDS[k]
        mid = {"warmth": 0, "brightness": 50, "saturation": 12, "detail": 0.07}[k]
        word = hi if (stats[k]["a"] + stats[k]["b"]) / 2 > mid else lo
        qualities.append(f"Both galleries lean {word}")
    far = sorted((k for k in WORDS if stats[k]["similarity"] < 0.7), key=lambda k: stats[k]["similarity"])
    for k in far[:1]:
        lo, hi = WORDS[k]
        a_word = hi if stats[k]["a"] > stats[k]["b"] else lo
        b_word = lo if a_word == hi else hi
        qualities.append(f"{na} brings the {a_word} side, {nb} the {b_word}")
    shared_subj = sorted(set(packet["top_subjects"]["a"]) & set(packet["top_subjects"]["b"]))
    if shared_subj:
        qualities.append(f"Shared subject: {shared_subj[0]}")
    if len(qualities) < 3:
        qualities.append(f"Painted with a {packet['painting_medium']} brush set")

    pairs = packet["matched_pairs"]
    sents = []
    same = [p["a_title"] for p in pairs if p["same_artwork"]][:2]
    if same:
        sents.append(f"You both picked {' and '.join(same)}.")
    for p in [p for p in pairs if not p["same_artwork"]][:2]:
        what = ", ".join(p["shared_subjects"][:2]) or "composition"
        close_v = " and ".join(p["close_variables"][:2])
        extra = f", with close {close_v}" if close_v else ""
        sents.append(f"{na}'s {p['a_title']} pairs with {nb}'s {p['b_title']}: both share {what}{extra}.")
    sents.append(f"Your galleries scored {packet['score']} out of 100 across the six variables.")
    emit({"event": "step", "detail": "Writing the panel"})
    import json
    res = T.write_panel(bid, json.dumps({"notable_qualities": qualities[:3], "why_matched": " ".join(sents[:3]),
                                         "source_history": history}))
    todos[-2]["status"] = todos[-1]["status"] = "completed"
    emit({"event": "todos", "todos": todos})
    panel = T.saved_panel(bid)
    if panel is None:
        raise RuntimeError(f"fallback could not save panel: {res}")
    return panel
