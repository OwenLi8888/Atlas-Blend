"""Grounding check for the side panel.

* combined_from, era_span and stats are rebuilt from the blend output and catalog (never trusted
  from the model).
* source_history entries must name a source artwork, and their year and medium must match the
  catalog record; mismatching entries are dropped.
* Free text (notable qualities, why-you-matched) may only mention years and mediums that occur
  in the source / gallery artworks; sentences or bullets that don't are dropped.
"""
from __future__ import annotations

import re

MEDIUM_WORDS = ["oil", "watercolor", "watercolour", "ink", "pastel", "gouache", "tempera",
                "charcoal", "chalk", "graphite", "woodblock", "woodcut", "etching", "lithograph",
                "engraving", "fresco", "acrylic"]
YEAR_RE = re.compile(r"\b(1[0-9]{3})s?\b")
SENT_RE = re.compile(r"(?<=[.!?])\s+")


def _allowed(blend: dict, catalog: dict) -> tuple[set[int], set[str], list[str]]:
    ids = set(blend["gallery_a"]["artwork_ids"]) | set(blend["gallery_b"]["artwork_ids"])
    ids |= {r["id"] for r in blend["references"]}
    years, mediums = set(), set()
    for i in ids:
        a = catalog[i]
        years.add(int(a["year"]))
        for d in re.findall(r"\b1[0-9]{3}\b", a.get("date_display") or ""):
            years.add(int(d))
        m = a["medium"].lower()
        mediums |= {w for w in MEDIUM_WORDS if w in m}
        mediums.add(a["brush"])
    years |= {(y // 10) * 10 for y in years} | {(y // 100) * 100 for y in years}
    if "watercolor" in mediums:
        mediums.add("watercolour")
    return years, mediums, sorted(ids)


def _text_ok(text: str, years: set[int], mediums: set[str]) -> bool:
    for y in YEAR_RE.findall(text):
        if int(y) not in years:
            return False
    low = text.lower()
    for w in MEDIUM_WORDS:
        if re.search(rf"\b{w}s?\b", low) and w not in mediums:
            return False
    return True


def stats_block(blend: dict) -> dict:
    keys = ["warmth", "brightness", "saturation", "detail", "era"]
    def pick(d):
        return {k: (round(float(d[k]), 3) if d.get(k) is not None else None) for k in keys} | {"hue": d.get("hue")}
    return {"a": pick(blend["gallery_a"]["means"]), "b": pick(blend["gallery_b"]["means"]),
            "painting": pick(blend["painting_variables"])}


def combined_from(blend: dict, catalog: dict) -> list[dict]:
    na, nb = blend["users"]["a"]["name"], blend["users"]["b"]["name"]
    out = []
    for g in blend["groups"][:3]:
        owner = {"shared": f"{na} + {nb}", "signature_a": na, "signature_b": nb}[g["kind"]]
        out.append({
            "group_id": g["id"], "label": g["label"], "kind": g["kind"], "whose": owner,
            "year_span": g["year_span"],
            "artworks": [{"id": i, "title": catalog[i]["title"], "image_path": catalog[i]["image_path"],
                          "owner": ("both" if i in g["owners"]["a"] and i in g["owners"]["b"]
                                    else na if i in g["owners"]["a"] else nb)}
                         for i in g["artwork_ids"][:6]],
        })
    return out


def validate(raw: dict, blend: dict, catalog: dict) -> tuple[dict, list[str]]:
    years, mediums, _ = _allowed(blend, catalog)
    dropped: list[str] = []
    sources = list(dict.fromkeys(r["id"] for r in blend["references"]))

    history = []
    for e in raw.get("source_history") or []:
        aid = e.get("artwork_id")
        if aid not in sources:
            dropped.append(f"source_history entry for non-source artwork {aid!r}")
            continue
        a = catalog[aid]
        if e.get("year") is not None and int(e["year"]) != int(a["year"]):
            dropped.append(f"{aid}: year {e['year']} != catalog {a['year']}")
            continue
        if e.get("medium") and e["medium"].strip().lower() != a["medium"].strip().lower():
            dropped.append(f"{aid}: medium {e['medium']!r} != catalog {a['medium']!r}")
            continue
        hist = (e.get("history") or "").strip()
        # years in a history line are grounded if they appear in this artwork's museum record
        from .tools import museum_record
        rec = museum_record(aid)
        rec_text = " ".join(str(rec.get(k) or "") for k in (
            "date_display", "history_text", "provenance_text", "exhibition_history", "credit_line"))
        own_text = (a.get("date_display") or "") + " " + rec_text
        own_years = {int(a["year"])} | {int(y) for y in re.findall(r"\b1[0-9]{3}\b", own_text)}
        if hist and not _text_ok(hist, years | own_years, mediums):
            dropped.append(f"{aid}: history line mentions an ungrounded year/medium")
            hist = ""
        history.append({"artwork_id": aid, "title": a["title"], "artist": a["artist"],
                        "year": a["year"], "medium": a["medium"], "history": hist,
                        "link": a["source_url"], "image_path": a["image_path"]})
    # every source artwork gets a line, even if the model skipped it (catalog facts only)
    have = {h["artwork_id"] for h in history}
    for aid in sources:
        if aid not in have:
            a = catalog[aid]
            history.append({"artwork_id": aid, "title": a["title"], "artist": a["artist"],
                            "year": a["year"], "medium": a["medium"], "history": "",
                            "link": a["source_url"], "image_path": a["image_path"]})
    history.sort(key=lambda h: sources.index(h["artwork_id"]))

    qualities = []
    for q in (raw.get("notable_qualities") or [])[:5]:
        if _text_ok(q, years, mediums):
            qualities.append(q.strip())
        else:
            dropped.append(f"quality dropped (ungrounded year/medium): {q!r}")
    why_sents = [s for s in SENT_RE.split((raw.get("why_matched") or "").strip()) if s]
    why = []
    for s in why_sents:
        if _text_ok(s, years, mediums):
            why.append(s)
        else:
            dropped.append(f"why-matched sentence dropped: {s!r}")

    src_years = [catalog[i]["year"] for i in sources]
    panel = {
        "combined_from": combined_from(blend, catalog),
        "era_span": {"start": min(src_years), "end": max(src_years)},
        "stats": stats_block(blend),
        "notable_qualities": qualities[:3],
        "why_matched": " ".join(why[:3]),
        "source_history": history,
        "score": blend["score"],
        "dropped": dropped,
    }
    return panel, dropped
