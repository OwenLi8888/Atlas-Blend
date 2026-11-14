"""Agent CLI. Reads the blend service result (JSON file), streams JSON lines on stdout:
{"event":"todos"}, {"event":"step"}, then {"event":"result","data":panel}.

    python -m blend_agent --blend path/to/blend.json [--out panel.json] [--mode auto|llm|fallback]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")


def emit(ev: dict) -> None:
    sys.stdout.write(json.dumps(ev, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", required=True)
    ap.add_argument("--out")
    ap.add_argument("--mode", default=os.environ.get("AGENT_MODE", "auto"))
    args = ap.parse_args()
    blend = json.loads(Path(args.blend).read_text(encoding="utf-8"))
    out = Path(args.out) if args.out else Path(args.blend).with_name("panel.json")
    if out.exists():  # cached by blend id
        emit({"event": "step", "detail": "Loaded cached panel"})
        emit({"event": "result", "data": json.loads(out.read_text(encoding="utf-8"))})
        return

    t0 = time.time()
    use_llm = args.mode == "llm" or (args.mode == "auto" and os.environ.get("ANTHROPIC_API_KEY"))
    panel, mode = None, "fallback"
    if use_llm:
        try:
            from .agent import run_llm, MODEL
            panel, mode = run_llm(blend, emit), f"deepagents:{MODEL}"
        except Exception as e:
            emit({"event": "step", "detail": f"LLM agent failed ({type(e).__name__}); using grounded fallback"})
            sys.stderr.write(f"[agent] {e!r}\n")
    if panel is None:
        from .fallback import run_fallback
        panel = run_fallback(blend, emit)
    panel["agent"] = {"mode": mode, "seconds": round(time.time() - t0, 1)}
    out.write_text(json.dumps(panel, indent=1, ensure_ascii=False), encoding="utf-8")
    emit({"event": "result", "data": panel})


if __name__ == "__main__":
    main()
