"""Research agent (M9) on LangChain deepagents.

Main agent: plans with the built-in todo tool, spawns one `artwork-researcher` subagent per
source artwork (via the built-in `task` tool), then writes the panel with `write_panel`.
Subagent: calls get_artwork + museum_record for exactly one artwork and returns grounded facts.
"""
from __future__ import annotations

import json
import os
from typing import Callable

from . import tools as T

MODEL = os.environ.get("AGENT_MODEL", "claude-opus-5-5")

MAIN_PROMPT = """You write the side panel for Blend, an app that paints a new artwork from two \
people's art galleries. You may ONLY state facts that came back from your tools. Never use \
outside knowledge for dates, mediums, places or history.

Steps:
1. Call get_blend_packet(blend_id). Then write a todo list with write_todos: one todo per source \
artwork ("Research <title> (<year>)"), one for compare_stats, one for writing the panel.
2. For EVERY source artwork, delegate to the `artwork-researcher` subagent with the task tool \
(one task per artwork, run them in parallel). Give it the artwork_id.
3. Call compare_stats(blend_id).
4. Call write_panel(blend_id, panel_json) with a JSON object:
   {"notable_qualities": [3 short bullets, under 14 words each, grounded in the stats, \
subjects or records, e.g. "Both galleries favor low horizons"],
    "why_matched": "2 to 3 plain sentences that cite the actual matched pairs by title and say \
what they share (subject, palette, detail). Use the people's names.",
    "source_history": [{"artwork_id", "title", "artist", "year", "medium", "history": "one line \
from the museum record", "link"} for each source artwork]}
   Copy year and medium EXACTLY from get_artwork. If write_panel reports dropped items, fix \
them and call write_panel again (at most twice).
5. Reply with the single word DONE.

Style: plain, warm, specific. No long story, no hype words, no em dashes."""

RESEARCHER_PROMPT = """You research ONE artwork for Blend's side panel. Call get_artwork(artwork_id) \
and museum_record(artwork_id). Return a compact JSON object: {"artwork_id", "title", "artist", \
"year" (from get_artwork), "medium" (from get_artwork, exact string), "history" (ONE sentence, \
max 30 words, paraphrasing only the museum record: history_text, else exhibition_history, \
else provenance_text; empty string if there is none), "link"}. Never add facts that are not in the tool results."""


def build_agent():
    from deepagents import create_deep_agent
    from langchain_anthropic import ChatAnthropic

    model = ChatAnthropic(model=MODEL, max_tokens=8000, timeout=90, max_retries=2)
    researcher = {
        "name": "artwork-researcher",
        "description": "Researches exactly one source artwork: catalog record + museum record. "
                       "Input: the artwork_id. Output: grounded JSON with title, artist, year, "
                       "medium, one-line history and link.",
        "system_prompt": RESEARCHER_PROMPT,
        "tools": [T.get_artwork, T.museum_record],
        "model": model,
    }
    return create_deep_agent(
        model=model,
        tools=[T.get_blend_packet, T.get_artwork, T.museum_record, T.compare_stats, T.write_panel],
        system_prompt=MAIN_PROMPT,
        subagents=[researcher],
        name="blend-researcher",
    )


def run_llm(blend: dict, emit: Callable[[dict], None]) -> dict:
    T.register_blend(blend)
    agent = build_agent()
    blend_id = blend["blend_id"]
    titles = {aid: T.catalog()[aid] for aid in T.source_artwork_ids(blend)}
    seen_todos = None
    msg = {"messages": [{"role": "user", "content": f"Write the side panel for blend_id={blend_id}."}]}
    for ns, chunk in agent.stream(msg, stream_mode="updates", subgraphs=True, config={"recursion_limit": 80}):
        for node, update in (chunk or {}).items():
            if not isinstance(update, dict):
                continue
            todos = update.get("todos")
            if todos and todos != seen_todos:
                seen_todos = todos
                emit({"event": "todos", "todos": [_todo(t) for t in todos]})
            for m in update.get("messages") or []:
                for tc in getattr(m, "tool_calls", None) or []:
                    emit({"event": "step", "detail": _describe(tc, titles), "subagent": bool(ns)})
    panel = T.saved_panel(blend_id)
    if panel is None:
        raise RuntimeError("agent finished without a saved panel")
    return panel


def _todo(t) -> dict:
    if isinstance(t, dict):
        return {"content": t.get("content"), "status": t.get("status")}
    return {"content": getattr(t, "content", str(t)), "status": getattr(t, "status", "pending")}


def _describe(tc: dict, titles: dict) -> str:
    name, args = tc.get("name"), tc.get("args") or {}
    aid = args.get("artwork_id")
    if name == "task":
        desc = json.dumps(args)[:200]
        for a in titles.values():
            if a["id"] in desc or a["title"][:20] in desc:
                return f"Subagent researching {a['title']} ({a['year']})"
        return "Spawning artwork researcher"
    if name in ("museum_record", "get_artwork") and aid in titles:
        a = titles[aid]
        who = a["artist"].split(",")[0].split()[-1] if a["artist"] else "artist"
        return f"Looking up the {a['year']} {who}..."
    return {"get_blend_packet": "Reading the blend packet", "compare_stats": "Comparing stats",
            "write_panel": "Writing the panel", "write_todos": "Planning"}.get(name, name or "")
