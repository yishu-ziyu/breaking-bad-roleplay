#!/usr/bin/env python3
"""Relationship Q&A eval: do speakers invent kinship when naming absent people?

Issue #81: crew replies mentioned people who were not in the room and invented
show-wrong ties (Jesse calling Hank his brother-in-law / the guy who mooches
dinner at "our house"; Jesse vocative-"Walter"; Marie treating Saul as family).

This harness runs those crew prompts through the real chat path and scores
replies with the same mechanical flags as the unit tests
(``agents.cast_relations.flag_relation_errors``): invented kinship, wrong
household, wrong form of address.

Run (live model, costs platform quota):
    cd backend && uv run python -m eval.relationship_qa --label after

Compare two runs:
    cd backend && uv run python -m eval.relationship_qa \\
        --compare /tmp/voice-eval/rel-qa-before.json /tmp/voice-eval/rel-qa-after.json

Writes /tmp/voice-eval/rel-qa-<label>.json and prints per-case flags.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from agents.cast_relations import flag_relation_errors
from agents.director import DirectorAgent
from agents.provider import ProviderFacade
from config import settings

# Crew prompts that name someone who may not be speaking.
# primary / relation match the app's first offered anchors.
SCENARIOS: list[dict[str, str]] = [
    {
        "id": "jesse_hank_finds_out",
        "primary": "jesse",
        "speaker": "jesse",
        "relation": "partner",
        "message": "汉克要是知道了怎么办？",
    },
    {
        "id": "walter_crew_jesse_about_hank",
        "primary": "walter",
        "speaker": "jesse",
        "relation": "family member",
        "message": "杰西，汉克要是知道了怎么办？",
    },
    {
        "id": "marie_who_is_saul",
        "primary": "marie",
        "speaker": "marie",
        "relation": "neighbor",
        "message": "索尔是谁？",
    },
]


async def _crew(director: DirectorAgent, primary: str, relation: str, message: str) -> list[dict]:
    out = await director.handle_chat_message(
        primary,
        message,
        {
            "mode": "crew",
            "relation": relation,
            "language": "zh",
            "history": [],
        },
    )
    return [
        {"sender": str(row.get("sender") or ""), "text": str(row.get("text") or "")}
        for row in (out.get("debate_logs") or [])
        if isinstance(row, dict)
    ]


def _score_logs(speaker: str, logs: list[dict]) -> dict:
    texts = [row["text"] for row in logs if row.get("sender") == speaker]
    if not texts:
        return {"texts": [], "flags": ["no_speaker_line"], "pass": False}
    joined = "\n".join(texts)
    flags = flag_relation_errors(speaker, joined)
    return {"texts": texts, "flags": flags, "pass": not flags}


async def run(label: str) -> dict:
    provider = ProviderFacade(settings)
    director = DirectorAgent(provider, model_route=settings.director_model_route)
    cases = []
    for spec in SCENARIOS:
        try:
            logs = await _crew(director, spec["primary"], spec["relation"], spec["message"])
            scored = _score_logs(spec["speaker"], logs)
            error = ""
        except Exception as exc:
            logs = []
            scored = {"texts": [], "flags": ["error"], "pass": False}
            error = str(exc)[:200]
        cases.append({**spec, "logs": logs, "error": error, **scored})
    passed = sum(1 for c in cases if c["pass"])
    result = {
        "label": label,
        "total": f"{passed}/{len(cases)}",
        "cases": cases,
    }
    out = Path("/tmp/voice-eval") / f"rel-qa-{label}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    return result


def compare(before_path: Path, after_path: Path) -> dict:
    before = json.loads(before_path.read_text())
    after = json.loads(after_path.read_text())
    rows = []
    after_by_id = {c["id"]: c for c in after.get("cases") or []}
    for old in before.get("cases") or []:
        new = after_by_id.get(old["id"], {})
        rows.append(
            {
                "id": old["id"],
                "before_pass": old.get("pass"),
                "after_pass": new.get("pass"),
                "before_flags": old.get("flags") or [],
                "after_flags": new.get("flags") or [],
            }
        )
    return {
        "before": before.get("label"),
        "after": after.get("label"),
        "before_total": before.get("total"),
        "after_total": after.get("total"),
        "cases": rows,
    }


def summarize(result: dict) -> dict:
    return {
        "label": result.get("label"),
        "total": result.get("total"),
        "cases": [
            {
                "id": c["id"],
                "pass": c.get("pass"),
                "flags": c.get("flags") or [],
                "sample": (c.get("texts") or [""])[0][:180],
            }
            for c in result.get("cases") or []
        ],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="run")
    ap.add_argument("--compare", nargs=2, metavar=("BEFORE", "AFTER"))
    args = ap.parse_args()
    if args.compare:
        print(json.dumps(compare(Path(args.compare[0]), Path(args.compare[1])), ensure_ascii=False, indent=2))
        return
    result = asyncio.run(run(args.label))
    print(json.dumps(summarize(result), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
