# Research agent (LangChain deepagents)

Fills the side panel. It may only state facts that came back from its tools.

* **Plan**: the main agent writes a todo list with deepagents' built-in `write_todos`; every
  todo change is streamed to the app as progress.
* **Subagents**: one `artwork-researcher` per source artwork (spawned in parallel with the
  built-in `task` tool), each calling `get_artwork` + `museum_record` (Art Institute of Chicago API).
* **Synthesis**: the main agent calls `compare_stats`, then `write_panel` with notable qualities,
  the 2 to 3 sentence "why you matched" blurb (citing the actual matched pairs) and one history
  line per source artwork.
* **Check**: `validator.py` rebuilds combined groups, era span and stats from the blend output,
  drops any history entry whose year or medium differs from the catalog, and drops any sentence
  mentioning a year or medium that isn't in the source artworks (a history line may also use
  years from that artwork's own museum record).

| Tool | Returns |
|---|---|
| `get_blend_packet(blend_id)` | Pairs, groups, stats, artwork IDs |
| `get_artwork(id)` | Catalog record |
| `museum_record(id)` | Museum API record and URL (cached on disk) |
| `compare_stats(blend_id)` | Per-variable gaps between A, B and the painting |
| `write_panel(blend_id, panel_json)` | Saves the validated panel |

Model: `claude-opus-5-5` (`AGENT_MODEL`). With no `ANTHROPIC_API_KEY`, or if the LLM run fails,
a deterministic run with the same plan, per-artwork researchers, tools and validator writes the
panel instead, and the panel's `agent.mode` says which one ran. Panels are cached by blend ID.

```
pip install -r requirements.txt
python -m blend_agent --blend ../data/runtime/<id>/blend.json [--mode auto|llm|fallback]
```
