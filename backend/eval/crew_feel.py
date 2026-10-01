#!/usr/bin/env python3
"""Live group-chat transcripts: does it read like a group, not a queue?

Plays four scripted group conversations through the real crew path and records
who spoke each turn, how long, and the full transcript for side-by-side review.

Run (live model, costs platform quota):
    cd backend && uv run python -m eval.crew_feel --label after
Writes /tmp/voice-eval/crew-<label>.json and prints the counts.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path

from config import settings
from agents.director import DirectorAgent
from agents.provider import ProviderFacade

SCENARIOS = [
    ("walter", "family member", [
        "沃尔特，你昨晚到底去哪了？",
        "杰西，你信他吗？",
        "你们俩能不能别吵了。",
        "汉克要是知道了怎么办？",
    ]),
    ("skyler", "family member", [
        "斯凯勒，家里的账是不是对不上？",
        "玛丽，你怎么看？",
        "你们俩别互相猜了。",
        "那现在怎么办？",
    ]),
    ("saul", "client", [
        "索尔，我惹上麻烦了。",
        "麦克，你能帮我处理吗？",
        "你们俩谁说了算？",
        "多少钱？",
    ]),
    ("gus", "employee", [
        "在吗？",
        "古斯先生，新来的人可靠吗？",
        "沃尔特说你在骗他。",
        "好吧，我先走了。",
    ]),
]

IN_PERSON = re.compile(r"坐下[说吧。]|先坐|坐吧|进来[说吧坐。]|闻到|坐这|sit down|come in")


async def play(director: DirectorAgent, primary: str, relation: str, lines: list[str]) -> dict:
    history: list[dict] = []
    turns = []
    for line in lines:
        out = await director.handle_chat_message(
            primary, line,
            {"mode": "crew", "relation": relation, "language": "zh", "history": list(history)},
        )
        logs = [{"sender": l["sender"], "text": l["text"]} for l in out.get("debate_logs", [])]
        turns.append({"user": line, "replies": logs})
        history.append({"sender": "user", "text": line})
        history.extend({"sender": l["sender"], "text": l["text"]} for l in logs)
    return {"primary": primary, "turns": turns}


async def run(label: str) -> dict:
    provider = ProviderFacade(settings)
    director = DirectorAgent(provider, model_route=settings.director_model_route)
    convos = await asyncio.gather(*(play(director, p, r, ls) for p, r, ls in SCENARIOS))
    turns = [t for c in convos for t in c["turns"]]
    lines = [r["text"] for t in turns for r in t["replies"]]
    counts = [len(t["replies"]) for t in turns]
    result = {
        "label": label,
        "speakers_per_turn": round(sum(counts) / len(counts), 2),
        "max_speakers": max(counts),
        "turns_with_one": sum(c == 1 for c in counts),
        "turns_with_two": sum(c == 2 for c in counts),
        "turns_with_three_plus": sum(c >= 3 for c in counts),
        "avg_chars_per_line": round(sum(len(l) for l in lines) / max(1, len(lines)), 1),
        "in_person_lines": sum(bool(IN_PERSON.search(l)) for l in lines),
        "convos": convos,
    }
    out = Path("/tmp/voice-eval") / f"crew-{label}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="run")
    args = ap.parse_args()
    r = asyncio.run(run(args.label))
    print(json.dumps({k: v for k, v in r.items() if k != "convos"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
